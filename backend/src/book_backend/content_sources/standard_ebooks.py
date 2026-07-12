from dataclasses import dataclass
from typing import Protocol
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from xml.etree.ElementTree import Element

import httpx
from defusedxml import ElementTree

from book_backend.editions.errors import SourceUnavailable

from .approved_catalog import ApprovedEpubCatalog, ApprovedEpubEntry, EpubDownloadPolicy
from .matching import TtlCache, authors_match, normalized_words, title_match_score

StandardEbookEntry = ApprovedEpubEntry

_XHTML = "{http://www.w3.org/1999/xhtml}"


@dataclass(frozen=True, slots=True)
class StandardEbooksCatalog:
    entries: tuple[StandardEbookEntry, ...]

    def find(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> StandardEbookEntry | None:
        matches = self.find_all(title, authors, physical_isbn13)
        return matches[0] if matches else None

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[StandardEbookEntry, ...]:
        return ApprovedEpubCatalog(self.entries).find_all(title, authors, physical_isbn13)


@dataclass(frozen=True, slots=True)
class StandardEbooksListing:
    title: str
    authors: tuple[str, ...]
    canonical_url: str


@dataclass(frozen=True, slots=True)
class StandardEbooksBook:
    language: str
    acquisition_url: str
    cover_url: str | None
    reviewed_at: str


class StandardEbooksClient(Protocol):
    async def search(self, query: str) -> tuple[StandardEbooksListing, ...]: ...

    async def get_book(self, canonical_url: str) -> StandardEbooksBook: ...


class HttpStandardEbooksClient:
    def __init__(self, user_agent: str, timeout_seconds: float = 10):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    async def search(self, query: str) -> tuple[StandardEbooksListing, ...]:
        content = await self._get(
            "https://standardebooks.org/ebooks",
            params={"query": query},
        )
        try:
            return parse_standard_ebooks_search(content)
        except (ElementTree.ParseError, ValueError) as error:
            raise SourceUnavailable("Standard Ebooks returned an invalid catalog page") from error

    async def get_book(self, canonical_url: str) -> StandardEbooksBook:
        if not _is_standard_ebooks_book_url(canonical_url):
            raise SourceUnavailable("Standard Ebooks returned an invalid book URL")
        content = await self._get(canonical_url)
        try:
            return parse_standard_ebooks_book(content, canonical_url)
        except (ElementTree.ParseError, ValueError) as error:
            raise SourceUnavailable("Standard Ebooks returned an invalid book page") from error

    async def _get(self, url: str, params: dict[str, str] | None = None) -> bytes:
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.get(
                    url,
                    params=params,
                    headers={
                        "Accept": "application/xhtml+xml, text/html;q=0.9",
                        "User-Agent": self.user_agent,
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable("Standard Ebooks could not be reached") from error
        content_type = response.headers.get("content-type", "").partition(";")[0].lower()
        if content_type not in {"application/xhtml+xml", "text/html"}:
            raise SourceUnavailable("Standard Ebooks returned an unexpected response")
        return response.content


class StandardEbooksOpenEditionSource:
    def __init__(
        self,
        client: StandardEbooksClient,
        cache_ttl_seconds: float = 300,
    ):
        self.client = client
        self.cache = TtlCache[tuple[str, tuple[str, ...]], tuple[StandardEbookEntry, ...]](
            ttl_seconds=cache_ttl_seconds,
            copy=lambda entries: tuple(entries),
        )

    async def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[StandardEbookEntry, ...]:
        del physical_isbn13
        cache_key = (
            " ".join(normalized_words(title)),
            tuple(sorted(" ".join(normalized_words(author)) for author in authors)),
        )
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        listings = await self.client.search(title)
        matches = [
            (title_match_score(title, listing.title), listing)
            for listing in listings
            if title_match_score(title, listing.title) >= 0.8
            and authors_match(authors, listing.authors)
        ]
        matches.sort(key=lambda item: item[0], reverse=True)

        entries: list[StandardEbookEntry] = []
        last_error: SourceUnavailable | None = None
        for _, listing in matches[:3]:
            try:
                book = await self.client.get_book(listing.canonical_url)
            except SourceUnavailable as error:
                last_error = error
                continue
            entries.append(_dynamic_entry(listing, book))
        if not entries and last_error is not None:
            raise last_error

        result = tuple(entries)
        self.cache.set(cache_key, result)
        return result


def parse_standard_ebooks_search(content: bytes) -> tuple[StandardEbooksListing, ...]:
    root = ElementTree.fromstring(content)
    listings: list[StandardEbooksListing] = []
    for item in root.findall(f".//{_XHTML}li"):
        if item.get("typeof") != "schema:Book":
            continue
        canonical_url = urljoin(_BASE, item.get("about", ""))
        if not _is_standard_ebooks_book_url(canonical_url):
            continue
        title = ""
        authors: list[str] = []
        for paragraph in item.findall(f"./{_XHTML}p"):
            name = paragraph.find(f".//{_XHTML}span[@property='schema:name']")
            if name is None or not name.text or not name.text.strip():
                continue
            if "author" in paragraph.get("class", "").split():
                authors.append(name.text.strip())
            elif not title:
                title = name.text.strip()
        if title and authors:
            listings.append(
                StandardEbooksListing(
                    title=title,
                    authors=tuple(authors),
                    canonical_url=canonical_url,
                )
            )
    return tuple(listings)


def parse_standard_ebooks_book(content: bytes, canonical_url: str) -> StandardEbooksBook:
    if not _is_standard_ebooks_book_url(canonical_url):
        raise ValueError("Invalid Standard Ebooks canonical URL")
    root = ElementTree.fromstring(content)
    section = next(
        (
            candidate
            for candidate in root.findall(f".//{_XHTML}section")
            if candidate.get("id") == "read-free"
        ),
        None,
    )
    if section is None:
        raise ValueError("Standard Ebooks book page has no download section")

    language = _meta_content(section, "schema:inLanguage") or "en"
    cover_url = _safe_standard_ebooks_asset_url(_meta_content(section, "schema:image"))
    reviewed_at = _meta_content(section, "schema:dateModified") or "live-catalog"
    acquisition_url: str | None = None
    for anchor in section.findall(f".//{_XHTML}a[@property='schema:contentUrl']"):
        classes = anchor.get("class", "").split()
        href = anchor.get("href", "")
        label = " ".join(anchor.itertext()).strip().casefold()
        if "epub" not in classes or "advanced" in label or "kepub" in href:
            continue
        candidate_url = urljoin(canonical_url, href)
        if _is_standard_ebooks_download_url(candidate_url, canonical_url):
            acquisition_url = _with_download_source(candidate_url)
            break
    if acquisition_url is None:
        raise ValueError("Standard Ebooks book page has no compatible EPUB")
    return StandardEbooksBook(
        language=language,
        acquisition_url=acquisition_url,
        cover_url=cover_url,
        reviewed_at=reviewed_at,
    )


def _meta_content(element: Element, property_name: str) -> str | None:
    meta = element.find(f".//{_XHTML}meta[@property='{property_name}']")
    value = meta.get("content") if meta is not None else None
    return value.strip() if value and value.strip() else None


def _is_standard_ebooks_book_url(url: str) -> bool:
    parsed = urlparse(url)
    path_parts = [part for part in parsed.path.split("/") if part]
    return (
        parsed.scheme == "https"
        and parsed.hostname == "standardebooks.org"
        and not parsed.username
        and not parsed.password
        and len(path_parts) >= 3
        and path_parts[0] == "ebooks"
        and "downloads" not in path_parts
    )


def _is_standard_ebooks_download_url(url: str, canonical_url: str) -> bool:
    parsed = urlparse(url)
    canonical = urlparse(canonical_url)
    expected_prefix = canonical.path.rstrip("/") + "/downloads/"
    return (
        parsed.scheme == "https"
        and parsed.hostname == "standardebooks.org"
        and not parsed.username
        and not parsed.password
        and parsed.path.startswith(expected_prefix)
        and parsed.path.endswith(".epub")
    )


def _safe_standard_ebooks_asset_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "standardebooks.org"
        and not parsed.username
        and not parsed.password
    ):
        return value
    return None


def _with_download_source(url: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["source"] = "download"
    return urlunparse(parsed._replace(query=urlencode(query)))


def _dynamic_entry(
    listing: StandardEbooksListing,
    book: StandardEbooksBook,
) -> StandardEbookEntry:
    slug = urlparse(listing.canonical_url).path.removeprefix("/ebooks/").strip("/")
    return StandardEbookEntry(
        entry_id=f"standardebooks:{slug.replace('/', '_')}",
        source_key="standard_ebooks",
        priority=10,
        work_title=listing.title,
        aliases=(),
        authors=listing.authors,
        digital_title=listing.title,
        language=book.language,
        digital_identifier=listing.canonical_url,
        publisher="Standard Ebooks",
        source_organization="Standard Ebooks",
        canonical_url=listing.canonical_url,
        acquisition_url=book.acquisition_url,
        cover_url=book.cover_url,
        rights_evidence="us_public_domain",
        license_name="CC0 1.0 Universal",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        rights_statement=_RIGHTS_STATEMENT,
        attribution=None,
        reviewed_at=book.reviewed_at,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"standardebooks.org"}),
        ),
    )


