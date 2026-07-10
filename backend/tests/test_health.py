import logging

import httpx
import pytest

from book_backend.app import create_app
from book_backend.config import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def make_transport() -> httpx.ASGITransport:
    return httpx.ASGITransport(app=create_app(Settings(environment="test", fixture_mode=True)))


@pytest.mark.anyio
async def test_health_contract() -> None:
    async with httpx.AsyncClient(transport=make_transport(), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "book-backend",
        "environment": "test",
        "fixtureMode": True,
        "version": "0.1.0",
    }
    assert response.headers["x-request-id"]


@pytest.mark.anyio
async def test_request_log_excludes_query_values(caplog) -> None:
    caplog.set_level(logging.INFO, logger="book_backend.request")

    async with httpx.AsyncClient(transport=make_transport(), base_url="http://test") as client:
        response = await client.get("/health?cover=private-image-data")

    assert response.status_code == 200
    messages = [record.getMessage() for record in caplog.records]
    assert any("GET /health 200" in message for message in messages)
    assert all("private-image-data" not in message for message in messages)
