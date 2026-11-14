import asyncio
import re
from collections.abc import Sequence
from difflib import SequenceMatcher
from typing import Protocol

from book_backend.content_sources.matching import title_match_score
from book_backend.metadata.models import MetadataCandidate, MetadataQuery
from book_backend.metadata.service import MetadataSearchService

from .models import CoverRecognitionResult, OcrLine


class CoverOcr(Protocol):
    async def read(self, image_bytes: bytes) -> list[OcrLine]: ...


class CoverComparator(Protocol):
    async def compare(
        self,
        image_bytes: bytes,
        candidate: MetadataCandidate,
    ) -> float | None: ...


class NoCoverComparator:
    async def compare(
        self,
        image_bytes: bytes,
        candidate: MetadataCandidate,
    ) -> float | None:
        return None


class CoverRecognitionService:
    def __init__(
        self,
        ocr: CoverOcr,
        metadata: MetadataSearchService,
        comparator: CoverComparator | None = None,
    ):
        self.ocr = ocr
        self.metadata = metadata
        self.comparator = comparator or NoCoverComparator()

    async def recognize(self, image_bytes: bytes) -> CoverRecognitionResult:
        lines = await self.ocr.read(image_bytes)
        image_height = max((line.top + line.height for line in lines), default=0)
        queries = extract_cover_queries(lines, image_height=max(int(image_height * 1.25), 1))
        if not queries:
            return _empty_result()

        candidates: dict[str, MetadataCandidate] = {}
        failures: set[str] = set()
        for query in queries[:3]:
            result = await self.metadata.search(query)
            failures.update(result.provider_failures)
            for candidate in result.candidates:
                candidates.setdefault(candidate.candidate_id, candidate)
        if not candidates:
            return CoverRecognitionResult(
                status="no_match",
                confidence="low",
                extracted_title=queries[0].title,
                extracted_author=queries[0].author,
                candidates=[],
                provider_failures=sorted(failures),
            )

        primary = queries[0]
        candidate_items = list(candidates.values())
        visual_scores = await asyncio.gather(
            *(self.comparator.compare(image_bytes, candidate) for candidate in candidate_items)
        )
        ranked: list[tuple[float, float, float | None, MetadataCandidate]] = []
        for candidate, visual_score in zip(candidate_items, visual_scores, strict=True):
            title_score = max(
                title_match_score(query.title or "", candidate.work.title) for query in queries
            )
            author_score = _author_similarity(primary.author, candidate.work.authors)
            text_score = (
                title_score if not primary.author else 0.78 * title_score + 0.22 * author_score
            )
            total = 0.9 * text_score + 0.1 * (visual_score or 0)
            ranked.append((total, text_score, visual_score, candidate))
        ranked.sort(key=lambda item: item[0], reverse=True)

        usable = [item for item in ranked if item[1] >= 0.55]
        if not usable:
            return CoverRecognitionResult(
                status="no_match",
                confidence="low",
                extracted_title=primary.title,
                extracted_author=primary.author,
                candidates=[],
                provider_failures=sorted(failures),
            )

        decorated = [_with_cover_reasons(item[3], primary, item[2]) for item in usable[:3]]
        leader_total, leader_text, leader_visual, _leader = usable[0]
        margin = leader_total - usable[1][0] if len(usable) > 1 else leader_total
        author_confirmed = bool(
            primary.author and _author_similarity(primary.author, decorated[0].work.authors) >= 0.78
        )
        visual_confirmed = leader_visual is not None and leader_visual >= 0.7
        high = leader_text >= 0.9 and (author_confirmed or visual_confirmed) and margin >= 0.12
        if high:
            status = "matched"
            confidence = "high"
        elif leader_text >= 0.68:
            status = "ambiguous"
            confidence = "medium"
        else:
            status = "ambiguous"
            confidence = "low"

        return CoverRecognitionResult(
            status=status,
            confidence=confidence,
            extracted_title=primary.title,
            extracted_author=primary.author,
            candidates=decorated,
            provider_failures=sorted(failures),
        )


