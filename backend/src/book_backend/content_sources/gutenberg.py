import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urljoin, urlparse
from xml.etree.ElementTree import Element

import httpx
from defusedxml import ElementTree

from book_backend.editions.errors import SourceUnavailable

from .approved_catalog import ApprovedEpubCatalog, ApprovedEpubEntry, EpubDownloadPolicy
from .matching import TtlCache, authors_match, normalized_words, title_match_score

_ATOM = "{http://www.w3.org/2005/Atom}"
_DCTERMS = "{http://purl.org/dc/terms/}"
_ACQUISITION_REL = "http://opds-spec.org/acquisition"
_IMAGE_REL = "http://opds-spec.org/image"


@dataclass(frozen=True, slots=True)
class GutenbergMirrorEntry:
    ebook_id: int
    work_title: str
    aliases: tuple[str, ...]
    authors: tuple[str, ...]
    language: str
    relative_epub_path: str
    expected_sha256: str


class ProjectGutenbergMirrorCatalog:
    """A reviewed Project Gutenberg harvest exposed from an operator-controlled mirror.

    The public Project Gutenberg website is intentionally not used as an automated app
    download origin. Operators must provision each asset through Gutenberg's documented
    harvest or mirroring process and pin its resulting SHA-256 here.
    """

    def __init__(
        self,
        *,
        mirror_base_url: str,
        entries: tuple[GutenbergMirrorEntry, ...],
        reviewed_at: str,
    ):
        parsed = urlparse(mirror_base_url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.hostname.casefold() in {"gutenberg.org", "www.gutenberg.org"}
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Project Gutenberg downloads require a configured HTTPS mirror")
        self.mirror_base_url = mirror_base_url.rstrip("/") + "/"
        self.mirror_host = parsed.hostname.casefold()
        self.reviewed_at = reviewed_at
        self.entries = entries
        self._catalog = ApprovedEpubCatalog(tuple(self._approved_entry(entry) for entry in entries))

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]:
        return self._catalog.find_all(title, authors, physical_isbn13)

    def _approved_entry(self, entry: GutenbergMirrorEntry) -> ApprovedEpubEntry:
        if (
            entry.relative_epub_path.startswith("/")
            or ".." in entry.relative_epub_path.split("/")
            or not re.fullmatch(r"[a-f0-9]{64}", entry.expected_sha256)
        ):
            raise ValueError("Project Gutenberg mirror manifest entry was invalid")
        acquisition_url = urljoin(self.mirror_base_url, entry.relative_epub_path)
        parsed_acquisition = urlparse(acquisition_url)
        if (
            parsed_acquisition.scheme != "https"
            or parsed_acquisition.hostname is None
            or parsed_acquisition.hostname.casefold() != self.mirror_host
            or parsed_acquisition.username
            or parsed_acquisition.password
        ):
            raise ValueError("Project Gutenberg mirror manifest escaped the reviewed mirror")
        return ApprovedEpubEntry(
            entry_id=f"project_gutenberg:{entry.ebook_id}",
            source_key="project_gutenberg",
            priority=30,
            work_title=entry.work_title,
            aliases=entry.aliases,
            authors=entry.authors,
            digital_title=entry.work_title,
            language=entry.language,
            digital_identifier=f"https://www.gutenberg.org/ebooks/{entry.ebook_id}",
            publisher="Project Gutenberg",
            source_organization="Project Gutenberg (reviewed mirror)",
            canonical_url=f"https://www.gutenberg.org/ebooks/{entry.ebook_id}",
            acquisition_url=acquisition_url,
            cover_url=None,
            rights_evidence="us_public_domain",
            license_name="Project Gutenberg License",
            license_url="https://www.gutenberg.org/policy/license.html",
            rights_statement=(
                "Project Gutenberg represents this unmodified ebook as not restricted in "
                "the United States. Its included Project Gutenberg license remains intact."
            ),
            attribution=(
                f"Project Gutenberg eBook #{entry.ebook_id}; distribute the unchanged EPUB "
                "with its included Project Gutenberg license."
            ),
            reviewed_at=self.reviewed_at,
            download_policy=EpubDownloadPolicy(
                allowed_hosts=frozenset({self.mirror_host}),
                expected_sha256=entry.expected_sha256,
            ),
        )


@dataclass(frozen=True, slots=True)
class GutenbergOpdsListing:
    ebook_id: int
    title: str
    authors: tuple[str, ...]
    detail_url: str


