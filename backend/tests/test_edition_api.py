import io
import zipfile

import httpx
import pytest

import book_backend.editions.fixtures as fixture_module
from book_backend.app import create_app
from book_backend.config import Settings
from book_backend.editions.errors import SourceUnavailable, ValidationFailed
from book_backend.editions.fixtures import fixture_epub_bytes
from book_backend.editions.models import EditionResolutionResult, EditionResolveRequest
from book_backend.epubs.artifacts import EphemeralEpubStore
from book_backend.epubs.generation import StructuredSource
from book_backend.epubs.generation import generate_epub as real_generate_epub
from book_backend.epubs.safety import inspect_epub
from book_backend.epubs.validator import EpubcheckValidator
from book_backend.rights.policy import RightsDecision


class StubEditionService:
    def __init__(self, result):
        self.result = result
        self.requests = []

    async def resolve(self, request):
        self.requests.append(request)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def request_body():
    return {
        "candidateId": "candidate",
        "workTitle": "Pride and Prejudice",
        "workAuthors": ["Jane Austen"],
        "physicalIsbn13": "9780141439518",
        "physicalPublisher": "Penguin Classics",
        "physicalPublishedDate": "2003",
        "workSourceIds": {"open_library": "OL66554W"},
        "editionSourceIds": {"open_library": "OL7353617M"},
        "territory": "US",
    }


def generated_fixture_request_body(
    *,
    candidate_id: str = "fixture:generated-html",
    title: str = "Structured Open Text",
):
    return {
        **request_body(),
        "candidateId": candidate_id,
        "workTitle": title,
        "workAuthors": ["Example Author"],
        "physicalIsbn13": None,
        "physicalPublisher": "Fixture Press",
        "physicalPublishedDate": "2026",
        "workSourceIds": {"fixture": "generated-html"},
        "editionSourceIds": {"fixture": "generated-html-edition"},
    }


