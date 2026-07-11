import hashlib
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime
from html import escape
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import urlsplit
from xml.sax.saxutils import quoteattr

from defusedxml import ElementTree

GENERATOR_VERSION = "structured-epub/1"
_DOCUMENT_TAGS = frozenset({"html", "body"})
_ROOT_BLOCK_TAGS = frozenset({"h1", "h2", "h3", "p", "pre", "aside", "blockquote", "ol", "ul"})
_NESTED_BLOCK_TAGS = frozenset({"p", "pre", "aside", "blockquote", "ol", "ul"})
_INLINE_TAGS = frozenset({"em", "i", "strong", "b", "a", "sup", "sub", "span"})
_ALLOWED_TAGS = _DOCUMENT_TAGS | _ROOT_BLOCK_TAGS | _INLINE_TAGS | frozenset({"br", "li"})
_VOID_TAGS = frozenset({"br"})
_REJECTED_TAGS = frozenset(
    {"img", "script", "style", "iframe", "object", "embed", "link", "video", "audio"}
)
_SAFE_ID = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,127}\Z")
_SAFE_LANGUAGE = re.compile(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,7}\Z")
_SHA256 = re.compile(r"[a-f0-9]{64}\Z")
_TEXT_ONLY_CONTAINERS = frozenset({"h1", "h2", "h3", "p", "pre"}) | _INLINE_TAGS
_MIXED_CONTAINERS = frozenset({"aside", "blockquote", "li"})
_STRUCTURAL_TEXT_BOUNDARIES = _ROOT_BLOCK_TAGS | frozenset({"li"})
_ACCESSIBILITY_SUMMARY = (
    "Textual EPUB with structural navigation and no known accessibility hazards."
)


