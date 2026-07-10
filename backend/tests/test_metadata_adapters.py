import pytest

from book_backend.metadata.providers import (
    AsyncRequestGate,
    normalize_google_volume,
    normalize_open_library_doc,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_normalize_google_volume_preserves_work_and_edition_evidence() -> None:
    record = normalize_google_volume(
        {
            "id": "google-volume-1",
            "volumeInfo": {
                "title": "Pride and Prejudice",
                "authors": ["Jane Austen"],
                "publisher": "Penguin Classics",
                "publishedDate": "2003-01-30",
                "language": "en",
                "industryIdentifiers": [
                    {"type": "ISBN_10", "identifier": "0141439513"},
                    {"type": "ISBN_13", "identifier": "9780141439518"},
                ],
                "imageLinks": {"thumbnail": "http://books.google.com/cover.jpg"},
            },
        }
    )

    assert record.provider == "google_books"
    assert record.provider_edition_id == "google-volume-1"
    assert record.title == "Pride and Prejudice"
    assert record.authors == ("Jane Austen",)
    assert record.isbn13 == "9780141439518"
    assert record.cover_url == "https://books.google.com/cover.jpg"


def test_normalize_open_library_doc_uses_matching_edition() -> None:
    record = normalize_open_library_doc(
        {
            "key": "/works/OL66554W",
            "title": "Pride and Prejudice",
            "author_name": ["Jane Austen"],
            "first_publish_year": 1813,
            "language": ["eng"],
            "editions": {
                "docs": [
                    {
                        "key": "/books/OL7353617M",
                        "title": "Pride and Prejudice",
                        "publisher": ["Penguin Classics"],
                        "publish_date": ["2003"],
                        "isbn": ["9780141439518"],
                        "cover_i": 10521270,
                    }
                ]
            },
        }
    )

    assert record.provider == "open_library"
    assert record.provider_work_id == "OL66554W"
    assert record.provider_edition_id == "OL7353617M"
    assert record.first_published_year == 1813
    assert record.cover_url == "https://covers.openlibrary.org/b/id/10521270-L.jpg"


@pytest.mark.anyio
async def test_request_gate_spaces_provider_calls() -> None:
    now = [0.0]
    sleeps: list[float] = []

    async def sleep(delay: float) -> None:
        sleeps.append(delay)
        now[0] += delay

    gate = AsyncRequestGate(min_interval_seconds=1.0, clock=lambda: now[0], sleep=sleep)

    await gate.wait()
    await gate.wait()

    assert sleeps == [1.0]
