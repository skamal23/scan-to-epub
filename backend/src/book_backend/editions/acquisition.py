import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urljoin, urlparse

import httpx

from book_backend.content_sources.approved_catalog import ApprovedEpubEntry

from .errors import SourceUnavailable, ValidationFailed
from .models import AcquiredEpub


@dataclass(frozen=True, slots=True)
class DownloadResponse:
    status: int
    content_type: str
    content: bytes
    final_url: str
    redirected: bool
    redirect_url: str | None = None


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
                    redirect_url=response.headers.get("location") if response.is_redirect else None,
                )
        except httpx.HTTPError as error:
            raise SourceUnavailable("The approved EPUB source could not be reached") from error


class SafeEpubAcquirer:
    def __init__(self, fetcher: EpubFetcher, max_bytes: int = 25_000_000):
        self.fetcher = fetcher
        self.max_bytes = max_bytes

    async def acquire(self, entry: ApprovedEpubEntry) -> AcquiredEpub:
        url = entry.acquisition_url
        redirects = 0
        while True:
            if not _is_allowed_https_url(url, entry):
                raise ValidationFailed("The reviewed EPUB came from an unapproved host")
            response = await self.fetcher.fetch(url, self.max_bytes)
            if response.status in {301, 302, 303, 307, 308}:
                if (
                    not entry.download_policy.allow_redirects
                    or response.redirect_url is None
                    or redirects >= entry.download_policy.max_redirects
                ):
                    raise ValidationFailed("The reviewed EPUB unexpectedly redirected")
                url = urljoin(url, response.redirect_url)
                redirects += 1
                continue
            break
        if response.status != 200:
            raise SourceUnavailable("The approved EPUB source did not return the reviewed file")
        if response.redirected:
            raise ValidationFailed("The reviewed EPUB unexpectedly redirected")
        if not _is_allowed_https_url(response.final_url, entry):
            raise ValidationFailed("The reviewed EPUB came from an unapproved host")
        content_type = response.content_type.partition(";")[0].strip().lower()
        if content_type != "application/epub+zip":
            raise ValidationFailed("The source response was not an EPUB")
        digest = hashlib.sha256(response.content).hexdigest()
        if (
            entry.download_policy.expected_sha256 is not None
            and digest != entry.download_policy.expected_sha256
        ):
            raise ValidationFailed("The EPUB no longer matches its reviewed hash")
        if (
            entry.download_policy.expected_md5 is not None
            and hashlib.md5(response.content).hexdigest() != entry.download_policy.expected_md5
        ):
            raise ValidationFailed("The EPUB no longer matches the source checksum")
        return AcquiredEpub(
            content=response.content,
            sha256=digest,
            retrieved_at=datetime.now(UTC),
        )


def _is_allowed_https_url(url: str, entry: ApprovedEpubEntry) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname.casefold() if parsed.hostname else None
    return (
        parsed.scheme == "https"
        and host in entry.download_policy.allowed_hosts
        and not parsed.username
        and not parsed.password
    )