@dataclass(frozen=True, slots=True)
class GutenbergOpenBook:
    title: str
    authors: tuple[str, ...]
    language: str
    acquisition_url: str
    cover_url: str | None
    rights_statement: str
    reviewed_at: str


class ProjectGutenbergOpdsClient(Protocol):
    async def search(self, query: str) -> tuple[GutenbergOpdsListing, ...]: ...

    async def get_book(self, detail_url: str, ebook_id: int) -> GutenbergOpenBook: ...


class HttpProjectGutenbergOpdsClient:
    def __init__(self, user_agent: str, timeout_seconds: float = 10):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    async def search(self, query: str) -> tuple[GutenbergOpdsListing, ...]:
        content = await self._get(
            "https://www.gutenberg.org/ebooks/search.opds/",
            params={"query": query},
        )
        try:
            return parse_gutenberg_search_feed(content)
        except (ElementTree.ParseError, ValueError) as error:
            raise SourceUnavailable("Project Gutenberg returned an invalid search feed") from error

    async def get_book(self, detail_url: str, ebook_id: int) -> GutenbergOpenBook:
        if _gutenberg_detail_id(detail_url) != ebook_id:
            raise SourceUnavailable("Project Gutenberg returned an invalid detail URL")
        content = await self._get(detail_url)
        try:
            return parse_gutenberg_book_feed(content, ebook_id)
        except (ElementTree.ParseError, ValueError) as error:
            raise SourceUnavailable("Project Gutenberg returned an invalid book feed") from error

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
                        "Accept": "application/atom+xml",
                        "User-Agent": self.user_agent,
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable("Project Gutenberg could not be reached") from error
        content_type = response.headers.get("content-type", "").partition(";")[0].lower()
        if content_type != "application/atom+xml":
            raise SourceUnavailable("Project Gutenberg returned an unexpected response")
        return response.content


class ProjectGutenbergOpenEditionSource:
    def __init__(
        self,
        client: ProjectGutenbergOpdsClient,
        cache_ttl_seconds: float = 300,
    ):
        self.client = client
        self.cache = TtlCache[tuple[str, tuple[str, ...]], tuple[ApprovedEpubEntry, ...]](
            ttl_seconds=cache_ttl_seconds,
            copy=lambda entries: tuple(entries),
        )

    async def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]:
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
        ]
        matches.sort(key=lambda item: item[0], reverse=True)

        entries: list[ApprovedEpubEntry] = []
        last_error: SourceUnavailable | None = None
        for _, listing in matches[:5]:
            try:
                book = await self.client.get_book(listing.detail_url, listing.ebook_id)
            except SourceUnavailable as error:
                last_error = error
                continue
            if title_match_score(title, book.title) < 0.8 or not authors_match(
                authors, book.authors
            ):
                continue
            entries.append(_dynamic_gutenberg_entry(listing.ebook_id, book))
        if not entries and last_error is not None:
            raise last_error

        result = tuple(entries)
        self.cache.set(cache_key, result)
        return result


def parse_gutenberg_search_feed(content: bytes) -> tuple[GutenbergOpdsListing, ...]:
    root = ElementTree.fromstring(content)
    listings: list[GutenbergOpdsListing] = []
    seen_ids: set[int] = set()
    for entry in root.findall(f"./{_ATOM}entry"):
        title = _element_text(entry.find(f"./{_ATOM}title"))
        content_text = _element_text(entry.find(f"./{_ATOM}content"))
        subsection = next(
            (
                link.get("href", "")
                for link in entry.findall(f"./{_ATOM}link")
                if link.get("rel") == "subsection"
            ),
            "",
        )
        detail_url = urljoin("https://www.gutenberg.org", subsection)
        ebook_id = _gutenberg_detail_id(detail_url)
        if not title or ebook_id is None or ebook_id in seen_ids:
            continue
        seen_ids.add(ebook_id)
        listings.append(
            GutenbergOpdsListing(
                ebook_id=ebook_id,
                title=title,
                authors=(content_text,) if content_text else (),
                detail_url=detail_url,
            )
        )
    return tuple(listings)


