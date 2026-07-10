import hashlib
import io
import zipfile
from datetime import datetime

from book_backend.content_sources.standard_ebooks import STANDARD_EBOOKS_CATALOG
from book_backend.epubs.artifacts import EphemeralEpubStore

from .models import (
    DigitalEditionInfo,
    EditionProvenance,
    EditionResolutionResult,
    EditionResolveRequest,
    EditionRightsInfo,
    EditionSourceInfo,
    EpubDeliveryInfo,
    PhysicalEditionInfo,
)


class FixtureEditionResolutionService:
    def __init__(self, artifact_store: EphemeralEpubStore):
        self.artifact_store = artifact_store

    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult:
        entry = STANDARD_EBOOKS_CATALOG.find(
            request.work_title,
            request.work_authors,
            request.physical_isbn13,
        )
        physical = PhysicalEditionInfo(
            candidate_id=request.candidate_id,
            title=request.work_title,
            authors=request.work_authors,
            isbn13=request.physical_isbn13,
            publisher=request.physical_publisher,
            published_date=request.physical_published_date,
            source_ids=request.edition_source_ids,
        )
        if entry is None:
            return EditionResolutionResult(
                status="unavailable",
                reason="No reviewed open edition is available for this work yet.",
                physical_edition=physical,
            )
        content = fixture_epub_bytes()
        sha256 = hashlib.sha256(content).hexdigest()
        delivery = await self.artifact_store.stage(
            content=content,
            sha256=sha256,
            title=f"{entry.digital_title} test export",
            authors=list(entry.authors[:1]),
        )
        return EditionResolutionResult(
            status="ready",
            physical_edition=physical,
            digital_edition=DigitalEditionInfo(
                title=f"{entry.digital_title} (test export)",
                authors=list(entry.authors[:1]),
                language=entry.language,
                identifier=f"urn:book-to-epub:fixture:{entry.entry_id.rsplit(':', maxsplit=1)[-1]}",
                publisher="Book to EPUB test fixture",
                cover_url=entry.cover_url,
                is_same_publication=False,
            ),
            source=EditionSourceInfo(
                organization="Deterministic test fixture",
                canonical_url="https://example.invalid/book-to-epub-fixture",
            ),
            rights=EditionRightsInfo(
                license_name="Test-only artifact",
                license_url="https://example.invalid/book-to-epub-fixture",
                rights_statement=(
                    "This test-only EPUB contains no source book text and exists only for "
                    "Simulator export testing."
                ),
                territory="US",
            ),
            provenance=EditionProvenance(
                catalog_entry_id=f"fixture:{entry.entry_id}",
                catalog_reviewed_at="2026-07-10",
                acquisition_url="https://example.invalid/book-to-epub-fixture",
                retrieved_at=datetime.fromisoformat("2026-07-10T18:00:00+00:00"),
                original_sha256=sha256,
                final_sha256=sha256,
                transformation="unchanged",
                epubcheck_version="5.3.0",
                epubcheck_status="valid",
                epubcheck_warnings=[],
            ),
            delivery=EpubDeliveryInfo(
                download_path=delivery.download_path,
                download_token=delivery.download_token,
                filename=delivery.filename,
                content_length=delivery.content_length,
                sha256=delivery.sha256,
                expires_at=delivery.expires_at,
            ),
        )


def fixture_epub_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        _write_entry(archive, "mimetype", b"application/epub+zip", zipfile.ZIP_STORED)
        _write_entry(
            archive,
            "META-INF/container.xml",
            b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
            b'  <rootfiles><rootfile full-path="EPUB/package.opf" '
            b'media-type="application/oebps-package+xml"/></rootfiles>\n'
            b"</container>",
        )
        _write_entry(
            archive,
            "EPUB/package.opf",
            b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<package xmlns="http://www.idpf.org/2007/opf" '
            b'version="3.0" unique-identifier="book-id">\n'
            b'  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
            b'    <dc:identifier id="book-id">urn:uuid:'
            b"4aec0753-df85-44ea-977d-151b3a5aa2b8</dc:identifier>\n"
            b"    <dc:title>Book to EPUB test export</dc:title>\n"
            b"    <dc:language>en</dc:language>\n"
            b'    <meta property="dcterms:modified">2026-07-10T00:00:00Z</meta>\n'
            b"  </metadata>\n"
            b"  <manifest>\n"
            b'    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" '
            b'properties="nav"/>\n'
            b'    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>\n'
            b"  </manifest>\n"
            b'  <spine><itemref idref="chapter"/></spine>\n'
            b"</package>",
        )
        _write_entry(
            archive,
            "EPUB/nav.xhtml",
            b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n'
            b"  <head><title>Contents</title></head>\n"
            b'  <body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">\n'
            b'    <ol><li><a href="chapter.xhtml">Test export</a></li></ol>\n'
            b"  </nav></body>\n"
            b"</html>",
        )
        _write_entry(
            archive,
            "EPUB/chapter.xhtml",
            b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n'
            b"  <head><title>Test export</title></head>\n"
            b"  <body><section><h1>Test export</h1>\n"
            b"    <p>This deterministic EPUB exists only for Simulator export testing.</p>\n"
            b"  </section></body>\n"
            b"</html>",
        )
    return output.getvalue()


def _write_entry(
    archive: zipfile.ZipFile,
    name: str,
    content: bytes,
    compression: int = zipfile.ZIP_DEFLATED,
) -> None:
    entry = zipfile.ZipInfo(name, date_time=(2026, 7, 10, 0, 0, 0))
    entry.compress_type = compression
    archive.writestr(entry, content)
