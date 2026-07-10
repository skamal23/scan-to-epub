from copy import deepcopy

import pytest

from book_backend.content_sources.google_books import (
    GoogleBooksOpenEditionSource,
    google_public_domain_epub_entry,
)


def _volume() -> dict:
    return {
        "id": "google-volume-id",
        "volumeInfo": {
            "title": "The Example Book",
            "authors": ["Example Author"],
            "language": "en",
            "publisher": "Example Publisher",
            "canonicalVolumeLink": "https://books.google.com/books?id=google-volume-id",
        },
        "accessInfo": {
            "country": "US",
            "viewability": "ALL_PAGES",
            "publicDomain": True,
            "accessViewStatus": "FULL_PUBLIC_DOMAIN",
            "epub": {
                "isAvailable": True,
                "downloadLink": "https://books.google.com/books/download/example.epub",
            },
        },
    }


def test_google_entry_requires_the_full_public_domain_epub_contract():
    entry = google_public_domain_epub_entry(_volume(), reviewed_at="2026-07-10T20:00:00Z")

    assert entry is not None
    assert entry.entry_id == "google_books:google-volume-id"
    assert entry.rights_evidence == "us_public_domain"
    assert entry.source_organization == "Google Books"
    assert entry.cover_url is None
    assert entry.acquisition_url == "https://books.google.com/books/download/example.epub"
    assert entry.download_policy.allowed_hosts == frozenset(
        {"books.google.com", "books.googleusercontent.com"}
    )
    assert entry.download_policy.allow_redirects is True
    assert entry.download_policy.max_redirects == 1
    assert entry.download_policy.expected_sha256 is None


@pytest.mark.parametrize(
    "mutate",
    [
        lambda volume: volume["accessInfo"].update(accessViewStatus="SAMPLE"),
        lambda volume: volume["accessInfo"].update(publicDomain=False),
        lambda volume: volume["accessInfo"].update(viewability="PARTIAL"),
        lambda volume: volume["accessInfo"]["epub"].update(isAvailable=False),
        lambda volume: volume["accessInfo"]["epub"].update(
            acsTokenLink="https://books.google.com/books/download/example.acsm"
        ),
        lambda volume: volume["accessInfo"]["epub"].update(
            downloadLink="https://untrusted.example/example.epub"
        ),
    ],
)
def test_google_entry_rejects_partial_restricted_and_untrusted_downloads(mutate):
    volume = deepcopy(_volume())
    mutate(volume)

    assert google_public_domain_epub_entry(volume, reviewed_at="2026-07-10T20:00:00Z") is None


class StubGoogleVolumes:
    def __init__(self, volumes):
        self.volumes = volumes
        self.queries = []

    async def search(self, query, *, country):
        self.queries.append((query, country))
        return self.volumes


@pytest.mark.anyio
async def test_google_source_queries_us_public_domain_candidates_then_rechecks_work_evidence():
    client = StubGoogleVolumes([_volume()])
    source = GoogleBooksOpenEditionSource(
        client=client,
        reviewed_at=lambda: "2026-07-10T20:00:00Z",
    )

    matches = await source.find_all("The Example Book", ["Example Author"], None)

    assert [entry.entry_id for entry in matches] == ["google_books:google-volume-id"]
    assert client.queries == [("intitle:The Example Book inauthor:Example Author", "US")]


@pytest.mark.anyio
async def test_google_source_caches_a_successful_source_lookup_for_the_short_demo_window():
    client = StubGoogleVolumes([_volume()])
    source = GoogleBooksOpenEditionSource(
        client=client,
        reviewed_at=lambda: "2026-07-10T20:00:00Z",
    )

    await source.find_all("The Example Book", ["Example Author"], None)
    await source.find_all("The Example Book", ["Example Author"], None)

    assert client.queries == [("intitle:The Example Book inauthor:Example Author", "US")]
