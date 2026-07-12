import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote, urlparse
from xml.etree.ElementTree import Element

import httpx
from defusedxml import ElementTree

from book_backend.editions.errors import SourceUnavailable
from book_backend.rights.policy import RightsEvidence

from .approved_catalog import ApprovedEpubEntry, EpubDownloadPolicy
from .matching import TtlCache, authors_match, normalized_words, title_match_score

_ATOM = "{http://www.w3.org/2005/Atom}"
_DCTERMS = "{http://purl.org/dc/terms/}"
_OPEN_ACCESS_REL = "http://opds-spec.org/acquisition/open-access"


@dataclass(frozen=True, slots=True)
class UnglueRecord:
    work_id: int
    ebook_id: int
    title: str
    authors: tuple[str, ...]
    publisher: str
    language: str
    acquisition_url: str
    rights_evidence: RightsEvidence
    rights_label: str
    updated: str


@dataclass(frozen=True, slots=True)
class UnglueWork:
    work_id: int
    title: str
    authors: tuple[str, ...]
    publisher: str
    language: str
    updated: str


class UnglueOpdsClient(Protocol):
    async def search(
        self, title: str, physical_isbn13: str | None = None
    ) -> tuple[UnglueRecord, ...]: ...


class HttpUnglueOpdsClient:
    def __init__(self, user_agent: str, timeout_seconds: float = 20):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    async def search(
        self, title: str, physical_isbn13: str | None = None
    ) -> tuple[UnglueRecord, ...]:
        if physical_isbn13 and re.fullmatch(r"97[89]\d{10}", physical_isbn13):
            try:
                isbn_records = await self._search_isbn(physical_isbn13)
            except SourceUnavailable:
                return ()
            if isbn_records is not None:
                return isbn_records
        encoded_title = quote(" ".join(title.split()), safe="")
        url = f"https://unglue.it/api/opds/epub/s.{encoded_title}/-gtbg/-doab/"
        content = await self._get(
            url,
            params={"page": "1"},
            accept="application/atom+xml;profile=opds-catalog;kind=acquisition",
        )
        try:
            return parse_unglue_feed(content)
        except (ElementTree.ParseError, ValueError) as error:
            raise SourceUnavailable("Unglue.it returned invalid OPDS metadata") from error

    async def _search_isbn(self, isbn13: str) -> tuple[UnglueRecord, ...] | None:
        widget = await self._get(
            f"https://unglue.it/api/widget/{isbn13}/",
            accept="text/html",
        )
        work_id = _widget_work_id(widget)
        if work_id is None:
            return None
        work_feed = await self._get(
            "https://unglue.it/api/opds/all/",
            params={"work": str(work_id)},
            accept="application/atom+xml;profile=opds-catalog;kind=acquisition",
        )
        try:
            work = parse_unglue_work_feed(work_feed)
        except (ElementTree.ParseError, ValueError) as error:
            raise SourceUnavailable("Unglue.it returned invalid OPDS metadata") from error
        if work.work_id != work_id:
            raise SourceUnavailable("Unglue.it returned a mismatched work record")
        download_page = await self._get(
            f"https://unglue.it/work/{work_id}/download/",
            accept="text/html",
        )
        return tuple(
            UnglueRecord(
                work_id=work.work_id,
                ebook_id=ebook_id,
                title=work.title,
                authors=work.authors,
                publisher=work.publisher,
                language=work.language,
                acquisition_url=f"https://unglue.it/download_ebook/{ebook_id}/",
                rights_evidence=evidence,
                rights_label=rights_label,
                updated=work.updated,
            )
            for ebook_id, rights_label, evidence in parse_unglue_downloads(download_page)
        )

    async def _get(
        self,
        url: str,
        *,
        accept: str,
        params: dict[str, str] | None = None,
    ) -> bytes:
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.get(
                    url,
                    params=params,
                    headers={"Accept": accept, "User-Agent": self.user_agent},
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable("Unglue.it could not be reached") from error
        expected_type = accept.partition(";")[0]
        content_type = response.headers.get("content-type", "").partition(";")[0].lower()
        if content_type != expected_type:
            raise SourceUnavailable("Unglue.it returned an unexpected response")
        return response.content


class UnglueOpenEditionSource:
    def __init__(self, client: UnglueOpdsClient, cache_ttl_seconds: float = 300):
        self.client = client
        self.cache = TtlCache[tuple[str, tuple[str, ...], str], tuple[ApprovedEpubEntry, ...]](
            ttl_seconds=cache_ttl_seconds,
            copy=lambda entries: tuple(entries),
        )

    async def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]:
        cache_key = (
            " ".join(normalized_words(title)),
            tuple(sorted(" ".join(normalized_words(author)) for author in authors)),
            physical_isbn13 or "",
        )
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached
        records = await self.client.search(title, physical_isbn13)
        matches = [
            record
            for record in records
            if title_match_score(title, record.title) >= 0.8
            and authors_match(authors, record.authors)
        ]
        matches.sort(key=lambda record: title_match_score(title, record.title), reverse=True)
        result = tuple(_entry(record) for record in matches[:3])
        self.cache.set(cache_key, result)
        return result


