import hashlib
import io
import zipfile

import pytest

from book_backend.epubs.generation import GenerationRejected, StructuredSource, generate_epub
from book_backend.epubs.safety import inspect_epub
from book_backend.epubs.validator import EpubcheckValidator


def test_generator_builds_a_deterministic_navigable_epub_without_changing_source_text():
    source_bytes = b"""<!doctype html>
<html lang="en"><body>
  <h1>The First Chapter</h1>
  <p>A quiet <em>first</em> line with <a href="https://example.org">a link</a>.</p>
  <pre>Roses are red\n  violets are blue</pre>
  <h1>The Second Chapter</h1>
  <p>A second line with a footnote<a href="#note-1"><sup>1</sup></a>.</p>
  <aside id="note-1"><p>1. A preserved note.</p></aside>
</body></html>"""
    source = StructuredSource(
        source_id="fixture:structured-open-text",
        canonical_url="https://example.invalid/structured-open-text",
        title="Structured Open Text",
        authors=("Example Author",),
        language="en",
        content=source_bytes,
        license_name="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        attribution="Example Author, Structured Open Text, CC BY 4.0.",
    )

    generated = generate_epub(source, generated_at="2026-07-10T20:00:00Z")
    repeated = generate_epub(source, generated_at="2026-07-10T20:00:00Z")

    assert generated.source_sha256 == hashlib.sha256(source_bytes).hexdigest()
    assert generated.final_sha256 == hashlib.sha256(generated.content).hexdigest()
    assert repeated.content == generated.content
    assert generated.chapter_titles == ("The First Chapter", "The Second Chapter")
    assert generated.normalized_output_text == generated.normalized_source_text
    assert generated.generator_version
    inspection = inspect_epub(generated.content)
    assert inspection.package_path == "EPUB/package.opf"

    with zipfile.ZipFile(io.BytesIO(generated.content)) as archive:
        assert archive.namelist()[0] == "mimetype"
        assert "EPUB/nav.xhtml" in archive.namelist()
        assert "EPUB/license.xhtml" in archive.namelist()
        assert "EPUB/cover.svg" in archive.namelist()
        package = archive.read("EPUB/package.opf").decode()
        assert 'properties="cover-image"' in package
        assert '<meta property="schema:accessMode">textual</meta>' in package
        assert '<meta property="schema:accessibilityFeature">structuralNavigation</meta>' in package
        assert '<meta property="schema:accessibilityHazard">none</meta>' in package
        assert "https://example.invalid/structured-open-text" in package
        assert "The First Chapter" in archive.read("EPUB/nav.xhtml").decode()
        first_chapter = archive.read("EPUB/chapter-001.xhtml").decode()
        assert 'href="https://example.org"' in first_chapter
        assert "Roses are red\n  violets are blue" in first_chapter
        second_chapter = archive.read("EPUB/chapter-002.xhtml").decode()
        assert 'href="#note-1"' in second_chapter
        assert '<aside id="note-1">' in second_chapter
        assert (
            "Example Author, Structured Open Text, CC BY 4.0."
            in archive.read("EPUB/license.xhtml").decode()
        )


def test_generator_converts_explicitly_structured_plain_text_without_changing_words():
    source_bytes = b"""# The First Plain-Text Chapter

A paragraph that wraps\nacross source lines.

# The Second Plain-Text Chapter

A second preserved paragraph."""
    source = StructuredSource(
        source_id="fixture:structured-plain-text",
        canonical_url="https://example.invalid/structured-plain-text",
        title="Structured Plain Text",
        authors=("Example Author",),
        language="en",
        content=source_bytes,
        license_name="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Example Author, Structured Plain Text, CC0 1.0.",
        content_format="plain_text",
    )

    generated = generate_epub(source, generated_at="2026-07-10T20:00:00Z")

    assert generated.chapter_titles == (
        "The First Plain-Text Chapter",
        "The Second Plain-Text Chapter",
    )
    assert generated.normalized_output_text == generated.normalized_source_text
    with zipfile.ZipFile(io.BytesIO(generated.content)) as archive:
        chapter = archive.read("EPUB/chapter-001.xhtml").decode()
        assert "A paragraph that wraps across source lines." in chapter


