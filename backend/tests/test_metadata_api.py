import httpx
import pytest

from book_backend.app import create_app
from book_backend.config import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def fixture_transport() -> httpx.ASGITransport:
    app = create_app(Settings(environment="test", fixture_mode=True))
    return httpx.ASGITransport(app=app)


@pytest.mark.anyio
async def test_fixture_isbn_search_returns_separate_work_and_edition(
    fixture_transport: httpx.ASGITransport,
) -> None:
    async with httpx.AsyncClient(transport=fixture_transport, base_url="http://test") as client:
        response = await client.post("/metadata/search", json={"isbn": "978-0-14-143951-8"})

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["candidates"]) == 1
    candidate = payload["candidates"][0]
    assert candidate["work"]["title"] == "Pride and Prejudice"
    assert candidate["work"]["firstPublishedYear"] == 1813
    assert candidate["edition"]["isbn13"] == "9780141439518"
    assert candidate["edition"]["publisher"] == "Penguin Classics"
    assert payload["observedIsbn"] == "9780141439518"


@pytest.mark.anyio
async def test_invalid_search_is_rejected(fixture_transport: httpx.ASGITransport) -> None:
    async with httpx.AsyncClient(transport=fixture_transport, base_url="http://test") as client:
        invalid_isbn = await client.post("/metadata/search", json={"isbn": "9780306406158"})
        empty_query = await client.post("/metadata/search", json={})

    assert invalid_isbn.status_code == 422
    assert empty_query.status_code == 422


@pytest.mark.anyio
async def test_fixture_no_result_is_an_honest_empty_list(
    fixture_transport: httpx.ASGITransport,
) -> None:
    async with httpx.AsyncClient(transport=fixture_transport, base_url="http://test") as client:
        response = await client.post(
            "/metadata/search",
            json={"title": "A Book That Does Not Exist", "author": "Nobody"},
        )

    assert response.status_code == 200
    assert response.json()["candidates"] == []


@pytest.mark.anyio
async def test_fixture_supports_ambiguity_and_partial_provider_failure(
    fixture_transport: httpx.ASGITransport,
) -> None:
    async with httpx.AsyncClient(transport=fixture_transport, base_url="http://test") as client:
        ambiguous = await client.post("/metadata/search", json={"title": "Invisible Man"})
        partial = await client.post("/metadata/search", json={"title": "Provider Warning"})

    assert ambiguous.status_code == 200
    assert len(ambiguous.json()["candidates"]) == 2
    assert all(candidate["confidence"] != "high" for candidate in ambiguous.json()["candidates"])
    assert partial.status_code == 200
    assert [candidate["work"]["title"] for candidate in partial.json()["candidates"]] == [
        "Provider Warning"
    ]
    assert partial.json()["providerFailures"] == ["fixture_secondary"]
