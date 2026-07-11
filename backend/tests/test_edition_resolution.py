import hashlib
import io
import zipfile
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from test_epub_safety import epub_bytes

from book_backend.content_sources.approved_catalog import (
    ApprovedEpubCatalog,
    ApprovedStructuredCatalog,
    ApprovedStructuredEntry,
)
from book_backend.content_sources.oapen import OAPEN_CATALOG
from book_backend.content_sources.standard_ebooks import STANDARD_EBOOKS_CATALOG
from book_backend.editions.models import EditionResolveRequest
from book_backend.editions.service import (
    AcquiredEpub,
    EditionResolutionService,
    SourceUnavailable,
    ValidationFailed,
)
from book_backend.epubs.artifacts import EphemeralEpubStore
from book_backend.epubs.validator import EpubcheckResult


class StubAcquirer:
    def __init__(self, payload: bytes | Exception):
        self.payload = payload
        self.entries = []

    async def acquire(self, entry):
        self.entries.append(entry)
        if isinstance(self.payload, Exception):
            raise self.payload
        return AcquiredEpub(
            content=self.payload,
            sha256=hashlib.sha256(self.payload).hexdigest(),
            retrieved_at=datetime(2026, 7, 10, 18, 0, tzinfo=UTC),
        )


class StubValidator:
    def __init__(self, result: EpubcheckResult | Exception):
        self.result = result
        self.calls = 0

    async def validate(self, _content: bytes):
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class SequencedValidator:
    def __init__(self, results: list[EpubcheckResult | Exception]):
        self.results = results
        self.calls = 0

    async def validate(self, _content: bytes):
        result = self.results[self.calls]
        self.calls += 1
        if isinstance(result, Exception):
            raise result
        return result


class FallbackAcquirer:
    def __init__(self, payload: bytes):
        self.payload = payload
        self.entries = []

    async def acquire(self, entry):
        self.entries.append(entry)
        if entry.source_key == "standard_ebooks":
            raise SourceUnavailable("Standard Ebooks is temporarily unavailable")
        return AcquiredEpub(
            content=self.payload,
            sha256=hashlib.sha256(self.payload).hexdigest(),
            retrieved_at=datetime(2026, 7, 10, 18, 0, tzinfo=UTC),
        )


class DynamicCatalog:
    def __init__(self, entries):
        self.entries = entries
        self.requests = []

    async def find_all(self, title, authors, physical_isbn13):
        self.requests.append((title, authors, physical_isbn13))
        return self.entries


class FailingDynamicCatalog:
    def __init__(self):
        self.requests = []

    async def find_all(self, title, authors, physical_isbn13):
        self.requests.append((title, authors, physical_isbn13))
        raise SourceUnavailable("dynamic discovery is unavailable")


def request(title="Pride and Prejudice", authors=None):
    return EditionResolveRequest(
        candidate_id="physical-candidate",
        work_title=title,
        work_authors=authors or ["Jane Austen"],
        physical_isbn13="9780141439518",
        physical_publisher="Penguin Classics",
        physical_published_date="2003",
        work_source_ids={"open_library": "OL66554W"},
        edition_source_ids={"open_library": "OL7353617M"},
        territory="US",
    )


def with_payload_hash(entry, payload: bytes):
    return replace(
        entry,
        download_policy=replace(
            entry.download_policy,
            expected_sha256=hashlib.sha256(payload).hexdigest(),
        ),
    )


def structured_entry(content: bytes) -> ApprovedStructuredEntry:
    return ApprovedStructuredEntry(
        entry_id="structured:open-text",
        source_key="reviewed_structured_source",
        priority=20,
        work_title="Structured Open Text",
        aliases=(),
        authors=("Example Author",),
        digital_title="Structured Open Text",
        language="en",
        digital_identifier="https://example.invalid/structured-open-text",
        publisher="Example Publisher",
        source_organization="Reviewed structured source",
        canonical_url="https://example.invalid/structured-open-text",
        source_url="https://example.invalid/structured-open-text/source.html",
        cover_url=None,
        content_format="html",
        content=content,
        expected_source_sha256=hashlib.sha256(content).hexdigest(),
        snapshot_retrieved_at=datetime(2026, 7, 10, 17, 0, tzinfo=UTC),
        rights_evidence="cc_by",
        license_name="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        rights_statement="The reviewed structured source is explicitly licensed CC BY.",
        attribution="Example Author, Structured Open Text, CC BY 4.0.",
        reviewed_at="2026-07-10",
    )


