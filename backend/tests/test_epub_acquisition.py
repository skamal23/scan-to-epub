import hashlib
from dataclasses import replace

import pytest
from test_epub_safety import epub_bytes

from book_backend.content_sources.standard_ebooks import STANDARD_EBOOKS_CATALOG
from book_backend.editions.acquisition import DownloadResponse, SafeEpubAcquirer
from book_backend.editions.service import SourceUnavailable, ValidationFailed


class Fetcher:
    def __init__(self, response):
        self.response = response
        self.urls = []

    async def fetch(self, url, max_bytes):
        self.urls.append((url, max_bytes))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


class SequenceFetcher:
    def __init__(self, responses):
        self.responses = list(responses)
        self.urls = []

    async def fetch(self, url, max_bytes):
        self.urls.append((url, max_bytes))
        return self.responses.pop(0)


def response(content: bytes, **overrides):
    values = {
        "status": 200,
        "content_type": "application/epub+zip",
        "content": content,
        "final_url": "https://standardebooks.org/ebooks/test/downloads/test.epub?source=download",
        "redirected": False,
    }
    values.update(overrides)
    return DownloadResponse(**values)


def pinned_entry(payload: bytes):
    entry = STANDARD_EBOOKS_CATALOG.entries[0]
    return replace(
        entry,
        acquisition_url=response(payload).final_url,
        download_policy=replace(
            entry.download_policy,
            expected_sha256=hashlib.sha256(payload).hexdigest(),
        ),
    )


@pytest.mark.anyio
async def test_acquirer_accepts_only_the_pinned_valid_epub():
    payload = epub_bytes()
    fetcher = Fetcher(response(payload))
    acquired = await SafeEpubAcquirer(fetcher).acquire(pinned_entry(payload))

    assert acquired.content == payload
    assert acquired.sha256 == hashlib.sha256(payload).hexdigest()
    assert fetcher.urls == [(pinned_entry(payload).acquisition_url, 25_000_000)]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "bad_response",
    [
        response(b"x", status=404),
        response(b"<html>error</html>", content_type="text/html"),
        response(epub_bytes(), redirected=True),
        response(epub_bytes(), final_url="https://evil.example/book.epub"),
    ],
)
async def test_status_type_redirect_and_host_fail_closed(bad_response):
    with pytest.raises((SourceUnavailable, ValidationFailed)):
        await SafeEpubAcquirer(Fetcher(bad_response)).acquire(pinned_entry(epub_bytes()))


@pytest.mark.anyio
async def test_changed_pinned_hash_requires_catalog_review():
    expected = epub_bytes()
    changed = epub_bytes([("EPUB/change.xhtml", "changed")])

    with pytest.raises(ValidationFailed, match="reviewed hash"):
        await SafeEpubAcquirer(Fetcher(response(changed))).acquire(pinned_entry(expected))


@pytest.mark.anyio
async def test_acquirer_uses_each_reviewed_source_host_and_digest_policy():
    payload = epub_bytes()
    entry = STANDARD_EBOOKS_CATALOG.entries[0]
    oapen = replace(
        entry,
        entry_id="oapen:example",
        source_key="oapen",
        source_organization="OAPEN",
        acquisition_url="https://library.oapen.org/rest/bitstreams/example/retrieve",
        download_policy=replace(
            entry.download_policy,
            allowed_hosts=frozenset({"library.oapen.org"}),
            expected_sha256=hashlib.sha256(payload).hexdigest(),
            expected_md5=hashlib.md5(payload).hexdigest(),
        ),
    )
    fetched = response(
        payload,
        final_url="https://library.oapen.org/rest/bitstreams/example/retrieve",
    )

    acquired = await SafeEpubAcquirer(Fetcher(fetched)).acquire(oapen)

    assert acquired.sha256 == hashlib.sha256(payload).hexdigest()


@pytest.mark.anyio
async def test_acquirer_follows_only_an_explicitly_allowed_google_redirect():
    payload = epub_bytes()
    initial_url = "https://books.google.com/books/download/example.epub"
    redirected_url = "https://books.googleusercontent.com/books/download/example.epub"
    entry = replace(
        pinned_entry(payload),
        source_key="google_books",
        acquisition_url=initial_url,
        download_policy=replace(
            pinned_entry(payload).download_policy,
            allowed_hosts=frozenset({"books.google.com", "books.googleusercontent.com"}),
            allow_redirects=True,
            max_redirects=1,
        ),
    )
    fetcher = SequenceFetcher(
        [
            DownloadResponse(
                status=302,
                content_type="",
                content=b"",
                final_url=initial_url,
                redirected=True,
                redirect_url=redirected_url,
            ),
            response(payload, final_url=redirected_url),
        ]
    )

    acquired = await SafeEpubAcquirer(fetcher).acquire(entry)

    assert acquired.sha256 == hashlib.sha256(payload).hexdigest()
    assert fetcher.urls == [(initial_url, 25_000_000), (redirected_url, 25_000_000)]
