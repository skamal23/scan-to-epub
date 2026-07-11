import io
import re
from collections import Counter
from dataclasses import dataclass
from html import escape
from statistics import median

import pdfplumber
from pypdf import PdfReader
from pypdf.errors import PdfReadError

ANALYZER_VERSION = "guarded-pdf/1"
_PAGE_NUMBER = re.compile(r"(?:page\s+)?\d{1,4}\Z", re.IGNORECASE)
_MATH_SYMBOL = re.compile(r"[=±√∑∫{}]")
_FOOTNOTE_MARKER = re.compile(r"(?:\d+[.)\]]|[*†‡])\s")
_MAX_PAGES = 50


class PdfRejected(ValueError):
    """Raised when a PDF cannot safely enter the deterministic EPUB path."""


@dataclass(frozen=True, slots=True)
class PdfBodyBlock:
    block_id: str
    page_number: int
    line_number: int
    text: str


@dataclass(frozen=True, slots=True)
class PdfRemovedBlock:
    block_id: str
    page_number: int
    line_number: int
    text: str
    reason: str


@dataclass(frozen=True, slots=True)
class PdfAnalysis:
    intermediate_html: bytes
    normalized_body_text: str
    body_blocks: tuple[PdfBodyBlock, ...]
    accounted_block_ids: tuple[str, ...]
    removed_blocks: tuple[PdfRemovedBlock, ...]
    page_count: int
    analyzer_version: str


@dataclass(frozen=True, slots=True)
class _PdfLine:
    block_id: str
    page_number: int
    line_number: int
    text: str
    x0: float
    top: float
    bottom: float
    font_size: float
    page_width: float
    page_height: float


@dataclass(frozen=True, slots=True)
class _Paragraph:
    source_block_ids: tuple[str, ...]
    text: str


def analyze_pdf(content: bytes, *, title: str) -> PdfAnalysis:
    """Return an auditable strict-HTML representation of a simple text PDF.

    The implementation accepts a deliberately small subset of layout: consistent,
    single-column pages with a real text layer and no images, forms, tables, or
    unexplained footer material. It rejects rather than guessing at reading order.
    """

    normalized_title = " ".join(title.split())
    if not content or not normalized_title:
        raise PdfRejected("PDF content or title is missing")
    _validate_pdf_container(content)
    try:
        with pdfplumber.open(io.BytesIO(content)) as document:
            if not document.pages:
                raise PdfRejected("PDF has no pages")
            if len(document.pages) > _MAX_PAGES:
                raise PdfRejected("PDF has too many pages for the guarded converter")
            lines = _extract_lines(document)
    except PdfRejected:
        raise
    except Exception as error:
        raise PdfRejected("PDF could not be analyzed safely") from error

    removed, body = _classify_lines(lines)
    _validate_body_layout(body)
    paragraphs = _paragraphs_from_body(body)
    accounted_block_ids = tuple(
        block_id for paragraph in paragraphs for block_id in paragraph.source_block_ids
    )
    expected_block_ids = tuple(block.block_id for block in body)
    if (
        len(accounted_block_ids) != len(set(accounted_block_ids))
        or accounted_block_ids != expected_block_ids
    ):
        raise PdfRejected("PDF body-text accounting was incomplete or duplicated")

    normalized_body_text = "\n\n".join(_normalize_text(paragraph.text) for paragraph in paragraphs)
    if not normalized_body_text:
        raise PdfRejected("PDF has no reliable body text")
    return PdfAnalysis(
        intermediate_html=_intermediate_html(normalized_title, paragraphs),
        normalized_body_text=normalized_body_text,
        body_blocks=tuple(
            PdfBodyBlock(
                block_id=block.block_id,
                page_number=block.page_number,
                line_number=block.line_number,
                text=block.text,
            )
            for block in body
        ),
        accounted_block_ids=accounted_block_ids,
        removed_blocks=tuple(
            PdfRemovedBlock(
                block_id=block.block_id,
                page_number=block.page_number,
                line_number=block.line_number,
                text=block.text,
                reason=reason,
            )
            for block, reason in removed
        ),
        page_count=len({line.page_number for line in lines}),
        analyzer_version=ANALYZER_VERSION,
    )