def matching_existing_entry(*, rights_evidence="cc0"):
    entry = STANDARD_EBOOKS_CATALOG.entries[0]
    return replace(
        entry,
        entry_id="existing:structured-open-text",
        source_key="existing_open_edition",
        priority=10,
        work_title="Structured Open Text",
        aliases=(),
        authors=("Example Author",),
        digital_title="Existing Structured Open Text",
        digital_identifier="https://example.invalid/existing-structured-open-text",
        publisher="Existing Publisher",
        source_organization="Existing open edition",
        canonical_url="https://example.invalid/existing-structured-open-text",
        acquisition_url="https://example.invalid/existing-structured-open-text.epub",
        rights_evidence=rights_evidence,
        license_name="Test source license",
        license_url="https://example.invalid/license",
        rights_statement="A matching existing source for fallback testing.",
        attribution=None,
    )


@pytest.mark.anyio
async def test_supported_work_returns_a_separate_verified_digital_edition():
    payload = epub_bytes()
    entry = STANDARD_EBOOKS_CATALOG.find("Pride and Prejudice", ["Jane Austen"], None)
    catalog = replace(
        STANDARD_EBOOKS_CATALOG,
        entries=(with_payload_hash(entry, payload),),
    )
    service = EditionResolutionService(
        catalog=catalog,
        acquirer=StubAcquirer(payload),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request())

    assert result.status == "ready"
    assert result.physical_edition.isbn13 == "9780141439518"
    assert result.digital_edition.identifier.startswith("https://standardebooks.org/ebooks/")
    assert result.digital_edition.publisher == "Standard Ebooks"
    assert result.digital_edition.is_same_publication is False
    assert result.rights.territory == "US"
    assert result.rights.license_name == "CC0 1.0 Universal"
    assert result.provenance.original_sha256 == hashlib.sha256(payload).hexdigest()
    assert result.provenance.final_sha256 == result.provenance.original_sha256
    assert result.provenance.transformation == "unchanged"
    assert result.provenance.epubcheck_status == "valid"


@pytest.mark.anyio
async def test_reviewed_structured_source_generates_a_verified_delivery_when_no_epub_exists():
    source_content = (
        b"<html><body><h1>First chapter</h1><p>First preserved paragraph.</p>"
        b"<h1>Second chapter</h1><p>Second preserved paragraph.</p></body></html>"
    )
    store = EphemeralEpubStore()
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        structured_catalog=ApprovedStructuredCatalog(entries=(structured_entry(source_content),)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=store,
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "ready"
    assert result.digital_edition.cover_url is None
    assert result.rights.license_name == "CC BY 4.0"
    assert result.provenance.transformation == "generated"
    assert result.provenance.generator_version == "structured-epub/1"
    assert result.provenance.transformation_steps == [
        "normalized authorized HTML",
        "packaged deterministic EPUB",
    ]
    assert result.provenance.original_sha256 == hashlib.sha256(source_content).hexdigest()
    assert result.provenance.final_sha256 == result.delivery.sha256
    assert result.provenance.final_sha256 != result.provenance.original_sha256
    assert result.provenance.source_attempts == ["Reviewed structured source"]
    assert result.provenance.retrieved_at == datetime(2026, 7, 10, 17, 0, tzinfo=UTC)
    assert result.provenance.generated_at is not None
    artifact = await store.get(result.delivery.download_token)
    assert artifact is not None
    with zipfile.ZipFile(io.BytesIO(bytes(artifact.content))) as archive:
        assert "First preserved paragraph." in archive.read("EPUB/chapter-001.xhtml").decode()


@pytest.mark.anyio
async def test_ineligible_existing_epub_falls_back_to_an_eligible_structured_source():
    source_content = b"<html><body><h1>Chapter</h1><p>Fallback text.</p></body></html>"
    validator = StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[]))
    acquirer = StubAcquirer(AssertionError("rights-ineligible EPUB must not be acquired"))
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(
            entries=(matching_existing_entry(rights_evidence="all_rights_reserved"),)
        ),
        structured_catalog=ApprovedStructuredCatalog(entries=(structured_entry(source_content),)),
        acquirer=acquirer,
        validator=validator,
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "ready"
    assert result.provenance.transformation == "generated"
    assert result.provenance.source_attempts == [
        "Existing open edition",
        "Reviewed structured source",
    ]
    assert acquirer.entries == []
    assert validator.calls == 1


