import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urlparse

import httpx

from book_backend.content_sources.standard_ebooks import StandardEbookEntry

from .errors import SourceUnavailable, ValidationFailed
from .models import AcquiredEpub


@dataclass(frozen=True, slots=True)
class DownloadResponse:
    status: int
    content_type: str
    content: bytes
    final_url: str
    redirected: bool


class EpubFetcher(Protocol):
    async def fetch(self, url: str, max_bytes: int) -> DownloadResponse: ...


class HttpEpubFetcher:
    def __init__(self, user_agent: str, timeout_seconds: float = 15):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    async def fetch(self, url: str, max_bytes: int) -> DownloadResponse:
        timeout = httpx.Timeout(self.timeout_seconds)
        try:
            async with (
                httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client,
                client.stream(
                    "GET",
                    url,
                    headers={
                        "Accept": "application/epub+zip",
                        "User-Agent": self.user_agent,
                    },
                ) as response,
            ):
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > max_bytes:
                    raise ValidationFailed("EPUB download exceeds the size limit")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        body.clear()
                        raise ValidationFailed("EPUB download exceeds the size limit")
                return DownloadResponse(
                    status=response.status_code,
                    content_type=response.headers.get("content-type", ""),
                    content=bytes(body),
                    final_url=str(response.url),
                    redirected=response.is_redirect,
                )
        except httpx.HTTPError as error:
            raise SourceUnavailable("Standard Ebooks could not be reached") from error


class SafeEpubAcquirer:
    def __init__(self, fetcher: EpubFetcher, max_bytes: int = 25_000_000):
        self.fetcher = fetcher
        self.max_bytes = max_bytes

    async def acquire(self, entry: StandardEbookEntry) -> AcquiredEpub:
        response = await self.fetcher.fetch(entry.acquisition_url, self.max_bytes)
        if response.status != 200:
            raise SourceUnavailable("Standard Ebooks did not return the reviewed file")
        if response.redirected:
            raise ValidationFailed("The reviewed EPUB unexpectedly redirected")
        parsed = urlparse(response.final_url)
        if parsed.scheme != "https" or parsed.hostname != "standardebooks.org":
            raise ValidationFailed("The reviewed EPUB came from an unapproved host")
        content_type = response.content_type.partition(";")[0].strip().lower()
        if content_type != "application/epub+zip":
            raise ValidationFailed("The source response was not an EPUB")
        digest = hashlib.sha256(response.content).hexdigest()
        if digest != entry.expected_sha256:
            raise ValidationFailed("The EPUB no longer matches its reviewed hash")
        return AcquiredEpub(
            content=response.content,
            sha256=digest,
            retrieved_at=datetime.now(UTC),
        )