def parse_gutenberg_book_feed(content: bytes, ebook_id: int) -> GutenbergOpenBook:
    root = ElementTree.fromstring(content)
    updated = _element_text(root.find(f"./{_ATOM}updated"))
    reviewed_at = updated[:10] if len(updated) >= 10 else "live-catalog"
    candidates: list[tuple[int, GutenbergOpenBook]] = []
    for entry in root.findall(f"./{_ATOM}entry"):
        title = _element_text(entry.find(f"./{_ATOM}title"))
        authors = tuple(
            name
            for author in entry.findall(f"./{_ATOM}author")
            if (name := _element_text(author.find(f"./{_ATOM}name")))
        )
        language = _element_text(entry.find(f"./{_DCTERMS}language")) or "en"
        rights = _element_text(entry.find(f"./{_ATOM}rights")) or (
            "Distributed under the Project Gutenberg License."
        )
        cover_url = next(
            (
                href
                for link in entry.findall(f"./{_ATOM}link")
                if link.get("rel") == _IMAGE_REL
                and (href := _safe_gutenberg_asset_url(link.get("href"))) is not None
            ),
            None,
        )
        for link in entry.findall(f"./{_ATOM}link"):
            if link.get("rel") != _ACQUISITION_REL or link.get("type") != "application/epub+zip":
                continue
            acquisition_url = link.get("href", "")
            if not _is_gutenberg_epub_url(acquisition_url, ebook_id):
                continue
            candidates.append(
                (
                    _epub_preference(link),
                    GutenbergOpenBook(
                        title=title,
                        authors=authors,
                        language=language,
                        acquisition_url=acquisition_url,
                        cover_url=cover_url,
                        rights_statement=rights,
                        reviewed_at=reviewed_at,
                    ),
                )
            )
    if not candidates:
        raise ValueError("Project Gutenberg book feed has no EPUB acquisition")
    return min(candidates, key=lambda item: item[0])[1]


def _element_text(element: Element | None) -> str:
    if element is None:
        return ""
    return " ".join("".join(element.itertext()).split())


def _gutenberg_detail_id(url: str) -> int | None:
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "www.gutenberg.org"
        or parsed.username
        or parsed.password
    ):
        return None
    match = re.fullmatch(r"/ebooks/(\d+)\.opds", parsed.path)
    return int(match.group(1)) if match else None


def _is_gutenberg_epub_url(url: str, ebook_id: int) -> bool:
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "www.gutenberg.org"
        or parsed.username
        or parsed.password
    ):
        return False
    return bool(
        re.fullmatch(rf"/ebooks/{ebook_id}\.epub(?:3)?\.(?:images|noimages)", parsed.path)
        or re.fullmatch(rf"/cache/epub/{ebook_id}/[^/]+\.epub", parsed.path)
    )


def _safe_gutenberg_asset_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "www.gutenberg.org"
        and not parsed.username
        and not parsed.password
        and parsed.path.startswith("/cache/epub/")
    ):
        return value
    return None


def _epub_preference(link: Element) -> int:
    description = f"{link.get('title', '')} {link.get('href', '')}".casefold()
    no_images = "no images" in description or "noimages" in description
    epub3 = "epub3" in description
    if epub3 and not no_images:
        return 0
    if not no_images:
        return 1
    if epub3:
        return 2
    return 3


def _dynamic_gutenberg_entry(ebook_id: int, book: GutenbergOpenBook) -> ApprovedEpubEntry:
    canonical_url = f"https://www.gutenberg.org/ebooks/{ebook_id}"
    return ApprovedEpubEntry(
        entry_id=f"project_gutenberg:{ebook_id}",
        source_key="project_gutenberg",
        priority=20,
        work_title=book.title,
        aliases=(),
        authors=book.authors,
        digital_title=book.title,
        language=book.language,
        digital_identifier=canonical_url,
        publisher="Project Gutenberg",
        source_organization="Project Gutenberg",
        canonical_url=canonical_url,
        acquisition_url=book.acquisition_url,
        cover_url=book.cover_url,
        rights_evidence="source_authorized_distribution",
        license_name="Project Gutenberg License",
        license_url="https://www.gutenberg.org/policy/license.html",
        rights_statement=(
            f"{book.rights_statement} This unchanged EPUB is distributed with its included "
            "Project Gutenberg License."
        ),
        attribution=f"Project Gutenberg eBook #{ebook_id}.",
        reviewed_at=book.reviewed_at,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"www.gutenberg.org"}),
            allow_redirects=True,
            max_redirects=1,
        ),
    )