@pytest.mark.anyio
async def test_unavailable_or_invalid_existing_epub_falls_back_to_a_structured_source():
    source_content = b"<html><body><h1>Chapter</h1><p>Fallback text.</p></body></html>"
    existing = matching_existing_entry()
    unavailable_service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=(existing,)),
        structured_catalog=ApprovedStructuredCatalog(entries=(structured_entry(source_content),)),
        acquirer=StubAcquirer(SourceUnavailable("existing source unavailable")),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    unavailable_result = await unavailable_service.resolve(
        request("Structured Open Text", ["Example Author"])
    )

    assert unavailable_result.status == "ready"
    assert unavailable_result.provenance.source_attempts == [
        "Existing open edition",
        "Reviewed structured source",
    ]

    invalid_service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=(existing,)),
        structured_catalog=ApprovedStructuredCatalog(entries=(structured_entry(source_content),)),
        acquirer=StubAcquirer(epub_bytes()),
        validator=SequencedValidator(
            [
                EpubcheckResult(version="5.3.0", valid=False, warnings=[]),
                EpubcheckResult(version="5.3.0", valid=True, warnings=[]),
            ]
        ),
        artifact_store=EphemeralEpubStore(),
    )

    invalid_result = await invalid_service.resolve(
        request("Structured Open Text", ["Example Author"])
    )

    assert invalid_result.status == "ready"
    assert invalid_result.provenance.transformation == "generated"
    assert invalid_result.provenance.source_attempts == [
        "Existing open edition",
        "Reviewed structured source",
    ]


