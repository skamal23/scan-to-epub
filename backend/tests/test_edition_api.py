import httpx
import pytest

from book_backend.app import create_app
from book_backend.config import Settings
from book_backend.editions.errors import SourceUnavailable, ValidationFailed
from book_backend.editions.models import EditionResolutionResult


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
