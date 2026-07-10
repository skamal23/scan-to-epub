import hashlib
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from test_epub_safety import epub_bytes

from book_backend.content_sources.approved_catalog import ApprovedEpubCatalog
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

    async def validate(self, _content: bytes):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


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