def test_generator_treats_crlf_as_single_line_endings_in_plain_text():
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:crlf-plain-text",
            canonical_url="https://example.invalid/crlf-plain-text",
            title="CRLF Plain Text",
            authors=("Example Author",),
            language="en",
            content=(
                b"# Chapter\r\n\r\n"
                b"The first paragraph wraps\r\nacross source lines.\r\n\r\n"
                b"The second paragraph stays separate."
            ),
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Example Author, CRLF Plain Text, CC0 1.0.",
            content_format="plain_text",
        ),
        generated_at="2026-07-10T20:00:00Z",
    )

    assert generated.normalized_source_text == (
        "Chapter\n\nThe first paragraph wraps across source lines.\n\n"
        "The second paragraph stays separate."
    )
    with zipfile.ZipFile(io.BytesIO(generated.content)) as archive:
        chapter = archive.read("EPUB/chapter-001.xhtml").decode()
        assert chapter.count("<p>") == 2
        assert "The first paragraph wraps across source lines." in chapter
        assert "The second paragraph stays separate." in chapter


def test_generator_accepts_a_valid_offset_timestamp_for_deterministic_packaging():
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:offset-timestamp",
            canonical_url="https://example.invalid/offset-timestamp",
            title="Offset Timestamp",
            authors=("Example Author",),
            language="en",
            content=b"<html><body><h1>Chapter</h1><p>Preserved text.</p></body></html>",
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Example Author, CC0 1.0.",
        ),
        generated_at="2026-07-10T20:00:00+00:00",
    )

    assert generated.content.startswith(b"PK")


def test_generator_preserves_explicit_html_line_breaks_without_losing_text():
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:line-breaks",
            canonical_url="https://example.invalid/line-breaks",
            title="Line Breaks",
            authors=("Example Author",),
            language="en",
            content=(
                b"<html><body><h1>Chapter</h1><p>First line<br/>Second line.</p></body></html>"
            ),
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Example Author, CC0 1.0.",
        ),
        generated_at="2026-07-10T20:00:00Z",
    )

    assert generated.normalized_output_text == generated.normalized_source_text
    with zipfile.ZipFile(io.BytesIO(generated.content)) as archive:
        assert "<br/>" in archive.read("EPUB/chapter-001.xhtml").decode()


@pytest.mark.parametrize(
    ("content", "expected_text"),
    [
        (
            b"<html><body><h1>Chapter</h1><blockquote><p>First quote.</p>"
            b"<p>Second quote.</p></blockquote></body></html>",
            "Chapter\n\nFirst quote. Second quote.",
        ),
        (
            b"<html><body><h1>Chapter</h1><ol><li>First item.</li>"
            b"<li>Second item.</li></ol></body></html>",
            "Chapter\n\nFirst item. Second item.",
        ),
    ],
)
def test_generator_preserves_text_boundaries_in_compact_nested_blocks(
    content: bytes, expected_text: str
):
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:compact-nested-blocks",
            canonical_url="https://example.invalid/compact-nested-blocks",
            title="Compact Nested Blocks",
            authors=("Example Author",),
            language="en",
            content=content,
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Example Author, CC0 1.0.",
        ),
        generated_at="2026-07-10T20:00:00Z",
    )

    assert generated.normalized_source_text == expected_text
    assert generated.normalized_output_text == expected_text


