import json
import re
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from book_backend.editions.errors import SourceUnavailable
from book_backend.rights.policy import RightsEvidence

from .approved_catalog import ApprovedEpubEntry, EpubDownloadPolicy
from .matching import TtlCache, authors_match, normalized_words, title_match_score


@dataclass(frozen=True, slots=True)
class OapenRecord:
    item_uuid: str
    bitstream_uuid: str
    handle: str
    title: str
    authors: tuple[str, ...]
    publisher: str
    language: str
    acquisition_url: str
    expected_md5: str
    rights_evidence: RightsEvidence
    license_name: str
    license_url: str
    updated: str


class OapenClient(Protocol):
    async def search(self, title: str) -> tuple[OapenRecord, ...]: ...


class HttpOapenClient:
    def __init__(self, user_agent: str, timeout_seconds: float = 15):
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    async def search(self, title: str) -> tuple[OapenRecord, ...]:
        escaped_title = title.replace('"', "")
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_seconds,
                follow_redirects=False,
            ) as client:
                response = await client.get(
                    "https://library.oapen.org/rest/search",
                    params={
                        "query": f'dc.title:"{escaped_title}"',
                        "expand": "metadata,bitstreams",
                    },
                    headers={"Accept": "application/json", "User-Agent": self.user_agent},
                )
                response.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable("OAPEN could not be reached") from error
        content_type = response.headers.get("content-type", "").partition(";")[0].lower()
        if content_type != "application/json":
            raise SourceUnavailable("OAPEN returned an unexpected response")
        try:
            return parse_oapen_results(response.content)
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            raise SourceUnavailable("OAPEN returned invalid metadata") from error


class OapenOpenEditionSource:
    def __init__(self, client: OapenClient, cache_ttl_seconds: float = 300):
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
        records = await self.client.search(title)
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


def parse_oapen_results(content: bytes) -> tuple[OapenRecord, ...]:
    payload = json.loads(content)
    if not isinstance(payload, list):
        raise ValueError("OAPEN search result must be a list")
    records: list[OapenRecord] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        item_uuid = str(item.get("uuid", ""))
        handle = str(item.get("handle", ""))
        if not _uuid(item_uuid) or not re.fullmatch(r"20\.500\.12657/\d+", handle):
            continue
        metadata = _metadata(item.get("metadata"))
        title = _first(metadata, "dc.title") or str(item.get("name", ""))
        authors = tuple(metadata.get("dc.contributor.author", ()))
        if not title or not authors:
            continue
        for bitstream in item.get("bitstreams") or ():
            if (
                not isinstance(bitstream, dict)
                or bitstream.get("mimeType") != "application/epub+zip"
                or bitstream.get("bundleName") != "ORIGINAL"
            ):
                continue
            bitstream_uuid = str(bitstream.get("uuid", ""))
            retrieve_link = str(bitstream.get("retrieveLink", ""))
            if (
                not _uuid(bitstream_uuid)
                or retrieve_link != f"/rest/bitstreams/{bitstream_uuid}/retrieve"
            ):
                continue
            checksum = bitstream.get("checkSum") or {}
            expected_md5 = str(checksum.get("value", "")).casefold()
            if checksum.get("checkSumAlgorithm") != "MD5" or not re.fullmatch(
                r"[a-f0-9]{32}", expected_md5
            ):
                continue
            bitstream_metadata = _metadata(bitstream.get("metadata"))
            license_url = _first(bitstream_metadata, "dc.rights.uri")
            rights = _oapen_rights(str(bitstream.get("code", "")), license_url)
            if rights is None:
                continue
            evidence, license_name, normalized_license_url = rights
            records.append(
                OapenRecord(
                    item_uuid=item_uuid,
                    bitstream_uuid=bitstream_uuid,
                    handle=handle,
                    title=title,
                    authors=authors,
                    publisher=(
                        _first(metadata, "publisher.name")
                        or _first(metadata, "dc.publisher")
                        or "OAPEN"
                    ),
                    language=_language(metadata),
                    acquisition_url=(
                        f"https://library.oapen.org/rest/bitstreams/{bitstream_uuid}/retrieve"
                    ),
                    expected_md5=expected_md5,
                    rights_evidence=evidence,
                    license_name=license_name,
                    license_url=normalized_license_url,
                    updated=str(item.get("lastModified", "")),
                )
            )
    return tuple(records)


def _metadata(raw: Any) -> dict[str, tuple[str, ...]]:
    values: dict[str, list[str]] = {}
    if not isinstance(raw, list):
        return {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", ""))
        value = str(item.get("value", "")).strip()
        if key and value:
            values.setdefault(key, []).append(value)
    return {key: tuple(items) for key, items in values.items()}


def _first(metadata: dict[str, tuple[str, ...]], key: str) -> str:
    values = metadata.get(key, ())
    return values[0] if values else ""


def _language(metadata: dict[str, tuple[str, ...]]) -> str:
    value = _first(metadata, "dc.language").casefold()
    return {"english": "en", "german": "de", "french": "fr", "spanish": "es"}.get(
        value, value[:2] or "en"
    )


def _oapen_rights(code: str, license_url: str) -> tuple[RightsEvidence, str, str] | None:
    normalized_code = re.sub(r"[^A-Z0-9]+", "-", code.upper()).strip("-")
    parsed = urlparse(license_url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "creativecommons.org",
        "www.creativecommons.org",
    }:
        return None
    path = parsed.path.rstrip("/") + "/"
    license_match = re.fullmatch(r"/licenses/(by|by-sa)/(2\.0|2\.5|3\.0|4\.0)/", path)
    if path == "/publicdomain/zero/1.0/":
        evidence: RightsEvidence = "cc0"
        name = "CC0 1.0"
    elif license_match:
        kind, version = license_match.groups()
        evidence = "cc_by" if kind == "by" else "cc_by_sa"
        name = f"CC {'BY' if kind == 'by' else 'BY-SA'} {version}"
    else:
        return None
    expected_codes = {
        "cc0": {"CC0", "CC-0", "CC-ZERO"},
        "cc_by": {"CC-BY"},
        "cc_by_sa": {"CC-BY-SA"},
    }[evidence]
    if normalized_code not in expected_codes:
        return None
    normalized_url = f"https://creativecommons.org{path}"
    return evidence, name, normalized_url


def _uuid(value: str) -> bool:
    return bool(re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}", value))


def _entry(record: OapenRecord) -> ApprovedEpubEntry:
    canonical_url = f"https://library.oapen.org/handle/{record.handle}"
    reviewed_at = record.updated[:10] if len(record.updated) >= 10 else "live-catalog"
    return ApprovedEpubEntry(
        entry_id=f"oapen:{record.item_uuid}:{record.bitstream_uuid}",
        source_key="oapen",
        priority=50,
        work_title=record.title,
        aliases=(),
        authors=record.authors,
        digital_title=record.title,
        language=record.language,
        digital_identifier=canonical_url,
        publisher=record.publisher,
        source_organization="OAPEN",
        canonical_url=canonical_url,
        acquisition_url=record.acquisition_url,
        cover_url=None,
        rights_evidence=record.rights_evidence,
        license_name=record.license_name,
        license_url=record.license_url,
        rights_statement=(
            f"OAPEN records this EPUB bitstream under {record.license_name}; the source "
            "bitstream is delivered unchanged."
        ),
        attribution=f"{record.title}, {', '.join(record.authors)}; {record.publisher}.",
        reviewed_at=reviewed_at,
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"library.oapen.org"}),
            expected_md5=record.expected_md5,
        ),
    )
