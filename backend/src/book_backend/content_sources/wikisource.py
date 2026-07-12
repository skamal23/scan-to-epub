import json
import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode, urlparse

import httpx

from book_backend.editions.errors import SourceUnavailable

from .approved_catalog import ApprovedEpubEntry, EpubDownloadPolicy
from .matching import TtlCache, authors_match, normalized_words, title_match_score


@dataclass(frozen=True, slots=True)
class WikisourcePage:
    page_id: int
    title: str
    canonical_url: str
    revision_id: int
    touched: str


@dataclass(frozen=True, slots=True)
class WikisourcePageDetails:
    page_title: str
    work_title: str
    authors: tuple[str, ...]
    ready_for_export: bool


class WikisourceClient(Protocol):
    async def search(self, title: str, authors: list[str]) -> tuple[WikisourcePage, ...]: ...

    async def details(self, page: WikisourcePage) -> WikisourcePageDetails: ...


class HttpWikisourceClient:
    api_url = "https://en.wikisource.org/w/api.php"

    def __init__(self, user_agent: str, timeout_seconds: float = 12):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds
        self._search_details: dict[int, WikisourcePageDetails] = {}

    async def search(self, title: str, authors: list[str]) -> tuple[WikisourcePage, ...]:
        author_terms = " ".join(authors[:2])
        payload = await self._get(
            {
                "action": "query",
                "generator": "search",
                "gsrsearch": f'intitle:"{title}" {author_terms}'.strip(),
                "gsrnamespace": "0",
                "gsrlimit": "8",
                "prop": "info|revisions|categories",
                "inprop": "url",
                "rvprop": "content",
                "rvslots": "main",
                "cllimit": "max",
                "format": "json",
            }
        )
        try:
            pages = parse_wikisource_search(payload)
            self._search_details = parse_wikisource_query_details(payload)
            return pages
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            raise SourceUnavailable("Wikisource returned invalid search metadata") from error

    async def details(self, page: WikisourcePage) -> WikisourcePageDetails:
        cached = self._search_details.get(page.page_id)
        if cached is not None:
            return cached
        payload = await self._get(
            {
                "action": "parse",
                "pageid": str(page.page_id),
                "prop": "wikitext|categories",
                "format": "json",
            }
        )
        try:
            return parse_wikisource_page(payload)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            raise SourceUnavailable("Wikisource returned invalid page metadata") from error

    async def _get(self, params: dict[str, str]) -> bytes:
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.get(
                    self.api_url,
                    params=params,
                    headers={"Accept": "application/json", "User-Agent": self.user_agent},
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable("Wikisource could not be reached") from error
        if response.headers.get("content-type", "").partition(";")[0].lower() != (
            "application/json"
        ):
            raise SourceUnavailable("Wikisource returned an unexpected response")
        return response.content


class WikisourceOpenEditionSource:
    def __init__(self, client: WikisourceClient, cache_ttl_seconds: float = 300):
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

        pages = await self.client.search(title, authors)
        pages = tuple(
            sorted(
                pages,
                key=lambda page: title_match_score(title, page.title),
                reverse=True,
            )
        )
        entries: list[ApprovedEpubEntry] = []
        last_error: SourceUnavailable | None = None
        for page in pages:
            try:
                details = await self.client.details(page)
            except SourceUnavailable as error:
                last_error = error
                continue
            if (
                not details.ready_for_export
                or title_match_score(title, details.work_title) < 0.8
                or not authors_match(authors, details.authors)
            ):
                continue
            entries.append(_entry(page, details))
            if len(entries) == 2:
                break
        if not entries and last_error is not None:
            raise last_error
        result = tuple(entries)
        self.cache.set(cache_key, result)
        return result


def parse_wikisource_search(content: bytes) -> tuple[WikisourcePage, ...]:
    payload = json.loads(content)
    if "error" in payload:
        raise ValueError("Wikisource API returned an error")
    raw_pages = payload.get("query", {}).get("pages", {})
    if not isinstance(raw_pages, dict):
        raise ValueError("pages must be an object")
    pages: list[WikisourcePage] = []
    for raw in raw_pages.values():
        canonical_url = str(raw.get("canonicalurl", ""))
        parsed = urlparse(canonical_url)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "en.wikisource.org"
            or not parsed.path.startswith("/wiki/")
            or parsed.username
            or parsed.password
        ):
            continue
        pages.append(
            WikisourcePage(
                page_id=int(raw["pageid"]),
                title=str(raw["title"]),
                canonical_url=canonical_url,
                revision_id=int(raw["lastrevid"]),
                touched=str(raw["touched"]),
            )
        )
    return tuple(pages)