def extract_cover_queries(lines: Sequence[OcrLine], image_height: int) -> list[MetadataQuery]:
    useful = [
        line
        for line in lines
        if line.confidence >= 55
        and len(_words(line.text)) >= 1
        and len(_normalized(line.text)) >= 3
        and not _is_supporting_copy(line.text)
    ]
    if not useful:
        return []

    prominent = sorted(
        useful,
        key=lambda line: (
            line.height * min(len(_words(line.text)), 5),
            line.confidence,
            -line.top,
        ),
        reverse=True,
    )
    title_line = prominent[0]
    title_lines = [title_line]
    for line in useful:
        if line is title_line:
            continue
        close_vertically = abs(line.top - (title_line.top + title_line.height)) <= max(
            title_line.height, line.height
        )
        similar_size = (
            min(line.height, title_line.height) / max(line.height, title_line.height) >= 0.72
        )
        if close_vertically and similar_size:
            title_lines.append(line)
    title_lines.sort(key=lambda line: line.top)
    title = " ".join(line.text.strip() for line in title_lines)

    excluded = {id(line) for line in title_lines}
    author_candidates = [
        line
        for line in useful
        if id(line) not in excluded
        and line.top <= image_height * 0.82
        and _looks_like_name(line.text)
    ]
    author = max(
        author_candidates,
        key=lambda line: (line.confidence, line.height),
        default=None,
    )
    author_text = _strip_byline(author.text) if author else None
    queries = [MetadataQuery(title=title, author=author_text)]
    if author_text:
        queries.append(MetadataQuery(title=title))
    if len(title_lines) > 1:
        queries.append(MetadataQuery(title=title_line.text, author=author_text))
    return _deduplicate_queries(queries)


def _empty_result() -> CoverRecognitionResult:
    return CoverRecognitionResult(
        status="no_match",
        confidence="low",
        candidates=[],
        provider_failures=[],
    )


def _with_cover_reasons(
    candidate: MetadataCandidate,
    query: MetadataQuery,
    visual_score: float | None,
) -> MetadataCandidate:
    reasons = ["Title match"]
    if query.author and _author_similarity(query.author, candidate.work.authors) >= 0.78:
        reasons.append("Author match")
    if visual_score is not None and visual_score >= 0.72:
        reasons.append("Cover match")
    return candidate.model_copy(update={"match_reasons": reasons}, deep=True)


def _is_supporting_copy(text: str) -> bool:
    normalized = _normalized(text)
    phrases = (
        "introduction by",
        "foreword by",
        "new york times",
        "bestseller",
        "penguin classics",
        "a novel",
    )
    return any(phrase in normalized for phrase in phrases)


def _looks_like_name(text: str) -> bool:
    value = _strip_byline(text)
    words = _words(value)
    if not 2 <= len(words) <= 5:
        return False
    if any(word.casefold() in {"the", "of", "and", "with", "novel"} for word in words):
        return False
    letters = [character for character in value if character.isalpha()]
    if not letters:
        return False
    return sum(character.isupper() for character in letters) / len(letters) >= 0.18


def _strip_byline(text: str) -> str:
    return re.sub(r"^\s*(?:written\s+)?by\s+", "", text, flags=re.IGNORECASE).strip()


def _deduplicate_queries(queries: Sequence[MetadataQuery]) -> list[MetadataQuery]:
    result: list[MetadataQuery] = []
    seen: set[tuple[str | None, str | None]] = set()
    for query in queries:
        key = (_normalized(query.title or ""), _normalized(query.author or ""))
        if key not in seen:
            seen.add(key)
            result.append(query)
    return result


def _author_similarity(query: str | None, authors: Sequence[str]) -> float:
    if not query:
        return 0
    return max((_similarity(query, author) for author in authors), default=0)


def _words(value: str) -> list[str]:
    return re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'’-]*", value)


def _normalized(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _similarity(left: str, right: str) -> float:
    normalized_left = _normalized(left)
    normalized_right = _normalized(right)
    sequence = SequenceMatcher(None, normalized_left, normalized_right).ratio()
    left_words = set(normalized_left.split())
    right_words = set(normalized_right.split())
    token_coverage = (
        len(left_words & right_words) / len(left_words | right_words)
        if left_words and right_words
        else 0
    )
    return max(sequence, token_coverage)