_REVIEWED = "2026-07-10"
_BASE = "https://standardebooks.org"
_RIGHTS_STATEMENT = (
    "Standard Ebooks represents the text and cover as public domain in the U.S. "
    "and dedicates its edition work to the public domain via CC0."
)


def _entry(
    *,
    entry_id: str,
    work_title: str,
    aliases: tuple[str, ...],
    authors: tuple[str, ...],
    digital_title: str,
    language: str,
    slug: str,
    cover_path: str,
    expected_sha256: str,
) -> StandardEbookEntry:
    author_slug, title_slug = slug.split("/", maxsplit=1)
    filename = f"{author_slug}_{title_slug}"
    canonical_url = f"{_BASE}/ebooks/{author_slug}/{title_slug}"
    return StandardEbookEntry(
        entry_id=entry_id,
        source_key="standard_ebooks",
        priority=10,
        work_title=work_title,
        aliases=aliases,
        authors=authors,
        digital_title=digital_title,
        language=language,
        digital_identifier=canonical_url,
        publisher="Standard Ebooks",
        source_organization="Standard Ebooks",
        canonical_url=canonical_url,
        acquisition_url=f"{canonical_url}/downloads/{filename}.epub?source=download",
        cover_url=f"{_BASE}/images/covers/{filename}/{cover_path}/cover@2x.jpg",
        rights_evidence="us_public_domain",
        license_name="CC0 1.0 Universal",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        rights_statement=_RIGHTS_STATEMENT,
        attribution=None,
        reviewed_at=_REVIEWED,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"standardebooks.org"}),
            expected_sha256=expected_sha256,
        ),
    )


