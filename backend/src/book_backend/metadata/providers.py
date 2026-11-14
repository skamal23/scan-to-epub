import asyncio
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Protocol

import httpx

from .isbn import InvalidISBN, normalize_isbn
from .models import BookRecord, MetadataQuery


class MetadataProvider(Protocol):
    name: str

    async def search(self, query: MetadataQuery) -> list[BookRecord]: ...


class AsyncRequestGate:
    def __init__(
        self,
        min_interval_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.min_interval_seconds = min_interval_seconds
        self.clock = clock
        self.sleep = sleep
        self._next_start = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            delay = self._next_start - self.clock()
            if delay > 0:
                await self.sleep(delay)
            self._next_start = self.clock() + self.min_interval_seconds


def _identifier(values: object, kind: str) -> str | None:
    if not isinstance(values, list):
        return None
    for item in values:
        if (
            isinstance(item, Mapping)
            and item.get("type") == kind
            and isinstance(item.get("identifier"), str)
        ):
            return item["identifier"]
    return None


def _safe_isbn(values: object, length: int) -> str | None:
    if not isinstance(values, list):
        return None
    for value in values:
        if not isinstance(value, str):
            continue
        try:
            normalized = normalize_isbn(value)
        except InvalidISBN:
            continue
        if len(normalized) == length:
            return normalized
    return None


def normalize_google_volume(item: Mapping[str, Any]) -> BookRecord:
    info = item.get("volumeInfo") if isinstance(item.get("volumeInfo"), Mapping) else {}
    identifiers = info.get("industryIdentifiers", [])
    cover = info.get("imageLinks") if isinstance(info.get("imageLinks"), Mapping) else {}
    cover_url = cover.get("thumbnail") if isinstance(cover.get("thumbnail"), str) else None
    if cover_url and cover_url.startswith("http://"):
        cover_url = "https://" + cover_url.removeprefix("http://")
    published_date = (
        info.get("publishedDate") if isinstance(info.get("publishedDate"), str) else None
    )
    authors = info.get("authors") if isinstance(info.get("authors"), list) else []
    return BookRecord(
        provider="google_books",
        provider_work_id=None,
        provider_edition_id=item.get("id") if isinstance(item.get("id"), str) else None,
        title=info.get("title") if isinstance(info.get("title"), str) else "Untitled",
        authors=tuple(author for author in authors if isinstance(author, str)),
        first_published_year=_year(published_date),
        published_date=published_date,
        publisher=info.get("publisher") if isinstance(info.get("publisher"), str) else None,
        language=info.get("language") if isinstance(info.get("language"), str) else None,
        isbn10=_identifier(identifiers, "ISBN_10"),
        isbn13=_identifier(identifiers, "ISBN_13"),
        cover_url=cover_url,
    )


def normalize_open_library_doc(
    doc: Mapping[str, Any], observed_isbn: str | None = None
) -> BookRecord:
    editions = doc.get("editions") if isinstance(doc.get("editions"), Mapping) else {}
    edition_docs = editions.get("docs") if isinstance(editions.get("docs"), list) else []
    edition = next(
        (
            item
            for item in edition_docs
            if isinstance(item, Mapping) and observed_isbn and observed_isbn in item.get("isbn", [])
        ),
        edition_docs[0]
        if not observed_isbn and edition_docs and isinstance(edition_docs[0], Mapping)
        else {},
    )
    publishers = edition.get("publisher") if isinstance(edition.get("publisher"), list) else []
    publish_dates = (
        edition.get("publish_date") if isinstance(edition.get("publish_date"), list) else []
    )
    languages = (
        edition.get("language")
        if isinstance(edition.get("language"), list)
        else doc.get("language", [])
    )
    isbns = edition.get("isbn") if isinstance(edition.get("isbn"), list) else doc.get("isbn", [])
    if observed_isbn and observed_isbn in isbns:
        isbns = [observed_isbn, *[value for value in isbns if value != observed_isbn]]
    cover_id = (
        edition.get("cover_i") if isinstance(edition.get("cover_i"), int) else doc.get("cover_i")
    )
    authors = doc.get("author_name") if isinstance(doc.get("author_name"), list) else []
    return BookRecord(
        provider="open_library",
        provider_work_id=_strip_open_library_key(doc.get("key")),
        provider_edition_id=_strip_open_library_key(edition.get("key")),
        title=(edition.get("title") if isinstance(edition.get("title"), str) else doc.get("title"))
        or "Untitled",
        authors=tuple(author for author in authors if isinstance(author, str)),
        first_published_year=doc.get("first_publish_year")
        if isinstance(doc.get("first_publish_year"), int)
        else None,
        published_date=next((date for date in publish_dates if isinstance(date, str)), None),
        publisher=next((publisher for publisher in publishers if isinstance(publisher, str)), None),
        language=_open_library_language(languages),
        isbn10=_safe_isbn(isbns, 10),
        isbn13=_safe_isbn(isbns, 13),
        cover_url=f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
        if isinstance(cover_id, int)
        else None,
    )


class GoogleBooksProvider:
    name = "google_books"

    def __init__(self, api_key: str, timeout_seconds: float = 6.0):
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    async def search(self, query: MetadataQuery) -> list[BookRecord]:
        terms = f"isbn:{query.isbn}" if query.isbn else f"intitle:{query.title}"
        if query.author:
            terms += f" inauthor:{query.author}"
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.get(
                "https://www.googleapis.com/books/v1/volumes",
                params={"q": terms, "key": self.api_key, "maxResults": 8, "printType": "books"},
            )
            response.raise_for_status()
        payload = response.json()
        items = payload.get("items", []) if isinstance(payload, Mapping) else []
        return [normalize_google_volume(item) for item in items if isinstance(item, Mapping)]


class OpenLibraryProvider:
    name = "open_library"

    def __init__(
        self,
        user_agent: str,
        timeout_seconds: float = 6.0,
        requests_per_second: float = 1.0,
    ):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds
        self.rate_gate = AsyncRequestGate(1 / requests_per_second)

    async def search(self, query: MetadataQuery) -> list[BookRecord]:
        await self.rate_gate.wait()
        fields = ",".join(
            (
                "key",
                "title",
                "author_name",
                "first_publish_year",
                "language",
                "cover_i",
                "isbn",
                "editions",
                "editions.key",
                "editions.title",
                "editions.publisher",
                "editions.publish_date",
                "editions.isbn",
                "editions.cover_i",
                "editions.language",
            )
        )
        params: dict[str, str | int] = {
            "fields": fields,
            "limit": 8,
            "lang": "en",
        }
        if query.isbn:
            params["q"] = f"isbn:{query.isbn}"
        else:
            params["title"] = query.title or ""
            if query.author:
                params["author"] = query.author
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.get(
                "https://openlibrary.org/search.json",
                params=params,
                headers={"User-Agent": self.user_agent},
            )
            response.raise_for_status()
        payload = response.json()
        docs = payload.get("docs", []) if isinstance(payload, Mapping) else []
        return [
            normalize_open_library_doc(doc, query.isbn) for doc in docs if isinstance(doc, Mapping)
        ]


class FixtureMetadataProvider:
    name = "fixture"

    def __init__(self):
        self.records = [
            BookRecord(
                provider="fixture",
                provider_work_id="OL66554W",
                provider_edition_id="OL7353617M",
                title="Pride and Prejudice",
                authors=("Jane Austen",),
                first_published_year=1813,
                published_date="2003",
                publisher="Penguin Classics",
                language="en",
                isbn10="0141439513",
                isbn13="9780141439518",
                cover_url="https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg",
            ),
            BookRecord(
                provider="fixture",
                provider_work_id="OL102749W",
                provider_edition_id="OL23243097M",
                title="Moby-Dick",
                authors=("Herman Melville",),
                first_published_year=1851,
                published_date="2009",
                publisher="Oxford University Press",
                language="en",
                isbn10="0199535728",
                isbn13="9780199535729",
                cover_url=None,
            ),
            BookRecord(
                provider="fixture",
                provider_work_id="OL488120W",
                provider_edition_id="OL22958782M",
                title="Invisible Man",
                authors=("Ralph Ellison",),
                first_published_year=1952,
                published_date="1995",
                publisher="Vintage International",
                language="en",
                isbn10="0679732764",
                isbn13="9780679732761",
                cover_url="https://covers.openlibrary.org/b/isbn/9780679732761-L.jpg",
            ),
            BookRecord(
                provider="fixture",
                provider_work_id="OL52267W",
                provider_edition_id="OL24271826M",
                title="The Invisible Man",
                authors=("H. G. Wells",),
                first_published_year=1897,
                published_date="2005",
                publisher="Penguin Classics",
                language="en",
                isbn10="014143998X",
                isbn13="9780141439983",
                cover_url=None,
            ),
            BookRecord(
                provider="fixture",
                provider_work_id="fixture-provider-warning-work",
                provider_edition_id="fixture-provider-warning-edition",
                title="Provider Warning",
                authors=("Demo Author",),
                first_published_year=2020,
                published_date="2020",
                publisher="Fixture Press",
                language="en",
                isbn10=None,
                isbn13=None,
                cover_url=None,
            ),
        ]

    async def search(self, query: MetadataQuery) -> list[BookRecord]:
        if query.isbn:
            return [
                record for record in self.records if query.isbn in {record.isbn10, record.isbn13}
            ]
        title = (query.title or "").casefold()
        author = (query.author or "").casefold()
        return [
            record
            for record in self.records
            if title in record.title.casefold()
            and (not author or any(author in candidate.casefold() for candidate in record.authors))
        ]


class FixtureFailureProvider:
    name = "fixture_secondary"

    async def search(self, query: MetadataQuery) -> list[BookRecord]:
        if query.title == "Provider Warning":
            raise RuntimeError("Fixture provider unavailable")
        return []


def _strip_open_library_key(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return value.rsplit("/", maxsplit=1)[-1]


def _open_library_language(values: object) -> str | None:
    if not isinstance(values, list):
        return None
    language = next((value for value in values if isinstance(value, str)), None)
    return "en" if language == "eng" else language


def _year(value: str | None) -> int | None:
    if value and len(value) >= 4 and value[:4].isdigit():
        return int(value[:4])
    return None
