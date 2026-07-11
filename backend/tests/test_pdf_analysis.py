from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from book_backend.pdfs.analysis import (
    PdfRejected,
    _join_source_lines,
    _Paragraph,
    _PdfLine,
    _validate_body_accounting,
    _validate_body_layout,
    analyze_pdf,
)


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
        document.setFont("Times-Roman", 8)
        document.drawString(72, 760, "Reviewed source header")
        document.setFont("Times-Roman", 10)
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


def _acroform_without_widgets_pdf() -> bytes:
    source = BytesIO()
    document = canvas.Canvas(source, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "This text-only page carries an AcroForm dictionary.")
    document.save()

    reader = PdfReader(BytesIO(source.getvalue()))
    output = BytesIO()
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer._root_object.update({NameObject("/AcroForm"): DictionaryObject()})
    writer.write(output)
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


def _borderless_narrow_table_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    for y, left, right in (
        (720, "Term", "Meaning"),
        (706, "One", "First"),
        (692, "Two", "Second"),
    ):
        document.drawString(72, y, left)
        document.drawString(160, y, right)
    document.save()
    return output.getvalue()


def _borderless_single_row_table_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "Term")
    document.drawString(160, 720, "Meaning")
    document.save()
    return output.getvalue()


def _borderless_tight_table_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    for y, left, right in (
        (720, "A", "B"),
        (706, "C", "D"),
        (692, "E", "F"),
    ):
        document.drawString(72, y, left)
        document.drawString(102, y, right)
    document.save()
    return output.getvalue()


def _borderless_very_tight_table_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    for y, left, right in (
        (720, "A", "B"),
        (706, "C", "D"),
        (692, "E", "F"),
    ):
        document.drawString(72, y, left)
        document.drawString(86, y, right)
    document.save()
    return output.getvalue()


def _math_or_footer_pdf(*, math_text: str | None = None) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "This line is otherwise ordinary.")
    if math_text is not None:
        document.drawString(72, 706, math_text)
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


def _cross_line_notation_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "x-")
    document.drawString(72, 706, "y")
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


def _single_line_footnote_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "A short source page has one line of body prose.")
    document.setFont("Times-Roman", 7)
    document.drawString(96, 690, "1. This note has no trustworthy anchor.")
    document.save()
    return output.getvalue()


def _same_font_footnote_pdf(marker: str) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, "A body line has no retained footnote relationship.")
    document.drawString(72, 690, f"{marker} A same-font note cannot be linked safely.")
    document.save()
    return output.getvalue()


def _standalone_footnote_marker_pdf(marker: str) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, marker)
    document.drawString(72, 706, "A note without a trustworthy relationship.")
    document.save()
    return output.getvalue()


def _inline_footnote_reference_pdf(marker: str) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    document.setFont("Times-Roman", 10)
    document.drawString(72, 720, f"A claim retains an unlinked reference{marker}.")
    document.save()
    return output.getvalue()


def _body_line(block_id: str, line_number: int) -> _PdfLine:
    return _PdfLine(
        block_id=block_id,
        page_number=1,
        line_number=line_number,
        text=f"Line {line_number}.",
        x0=72,
        top=72 + line_number * 14,
        bottom=82 + line_number * 14,
        font_size=10,
        page_width=612,
        page_height=792,
    )


def _ambiguous_repeated_top_text_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output, pagesize=(612, 792), invariant=1)
    for page_number in (1, 2):
        document.setFont("Times-Roman", 10)
        document.drawString(72, 760, "Repeated top prose line.")
        document.drawString(72, 720, f"Body text for page {page_number} remains ordinary.")
        document.showPage()
    document.save()
    return output.getvalue()


def test_analyzer_converts_a_simple_text_pdf_with_accounted_blocks_and_artifact_removal():
    analysis = analyze_pdf(_single_column_pdf(), title="Authorized PDF Source")

    assert analysis.normalized_body_text == (
        "This is a reliable paragraph with hyphen-ation across a source line.\n\n"
        "A second page continues the authorized source."
    )
    assert analysis.accounted_block_ids == tuple(block.block_id for block in analysis.body_blocks)
    assert {removal.reason for removal in analysis.removed_blocks} == {
        "running_header",
        "page_number",
    }
    intermediate = analysis.intermediate_html.decode()
    assert "<h1>Authorized PDF Source</h1>" in intermediate
    assert "hyphen-ation across a source line." in intermediate
    assert "Reviewed source header" not in intermediate


def test_pdf_fixture_bytes_are_deterministic_for_hash_and_provenance_tests():
    assert _single_column_pdf() == _single_column_pdf()


def test_analyzer_refuses_a_multi_column_pdf_before_generating_html():
    with pytest.raises(PdfRejected, match="multiple text columns"):
        analyze_pdf(_two_column_pdf(), title="Two Columns")


def test_analyzer_refuses_an_image_only_pdf_before_generating_html():
    with pytest.raises(PdfRejected, match="image-led"):
        analyze_pdf(_image_only_pdf(), title="Scanned Source")