class GenerationRejected(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class StructuredSource:
    source_id: str
    canonical_url: str
    title: str
    authors: tuple[str, ...]
    language: str
    content: bytes
    license_name: str
    license_url: str
    attribution: str
    content_format: str = "html"
    original_source_sha256: str | None = None
    original_source_format: str = "structured"


@dataclass(frozen=True, slots=True)
class GeneratedEpub:
    content: bytes
    source_sha256: str
    final_sha256: str
    normalized_source_text: str
    normalized_output_text: str
    chapter_titles: tuple[str, ...]
    generator_version: str


@dataclass(frozen=True, slots=True)
class _Block:
    kind: str
    xhtml: str
    text: str


@dataclass(frozen=True, slots=True)
class _Chapter:
    title: str
    blocks: tuple[_Block, ...]


def generate_epub(source: StructuredSource, *, generated_at: str) -> GeneratedEpub:
    """Create a deterministic EPUB from a deliberately small, auditable HTML subset."""

    if not source.content or not source.authors:
        raise GenerationRejected("Structured source metadata or content is missing")
    blocks = _parse_source_content(source)
    chapters = _chapters_from_blocks(blocks)
    normalized_source_text = _normalized_document_text(blocks)
    content = _package_epub(source, chapters, generated_at)
    normalized_output_text = _generated_chapter_text(content)
    if normalized_output_text != normalized_source_text:
        raise GenerationRejected("Generated EPUB text did not match the structured source")
    source_sha256 = _original_source_sha256(source)
    return GeneratedEpub(
        content=content,
        source_sha256=source_sha256,
        final_sha256=hashlib.sha256(content).hexdigest(),
        normalized_source_text=normalized_source_text,
        normalized_output_text=normalized_output_text,
        chapter_titles=tuple(chapter.title for chapter in chapters),
        generator_version=GENERATOR_VERSION,
    )


class _StructuredHtmlParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.open_tags: list[str] = []
        self.current_root: str | None = None
        self.current_markup: list[str] = []
        self.current_text: list[str] = []
        self.blocks: list[_Block] = []
        self.document_mode: str | None = None
        self.seen_html = False
        self.seen_body = False
        self.seen_doctype = False
        self.ids: set[str] = set()
        self.fragment_targets: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        _ensure_supported_tag(tag)
        markup = _start_tag(tag, attrs)
        self._record_identifiers(attrs)
        parent = self.open_tags[-1] if self.open_tags else None

        if tag in _VOID_TAGS:
            if self.current_root is None or not _allows_inline_child(parent):
                raise GenerationRejected("A line break appeared outside inline structured content")
            self.current_markup.append("<br/>")
            self.current_text.append("\n")
            return

        if tag in {"html", "body"}:
            if tag == "html":
                if parent is not None or self.document_mode is not None:
                    raise GenerationRejected("Structured HTML document must have one html root")
                self.document_mode = "document"
                self.seen_html = True
            elif parent != "html" or self.seen_body:
                raise GenerationRejected(
                    "Structured HTML document must place body directly inside html"
                )
            else:
                self.seen_body = True
            self.open_tags.append(tag)
            return

        if parent is None:
            if self.document_mode is not None:
                raise GenerationRejected(
                    "Structured HTML document cannot contain blocks outside body"
                )
            if self.seen_doctype:
                raise GenerationRejected("An HTML declaration requires an html document root")
            if tag not in _ROOT_BLOCK_TAGS:
                raise GenerationRejected(f"Unsupported HTML document root element: {tag}")
            is_root_block = True
        elif parent == "body":
            if tag not in _ROOT_BLOCK_TAGS:
                raise GenerationRejected(f"Unsupported HTML body child: {tag}")
            is_root_block = True
        else:
            if not _allows_nonvoid_child(parent, tag):
                raise GenerationRejected(f"Unsupported HTML nesting: {tag} inside {parent}")
            is_root_block = False

        if is_root_block:
            if self.current_root is not None:
                raise GenerationRejected("Structured HTML block nesting is ambiguous")
            self.current_root = tag
            self.current_markup = [markup]
            self.current_text = []
            self.open_tags.append(tag)
            return

        if self.current_root is None:
            raise GenerationRejected(f"HTML element appeared outside a block: {tag}")
        self.current_markup.append(markup)
        self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        _ensure_supported_tag(tag)
        if tag not in _VOID_TAGS:
            raise GenerationRejected("Self-closing non-void HTML elements are not supported")
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        _ensure_supported_tag(tag)
        if tag in _VOID_TAGS:
            raise GenerationRejected(f"Unexpected closing HTML element: {tag}")
        if not self.open_tags or self.open_tags[-1] != tag:
            raise GenerationRejected(f"Malformed or ambiguous HTML nesting at: {tag}")
        self.open_tags.pop()
        if tag == "body":
            return
        if tag == "html":
            if not self.seen_body:
                raise GenerationRejected("Structured HTML document requires a body")
            return
        if self.current_root is None:
            raise GenerationRejected(f"HTML element closed outside a block: {tag}")
        self.current_markup.append(f"</{tag}>")
        if tag == self.current_root:
            self.blocks.append(
                _Block(
                    kind=tag,
                    xhtml="".join(self.current_markup),
                    text="".join(self.current_text),
                )
            )
            self.current_root = None
            self.current_markup = []
            self.current_text = []
        elif tag in _STRUCTURAL_TEXT_BOUNDARIES:
            self.current_text.append("\n")

    def handle_data(self, data: str) -> None:
        parent = self.open_tags[-1] if self.open_tags else None
        if self.current_root is None or parent is None:
            if data.strip():
                raise GenerationRejected("Text appeared outside a structured HTML block")
            return
        if not _allows_text(parent):
            if data.strip():
                raise GenerationRejected(f"Text is not allowed directly inside {parent}")
            self.current_markup.append(escape(data, quote=False))
            return
        self.current_markup.append(escape(data, quote=False))
        self.current_text.append(data)

    def handle_decl(self, decl: str) -> None:
        if self.seen_doctype or self.open_tags or decl.strip().casefold() != "doctype html":
            raise GenerationRejected("Unsupported HTML declaration")
        self.seen_doctype = True

    def handle_comment(self, data: str) -> None:
        raise GenerationRejected("HTML comments are not supported in structured sources")

    def handle_pi(self, data: str) -> None:
        raise GenerationRejected("Processing instructions are not supported in structured sources")

    def close(self) -> None:
        super().close()
        if self.current_root is not None or self.open_tags:
            raise GenerationRejected("Structured HTML has an unclosed element")
        if self.seen_doctype and not self.seen_html:
            raise GenerationRejected("An HTML declaration requires an html document root")
        unresolved_fragments = self.fragment_targets - self.ids
        if unresolved_fragments:
            target = sorted(unresolved_fragments)[0]
            raise GenerationRejected(f"Fragment link has no matching id: {target}")

    def _record_identifiers(self, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            key = name.casefold()
            if key == "id":
                assert value is not None
                if value in self.ids:
                    raise GenerationRejected(f"Duplicate HTML id: {value}")
                self.ids.add(value)
            elif key == "href" and value and value.startswith("#"):
                self.fragment_targets.add(value[1:])


def _parse_structured_html(content: bytes) -> tuple[_Block, ...]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise GenerationRejected("Structured source is not valid UTF-8") from error
    parser = _StructuredHtmlParser()
    try:
        parser.feed(text)
        parser.close()
    except GenerationRejected:
        raise
    except Exception as error:
        raise GenerationRejected("Structured HTML could not be parsed") from error
    if not parser.blocks:
        raise GenerationRejected("Structured source has no supported content blocks")
    return tuple(parser.blocks)


def _parse_source_content(source: StructuredSource) -> tuple[_Block, ...]:
    if source.content_format == "html":
        return _parse_structured_html(source.content)
    if source.content_format == "plain_text":
        return _parse_plain_text(source.content)
    raise GenerationRejected("Structured source format is not eligible for EPUB generation")


def _parse_plain_text(content: bytes) -> tuple[_Block, ...]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise GenerationRejected("Structured source is not valid UTF-8") from error
    normalized_line_endings = text.replace("\r\n", "\n").replace("\r", "\n")
    chunks = re.split(r"(?:\n){2,}", normalized_line_endings)
    blocks: list[_Block] = []
    for chunk in chunks:
        stripped = chunk.strip()
        if not stripped:
            continue
        lines = stripped.split("\n")
        if len(lines) == 1 and lines[0].startswith("# "):
            title = lines[0][2:]
            blocks.append(_Block(kind="h1", xhtml=f"<h1>{escape(title)}</h1>", text=title))
            continue
        if any(line.startswith("# ") for line in lines):
            raise GenerationRejected("Plain-text chapter headings must be their own paragraph")
        normalized = _normalize_inline_text(stripped)
        blocks.append(_Block(kind="p", xhtml=f"<p>{escape(normalized)}</p>", text=normalized))
    if not blocks:
        raise GenerationRejected("Structured source has no supported content blocks")
    return tuple(blocks)


def _start_tag(tag: str, attrs: list[tuple[str, str | None]]) -> str:
    allowed: list[str] = []
    seen: set[str] = set()
    for name, value in attrs:
        key = name.casefold()
        if key in seen:
            raise GenerationRejected(f"Duplicate HTML attribute: {key}")
        seen.add(key)
        if key == "id":
            if tag in _DOCUMENT_TAGS:
                raise GenerationRejected(f"Unsupported HTML attribute: {key}")
            if value is None or not _SAFE_ID.fullmatch(value):
                raise GenerationRejected(f"Unsafe HTML attribute value: {key}")
            allowed.append(f" id={quoteattr(value)}")
        elif key == "href":
            if tag != "a":
                raise GenerationRejected(f"Unsupported HTML attribute: {key}")
            if value is None or not _safe_href(value):
                raise GenerationRejected(f"Unsafe HTML attribute value: {key}")
            allowed.append(f" href={quoteattr(value)}")
        elif key == "lang":
            if tag not in _DOCUMENT_TAGS:
                raise GenerationRejected(f"Unsupported HTML attribute: {key}")
            if value is None or not _SAFE_LANGUAGE.fullmatch(value):
                raise GenerationRejected(f"Unsafe HTML attribute value: {key}")
            allowed.append(f" lang={quoteattr(value)}")
        else:
            raise GenerationRejected(f"Unsupported HTML attribute: {key}")
    return f"<{tag}{''.join(allowed)}>"


def _safe_href(value: str) -> bool:
    if not value or value != value.strip() or any(character.isspace() for character in value):
        return False
    if value.startswith("#"):
        return _SAFE_ID.fullmatch(value[1:]) is not None
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
    except ValueError:
        return False
    return (
        parsed.scheme in {"https", "http"}
        and bool(parsed.netloc)
        and bool(hostname)
        and parsed.username is None
        and parsed.password is None
    )


def _ensure_supported_tag(tag: str) -> None:
    if tag in _REJECTED_TAGS:
        raise GenerationRejected(f"Unsupported active or remote HTML element: {tag}")
    if tag not in _ALLOWED_TAGS:
        raise GenerationRejected(f"Unsupported HTML element: {tag}")


def _allows_nonvoid_child(parent: str, tag: str) -> bool:
    if parent == "html":
        return tag == "body"
    if parent in _TEXT_ONLY_CONTAINERS:
        return tag in _INLINE_TAGS and not (parent == "a" and tag == "a")
    if parent in _MIXED_CONTAINERS:
        return tag in _INLINE_TAGS or tag in _NESTED_BLOCK_TAGS
    if parent in {"ol", "ul"}:
        return tag == "li"
    return False


def _allows_inline_child(parent: str | None) -> bool:
    return parent in _TEXT_ONLY_CONTAINERS or parent in _MIXED_CONTAINERS


def _allows_text(parent: str) -> bool:
    return parent in _TEXT_ONLY_CONTAINERS or parent in _MIXED_CONTAINERS


def _chapters_from_blocks(blocks: tuple[_Block, ...]) -> tuple[_Chapter, ...]:
    chapters: list[_Chapter] = []
    current: list[_Block] = []
    title: str | None = None
    for block in blocks:
        if block.kind == "h1":
            if title is not None:
                chapters.append(_Chapter(title=title, blocks=tuple(current)))
            title = _normalize_inline_text(block.text)
            if not title:
                raise GenerationRejected("A chapter heading was empty")
            current = [block]
        elif title is None:
            raise GenerationRejected("Structured source must begin with an h1 chapter heading")
        else:
            current.append(block)
    if title is None:
        raise GenerationRejected("Structured source has no h1 chapter headings")
    chapters.append(_Chapter(title=title, blocks=tuple(current)))
    return tuple(chapters)


def _normalized_document_text(blocks: tuple[_Block, ...] | list[_Block]) -> str:
    return "\n\n".join(_normalized_block_text(block) for block in blocks)


def _normalized_block_text(block: _Block) -> str:
    if block.kind == "pre":
        return block.text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    return _normalize_inline_text(block.text)


def _normalize_inline_text(value: str) -> str:
    return " ".join(value.split())


def _original_source_sha256(source: StructuredSource) -> str:
    if source.original_source_format not in {"structured", "pdf"}:
        raise GenerationRejected("Original source format is not eligible for EPUB generation")
    if source.original_source_format == "pdf" and source.original_source_sha256 is None:
        raise GenerationRejected("PDF conversion requires the original PDF hash")
    if source.original_source_sha256 is None:
        return hashlib.sha256(source.content).hexdigest()
    if not _SHA256.fullmatch(source.original_source_sha256):
        raise GenerationRejected("Original source hash is invalid")
    return source.original_source_sha256


def _source_media_type(source: StructuredSource) -> str:
    if source.original_source_format == "pdf":
        return "application/pdf"
    return "text/plain" if source.content_format == "plain_text" else "text/html"


def _source_label(source: StructuredSource) -> str:
    return "PDF source" if source.original_source_format == "pdf" else "structured source"


def _package_epub(
    source: StructuredSource,
    chapters: tuple[_Chapter, ...],
    generated_at: str,
) -> bytes:
    timestamp = _zip_timestamp(generated_at)
    source_sha = _original_source_sha256(source)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        _write_entry(archive, "mimetype", b"application/epub+zip", timestamp, zipfile.ZIP_STORED)
        _write_entry(
            archive,
            "META-INF/container.xml",
            _container_xml().encode(),
            timestamp,
        )
        _write_entry(
            archive,
            "EPUB/package.opf",
            _package_document(source, chapters, source_sha, generated_at).encode(),
            timestamp,
        )
        _write_entry(
            archive,
            "EPUB/nav.xhtml",
            _navigation(chapters, source.language).encode(),
            timestamp,
        )
        _write_entry(archive, "EPUB/cover.svg", _typographic_cover(source).encode(), timestamp)
        _write_entry(archive, "EPUB/license.xhtml", _license_document(source).encode(), timestamp)
        for index, chapter in enumerate(chapters, start=1):
            _write_entry(
                archive,
                f"EPUB/chapter-{index:03d}.xhtml",
                _chapter_document(chapter, source.language).encode(),
                timestamp,
            )
    return output.getvalue()


def _container_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""


def _package_document(
    source: StructuredSource,
    chapters: tuple[_Chapter, ...],
    source_sha: str,
    generated_at: str,
) -> str:
    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>',
        '<item id="license" href="license.xhtml" media-type="application/xhtml+xml"/>',
    ]
    spine = []
    for index, _chapter in enumerate(chapters, start=1):
        manifest.append(
            f'<item id="chapter-{index}" href="chapter-{index:03d}.xhtml" '
            'media-type="application/xhtml+xml"/>'
        )
        spine.append(f'<itemref idref="chapter-{index}"/>')
    spine.append('<itemref idref="license"/>')
    creators = "\n".join(
        f"    <dc:creator>{escape(author)}</dc:creator>" for author in source.authors
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         version="3.0"
         unique-identifier="book-id"
         xml:lang="{escape(source.language)}"
         prefix="schema: http://schema.org/">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:sha256:{source_sha}</dc:identifier>
    <dc:title>{escape(source.title)}</dc:title>
{creators}
    <dc:language>{escape(source.language)}</dc:language>
    <dc:source>{escape(source.canonical_url)}</dc:source>
    <meta name="source-format" content="{_source_media_type(source)}"/>
    <meta property="dcterms:modified">{escape(generated_at)}</meta>
    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilitySummary">{_ACCESSIBILITY_SUMMARY}</meta>
  </metadata>
  <manifest>
    {" ".join(manifest)}
  </manifest>
  <spine>
    {" ".join(spine)}
  </spine>
</package>"""


def _navigation(chapters: tuple[_Chapter, ...], language: str) -> str:
    items = "".join(
        f'<li><a href="chapter-{index:03d}.xhtml">{escape(chapter.title)}</a></li>'
        for index, chapter in enumerate(chapters, start=1)
    )
    return _xhtml_document(
        language,
        "Contents",
        '<nav epub:type="toc" id="toc"><ol>' + items + "</ol></nav>",
    )


def _typographic_cover(source: StructuredSource) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 1200 1800"
     role="img"
     aria-labelledby="title creator">
  <title id="title">{escape(source.title)}</title>
  <desc id="creator">{escape(", ".join(source.authors))}</desc>
  <rect width="1200" height="1800" fill="#f4f1ea"/>
  <rect x="96" y="96" width="1008" height="1608" fill="none" stroke="#243b2f" stroke-width="8"/>
  <text x="600" y="720" text-anchor="middle" fill="#1d241f" font-size="72" font-family="serif">
    {escape(source.title)}
  </text>
  <text x="600" y="1010" text-anchor="middle" fill="#52705f" font-size="42"
        font-family="sans-serif">
    {escape(", ".join(source.authors))}
  </text>
</svg>"""


def _license_document(source: StructuredSource) -> str:
    source_url = escape(source.canonical_url, quote=True)
    license_url = escape(source.license_url, quote=True)
    source_sha = _original_source_sha256(source)
    source_notice = (
        "<p>This EPUB was generated deterministically from the authorized "
        f"{_source_label(source)}. "
        "No generative text changes were made.</p>"
    )
    body = (
        "<section><h1>Source and license</h1>"
        f"<p>{escape(source.attribution)}</p>"
        f'<p>Source: <a href="{source_url}">{escape(source.canonical_url)}</a></p>'
        f"<p>Original source SHA-256: {source_sha}</p>"
        f'<p>License: <a href="{license_url}">{escape(source.license_name)}</a></p>'
        f"{source_notice}</section>"
    )
    return _xhtml_document(source.language, "Source and license", body)


def _chapter_document(chapter: _Chapter, language: str) -> str:
    body = "".join(block.xhtml for block in chapter.blocks)
    return _xhtml_document(language, chapter.title, body)


def _xhtml_document(language: str, title: str, body: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="{escape(language)}"
      lang="{escape(language)}">
  <head><title>{escape(title)}</title></head>
  <body>{body}</body>
</html>"""


def _generated_chapter_text(content: bytes) -> str:
    blocks: list[_Block] = []
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        chapter_names = sorted(
            name for name in archive.namelist() if PurePosixPath(name).match("EPUB/chapter-*.xhtml")
        )
        for name in chapter_names:
            try:
                root = ElementTree.fromstring(archive.read(name))
            except ElementTree.ParseError as error:
                raise GenerationRejected("Generated chapter XHTML was invalid") from error
            body = next((element for element in root.iter() if element.tag.endswith("body")), None)
            if body is None:
                raise GenerationRejected("Generated chapter had no body")
            for child in list(body):
                kind = child.tag.rsplit("}", maxsplit=1)[-1]
                blocks.append(_Block(kind=kind, xhtml="", text=_element_text(child)))
    return _normalized_document_text(blocks)


def _element_text(element) -> str:
    text = [element.text or ""]
    for child in element:
        kind = child.tag.rsplit("}", maxsplit=1)[-1]
        if kind == "br":
            text.append("\n")
        else:
            text.append(_element_text(child))
            if kind in _STRUCTURAL_TEXT_BOUNDARIES:
                text.append("\n")
        text.append(child.tail or "")
    return "".join(text)


def _zip_timestamp(generated_at: str) -> tuple[int, int, int, int, int, int]:
    try:
        timestamp = (
            generated_at.removesuffix("Z") + "+00:00"
            if generated_at.endswith("Z")
            else generated_at
        )
        parsed = datetime.fromisoformat(timestamp)
    except ValueError as error:
        raise GenerationRejected("Generated EPUB timestamp was invalid") from error
    if parsed.year < 1980:
        raise GenerationRejected("Generated EPUB timestamp predates ZIP support")
    return (parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second)


def _write_entry(
    archive: zipfile.ZipFile,
    name: str,
    content: bytes,
    timestamp: tuple[int, int, int, int, int, int],
    compression: int = zipfile.ZIP_DEFLATED,
) -> None:
    entry = zipfile.ZipInfo(name, date_time=timestamp)
    entry.compress_type = compression
    archive.writestr(entry, content)