def test_generator_preserves_utf8_source_text_without_rewriting_it():
    source_text = "<html><body><h1>Résumé</h1><p>Café — naïve &amp; coöperative.</p></body></html>"
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:utf8",
            canonical_url="https://example.invalid/utf8",
            title="Résumé",
            authors=("Élodie Example",),
            language="fr",
            content=source_text.encode(),
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Élodie Example, CC0 1.0.",
        ),
        generated_at="2026-07-10T20:00:00Z",
    )

    assert generated.normalized_output_text == "Résumé\n\nCafé — naïve & coöperative."
    with zipfile.ZipFile(io.BytesIO(generated.content)) as archive:
        assert "Café — naïve &amp; coöperative." in archive.read("EPUB/chapter-001.xhtml").decode()


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (
            b"<html><body><h1>Chapter</h1><script>alert('no')</script></body></html>",
            "Unsupported active or remote HTML element",
        ),
        (
            b"<html><body><h1>Chapter</h1><img alt='cover'/></body></html>",
            "Unsupported active or remote HTML element",
        ),
        (
            b"<html><body><p>No chapter heading.</p></body></html>",
            "must begin with an h1 chapter heading",
        ),
        (b"<html><body><h1>Chapter</h1><p>Unclosed paragraph", "unclosed element"),
    ],
)
def test_generator_refuses_unsafe_or_ambiguous_html(content: bytes, message: str):
    source = StructuredSource(
        source_id="fixture:ineligible-html",
        canonical_url="https://example.invalid/ineligible-html",
        title="Ineligible HTML",
        authors=("Example Author",),
        language="en",
        content=content,
        license_name="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Example Author, CC0 1.0.",
    )

    with pytest.raises(GenerationRejected, match=message):
        generate_epub(source, generated_at="2026-07-10T20:00:00Z")


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (
            b"<html><body><h1 class='chapter'>Chapter</h1><p>Text.</p></body></html>",
            "Unsupported HTML attribute: class",
        ),
        (
            b"<html><body><h1>Chapter</h1><p>"
            b"<a href='javascript:alert(1)'>Text</a></p></body></html>",
            "Unsafe HTML attribute value: href",
        ),
        (
            b"<html><body><h1 id='not a valid id'>Chapter</h1><p>Text.</p></body></html>",
            "Unsafe HTML attribute value: id",
        ),
        (
            b"<html><body><h1>Chapter</h1><p data-source='unreviewed'>Text.</p></body></html>",
            "Unsupported HTML attribute: data-source",
        ),
    ],
)
def test_generator_rejects_attributes_it_cannot_preserve_safely(content: bytes, message: str):
    source = StructuredSource(
        source_id="fixture:invalid-attribute",
        canonical_url="https://example.invalid/invalid-attribute",
        title="Invalid Attribute",
        authors=("Example Author",),
        language="en",
        content=content,
        license_name="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Example Author, CC0 1.0.",
    )

    with pytest.raises(GenerationRejected, match=message):
        generate_epub(source, generated_at="2026-07-10T20:00:00Z")


@pytest.mark.parametrize(
    "content",
    [
        b"<body><h1>Chapter</h1><p>Text.</p></body>",
        b"<html><body><h1>Chapter</h1><p><p>Nested text.</p></p></body></html>",
        b"<html><body><aside><h1>Hidden chapter</h1></aside>"
        b"<h1>Chapter</h1><p>Text.</p></body></html>",
    ],
)
def test_generator_rejects_ambiguous_document_or_element_nesting(content: bytes):
    source = StructuredSource(
        source_id="fixture:invalid-nesting",
        canonical_url="https://example.invalid/invalid-nesting",
        title="Invalid Nesting",
        authors=("Example Author",),
        language="en",
        content=content,
        license_name="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Example Author, CC0 1.0.",
    )

    with pytest.raises(GenerationRejected, match="nesting|document"):
        generate_epub(source, generated_at="2026-07-10T20:00:00Z")


@pytest.mark.anyio
async def test_generated_epub_passes_epubcheck():
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:epubcheck",
            canonical_url="https://example.invalid/epubcheck",
            title="EPUBCheck Source",
            authors=("Example Author",),
            language="en",
            content=b"<html><body><h1>Chapter one</h1><p>A valid paragraph.</p></body></html>",
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Example Author, CC0 1.0.",
        ),
        generated_at="2026-07-10T20:00:00Z",
    )

    validation = await EpubcheckValidator().validate(generated.content)

    assert validation.valid is True


@pytest.mark.anyio
async def test_rich_generated_epub_with_notes_and_poetry_passes_epubcheck():
    generated = generate_epub(
        StructuredSource(
            source_id="fixture:rich-epubcheck",
            canonical_url="https://example.invalid/rich-epubcheck",
            title="Rich EPUBCheck Source",
            authors=("Example Author",),
            language="en",
            content=(
                b"<!doctype html><html lang='en'><body>"
                b"<h1>Chapter one</h1><p>A <em>preserved</em> sentence "
                b"with a <a href='#note-one'><sup>1</sup></a>.</p>"
                b"<pre>A short line\n  with poetic spacing</pre>"
                b"<aside id='note-one'><p>1. A preserved note.</p></aside>"
                b"<h1>Chapter two</h1><blockquote><p>Another preserved passage.</p></blockquote>"
                b"</body></html>"
            ),
            license_name="CC0 1.0",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Example Author, CC0 1.0.",
        ),
        generated_at="2026-07-10T20:00:00Z",
    )

    validation = await EpubcheckValidator().validate(generated.content)

    assert validation.valid is True
