import hashlib
import logging

import httpx
import pytest

from book_backend.app import create_app
from book_backend.config import Settings
from book_backend.epubs.artifacts import EphemeralEpubStore


@pytest.mark.anyio
async def test_download_endpoint_returns_only_the_staged_epub_with_safe_headers(caplog):
    payload = b"validated epub payload"
    store = EphemeralEpubStore()
    delivery = await store.stage(
        content=payload,
        sha256=hashlib.sha256(payload).hexdigest(),
        title="Pride and Prejudice",
        authors=["Jane Austen"],
    )
    app = create_app(Settings(environment="test", fixture_mode=True), epub_store=store)
    caplog.set_level(logging.INFO, logger="book_backend.request")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/editions/download",
            headers={"Authorization": f"Bearer {delivery.download_token}"},
        )

    assert response.status_code == 200
    assert response.content == payload
    assert response.headers["content-type"].startswith("application/epub+zip")
    assert response.headers["content-length"] == str(len(payload))
    assert response.headers["content-disposition"] == (
        'attachment; filename="Pride-and-Prejudice-Jane-Austen.epub"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-sha256"] == delivery.sha256
    assert all(delivery.download_token not in record.getMessage() for record in caplog.records)


@pytest.mark.anyio
async def test_download_endpoint_rejects_missing_or_unknown_credentials_without_leaking_epub_data():
    app = create_app(
        Settings(environment="test", fixture_mode=True), epub_store=EphemeralEpubStore()
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        missing = await client.get("/editions/download")
        unknown = await client.get(
            "/editions/download", headers={"Authorization": "Bearer unknown"}
        )

    assert missing.status_code == 401
    assert unknown.status_code == 410
    assert unknown.headers["content-type"].startswith("application/json")
    assert not unknown.content.startswith(b"PK")
