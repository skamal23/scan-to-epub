from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from time import monotonic
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from book_backend.editions.errors import SourceUnavailable
from book_backend.metadata.providers import AsyncRequestGate

from .approved_catalog import ApprovedEpubEntry, EpubDownloadPolicy

GOOGLE_DOWNLOAD_HOSTS = frozenset({"books.google.com", "books.googleusercontent.com"})


class GoogleBooksVolumeClient(Protocol):
    async def search(self, query: str, *, country: str) -> list[Mapping[str, Any]]: ...


class HttpGoogleBooksVolumeClient:
    def __init__(
        self,
        api_key: str,
        timeout_seconds: float = 8.0,
        requests_per_second: float = 1.0,
    ):
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.rate_gate = AsyncRequestGate(1 / requests_per_second)

    async def search(self, query: str, *, country: str) -> list[Mapping[str, Any]]:
        await self.rate_gate.wait()
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.get(
                    "https://www.googleapis.com/books/v1/volumes",
                    params={
                        "q": query,
                        "key": self.api_key,
                        "country": country,
                        "filter": "free-ebooks",
                        "download": "epub",
                        "projection": "full",
                        "maxResults": 10,
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable("Google Books could not be reached") from error
        payload = response.json()
        items = payload.get("items", []) if isinstance(payload, Mapping) else []
        return [item for item in items if isinstance(item, Mapping)]


class GoogleBooksOpenEditionSource:
    def __init__(
        self,
        client: GoogleBooksVolumeClient,
        reviewed_at: Callable[[], str] | None = None,
        cache_ttl_seconds: float = 300,
        clock: Callable[[], float] = monotonic,
    ):
        self.client = client
        self.reviewed_at = reviewed_at or _reviewed_at_now
        self.cache_ttl_seconds = cache_ttl_seconds
        self.clock = clock
        self._cache: dict[
            tuple[str, tuple[str, ...], str | None],
            tuple[float, tuple[ApprovedEpubEntry, ...]],
        ] = {}

    async def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]:
        cache_key = (title, tuple(authors), physical_isbn13)
        cached = self._cache.get(cache_key)
        now = self.clock()
        if cached and cached[0] > now:
            return cached[1]
        query = _query_for(title, authors, physical_isbn13)
        volumes = await self.client.search(query, country="US")
        entries = tuple(
            entry
            for volume in volumes
            if (entry := google_public_domain_epub_entry(volume, reviewed_at=self.reviewed_at()))
            is not None
        )
        from .approved_catalog import ApprovedEpubCatalog

        matches = ApprovedEpubCatalog(entries).find_all(title, authors, physical_isbn13)
        if self.cache_ttl_seconds > 0:
            self._cache[cache_key] = (now + self.cache_ttl_seconds, matches)
        return matches


def google_public_domain_epub_entry(
    volume: Mapping[str, Any], *, reviewed_at: str
) -> ApprovedEpubEntry | None:
    """Normalize only an explicitly downloadable U.S. public-domain Google volume.

    Google exposes download links for more than public-domain books, including samples and
    account-bound downloads. Every access field below is therefore a required gate.
    """

    volume_id = volume.get("id")
    volume_info = volume.get("volumeInfo")
    access_info = volume.get("accessInfo")
    if (
        not isinstance(volume_id, str)
        or not isinstance(volume_info, Mapping)
        or not isinstance(access_info, Mapping)
        or access_info.get("country") != "US"
        or access_info.get("accessViewStatus") != "FULL_PUBLIC_DOMAIN"
        or access_info.get("publicDomain") is not True
        or access_info.get("viewability") != "ALL_PAGES"
    ):
        return None

    epub = access_info.get("epub")
    if not isinstance(epub, Mapping) or epub.get("isAvailable") is not True:
        return None
    download_url = epub.get("downloadLink")
    if not isinstance(download_url, str) or epub.get("acsTokenLink"):
        return None
    parsed_download = urlparse(download_url)
    if (
        parsed_download.scheme != "https"
        or parsed_download.hostname not in GOOGLE_DOWNLOAD_HOSTS
        or parsed_download.username
        or parsed_download.password
        or parsed_download.fragment
    ):
        return None

    download_access = access_info.get("downloadAccess")
    if isinstance(download_access, Mapping) and download_access.get("restricted") is True:
        return None

    title = volume_info.get("title")
    raw_authors = volume_info.get("authors")
    authors = (
        tuple(author for author in raw_authors if isinstance(author, str))
        if isinstance(raw_authors, list)
        else ()
    )
    if not isinstance(title, str) or not title.strip() or not authors:
        return None
    language = volume_info.get("language")
    publisher = volume_info.get("publisher")
    canonical_url = _canonical_volume_url(volume_info.get("canonicalVolumeLink"), volume_id)
    if canonical_url is None:
        return None

    return ApprovedEpubEntry(
        entry_id=f"google_books:{volume_id}",
        source_key="google_books",
        priority=50,
        work_title=title,
        aliases=(),
        authors=authors,
        digital_title=title,
        language=language if isinstance(language, str) else "en",
        digital_identifier=canonical_url,
        publisher=publisher if isinstance(publisher, str) else "Google Books",
        source_organization="Google Books",
        canonical_url=canonical_url,
        acquisition_url=download_url,
        cover_url=None,
        rights_evidence="us_public_domain",
        license_name="Public domain (United States)",
        license_url="https://www.google.com/googlebooks/uspto.html",
        rights_statement=(
            "Google Books reported a full public-domain EPUB download for the United States "
            "when this edition was checked."
        ),
        attribution=f"{', '.join(authors)}, {title}; Google Books public-domain EPUB.",
        reviewed_at=reviewed_at,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=GOOGLE_DOWNLOAD_HOSTS,
            allow_redirects=True,
            max_redirects=1,
        ),
    )


def _canonical_volume_url(value: object, volume_id: str) -> str | None:
    if isinstance(value, str):
        parsed = urlparse(value)
        if (
            parsed.scheme == "https"
            and parsed.hostname == "books.google.com"
            and not parsed.username
            and not parsed.password
        ):
            return value
    return f"https://books.google.com/books?id={volume_id}"


def _query_for(title: str, authors: list[str], physical_isbn13: str | None) -> str:
    if physical_isbn13:
        return f"isbn:{physical_isbn13}"
    query = f"intitle:{title}"
    if authors:
        query += f" inauthor:{authors[0]}"
    return query


def _reviewed_at_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
