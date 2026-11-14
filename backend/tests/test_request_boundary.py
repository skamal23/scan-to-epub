import uuid
from pathlib import Path

import httpx
import pytest

from book_backend.app import create_app
from book_backend.config import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def app():
    return create_app(Settings(environment="test", fixture_mode=True))


@pytest.mark.anyio
async def test_response_uses_a_server_generated_request_id_and_privacy_headers():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app()), base_url="http://test"
    ) as client:
        response = await client.get("/health", headers={"x-request-id": "untrusted-value"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] != "untrusted-value"
    assert uuid.UUID(response.headers["x-request-id"]).version == 4
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.anyio
async def test_cover_route_rejects_a_malformed_content_length_without_reading_a_body():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app()), base_url="http://test"
    ) as client:
        response = await client.post(
            "/covers/recognize",
            content=b"not-read",
            headers={"content-type": "image/jpeg", "content-length": "not-a-number"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cover size could not be read"


@pytest.mark.anyio
@pytest.mark.parametrize("content_length", ["+1", "-0", ""])
async def test_cover_route_accepts_only_ascii_decimal_content_length(content_length: str):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app()), base_url="http://test"
    ) as client:
        response = await client.post(
            "/covers/recognize",
            content=b"not-read",
            headers={"content-type": "image/jpeg", "content-length": content_length},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cover size could not be read"


def test_backend_launch_commands_disable_uvicorn_access_logging():
    workspace = Path(__file__).parents[2]
    makefile = (workspace / "Makefile").read_text()
    render = (workspace / "render.yaml").read_text()

    assert makefile.count("uvicorn book_backend.app:app") == 4
    assert makefile.count("--no-access-log") == 4
    assert "runtime: docker" in render
    assert "--no-access-log" in (workspace / "backend/Dockerfile").read_text()