@pytest.mark.anyio
async def test_dynamic_epub_discovery_outage_does_not_block_structured_fallback():
    source_content = b"<html><body><h1>Chapter</h1><p>Fallback text.</p></body></html>"
    dynamic_source = FailingDynamicCatalog()
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        dynamic_sources=(dynamic_source,),
        structured_catalog=ApprovedStructuredCatalog(entries=(structured_entry(source_content),)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "ready"
    assert result.provenance.transformation == "generated"
    assert dynamic_source.requests == [
        ("Structured Open Text", ["Example Author"], "9780141439518")
    ]


@pytest.mark.anyio
async def test_later_structured_source_survives_a_prior_validation_failure():
    source_content = b"<html><body><h1>Chapter</h1><p>Fallback text.</p></body></html>"
    invalid_first = replace(
        structured_entry(source_content),
        entry_id="structured:invalid-first",
        priority=10,
        digital_identifier="https://example.invalid/invalid-first",
        expected_source_sha256="0" * 64,
    )
    valid_later = replace(
        structured_entry(source_content),
        entry_id="structured:valid-later",
        priority=20,
        digital_identifier="https://example.invalid/valid-later",
        source_organization="Later reviewed source",
        canonical_url="https://example.invalid/valid-later",
        source_url="https://example.invalid/valid-later/source.html",
    )
    validator = StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[]))
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        structured_catalog=ApprovedStructuredCatalog(entries=(valid_later, invalid_first)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=validator,
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "ready"
    assert result.source.organization == "Later reviewed source"
    assert result.provenance.source_attempts == [
        "Reviewed structured source",
        "Later reviewed source",
    ]
    assert validator.calls == 1


@pytest.mark.anyio
async def test_changed_structured_snapshot_is_an_integrity_failure():
    source_content = b"<html><body><h1>Chapter</h1><p>Preserved text.</p></body></html>"
    changed_entry = replace(
        structured_entry(source_content),
        expected_source_sha256="0" * 64,
    )
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        structured_catalog=ApprovedStructuredCatalog(entries=(changed_entry,)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    with pytest.raises(ValidationFailed, match="pinned hash"):
        await service.resolve(request("Structured Open Text", ["Example Author"]))


@pytest.mark.anyio
async def test_ineligible_structured_html_refuses_before_validation_or_delivery():
    unsafe_content = b"<html><body><h1>Chapter</h1><img alt='unapproved image'/></body></html>"
    validator = StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[]))
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        structured_catalog=ApprovedStructuredCatalog(entries=(structured_entry(unsafe_content),)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=validator,
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "unavailable"
    assert result.reason == (
        "We found an authorized structured source, but could not safely convert it into an EPUB."
    )
    assert result.delivery is None
    assert validator.calls == 0


@pytest.mark.anyio
async def test_sharealike_structured_source_is_rejected_until_derivative_licensing_exists():
    source_content = b"<html><body><h1>Chapter</h1><p>Share-alike source text.</p></body></html>"
    sharealike_entry = replace(
        structured_entry(source_content),
        rights_evidence="cc_by_sa",
        license_name="CC BY-SA 4.0",
        license_url="https://creativecommons.org/licenses/by-sa/4.0/",
    )
    validator = StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[]))
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        structured_catalog=ApprovedStructuredCatalog(entries=(sharealike_entry,)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=validator,
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "unavailable"
    assert result.reason == "The available source did not pass the demo's rights policy."
    assert validator.calls == 0


@pytest.mark.anyio
async def test_attribution_required_structured_source_is_rejected_without_reviewed_attribution():
    source_content = b"<html><body><h1>Chapter</h1><p>CC BY source text.</p></body></html>"
    unattributed_entry = replace(structured_entry(source_content), attribution=None)
    validator = StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[]))
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        structured_catalog=ApprovedStructuredCatalog(entries=(unattributed_entry,)),
        acquirer=StubAcquirer(AssertionError("must not acquire an existing EPUB")),
        validator=validator,
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("Structured Open Text", ["Example Author"]))

    assert result.status == "unavailable"
    assert result.reason == "The available source did not pass the demo's rights policy."
    assert validator.calls == 0


@pytest.mark.anyio
async def test_unsupported_work_returns_honest_unavailable_without_acquisition():
    acquirer = StubAcquirer(AssertionError("must not download"))
    service = EditionResolutionService(
        catalog=STANDARD_EBOOKS_CATALOG,
        acquirer=acquirer,
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request("The Martian", ["Andy Weir"]))

    assert result.status == "unavailable"
    assert result.reason == "No reviewed open edition is available for this work yet."
    assert acquirer.entries == []


@pytest.mark.anyio
async def test_source_outage_and_epubcheck_failure_are_not_misreported_as_unavailable():
    offline = EditionResolutionService(
        catalog=STANDARD_EBOOKS_CATALOG,
        acquirer=StubAcquirer(SourceUnavailable("offline")),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )
    with pytest.raises(SourceUnavailable):
        await offline.resolve(request())

    payload = epub_bytes()
    entry = STANDARD_EBOOKS_CATALOG.find("Pride and Prejudice", ["Jane Austen"], None)
    catalog = replace(
        STANDARD_EBOOKS_CATALOG,
        entries=(with_payload_hash(entry, payload),),
    )
    invalid = EditionResolutionService(
        catalog=catalog,
        acquirer=StubAcquirer(payload),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=False, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )
    with pytest.raises(ValidationFailed):
        await invalid.resolve(request())


@pytest.mark.anyio
async def test_unavailable_epubcheck_is_reported_as_a_validation_failure():
    payload = epub_bytes()
    entry = STANDARD_EBOOKS_CATALOG.find("Pride and Prejudice", ["Jane Austen"], None)
    catalog = replace(
        STANDARD_EBOOKS_CATALOG,
        entries=(with_payload_hash(entry, payload),),
    )
    service = EditionResolutionService(
        catalog=catalog,
        acquirer=StubAcquirer(payload),
        validator=StubValidator(RuntimeError("EPUBCheck is unavailable")),
        artifact_store=EphemeralEpubStore(),
    )

    with pytest.raises(ValidationFailed, match="could not run"):
        await service.resolve(request())


