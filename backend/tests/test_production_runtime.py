import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from book_backend.app import create_app
from book_backend.config import Settings
from book_backend.editions.errors import SourceUnavailable
from book_backend.epubs.artifacts import SqliteEpubStore


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_delivery_survives_store_restart_and_expiry(tmp_path):
    path = str(tmp_path / "artifacts.sqlite")
    first = SqliteEpubStore(path)
    content = b"verified epub fixture"
    delivery = await first.stage(content, hashlib.sha256(content).hexdigest(), "Book", ["Author"])
    restarted = SqliteEpubStore(path)
    artifact = await restarted.get(delivery.download_token)
    assert bytes(artifact.content) == content
    restarted.now = lambda: datetime.now(UTC) + timedelta(minutes=20)
    assert await restarted.get(delivery.download_token) is None


@pytest.mark.anyio
async def test_full_store_keeps_existing_deliveries(tmp_path):
    store = SqliteEpubStore(str(tmp_path / "artifacts.sqlite"), max_bytes=4)
    content = b"epub"
    delivery = await store.stage(content, hashlib.sha256(content).hexdigest(), "Book", [])
    with pytest.raises(SourceUnavailable):
        await store.stage(content, hashlib.sha256(content).hexdigest(), "Other", [])
    assert await store.get(delivery.download_token) is not None


def test_production_cannot_use_fixture_books():
    with pytest.raises(ValueError, match="fixture"):
        Settings(environment="production", fixture_mode=True)


def test_browser_can_read_download_integrity_header():
    client = TestClient(create_app(Settings(fixture_mode=True)))
    response = client.get("/health", headers={"Origin": "http://localhost:8081"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert "X-Content-SHA256" in response.headers["access-control-expose-headers"]
