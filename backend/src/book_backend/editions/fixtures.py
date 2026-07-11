import hashlib
import io
import zipfile
from datetime import UTC, datetime

from book_backend.content_sources.standard_ebooks import STANDARD_EBOOKS_CATALOG
from book_backend.epubs.artifacts import EphemeralEpubStore
from book_backend.epubs.generation import GenerationRejected, StructuredSource, generate_epub
from book_backend.epubs.safety import InvalidEpub, inspect_epub
from book_backend.epubs.validator import EpubcheckValidator

from .errors import ValidationFailed
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

_FIXTURE_RETRIEVED_AT = datetime(2026, 7, 10, 18, 0, tzinfo=UTC)
_FIXTURE_SOURCE_RETRIEVED_AT = datetime(2026, 7, 10, 17, 0, tzinfo=UTC)
_GENERATED_FIXTURES = {
    "fixture:generated-html": StructuredSource(
        source_id="fixture:generated-html",
        canonical_url="https://example.invalid/test-only-generated-html",
        title="Structured Open Text",
        authors=("Example Author",),
        language="en",
        content=(
            b"<html><body><h1>Test chapter</h1>"
            b"<p>This test-only text verifies deterministic EPUB generation.</p>"
            b"</body></html>"
        ),
        license_name="Test-only structured source",
        license_url="https://example.invalid/test-only-generated-source",
        attribution="Book to EPUB test fixture.",
    ),
    "fixture:generated-plain-text": StructuredSource(
        source_id="fixture:generated-plain-text",
        canonical_url="https://example.invalid/test-only-generated-plain-text",
        title="Structured Plain Text",
        authors=("Example Author",),
        language="en",
        content=(
            b"# Test chapter\n\n"
            b"This test-only plain-text source verifies deterministic EPUB generation."
        ),
        license_name="Test-only structured source",
        license_url="https://example.invalid/test-only-generated-source",
        attribution="Book to EPUB test fixture.",
        content_format="plain_text",
    ),
}


class FixtureEditionResolutionService:
    def __init__(self, artifact_store: EphemeralEpubStore):
        self.artifact_store = artifact_store
        self.validator = EpubcheckValidator()

    async def resolve(self, request: EditionResolveRequest) -> EditionResolutionResult:
        generated_source = _GENERATED_FIXTURES.get(request.candidate_id)
        if generated_source is not None:
            return await self._resolve_generated_fixture(request, generated_source)
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
                source_attempts=["Deterministic test fixture"],
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

    async def _resolve_generated_fixture(
        self,
        request: EditionResolveRequest,
        source: StructuredSource,
    ) -> EditionResolutionResult:
        try:
            generated = generate_epub(
                source,
                generated_at=_FIXTURE_RETRIEVED_AT.isoformat().replace("+00:00", "Z"),
            )
            inspect_epub(generated.content)
        except (GenerationRejected, InvalidEpub) as error:
            raise ValidationFailed("The test-only generated EPUB could not be prepared") from error
        try:
            validation = await self.validator.validate(generated.content)
        except RuntimeError as error:
            raise ValidationFailed("EPUB conformance validation could not run") from error
        if not validation.valid:
            raise ValidationFailed("EPUBCheck found conformance errors")
        try:
            delivery = await self.artifact_store.stage(
                content=generated.content,
                sha256=generated.final_sha256,
                title=f"{source.title} test export",
                authors=list(source.authors),
            )
        except ValueError as error:
            raise ValidationFailed("The test-only generated EPUB could not be delivered") from error
        return EditionResolutionResult(
            status="ready",
            physical_edition=PhysicalEditionInfo(
                candidate_id=request.candidate_id,
                title=request.work_title,
                authors=request.work_authors,
                isbn13=request.physical_isbn13,
                publisher=request.physical_publisher,
                published_date=request.physical_published_date,
                source_ids=request.edition_source_ids,
            ),
            digital_edition=DigitalEditionInfo(
                title=f"{source.title} (test export)",
                authors=list(source.authors),
                language=source.language,
                identifier=f"urn:book-to-epub:{source.source_id}",
                publisher="Book to EPUB test fixture",
                cover_url=None,
                is_same_publication=False,
            ),
            source=EditionSourceInfo(
                organization="Deterministic generated fixture",
                canonical_url=source.canonical_url,
            ),
            rights=EditionRightsInfo(
                license_name=source.license_name,
                license_url=source.license_url,
                rights_statement=(
                    "This test-only EPUB is generated from purpose-built fixture text. "
                    "It is not a source for a real book."
                ),
                attribution=source.attribution,
                territory=request.territory,
            ),
            provenance=EditionProvenance(
                catalog_entry_id=source.source_id,
                catalog_reviewed_at="2026-07-10",
                acquisition_url=source.canonical_url,
                retrieved_at=_FIXTURE_SOURCE_RETRIEVED_AT,
                original_sha256=generated.source_sha256,
                final_sha256=generated.final_sha256,
                transformation="generated",
                epubcheck_version=validation.version,
                epubcheck_status="valid",
                epubcheck_warnings=validation.warnings,
                source_attempts=["Deterministic generated fixture"],
                generated_at=_FIXTURE_RETRIEVED_AT,
                generator_version=generated.generator_version,
                transformation_steps=[
                    f"normalized authorized {source.content_format.upper()}",
                    "packaged deterministic EPUB",
                ],
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