@pytest.mark.anyio
async def test_verified_result_stages_the_exact_validated_epub_for_short_lived_delivery():
    payload = epub_bytes()
    entry = STANDARD_EBOOKS_CATALOG.find("Pride and Prejudice", ["Jane Austen"], None)
    catalog = replace(
        STANDARD_EBOOKS_CATALOG,
        entries=(with_payload_hash(entry, payload),),
    )
    store = EphemeralEpubStore()
    service = EditionResolutionService(
        catalog=catalog,
        acquirer=StubAcquirer(payload),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=store,
    )

    result = await service.resolve(request())

    assert result.delivery is not None
    assert result.delivery.filename == "Pride-and-Prejudice-Jane-Austen.epub"
    assert result.delivery.sha256 == hashlib.sha256(payload).hexdigest()
    artifact = await store.get(result.delivery.download_token)
    assert artifact is not None
    assert bytes(artifact.content) == payload


@pytest.mark.anyio
async def test_source_outage_falls_back_to_a_distinct_reviewed_open_edition():
    payload = epub_bytes()
    standard = STANDARD_EBOOKS_CATALOG.entries[0]
    oapen = replace(
        standard,
        entry_id="oapen:media-use-in-digital-everyday-life",
        source_key="oapen",
        priority=40,
        digital_title="Media Use in Digital Everyday Life",
        digital_identifier="https://library.oapen.org/handle/20.500.12657/61404",
        publisher="Emerald Publishing",
        source_organization="OAPEN",
        canonical_url="https://library.oapen.org/handle/20.500.12657/61404",
        acquisition_url="https://library.oapen.org/rest/bitstreams/example/retrieve",
        cover_url="https://library.oapen.org/cover.jpg",
        rights_evidence="cc_by",
        license_name="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        rights_statement="The OAPEN bitstream is explicitly licensed CC BY.",
        attribution="Brita Ytre-Arne, CC BY 4.0.",
        download_policy=replace(
            standard.download_policy,
            expected_sha256=hashlib.sha256(payload).hexdigest(),
        ),
    )
    catalog = ApprovedEpubCatalog(entries=(standard, oapen))
    acquirer = FallbackAcquirer(payload)
    service = EditionResolutionService(
        catalog=catalog,
        acquirer=acquirer,
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(request())

    assert [entry.source_key for entry in acquirer.entries] == ["standard_ebooks", "oapen"]
    assert result.status == "ready"
    assert result.source.organization == "OAPEN"
    assert result.rights.license_name == "CC BY 4.0"
    assert result.rights.attribution == "Brita Ytre-Arne, CC BY 4.0."
    assert result.provenance.source_attempts == ["Standard Ebooks", "OAPEN"]
    assert result.provenance.catalog_entry_id == "oapen:media-use-in-digital-everyday-life"


@pytest.mark.anyio
async def test_dynamic_approved_source_is_used_when_the_reviewed_static_catalog_has_no_match():
    payload = epub_bytes()
    entry = OAPEN_CATALOG.entries[0]
    source = DynamicCatalog((with_payload_hash(entry, payload),))
    service = EditionResolutionService(
        catalog=ApprovedEpubCatalog(entries=()),
        dynamic_sources=(source,),
        acquirer=StubAcquirer(payload),
        validator=StubValidator(EpubcheckResult(version="5.3.0", valid=True, warnings=[])),
        artifact_store=EphemeralEpubStore(),
    )

    result = await service.resolve(
        request("Media Use in Digital Everyday Life", ["Brita Ytre-Arne"])
    )

    assert source.requests == [
        ("Media Use in Digital Everyday Life", ["Brita Ytre-Arne"], "9780141439518")
    ]
    assert result.status == "ready"
    assert result.source.organization == "OAPEN"