STANDARD_EBOOKS_CATALOG = StandardEbooksCatalog(
    entries=(
        _entry(
            entry_id="standardebooks:jane-austen_pride-and-prejudice",
            work_title="Pride and Prejudice",
            aliases=("Pride & Prejudice",),
            authors=("Jane Austen",),
            digital_title="Pride and Prejudice",
            language="en-GB",
            slug="jane-austen/pride-and-prejudice",
            cover_path="495dd49502f1fd5609a27a16f5af2f0a387accb4",
            expected_sha256="377c8b79622702c406de068d1ca4f6d2a8a675f46f801c2fe4013e1af17e6ee9",
        ),
        _entry(
            entry_id="standardebooks:herman-melville_moby-dick",
            work_title="Moby-Dick",
            aliases=("Moby Dick", "Moby Dick, or The Whale"),
            authors=("Herman Melville",),
            digital_title="Moby Dick, or The Whale",
            language="en-US",
            slug="herman-melville/moby-dick",
            cover_path="d30d8f15cb2f832ae68dbbc08e6b2a154aa6d109",
            expected_sha256="87e06598b17e5512ae04133ca4c794a1dc5a9f779b649559c0b92c15155abbdc",
        ),
        _entry(
            entry_id="standardebooks:mary-shelley_frankenstein",
            work_title="Frankenstein",
            aliases=("Frankenstein, or the Modern Prometheus",),
            authors=("Mary Shelley",),
            digital_title="Frankenstein, or the Modern Prometheus",
            language="en-GB",
            slug="mary-shelley/frankenstein",
            cover_path="a2a4d948cd6d7eaa6bd1ce223fe17e4380689b5a",
            expected_sha256="7be342e288497b37b0ec191d1ecdef99050c1b4828675ea5af450a0e62e43649",
        ),
        _entry(
            entry_id="standardebooks:bram-stoker_dracula",
            work_title="Dracula",
            aliases=(),
            authors=("Bram Stoker",),
            digital_title="Dracula",
            language="en-GB",
            slug="bram-stoker/dracula",
            cover_path="a02c17aca72aec342c861065c62cd25559a6d960",
            expected_sha256="8fb41790926f7da2aebe1c052cb13f874e87fa4c6ef5ebb487d82e83623ef95a",
        ),
        _entry(
            entry_id="standardebooks:charlotte-bronte_jane-eyre",
            work_title="Jane Eyre",
            aliases=("Jane Eyre: An Autobiography",),
            authors=("Charlotte Brontë", "Charlotte Bronte"),
            digital_title="Jane Eyre: An Autobiography",
            language="en-GB",
            slug="charlotte-bronte/jane-eyre",
            cover_path="315cd8030f893603f1cd1c5df3d11e000bfc3c8f",
            expected_sha256="a2f510add9cdeab848862c5e2ca675c1d7cd73f563409070673932323e458c5d",
        ),
    )
)
