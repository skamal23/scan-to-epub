import hashlib
from datetime import UTC, datetime, timedelta

import pytest

from book_backend.epubs.artifacts import EphemeralEpubStore, safe_epub_filename


class Clock:
    def __init__(self):
        self.now = datetime(2026, 7, 10, 18, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


@pytest.mark.anyio
async def test_stages_a_verified_epub_with_an_opaque_expiring_download_credential():
    clock = Clock()
    payload = b"verified epub bytes"
    store = EphemeralEpubStore(ttl_seconds=60, now=clock)

    delivery = await store.stage(
        content=payload,
        sha256=hashlib.sha256(payload).hexdigest(),
        title="Pride and Prejudice",
        authors=["Jane Austen"],
    )

    assert delivery.download_path == "/editions/download"
    assert delivery.filename == "Pride-and-Prejudice-Jane-Austen.epub"
    assert delivery.content_length == len(payload)
    assert delivery.sha256 == hashlib.sha256(payload).hexdigest()
    assert delivery.expires_at == datetime(2026, 7, 10, 18, 1, tzinfo=UTC)
    assert len(delivery.download_token) >= 40

    artifact = await store.get(delivery.download_token)

    assert artifact is not None
    assert artifact.content == payload
    assert artifact.filename == delivery.filename


@pytest.mark.anyio
async def test_expired_artifacts_are_unavailable_and_removed_from_the_store():
    clock = Clock()
    store = EphemeralEpubStore(ttl_seconds=60, now=clock)
    delivery = await store.stage(
        content=b"verified epub bytes",
        sha256=hashlib.sha256(b"verified epub bytes").hexdigest(),
        title="A Book",
        authors=["An Author"],
    )

    clock.now += timedelta(seconds=61)

    assert await store.get(delivery.download_token) is None
    assert await store.get(delivery.download_token) is None


@pytest.mark.parametrize(
    ("title", "authors", "expected"),
    [
        (
            "Jane Eyre: An Autobiography",
            ["Charlotte Brontë"],
            "Jane-Eyre-An-Autobiography-Charlotte-Bronte.epub",
        ),
        ("../../private", ["???"], "private-book.epub"),
    ],
)
def test_delivery_filename_is_stable_human_readable_and_safe(title, authors, expected):
    assert safe_epub_filename(title, authors) == expected