@pytest.mark.anyio
async def test_resolution_endpoint_uses_confirmed_work_and_edition_contract():
    service = StubEditionService(
        EditionResolutionResult(
            status="unavailable",
            reason="No reviewed open edition is available for this work yet.",
        )
    )
    app = create_app(Settings(environment="test", fixture_mode=True), edition_service=service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/editions/resolve", json=request_body())

    assert response.status_code == 200
    assert response.json()["status"] == "unavailable"
    assert service.requests[0].work_title == "Pride and Prejudice"
    assert service.requests[0].physical_isbn13 == "9780141439518"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("error", "status", "detail"),
    [
        (SourceUnavailable("private details"), 503, "The open-edition source is unavailable"),
        (ValidationFailed("private details"), 502, "The open edition could not be verified"),
    ],
)
async def test_resolution_endpoint_maps_source_and_validation_failures(error, status, detail):
    app = create_app(
        Settings(environment="test", fixture_mode=True),
        edition_service=StubEditionService(error),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/editions/resolve", json=request_body())

    assert response.status_code == status
    assert response.json()["detail"] == detail
    assert "private details" not in response.text


@pytest.mark.anyio
async def test_fixture_resolution_provides_a_short_lived_epub_for_simulator_export():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resolved = await client.post("/editions/resolve", json=request_body())
        delivery = resolved.json()["delivery"]
        downloaded = await client.get(
            delivery["downloadPath"],
            headers={"Authorization": f"Bearer {delivery['downloadToken']}"},
        )

    assert resolved.status_code == 200
    assert resolved.json()["status"] == "ready"
    assert resolved.json()["digitalEdition"]["title"] == "Pride and Prejudice (test export)"
    assert resolved.json()["source"]["organization"] == "Deterministic test fixture"
    assert "test-only" in resolved.json()["rights"]["rightsStatement"].lower()
    assert delivery["filename"] == "Pride-and-Prejudice-test-export-Jane-Austen.epub"
    assert downloaded.status_code == 200
    assert downloaded.headers["x-content-sha256"] == delivery["sha256"]
    assert downloaded.content.startswith(b"PK")


@pytest.mark.anyio
async def test_fixture_mode_generates_and_delivers_a_test_only_structured_epub():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resolved = await client.post("/editions/resolve", json=generated_fixture_request_body())

        assert resolved.status_code == 200
        assert resolved.json()["status"] == "ready"
        delivery = resolved.json()["delivery"]
        downloaded = await client.get(
            delivery["downloadPath"],
            headers={"Authorization": f"Bearer {delivery['downloadToken']}"},
        )

    payload = resolved.json()
    assert payload["provenance"]["transformation"] == "generated"
    assert payload["provenance"]["generatorVersion"] == "structured-epub/1"
    assert payload["provenance"]["retrievedAt"] == "2026-07-10T17:00:00Z"
    assert payload["provenance"]["generatedAt"] == "2026-07-10T18:00:00Z"
    assert payload["rights"]["licenseName"] == "Test-only structured source"
    assert downloaded.status_code == 200
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
        chapter = archive.read("EPUB/chapter-001.xhtml").decode()
    assert "This test-only text verifies deterministic EPUB generation." in chapter


@pytest.mark.anyio
async def test_fixture_mode_generates_and_delivers_a_test_only_plain_text_epub():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resolved = await client.post(
            "/editions/resolve",
            json=generated_fixture_request_body(
                candidate_id="fixture:generated-plain-text",
                title="Structured Plain Text",
            ),
        )

        assert resolved.status_code == 200
        assert resolved.json()["status"] == "ready"
        delivery = resolved.json()["delivery"]
        downloaded = await client.get(
            delivery["downloadPath"],
            headers={"Authorization": f"Bearer {delivery['downloadToken']}"},
        )

    payload = resolved.json()
    assert payload["provenance"]["transformationSteps"] == [
        "normalized authorized PLAIN_TEXT",
        "packaged deterministic EPUB",
    ]
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
        chapter = archive.read("EPUB/chapter-001.xhtml").decode()
    assert "This test-only plain-text source verifies deterministic EPUB generation." in chapter


@pytest.mark.anyio
async def test_fixture_mode_analyzes_a_test_only_pdf_and_delivers_a_generated_epub():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resolved = await client.post(
            "/editions/resolve",
            json=generated_fixture_request_body(
                candidate_id="fixture:generated-pdf",
                title="Authorized PDF Source",
            ),
        )

        assert resolved.status_code == 200
        assert resolved.json()["status"] == "ready"
        delivery = resolved.json()["delivery"]
        downloaded = await client.get(
            delivery["downloadPath"],
            headers={"Authorization": f"Bearer {delivery['downloadToken']}"},
        )

    payload = resolved.json()
    assert payload["provenance"]["generatorVersion"] == "guarded-pdf/3 + structured-epub/1"
    assert "accounted for 3 PDF body blocks" in payload["provenance"]["transformationSteps"]
    assert "removed running_header (p1-l1)" in payload["provenance"]["transformationSteps"]
    assert "removed page_number (p2-l3)" in payload["provenance"]["transformationSteps"]
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
        chapter = archive.read("EPUB/chapter-001.xhtml").decode()
    assert "This test-only PDF source has a reliable text layer." in chapter
    assert "Test-only PDF header" not in chapter


@pytest.mark.anyio
async def test_pdf_fixture_applies_rights_before_analyzing_content(monkeypatch):
    def analysis_must_not_run(*_args, **_kwargs):
        raise AssertionError("rights-denied fixture must not enter PDF analysis")

    monkeypatch.setattr(fixture_module, "analyze_pdf", analysis_must_not_run)
    monkeypatch.setattr(
        fixture_module,
        "decide_rights",
        lambda *_args, **_kwargs: RightsDecision("reject"),
        raising=False,
    )
    service = fixture_module.FixtureEditionResolutionService(EphemeralEpubStore())
    request = EditionResolveRequest.model_validate(
        generated_fixture_request_body(
            candidate_id="fixture:generated-pdf",
            title="Authorized PDF Source",
        )
    )

    result = await service.resolve(request)

    assert result.status == "unavailable"
    assert result.reason == "The available source did not pass the demo's rights policy."


@pytest.mark.anyio
async def test_pdf_fixture_requires_its_pinned_hash_before_analyzing_content(monkeypatch):
    def analysis_must_not_run(*_args, **_kwargs):
        raise AssertionError("hash-mismatched fixture must not enter PDF analysis")

    monkeypatch.setitem(fixture_module._PDF_FIXTURES, "fixture:generated-pdf", b"not a PDF")
    monkeypatch.setattr(fixture_module, "analyze_pdf", analysis_must_not_run)
    service = fixture_module.FixtureEditionResolutionService(EphemeralEpubStore())
    request = EditionResolveRequest.model_validate(
        generated_fixture_request_body(
            candidate_id="fixture:generated-pdf",
            title="Authorized PDF Source",
        )
    )

    with pytest.raises(ValidationFailed, match="pinned hash"):
        await service.resolve(request)


@pytest.mark.anyio
async def test_pdf_refusal_fixture_applies_rights_before_analyzing_content(monkeypatch):
    def analysis_must_not_run(*_args, **_kwargs):
        raise AssertionError("rights-denied refusal fixture must not enter PDF analysis")

    monkeypatch.setattr(fixture_module, "analyze_pdf", analysis_must_not_run)
    monkeypatch.setattr(
        fixture_module,
        "decide_rights",
        lambda *_args, **_kwargs: RightsDecision("reject"),
        raising=False,
    )
    service = fixture_module.FixtureEditionResolutionService(EphemeralEpubStore())
    request = EditionResolveRequest.model_validate(
        generated_fixture_request_body(
            candidate_id="fixture:pdf-refused",
            title="PDF Conversion Refusal",
        )
    )

    result = await service.resolve(request)

    assert result.status == "unavailable"
    assert result.reason == "The available source did not pass the demo's rights policy."


@pytest.mark.anyio
async def test_pdf_refusal_fixture_requires_its_pinned_hash_before_analyzing_content(
    monkeypatch,
):
    def analysis_must_not_run(*_args, **_kwargs):
        raise AssertionError("hash-mismatched refusal fixture must not enter PDF analysis")

    monkeypatch.setitem(fixture_module._PDF_REFUSAL_FIXTURES, "fixture:pdf-refused", b"not a PDF")
    monkeypatch.setattr(fixture_module, "analyze_pdf", analysis_must_not_run)
    service = fixture_module.FixtureEditionResolutionService(EphemeralEpubStore())
    request = EditionResolveRequest.model_validate(
        generated_fixture_request_body(
            candidate_id="fixture:pdf-refused",
            title="PDF Conversion Refusal",
        )
    )

    with pytest.raises(ValidationFailed, match="pinned hash"):
        await service.resolve(request)


@pytest.mark.anyio
async def test_pdf_fixture_requires_its_reviewed_layout_profile_before_generation(monkeypatch):
    monkeypatch.setattr(fixture_module, "_PDF_FIXTURE_ANALYSIS_SHA256", "0" * 64)
    service = fixture_module.FixtureEditionResolutionService(EphemeralEpubStore())
    request = EditionResolveRequest.model_validate(
        generated_fixture_request_body(
            candidate_id="fixture:generated-pdf",
            title="Authorized PDF Source",
        )
    )

    with pytest.raises(ValidationFailed, match="layout profile"):
        await service.resolve(request)


@pytest.mark.anyio
async def test_fixture_mode_refuses_a_complex_pdf_without_creating_a_delivery():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resolved = await client.post(
            "/editions/resolve",
            json=generated_fixture_request_body(
                candidate_id="fixture:pdf-refused",
                title="PDF Conversion Refusal",
            ),
        )

    payload = resolved.json()
    assert resolved.status_code == 200
    assert payload["status"] == "unavailable"
    assert payload["reason"] == (
        "We found an authorized PDF, but could not safely convert its layout into an EPUB."
    )
    assert payload["delivery"] is None


@pytest.mark.anyio
async def test_fixture_mode_refuses_a_pdf_export_when_generated_text_loses_analyzed_content(
    monkeypatch,
):
    def generate_mismatched_epub(source: StructuredSource, *, generated_at: str):
        return real_generate_epub(
            StructuredSource(
                source_id=source.source_id,
                canonical_url=source.canonical_url,
                title=source.title,
                authors=source.authors,
                language=source.language,
                content=(
                    b"<html><body><h1>Replacement chapter</h1>"
                    b"<p>Unrelated replacement text.</p></body></html>"
                ),
                license_name=source.license_name,
                license_url=source.license_url,
                attribution=source.attribution,
            ),
            generated_at=generated_at,
        )

    monkeypatch.setattr(fixture_module, "generate_epub", generate_mismatched_epub)
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resolved = await client.post(
            "/editions/resolve",
            json=generated_fixture_request_body(
                candidate_id="fixture:generated-pdf",
                title="Authorized PDF Source",
            ),
        )

    assert resolved.status_code == 502
    assert resolved.json()["detail"] == "The open edition could not be verified"


@pytest.mark.anyio
async def test_simulator_export_fixture_is_safe_and_epubcheck_valid():
    content = fixture_epub_bytes()

    inspection = inspect_epub(content)
    validation = await EpubcheckValidator().validate(content)

    assert inspection.package_path == "EPUB/package.opf"
    assert validation.valid is True