def test_analyzer_refuses_an_acroform_even_without_page_widget_annotations():
    with pytest.raises(PdfRejected, match="forms"):
        analyze_pdf(_acroform_without_widgets_pdf(), title="Form Source")


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (_table_pdf(), "tables"),
        (_borderless_narrow_table_pdf(), "multiple text columns"),
        (_borderless_single_row_table_pdf(), "multiple text columns"),
        (_borderless_tight_table_pdf(), "multiple text columns"),
        (_borderless_very_tight_table_pdf(), "multiple text columns"),
        (_math_or_footer_pdf(math_text="x = y"), "notation"),
        (_math_or_footer_pdf(math_text="x + y"), "notation"),
        (_math_or_footer_pdf(math_text="x / y"), "notation"),
        (_math_or_footer_pdf(math_text="x - y"), "notation"),
        (_math_or_footer_pdf(math_text="x^2"), "notation"),
        (_math_or_footer_pdf(), "footer or marginalia"),
    ],
)
def test_analyzer_refuses_layout_or_notation_it_cannot_account_for(content: bytes, message: str):
    with pytest.raises(PdfRejected, match=message):
        analyze_pdf(content, title="Ineligible PDF")


def test_analyzer_preserves_a_regular_line_end_hyphen():
    analysis = analyze_pdf(_ambiguous_hyphen_pdf(), title="Ambiguous Hyphen")

    assert analysis.normalized_body_text == (
        "This source preserves a visible dash- Next sentence begins with uppercase text."
    )


def test_analyzer_refuses_cross_line_notation_before_merging_it_into_prose():
    with pytest.raises(PdfRejected, match="notation"):
        analyze_pdf(_cross_line_notation_pdf(), title="Cross-line Notation")


def test_line_joining_preserves_regular_hyphens_and_removes_only_explicit_soft_hyphens():
    assert _join_source_lines("well-", "known") == "well-known"
    assert _join_source_lines("hyphen\u00ad", "ation") == "hyphenation"


def test_analyzer_refuses_an_ambiguous_footnote_instead_of_merging_it_into_prose():
    with pytest.raises(PdfRejected, match="footnote"):
        analyze_pdf(_ambiguous_footnote_pdf(), title="Ambiguous Footnote")


def test_analyzer_refuses_single_line_marginalia_instead_of_guessing_its_reading_order():
    with pytest.raises(PdfRejected, match="multiple text columns"):
        analyze_pdf(_marginalia_pdf(), title="Marginalia")


def test_analyzer_refuses_an_ambiguous_footnote_when_a_page_has_only_one_body_line():
    with pytest.raises(PdfRejected, match="footnote"):
        analyze_pdf(_single_line_footnote_pdf(), title="Single-line Footnote")


@pytest.mark.parametrize("marker", ["[1]", "1", "(1)"])
def test_analyzer_refuses_a_same_font_footnote_without_an_anchor(marker: str):
    with pytest.raises(PdfRejected, match="footnote"):
        analyze_pdf(_same_font_footnote_pdf(marker), title="Same-font Footnote")


@pytest.mark.parametrize("marker", ["[1]", "(1)"])
def test_analyzer_refuses_a_standalone_footnote_marker(marker: str):
    with pytest.raises(PdfRejected, match="footnote"):
        analyze_pdf(_standalone_footnote_marker_pdf(marker), title="Standalone Footnote")


@pytest.mark.parametrize("marker", ["[1]", " (1)"])
def test_analyzer_refuses_an_inline_footnote_reference(marker: str):
    with pytest.raises(PdfRejected, match="footnote"):
        analyze_pdf(_inline_footnote_reference_pdf(marker), title="Inline Footnote")


def test_analyzer_refuses_repeated_top_text_without_confident_header_evidence():
    with pytest.raises(PdfRejected, match="ambiguous running header"):
        analyze_pdf(_ambiguous_repeated_top_text_pdf(), title="Ambiguous Header")


@pytest.mark.parametrize(
    "paragraphs",
    [
        (_Paragraph(("p1-l1",), "Line 1."),),
        (
            _Paragraph(("p1-l1", "p1-l1"), "Line 1."),
            _Paragraph(("p1-l2",), "Line 2."),
        ),
        (
            _Paragraph(("p1-l2",), "Line 2."),
            _Paragraph(("p1-l1",), "Line 1."),
        ),
    ],
)
def test_body_accounting_refuses_missing_duplicated_or_reordered_pdf_blocks(paragraphs):
    body = [_body_line("p1-l1", 1), _body_line("p1-l2", 2)]

    with pytest.raises(PdfRejected, match="accounting"):
        _validate_body_accounting(body, paragraphs)


def test_layout_validation_refuses_extraction_order_that_disagrees_with_geometry():
    with pytest.raises(PdfRejected, match="reading order"):
        _validate_body_layout([_body_line("p1-l2", 2), _body_line("p1-l1", 1)])
