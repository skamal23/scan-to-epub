import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from book_backend.rights.policy import RightsEvidence


@dataclass(frozen=True, slots=True)
class EpubDownloadPolicy:
    """The tightly scoped network and integrity rules for one reviewed EPUB."""

    allowed_hosts: frozenset[str]
    expected_sha256: str | None = None
    expected_md5: str | None = None
    allow_redirects: bool = False
    max_redirects: int = 0


@dataclass(frozen=True, slots=True)
class ApprovedEpubEntry:
    """One reviewed, existing EPUB that is eligible for the U.S. demo."""

    entry_id: str
    source_key: str
    priority: int
    work_title: str
    aliases: tuple[str, ...]
    authors: tuple[str, ...]
    digital_title: str
    language: str
    digital_identifier: str
    publisher: str
    source_organization: str
    canonical_url: str
    acquisition_url: str
    cover_url: str | None
    rights_evidence: RightsEvidence
    license_name: str
    license_url: str
    rights_statement: str
    attribution: str | None
    reviewed_at: str
    download_policy: EpubDownloadPolicy


StructuredContentFormat = Literal["html", "plain_text"]


@dataclass(frozen=True, slots=True)
class ApprovedStructuredEntry:
    """One reviewed source snapshot that may be deterministically converted to EPUB."""

    entry_id: str
    source_key: str
    priority: int
    work_title: str
    aliases: tuple[str, ...]
    authors: tuple[str, ...]
    digital_title: str
    language: str
    digital_identifier: str
    publisher: str
    source_organization: str
    canonical_url: str
    source_url: str
    cover_url: str | None
    content_format: StructuredContentFormat
    content: bytes
    expected_source_sha256: str
    snapshot_retrieved_at: datetime
    rights_evidence: RightsEvidence
    license_name: str
    license_url: str
    rights_statement: str
    attribution: str | None
    reviewed_at: str


@dataclass(frozen=True, slots=True)
class ApprovedPdfEntry:
    """One reviewed text-based PDF snapshot eligible for guarded conversion."""

    entry_id: str
    source_key: str
    priority: int
    work_title: str
    aliases: tuple[str, ...]
    authors: tuple[str, ...]
    digital_title: str
    language: str
    digital_identifier: str
    publisher: str
    source_organization: str
    canonical_url: str
    pdf_url: str
    cover_url: str | None
    content: bytes
    expected_pdf_sha256: str
    snapshot_retrieved_at: datetime
    rights_evidence: RightsEvidence
    license_name: str
    license_url: str
    rights_statement: str
    attribution: str | None
    reviewed_at: str


@dataclass(frozen=True, slots=True)
class ApprovedEpubCatalog:
    entries: tuple[ApprovedEpubEntry, ...]

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedEpubEntry, ...]:
        del physical_isbn13
        normalized_title = _normalized(title)
        normalized_authors = {_normalized(author) for author in authors}
        if not normalized_title or not normalized_authors:
            return ()

        seen_identifiers: set[str] = set()
        matches: list[ApprovedEpubEntry] = []
        for entry in sorted(self.entries, key=lambda item: (item.priority, item.entry_id)):
            entry_titles = {
                _normalized(entry.work_title),
                *(_normalized(alias) for alias in entry.aliases),
            }
            entry_authors = {_normalized(author) for author in entry.authors}
            if normalized_title not in entry_titles or not (normalized_authors & entry_authors):
                continue
            identifier = _canonical_identifier(entry.digital_identifier)
            if identifier in seen_identifiers:
                continue
            seen_identifiers.add(identifier)
            matches.append(entry)
        return tuple(matches)


@dataclass(frozen=True, slots=True)
class ApprovedStructuredCatalog:
    entries: tuple[ApprovedStructuredEntry, ...]

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedStructuredEntry, ...]:
        del physical_isbn13
        normalized_title = _normalized(title)
        normalized_authors = {_normalized(author) for author in authors}
        if not normalized_title or not normalized_authors:
            return ()

        seen_identifiers: set[str] = set()
        matches: list[ApprovedStructuredEntry] = []
        for entry in sorted(self.entries, key=lambda item: (item.priority, item.entry_id)):
            entry_titles = {
                _normalized(entry.work_title),
                *(_normalized(alias) for alias in entry.aliases),
            }
            entry_authors = {_normalized(author) for author in entry.authors}
            if normalized_title not in entry_titles or not (normalized_authors & entry_authors):
                continue
            identifier = _canonical_identifier(entry.digital_identifier)
            if identifier in seen_identifiers:
                continue
            seen_identifiers.add(identifier)
            matches.append(entry)
        return tuple(matches)


@dataclass(frozen=True, slots=True)
class ApprovedPdfCatalog:
    entries: tuple[ApprovedPdfEntry, ...]

    def find_all(
        self,
        title: str,
        authors: list[str],
        physical_isbn13: str | None,
    ) -> tuple[ApprovedPdfEntry, ...]:
        del physical_isbn13
        normalized_title = _normalized(title)
        normalized_authors = {_normalized(author) for author in authors}
        if not normalized_title or not normalized_authors:
            return ()

        seen_identifiers: set[str] = set()
        matches: list[ApprovedPdfEntry] = []
        for entry in sorted(self.entries, key=lambda item: (item.priority, item.entry_id)):
            entry_titles = {
                _normalized(entry.work_title),
                *(_normalized(alias) for alias in entry.aliases),
            }
            entry_authors = {_normalized(author) for author in entry.authors}
            if normalized_title not in entry_titles or not (normalized_authors & entry_authors):
                continue
            identifier = _canonical_identifier(entry.digital_identifier)
            if identifier in seen_identifiers:
                continue
            seen_identifiers.add(identifier)
            matches.append(entry)
        return tuple(matches)


def _canonical_identifier(value: str) -> str:
    return value.strip().rstrip("/").casefold()


def _normalized(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    tokens = re.findall(r"[a-z0-9]+", decomposed.casefold().replace("&", " and "))
    return " ".join(tokens)
