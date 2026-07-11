from io import BytesIO

import pytest
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from book_backend.pdfs.analysis import PdfRejected, analyze_pdf


def _single_column_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    for page_number, lines in enumerate(
        (
            (
                "This is a reliable paragraph with hyphen-",
                "ation across a source line.",
            ),
            ("A second page continues the authorized source.",),
        ),
        start=1,
    ):
        document.setFont("Times-Roman", 10)
        document.drawString(72, 760, "Reviewed source header")
        y = 720
        for line in lines:
            document.drawString(72, y, line)
            y -= 14
        document.drawString(72, 60, str(page_number))
        document.showPage()
    document.save()
    return output.getvalue()


def _two_column_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "Left column first line.")
    document.drawString(72, 706, "Left column second line.")
    document.drawString(340, 720, "Right column first line.")
    document.drawString(340, 706, "Right column second line.")
    document.save()
    return output.getvalue()


def _image_only_pdf() -> bytes:
    image_buffer = BytesIO()
    Image.new("RGB", (32, 32), color="black").save(image_buffer, format="PNG")
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    image = ImageReader(BytesIO(image_buffer.getvalue()))
    document.drawImage(image, 72, 600, width=200, height=100)
    document.save()
    return output.getvalue()


def _table_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    for x in (72, 240, 408):
        document.line(x, 650, x, 720)
    for y in (650, 685, 720):
        document.line(72, y, 408, y)
    document.drawString(84, 698, "Column one")
    document.drawString(252, 698, "Column two")
    document.drawString(84, 663, "Value one")
    document.drawString(252, 663, "Value two")
    document.save()
    return output.getvalue()


def _math_or_footer_pdf(*, include_math: bool) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "This line is otherwise ordinary.")
    if include_math:
        document.drawString(72, 706, "x = y")
    else:
        document.drawString(72, 60, "Unclassified footer note")
    document.save()
    return output.getvalue()


def _ambiguous_hyphen_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "This source preserves a visible dash-")
    document.drawString(72, 706, "Next sentence begins with uppercase text.")
    document.save()
    return output.getvalue()


def _ambiguous_footnote_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "This prose paragraph has a superscript-style reference.")
    document.drawString(72, 706, "Its source page does not preserve a verifiable relationship.")
    document.setFont("Times-Roman", 7)
    document.drawString(96, 676, "1. A small indented note has no trustworthy anchor.")
    document.save()
    return output.getvalue()


def _marginalia_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "The main prose begins in its expected column.")
    document.drawString(72, 706, "It continues in the same reading column.")
    document.drawString(360, 692, "An unclassified side note appears separately.")
    document.save()
    return output.getvalue()


def test_analyzer_converts_a_simple_text_pdf_with_accounted_blocks_and_artifact_removal():
    analysis = analyze_pdf(_single_column_pdf(), title="Authorized PDF Source")

    assert analysis.normalized_body_text == (
        "This is a reliable paragraph with hyphenation across a source line.\n\n"
        "A second page continues the authorized source."
    )
    assert analysis.accounted_block_ids == tuple(block.block_id for block in analysis.body_blocks)
    assert {removal.reason for removal in analysis.removed_blocks} == {
        "running_header",
        "page_number",
    }
    intermediate = analysis.intermediate_html.decode()
    assert "<h1>Authorized PDF Source</h1>" in intermediate
    assert "hyphenation across a source line." in intermediate
    assert "Reviewed source header" not in intermediate


def test_pdf_fixture_bytes_are_deterministic_for_hash_and_provenance_tests():
    assert _single_column_pdf() == _single_column_pdf()


def test_analyzer_refuses_a_multi_column_pdf_before_generating_html():
    with pytest.raises(PdfRejected, match="multiple text columns"):
        analyze_pdf(_two_column_pdf(), title="Two Columns")


def test_analyzer_refuses_an_image_only_pdf_before_generating_html():
    with pytest.raises(PdfRejected, match="image-led"):
        analyze_pdf(_image_only_pdf(), title="Scanned Source")


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (_table_pdf(), "tables"),
        (_math_or_footer_pdf(include_math=True), "notation"),
        (_math_or_footer_pdf(include_math=False), "footer or marginalia"),
    ],
)
def test_analyzer_refuses_layout_or_notation_it_cannot_account_for(content: bytes, message: str):
    with pytest.raises(PdfRejected, match=message):
        analyze_pdf(content, title="Ineligible PDF")


def test_analyzer_only_rejoins_a_line_end_hyphen_when_the_continuation_is_unambiguous():
    analysis = analyze_pdf(_ambiguous_hyphen_pdf(), title="Ambiguous Hyphen")

    assert analysis.normalized_body_text == (
        "This source preserves a visible dash- Next sentence begins with uppercase text."
    )


def test_analyzer_refuses_an_ambiguous_footnote_instead_of_merging_it_into_prose():
    with pytest.raises(PdfRejected, match="footnote"):
        analyze_pdf(_ambiguous_footnote_pdf(), title="Ambiguous Footnote")


def test_analyzer_refuses_single_line_marginalia_instead_of_guessing_its_reading_order():
    with pytest.raises(PdfRejected, match="multiple text columns"):
        analyze_pdf(_marginalia_pdf(), title="Marginalia")
