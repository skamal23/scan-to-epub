import asyncio
import hashlib
import re
import time
from collections import defaultdict
from difflib import SequenceMatcher

from .models import (
    BookRecord,
    EditionSummary,
    MetadataCandidate,
    MetadataQuery,
    MetadataSearchResult,
    SourceEvidence,
    WorkSummary,
)
from .providers import MetadataProvider


class MetadataSearchService:
    def __init__(
        self,
        providers: list[MetadataProvider],
        cache_ttl_seconds: float = 300,
    ):
        self.providers = providers
        self.cache_ttl_seconds = cache_ttl_seconds
        self._cache: dict[MetadataQuery, tuple[float, MetadataSearchResult]] = {}

    async def search(self, query: MetadataQuery) -> MetadataSearchResult:
        cached = self._cache.get(query)
        now = time.monotonic()
        if cached and cached[0] > now:
            return cached[1].model_copy(deep=True)

        outcomes = await asyncio.gather(
            *(provider.search(query) for provider in self.providers),
            return_exceptions=True,
        )
        records: list[BookRecord] = []
        failures: list[str] = []
        for provider, outcome in zip(self.providers, outcomes, strict=True):
            if isinstance(outcome, BaseException):
                failures.append(provider.name)
            else:
                records.extend(outcome)

        groups: dict[str, list[BookRecord]] = defaultdict(list)
        for record in records:
            groups[_deduplication_key(query, record)].append(record)

        ranked = sorted(
            ((self._score(query, group), group) for group in groups.values()),
            key=lambda item: item[0],
            reverse=True,
        )
        candidates = [self._candidate(query, score, group) for score, group in ranked[:3]]
        result = MetadataSearchResult(candidates=candidates, provider_failures=failures)
        if not failures and self.cache_ttl_seconds > 0:
            self._cache[query] = (now + self.cache_ttl_seconds, result.model_copy(deep=True))
        return result

    def _score(self, query: MetadataQuery, records: list[BookRecord]) -> float:
        if query.isbn and any(query.isbn in {record.isbn10, record.isbn13} for record in records):
            return 1.0
        representative = _representative(records)
        title_score = _similarity(query.title or "", representative.title)
        if query.author:
            author_score = max(
                (_similarity(query.author, author) for author in representative.authors), default=0
            )
            return 0.75 * title_score + 0.25 * author_score
        return 0.85 * title_score

    def _candidate(
        self,
        query: MetadataQuery,
        score: float,
        records: list[BookRecord],
    ) -> MetadataCandidate:
        representative = _representative(records)
        exact_isbn = bool(
            query.isbn and any(query.isbn in {record.isbn10, record.isbn13} for record in records)
        )
        confidence = "high" if exact_isbn else "medium" if score >= 0.68 else "low"
        reasons = ["Exact ISBN match"] if exact_isbn else ["Title match"]
        if query.author and any(
            _similarity(query.author, author) >= 0.85 for author in representative.authors
        ):
            reasons.append("Author match")
        work_ids = {
            record.provider: record.provider_work_id
            for record in records
            if record.provider_work_id
        }
        edition_ids = {
            record.provider: record.provider_edition_id
            for record in records
            if record.provider_edition_id
        }
        identity = query.isbn or ":".join(
            [
                _normalized(representative.title),
                _normalized(representative.authors[0] if representative.authors else ""),
            ]
        )
        candidate_id = hashlib.sha256(identity.encode()).hexdigest()[:16]
        return MetadataCandidate(
            candidate_id=candidate_id,
            confidence=confidence,
            match_reasons=reasons,
            work=WorkSummary(
                title=representative.title,
                authors=list(representative.authors),
                first_published_year=min(
                    (
                        record.first_published_year
                        for record in records
                        if record.first_published_year
                    ),
                    default=None,
                ),
                language=representative.language,
                source_ids=work_ids,
            ),
            edition=EditionSummary(
                title=representative.title,
                publisher=representative.publisher,
                published_date=representative.published_date,
                isbn10=representative.isbn10,
                isbn13=representative.isbn13,
                cover_url=representative.cover_url,
                source_ids=edition_ids,
            ),
            sources=[
                SourceEvidence(
                    provider=record.provider,
                    work_id=record.provider_work_id,
                    edition_id=record.provider_edition_id,
                )
                for record in records
            ],
        )


def _representative(records: list[BookRecord]) -> BookRecord:
    return max(
        records,
        key=lambda record: sum(
            value is not None
            for value in (record.cover_url, record.isbn13, record.publisher, record.published_date)
        ),
    )


def _deduplication_key(query: MetadataQuery, record: BookRecord) -> str:
    if query.isbn:
        return f"isbn:{record.isbn13 or record.isbn10 or query.isbn}"
    author = record.authors[0] if record.authors else ""
    return f"work:{_normalized(record.title)}:{_normalized(author)}"


def _normalized(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, _normalized(left), _normalized(right)).ratio()