def parse_unglue_feed(content: bytes) -> tuple[UnglueRecord, ...]:
    root = ElementTree.fromstring(content)
    records: list[UnglueRecord] = []
    seen_ebooks: set[int] = set()
    for entry in root.findall(f"./{_ATOM}entry"):
        work_id = _work_id(_text(entry.find(f"./{_ATOM}id")))
        title = _text(entry.find(f"./{_ATOM}title"))
        authors = tuple(
            name
            for author in entry.findall(f"./{_ATOM}author")
            if (name := _text(author.find(f"./{_ATOM}name")))
        )
        if work_id is None or not title or not authors:
            continue
        for link in entry.findall(f"./{_ATOM}link"):
            if link.get("rel") != _OPEN_ACCESS_REL or link.get("type") != "application/epub+zip":
                continue
            acquisition_url = link.get("href", "")
            ebook_id = _ebook_id(acquisition_url)
            rights_label = link.get(f"{_DCTERMS}rights", "")
            rights_evidence = _rights_evidence(rights_label)
            if ebook_id is None or rights_evidence is None or ebook_id in seen_ebooks:
                continue
            seen_ebooks.add(ebook_id)
            records.append(
                UnglueRecord(
                    work_id=work_id,
                    ebook_id=ebook_id,
                    title=title,
                    authors=authors,
                    publisher=_text(entry.find(f"./{_DCTERMS}publisher")) or "Unglue.it",
                    language=_text(entry.find(f"./{_DCTERMS}language")) or "en",
                    acquisition_url=acquisition_url,
                    rights_evidence=rights_evidence,
                    rights_label=rights_label,
                    updated=_text(entry.find(f"./{_ATOM}updated")),
                )
            )
    return tuple(records)


def parse_unglue_work_feed(content: bytes) -> UnglueWork:
    root = ElementTree.fromstring(content)
    entry = root.find(f"./{_ATOM}entry")
    if entry is None:
        raise ValueError("Unglue.it work feed has no entry")
    work_id = _work_id(_text(entry.find(f"./{_ATOM}id")))
    title = _text(entry.find(f"./{_ATOM}title"))
    authors = tuple(
        name
        for author in entry.findall(f"./{_ATOM}author")
        if (name := _text(author.find(f"./{_ATOM}name")))
    )
    if work_id is None or not title or not authors:
        raise ValueError("Unglue.it work metadata is incomplete")
    return UnglueWork(
        work_id=work_id,
        title=title,
        authors=authors,
        publisher=_text(entry.find(f"./{_DCTERMS}publisher")) or "Unglue.it",
        language=_text(entry.find(f"./{_DCTERMS}language")) or "en",
        updated=_text(entry.find(f"./{_ATOM}updated")),
    )


