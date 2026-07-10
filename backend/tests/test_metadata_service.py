import logging

import pytest

from book_backend.metadata.models import BookRecord, MetadataQuery
from book_backend.metadata.service import MetadataSearchService


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeProvider:
    def __init__(self, name: str, records: list[BookRecord], error: Exception | None = None):
        self.name = name
        self.records = records
        self.error = error
        self.calls = 0

    async def search(self, query: MetadataQuery) -> list[BookRecord]:
        self.calls += 1
        if self.error:
            raise self.error
        return self.records


def pride_record(provider: str, provider_id: str) -> BookRecord:
    return BookRecord(
        provider=provider,
        provider_work_id="OL66554W" if provider == "open_library" else None,
        provider_edition_id=provider_id,
        title="Pride and Prejudice",
        authors=("Jane Austen",),
        first_published_year=1813,
        published_date="2003",
        publisher="Penguin Classics",
        language="en",
        isbn10="0141439513",
        isbn13="9780141439518",
        cover_url=None,
    )


@pytest.mark.anyio
async def test_search_deduplicates_provider_records_and_preserves_sources() -> None:
    service = MetadataSearchService(
        providers=[
            FakeProvider("google_books", [pride_record("google_books", "google-1")]),
            FakeProvider("open_library", [pride_record("open_library", "OL7353617M")]),
        ]
    )

    result = await service.search(MetadataQuery(isbn="9780141439518"))

    assert len(result.candidates) == 1
    candidate = result.candidates[0]
    assert candidate.confidence == "high"
    assert candidate.work.title == "Pride and Prejudice"
    assert candidate.edition.isbn13 == "9780141439518"
    assert {source.provider for source in candidate.sources} == {"google_books", "open_library"}


@pytest.mark.anyio
async def test_title_search_deduplicates_different_editions_of_the_same_work() -> None:
    first = pride_record("open_library", "OL7353617M")
    second = BookRecord(
        provider="open_library",
        provider_work_id="OL66554W",
        provider_edition_id="OL999999M",
        title="Pride and Prejudice",
        authors=("Jane Austen",),
        first_published_year=1813,
        published_date="2011",
        publisher="Another Publisher",
        language="en",
        isbn10=None,
        isbn13="9780000000042",
        cover_url=None,
    )
    service = MetadataSearchService(providers=[FakeProvider("open_library", [first, second])])

    result = await service.search(MetadataQuery(title="Pride and Prejudice", author="Jane Austen"))

    assert len(result.candidates) == 1
    assert len(result.candidates[0].sources) == 2


@pytest.mark.anyio
async def test_search_falls_back_when_one_provider_fails() -> None:
    service = MetadataSearchService(
        providers=[
            FakeProvider("google_books", [], error=RuntimeError("rate limited")),
            FakeProvider("open_library", [pride_record("open_library", "OL7353617M")]),
        ]
    )

    result = await service.search(MetadataQuery(title="Pride and Prejudice", author="Jane Austen"))

    assert [candidate.work.title for candidate in result.candidates] == ["Pride and Prejudice"]
    assert result.provider_failures == ["google_books"]


@pytest.mark.anyio
async def test_provider_failure_log_names_provider_without_query_data(caplog) -> None:
    caplog.set_level(logging.WARNING, logger="book_backend.metadata")
    service = MetadataSearchService(
        providers=[FakeProvider("google_books", [], error=RuntimeError("9780141439518 secret"))]
    )

    await service.search(MetadataQuery(isbn="9780141439518"))

    messages = [record.getMessage() for record in caplog.records]
    assert messages == ["metadata provider failed: google_books"]
    assert all("9780141439518" not in message and "secret" not in message for message in messages)


@pytest.mark.anyio
async def test_ambiguous_title_returns_at_most_three_without_high_confidence() -> None:
    records = [
        BookRecord(
            provider="open_library",
            provider_work_id=f"work-{index}",
            provider_edition_id=f"edition-{index}",
            title="Invisible Man" if index < 2 else f"Invisible Man {index}",
            authors=(author,),
            first_published_year=year,
            published_date=str(year),
            publisher=None,
            language="en",
            isbn10=None,
            isbn13=None,
            cover_url=None,
        )
        for index, (author, year) in enumerate(
            [("Ralph Ellison", 1952), ("H. G. Wells", 1897), ("John Doe", 2001), ("Jane Doe", 2002)]
        )
    ]
    service = MetadataSearchService(providers=[FakeProvider("open_library", records)])

    result = await service.search(MetadataQuery(title="Invisible Man"))

    assert len(result.candidates) == 3
    assert all(candidate.confidence != "high" for candidate in result.candidates)


@pytest.mark.anyio
async def test_successful_searches_are_cached_but_failures_are_not() -> None:
    successful = FakeProvider("open_library", [pride_record("open_library", "OL7353617M")])
    service = MetadataSearchService(providers=[successful], cache_ttl_seconds=300)
    query = MetadataQuery(isbn="9780141439518")

    await service.search(query)
    await service.search(query)

    assert successful.calls == 1

    failing = FakeProvider("open_library", [], error=RuntimeError("temporary"))
    retrying_service = MetadataSearchService(providers=[failing], cache_ttl_seconds=300)
    await retrying_service.search(query)
    await retrying_service.search(query)
    assert failing.calls == 2