def parse_wikisource_page(content: bytes) -> WikisourcePageDetails:
    parsed = json.loads(content)["parse"]
    wikitext = str(parsed["wikitext"]["*"])
    categories = [str(category.get("*", "")) for category in parsed.get("categories", [])]
    return _details_from_wikitext(str(parsed["title"]), wikitext, categories)


def parse_wikisource_query_details(content: bytes) -> dict[int, WikisourcePageDetails]:
    payload = json.loads(content)
    if "error" in payload:
        raise ValueError("Wikisource API returned an error")
    raw_pages = payload.get("query", {}).get("pages", {})
    if not isinstance(raw_pages, dict):
        raise ValueError("pages must be an object")
    details: dict[int, WikisourcePageDetails] = {}
    for raw in raw_pages.values():
        revisions = raw.get("revisions") or ()
        if not revisions:
            continue
        slots = revisions[0].get("slots") or {}
        main = slots.get("main") or {}
        wikitext = main.get("*")
        if not isinstance(wikitext, str):
            continue
        categories = [
            str(category.get("title", "")).removeprefix("Category:")
            for category in raw.get("categories") or ()
        ]
        details[int(raw["pageid"])] = _details_from_wikitext(
            str(raw["title"]), wikitext, categories
        )
    return details


def _details_from_wikitext(
    page_title: str, wikitext: str, categories: list[str]
) -> WikisourcePageDetails:
    normalized_categories = {category.casefold().replace(" ", "_") for category in categories}
    title = _header_value(wikitext, "section") or _header_value(wikitext, "title") or page_title
    author_text = _header_value(wikitext, "author")
    authors = tuple(
        cleaned
        for value in re.split(r"\s*(?:;|<br\s*/?>)\s*", author_text, flags=re.I)
        if (cleaned := _clean_wikitext(value))
    )
    return WikisourcePageDetails(
        page_title=page_title,
        work_title=_clean_wikitext(title),
        authors=authors,
        ready_for_export=(
            "ready_for_export" in normalized_categories
            or bool(re.search(r"(?i)<pages\s+[^>]*index\s*=", wikitext))
            or "ws-summary" in wikitext
        ),
    )


def _header_value(wikitext: str, field: str) -> str:
    match = re.search(rf"(?im)^\s*\|\s*{re.escape(field)}\s*=\s*(.*?)\s*$", wikitext)
    return match.group(1) if match else ""


def _clean_wikitext(value: str) -> str:
    value = re.sub(r"\[\[(?:[^]|]+\|)?([^]]+)]]", r"\1", value)
    value = re.sub(r"\{\{(?:author link|plain link)\|([^}|]+).*?}}", r"\1", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return " ".join(value.replace("''", "").split())


def _entry(page: WikisourcePage, details: WikisourcePageDetails) -> ApprovedEpubEntry:
    acquisition_url = "https://ws-export.wmcloud.org/tool/book.php?" + urlencode(
        {"lang": "en", "format": "epub-3", "page": details.page_title}
    )
    reviewed_at = page.touched[:10] if len(page.touched) >= 10 else "live-catalog"
    return ApprovedEpubEntry(
        entry_id=f"wikisource:en:{page.page_id}:{page.revision_id}",
        source_key="wikisource",
        priority=30,
        work_title=details.work_title,
        aliases=(page.title,),
        authors=details.authors,
        digital_title=details.work_title,
        language="en",
        digital_identifier=f"{page.canonical_url}?oldid={page.revision_id}",
        publisher="Wikisource",
        source_organization="Wikisource",
        canonical_url=page.canonical_url,
        acquisition_url=acquisition_url,
        cover_url=None,
        rights_evidence="cc_by_sa",
        license_name="Creative Commons Attribution-ShareAlike 4.0",
        license_url="https://creativecommons.org/licenses/by-sa/4.0/",
        rights_statement=(
            "This unchanged EPUB is exported by Wikisource from a complete/exportable page; "
            "Wikisource contributions are available under CC BY-SA."
        ),
        attribution=(
            f"{details.work_title} by {', '.join(details.authors)}; Wikisource contributors, "
            f"revision {page.revision_id}."
        ),
        reviewed_at=reviewed_at,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"ws-export.wmcloud.org"}),
        ),
    )