def parse_unglue_downloads(
    content: bytes,
) -> tuple[tuple[int, str, RightsEvidence], ...]:
    text = content.decode("utf-8", errors="replace")
    pattern = re.compile(
        r'<a\s+href="/download_ebook/(\d+)/">\s*'
        r'<img\s+[^>]*alt="([^"]+)"[^>]*></a>\s*'
        r'<a\s+href="/download_ebook/\1/">\s*'
        r'<img\s+[^>]*alt="epub at Unglue\.it"[^>]*></a>',
        flags=re.I,
    )
    downloads: list[tuple[int, str, RightsEvidence]] = []
    for match in pattern.finditer(text):
        rights_label = match.group(2)
        evidence = _rights_evidence(rights_label)
        if evidence is not None:
            downloads.append((int(match.group(1)), rights_label, evidence))
    return tuple(downloads)


def _widget_work_id(content: bytes) -> int | None:
    match = re.search(rb'href="/work/(\d+)/"', content)
    return int(match.group(1)) if match else None


def _work_id(value: str) -> int | None:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "unglue.it"
        or parsed.username
        or parsed.password
    ):
        return None
    match = re.fullmatch(r"/api/id/work/(\d+)/", parsed.path)
    return int(match.group(1)) if match else None


def _ebook_id(value: str) -> int | None:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "unglue.it"
        or parsed.username
        or parsed.password
    ):
        return None
    match = re.fullmatch(r"/download_ebook/(\d+)/", parsed.path)
    return int(match.group(1)) if match else None


def _rights_evidence(label: str) -> RightsEvidence | None:
    normalized = re.sub(r"[^a-z0-9]+", " ", label.casefold()).strip()
    return {
        "cc0": "cc0",
        "cc by": "cc_by",
        "cc by sa": "cc_by_sa",
        "pd us": "us_public_domain",
        "public domain us": "us_public_domain",
    }.get(normalized)


def _text(element: Element | None) -> str:
    return "" if element is None else " ".join("".join(element.itertext()).split())


def _license(evidence: RightsEvidence) -> tuple[str, str]:
    return {
        "cc0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
        "cc_by": (
            "CC BY (version recorded by source)",
            "https://creativecommons.org/share-your-work/cclicenses/",
        ),
        "cc_by_sa": (
            "CC BY-SA (version recorded by source)",
            "https://creativecommons.org/share-your-work/cclicenses/",
        ),
        "us_public_domain": (
            "Public Domain in the United States",
            "https://creativecommons.org/publicdomain/mark/1.0/",
        ),
    }[evidence]


def _entry(record: UnglueRecord) -> ApprovedEpubEntry:
    license_name, license_url = _license(record.rights_evidence)
    reviewed_at = record.updated[:10] if len(record.updated) >= 10 else "live-catalog"
    canonical_url = f"https://unglue.it/work/{record.work_id}/"
    return ApprovedEpubEntry(
        entry_id=f"unglue:{record.work_id}:{record.ebook_id}",
        source_key="unglue",
        priority=40,
        work_title=record.title,
        aliases=(),
        authors=record.authors,
        digital_title=record.title,
        language=record.language,
        digital_identifier=f"https://unglue.it/api/id/work/{record.work_id}/",
        publisher=record.publisher,
        source_organization="Unglue.it",
        canonical_url=canonical_url,
        acquisition_url=record.acquisition_url,
        cover_url=None,
        rights_evidence=record.rights_evidence,
        license_name=license_name,
        license_url=license_url,
        rights_statement=(
            f"Unglue.it marks this existing EPUB as {record.rights_label}; the file is "
            "delivered unchanged."
        ),
        attribution=f"{record.title}, {', '.join(record.authors)}; via Unglue.it.",
        reviewed_at=reviewed_at,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"unglue.it", "tieulgnu.s3.amazonaws.com"}),
            allow_redirects=True,
            max_redirects=1,
        ),
    )