def _validate_pdf_container(content: bytes) -> None:
    if not content.startswith(b"%PDF-"):
        raise PdfRejected("Source is not a PDF document")
    try:
        reader = PdfReader(io.BytesIO(content))
    except PdfReadError as error:
        raise PdfRejected("PDF container could not be read") from error
    if reader.is_encrypted:
        raise PdfRejected("Encrypted PDFs are not eligible for conversion")
    if not reader.pages:
        raise PdfRejected("PDF has no pages")


def _extract_lines(document: pdfplumber.PDF) -> tuple[_PdfLine, ...]:
    first_width: float | None = None
    first_height: float | None = None
    lines: list[_PdfLine] = []
    for page_number, page in enumerate(document.pages, start=1):
        if page.images:
            raise PdfRejected("PDF is image-led or contains unreviewed images")
        if page.annots:
            raise PdfRejected("PDF forms or annotations are not eligible for conversion")
        if page.find_tables():
            raise PdfRejected("PDF tables are not eligible for conversion")
        _reject_multi_column_word_rows(page)
        if first_width is None:
            first_width, first_height = page.width, page.height
        elif abs(page.width - first_width) > 1 or abs(page.height - first_height) > 1:
            raise PdfRejected("PDF page dimensions are inconsistent")

        page_lines = page.extract_text_lines(strip=True, return_chars=True)
        if not page_lines:
            raise PdfRejected("PDF page has no reliable extractable text")
        for line_number, raw in enumerate(page_lines, start=1):
            text = _normalize_text(raw["text"])
            if not text:
                continue
            chars = raw["chars"]
            if not chars:
                raise PdfRejected("PDF text layout could not be analyzed safely")
            if "\ufffd" in text or _MATH_SYMBOL.search(text):
                raise PdfRejected("PDF text quality or notation is not eligible for conversion")
            lines.append(
                _PdfLine(
                    block_id=f"p{page_number}-l{line_number}",
                    page_number=page_number,
                    line_number=line_number,
                    text=text,
                    x0=float(raw["x0"]),
                    top=float(raw["top"]),
                    bottom=float(raw["bottom"]),
                    font_size=float(median(float(char["size"]) for char in chars)),
                    page_width=page.width,
                    page_height=page.height,
                )
            )
    if not lines:
        raise PdfRejected("PDF has no reliable extractable text")
    return tuple(lines)


def _reject_multi_column_word_rows(page: pdfplumber.page.Page) -> None:
    words_by_row: dict[int, list[dict]] = {}
    for word in page.extract_words():
        words_by_row.setdefault(round(float(word["top"]) / 2), []).append(word)
    separated_rows = 0
    for words in words_by_row.values():
        ordered = sorted(words, key=lambda word: float(word["x0"]))
        if any(
            float(following["x0"]) - float(previous["x1"]) >= page.width * 0.2
            for previous, following in zip(ordered, ordered[1:], strict=False)
        ):
            separated_rows += 1
    if separated_rows >= 2:
        raise PdfRejected("PDF has multiple text columns")


def _classify_lines(
    lines: tuple[_PdfLine, ...],
) -> tuple[list[tuple[_PdfLine, str]], list[_PdfLine]]:
    header_counts = Counter(
        line.text.casefold() for line in lines if line.top <= line.page_height * 0.15
    )
    repeated_headers = {text for text, count in header_counts.items() if count >= 2}
    removed: list[tuple[_PdfLine, str]] = []
    body: list[_PdfLine] = []
    for line in lines:
        if line.top <= line.page_height * 0.15 and line.text.casefold() in repeated_headers:
            removed.append((line, "running_header"))
        elif line.bottom >= line.page_height * 0.85 and _PAGE_NUMBER.fullmatch(line.text):
            removed.append((line, "page_number"))
        elif line.top >= line.page_height * 0.85:
            raise PdfRejected("PDF has unclassified footer or marginalia")
        else:
            body.append(line)
    if not body:
        raise PdfRejected("PDF has no body text after artifact removal")
    return removed, body


