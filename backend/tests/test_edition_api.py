import httpx
import pytest

from book_backend.app import create_app
from book_backend.config import Settings
from book_backend.editions.errors import SourceUnavailable, ValidationFailed
from book_backend.editions.fixtures import fixture_epub_bytes
from book_backend.editions.models import EditionResolutionResult
from book_backend.epubs.safety import inspect_epub
from book_backend.epubs.validator import EpubcheckValidator


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
async def test_simulator_export_fixture_is_safe_and_epubcheck_valid():
    content = fixture_epub_bytes()

    inspection = inspect_epub(content)
    validation = await EpubcheckValidator().validate(content)

    assert inspection.package_path == "EPUB/package.opf"
    assert validation.valid is True
