from dataclasses import dataclass

import pytest

from book_backend.cover.models import OcrLine
from book_backend.cover.service import CoverRecognitionService, extract_cover_queries
from book_backend.metadata.models import (
    EditionSummary,
    MetadataCandidate,
    MetadataSearchResult,
    SourceEvidence,
    WorkSummary,
)


def candidate(
    candidate_id: str,
    title: str,
    author: str,
    confidence: str = "medium",
    cover_url: str | None = "https://covers.example/book.jpg",
) -> MetadataCandidate:
    return MetadataCandidate(
        candidate_id=candidate_id,
        confidence=confidence,
        match_reasons=["Title match"],
        work=WorkSummary(
            title=title,
            authors=[author],
            first_published_year=1813,
            language="en",
            source_ids={"fixture": candidate_id},
        ),
        edition=EditionSummary(
            title=title,
            publisher="Fixture Press",
            published_date="2020",
            isbn10=None,
            isbn13=None,
            cover_url=cover_url,
            source_ids={"fixture": f"edition-{candidate_id}"},
        ),
        sources=[SourceEvidence(provider="fixture", work_id=candidate_id, edition_id=None)],
    )


class StubOcr:
    def __init__(self, lines: list[OcrLine]):
        self.lines = lines
        self.received: bytes | None = None

    async def read(self, image_bytes: bytes) -> list[OcrLine]:
        self.received = image_bytes
        return self.lines


class StubMetadata:
    def __init__(self, candidates: list[MetadataCandidate]):
        self.candidates = candidates
        self.queries = []

    async def search(self, query):
        self.queries.append(query)
        return MetadataSearchResult(
            observed_isbn=None,
            candidates=self.candidates,
            provider_failures=[],
        )


@dataclass
class StubComparator:
    scores: dict[str, float]

    async def compare(self, _image_bytes: bytes, item: MetadataCandidate) -> float | None:
        return self.scores.get(item.candidate_id)


def test_extract_cover_queries_prefers_prominent_title_and_byline():
    queries = extract_cover_queries(
        [
            OcrLine(text="PENGUIN CLASSICS", confidence=89, top=24, height=16),
            OcrLine(text="PRIDE AND PREJUDICE", confidence=97, top=130, height=52),
            OcrLine(text="Jane Austen", confidence=95, top=330, height=28),
            OcrLine(text="With an introduction by Vivien Jones", confidence=83, top=640, height=15),
        ],
        image_height=800,
    )

    assert queries[0].title == "PRIDE AND PREJUDICE"
    assert queries[0].author == "Jane Austen"
    assert any(query.title == "PRIDE AND PREJUDICE" and query.author is None for query in queries)
    assert all("introduction" not in query.title.casefold() for query in queries)


def test_extract_cover_queries_handles_title_split_across_lines():
    queries = extract_cover_queries(
        [
            OcrLine(text="THE LEFT HAND", confidence=94, top=90, height=40),
            OcrLine(text="OF DARKNESS", confidence=95, top=138, height=40),
            OcrLine(text="URSULA K. LE GUIN", confidence=93, top=480, height=24),
        ],
        image_height=700,
    )

    assert queries[0].title == "THE LEFT HAND OF DARKNESS"
    assert queries[0].author == "URSULA K. LE GUIN"


@pytest.mark.anyio
async def test_recognition_uses_text_as_primary_evidence_and_returns_high_confidence():
    ocr = StubOcr(
        [
            OcrLine(text="PRIDE AND PREJUDICE", confidence=97, top=100, height=52),
            OcrLine(text="Jane Austen", confidence=95, top=330, height=28),
        ]
    )
    metadata = StubMetadata(
        [
            candidate("right", "Pride and Prejudice", "Jane Austen"),
            candidate("wrong", "Pride and Premeditation", "Tirzah Price"),
        ]
    )
    service = CoverRecognitionService(
        ocr=ocr,
        metadata=metadata,
        comparator=StubComparator({"right": 0.91, "wrong": 0.99}),
    )

    result = await service.recognize(b"decoded-cover")

    assert result.status == "matched"
    assert result.confidence == "high"
    assert result.extracted_title == "PRIDE AND PREJUDICE"
    assert result.extracted_author == "Jane Austen"
    assert [item.candidate_id for item in result.candidates] == ["right", "wrong"]
    assert result.candidates[0].match_reasons == ["Title match", "Author match", "Cover match"]


@pytest.mark.anyio
async def test_visual_similarity_alone_never_forces_a_match():
    ocr = StubOcr([OcrLine(text="A NOVEL", confidence=43, top=100, height=18)])
    metadata = StubMetadata([candidate("lookalike", "Completely Different", "Somebody Else")])
    service = CoverRecognitionService(
        ocr=ocr,
        metadata=metadata,
        comparator=StubComparator({"lookalike": 1.0}),
    )

    result = await service.recognize(b"similar-looking-cover")

    assert result.status == "no_match"
    assert result.confidence == "low"
    assert result.candidates == []


@pytest.mark.anyio
async def test_exact_title_without_author_or_cover_evidence_still_requires_confirmation():
    ocr = StubOcr([OcrLine(text="INVISIBLE MAN", confidence=96, top=100, height=48)])
    metadata = StubMetadata([candidate("one", "Invisible Man", "Ralph Ellison")])
    service = CoverRecognitionService(
        ocr=ocr,
        metadata=metadata,
        comparator=StubComparator({}),
    )

    result = await service.recognize(b"title-only-cover")

    assert result.status == "ambiguous"
    assert result.confidence == "medium"
    assert result.candidates[0].candidate_id == "one"


@pytest.mark.anyio
async def test_close_text_candidates_are_ambiguous_even_with_one_visual_leader():
    ocr = StubOcr(
        [
            OcrLine(text="FRANKENSTEIN", confidence=96, top=110, height=50),
            OcrLine(text="Mary Shelley", confidence=91, top=390, height=24),
        ]
    )
    metadata = StubMetadata(
        [
            candidate("one", "Frankenstein", "Mary Shelley"),
            candidate("two", "Frankenstein; or, The Modern Prometheus", "Mary Shelley"),
        ]
    )
    service = CoverRecognitionService(
        ocr=ocr,
        metadata=metadata,
        comparator=StubComparator({"one": 0.77, "two": 0.95}),
    )

    result = await service.recognize(b"cover")

    assert result.status == "ambiguous"
    assert result.confidence == "medium"
    assert len(result.candidates) == 2


@pytest.mark.anyio
async def test_no_useful_ocr_returns_no_match_without_catalog_query():
    ocr = StubOcr(
        [
            OcrLine(text="x", confidence=20, top=12, height=6),
            OcrLine(text="", confidence=0, top=18, height=8),
        ]
    )
    metadata = StubMetadata([])
    service = CoverRecognitionService(
        ocr=ocr,
        metadata=metadata,
        comparator=StubComparator({}),
    )

    result = await service.recognize(b"ornate-cover")

    assert result.status == "no_match"
    assert result.candidates == []
    assert metadata.queries == []