def _validate_body_layout(body: list[_PdfLine]) -> None:
    by_page: dict[int, list[_PdfLine]] = {}
    for line in body:
        by_page.setdefault(line.page_number, []).append(line)
    for lines in by_page.values():
        _reject_ambiguous_footnotes(lines)
        _reject_multi_column_layout(lines)
        sorted_lines = sorted(lines, key=lambda line: (line.top, line.x0))
        if any(
            following.top + 0.5 < previous.top
            for previous, following in zip(sorted_lines, sorted_lines[1:], strict=False)
        ):
            raise PdfRejected("PDF reading order is ambiguous")


def _reject_ambiguous_footnotes(lines: list[_PdfLine]) -> None:
    body_font_size = median(line.font_size for line in lines)
    for line in lines:
        if line.font_size <= body_font_size * 0.8 and _FOOTNOTE_MARKER.match(line.text):
            raise PdfRejected("PDF has an ambiguous footnote relationship")


def _reject_multi_column_layout(lines: list[_PdfLine]) -> None:
    positions: dict[int, list[float]] = {}
    for line in lines:
        positions.setdefault(round(line.x0 / 12), []).append(line.x0)
    left_edges = [sum(values) / len(values) for values in positions.values()]
    for index, left in enumerate(left_edges):
        if any(abs(right - left) >= lines[0].page_width * 0.2 for right in left_edges[index + 1 :]):
            raise PdfRejected("PDF has multiple text columns")


def _paragraphs_from_body(body: list[_PdfLine]) -> tuple[_Paragraph, ...]:
    by_page: dict[int, list[_PdfLine]] = {}
    for line in body:
        by_page.setdefault(line.page_number, []).append(line)
    paragraphs: list[_Paragraph] = []
    for page_number in sorted(by_page):
        lines = sorted(by_page[page_number], key=lambda line: (line.top, line.x0))
        paragraphs.extend(_paragraphs_from_page(lines))
    return tuple(paragraphs)


def _paragraphs_from_page(lines: list[_PdfLine]) -> tuple[_Paragraph, ...]:
    if not lines:
        return ()
    vertical_steps = [
        following.top - previous.top
        for previous, following in zip(lines, lines[1:], strict=False)
        if following.top > previous.top
    ]
    expected_step = median(vertical_steps) if vertical_steps else 14.0
    paragraph_gap = max(20.0, expected_step * 1.8)
    source_ids: list[str] = [lines[0].block_id]
    text = lines[0].text
    paragraphs: list[_Paragraph] = []
    previous = lines[0]
    for line in lines[1:]:
        if line.top - previous.top > paragraph_gap:
            paragraphs.append(_Paragraph(tuple(source_ids), text))
            source_ids = [line.block_id]
            text = line.text
        else:
            source_ids.append(line.block_id)
            text = _join_source_lines(text, line.text)
        previous = line
    paragraphs.append(_Paragraph(tuple(source_ids), text))
    return tuple(paragraphs)


def _join_source_lines(previous: str, following: str) -> str:
    if previous.endswith("-") and following and following[0].islower():
        return previous[:-1] + following
    return f"{previous} {following}"


def _intermediate_html(title: str, paragraphs: tuple[_Paragraph, ...]) -> bytes:
    body = "".join(f"<p>{escape(_normalize_text(paragraph.text))}</p>" for paragraph in paragraphs)
    return f"<html><body><h1>{escape(title)}</h1>{body}</body></html>".encode()


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


__all__ = [
    "ANALYZER_VERSION",
    "PdfAnalysis",
    "PdfBodyBlock",
    "PdfRejected",
    "PdfRemovedBlock",
    "analyze_pdf",
]
