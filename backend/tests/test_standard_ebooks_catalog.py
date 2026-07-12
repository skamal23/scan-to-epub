import pytest

from book_backend.content_sources.standard_ebooks import (
    STANDARD_EBOOKS_CATALOG,
    StandardEbooksBook,
    StandardEbooksListing,
    StandardEbooksOpenEditionSource,
    parse_standard_ebooks_book,
    parse_standard_ebooks_search,
)


def test_curated_fallback_catalog_has_five_pinned_unique_entries():
    assert len(STANDARD_EBOOKS_CATALOG.entries) == 5
    assert len({entry.entry_id for entry in STANDARD_EBOOKS_CATALOG.entries}) == 5
    assert all(
        entry.download_policy.expected_sha256 and len(entry.download_policy.expected_sha256) == 64
        for entry in STANDARD_EBOOKS_CATALOG.entries
    )
    assert all(
        entry.acquisition_url.endswith("?source=download")
        for entry in STANDARD_EBOOKS_CATALOG.entries
    )
    assert all(
        entry.canonical_url.startswith("https://standardebooks.org/ebooks/")
        for entry in STANDARD_EBOOKS_CATALOG.entries
    )


def test_catalog_maps_the_work_not_a_modern_physical_edition():
    entry = STANDARD_EBOOKS_CATALOG.find(
        title="Pride & Prejudice",
        authors=["Jane Austen"],
        physical_isbn13="9780141439518",
    )

    assert entry is not None
    assert (
        entry.digital_identifier
        == "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice"
    )
    assert entry.work_title == "Pride and Prejudice"
    assert entry.rights_evidence == "us_public_domain"


def test_catalog_refuses_title_only_collision_and_unsupported_modern_work():
    assert STANDARD_EBOOKS_CATALOG.find("Invisible Man", [], None) is None
    assert STANDARD_EBOOKS_CATALOG.find("The Martian", ["Andy Weir"], None) is None


SEARCH_XHTML = b"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <ol class="ebooks-list">
    <li typeof="schema:Book" about="/ebooks/h-g-wells/the-time-machine">
      <p><a property="schema:url"><span property="schema:name">The Time Machine</span></a></p>
      <p class="author" property="schema:author"><span property="schema:name">H. G. Wells</span></p>
    </li>
    <li typeof="schema:Book" about="https://evil.example/ebooks/not-a-book">
      <p><span property="schema:name">The Time Machine</span></p>
      <p class="author"><span property="schema:name">Someone Else</span></p>
    </li>
  </ol>
</body></html>"""


BOOK_XHTML = (
    b"""<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <section id="read-free" typeof="schema:Book">
    <meta property="schema:inLanguage" content="en-GB"/>
    <meta property="schema:image" content="https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/cover.jpg"/>
    <meta property="schema:dateModified" content="2026-06-30"/>
    <a property="schema:contentUrl" class="epub" href="/ebooks/h-g-wells/"""
    b"""the-time-machine/downloads/h-g-wells_the-time-machine.epub">Compatible epub</a>
    <a property="schema:contentUrl" class="epub" href="/ebooks/h-g-wells/"""
    b"""the-time-machine/downloads/h-g-wells_the-time-machine_advanced.epub">Advanced epub</a>
  </section>
</body></html>"""
)


def test_public_search_parser_discovers_books_without_a_checked_in_title_list():
    listings = parse_standard_ebooks_search(SEARCH_XHTML)

    assert listings == (
        StandardEbooksListing(
            title="The Time Machine",
            authors=("H. G. Wells",),
            canonical_url="https://standardebooks.org/ebooks/h-g-wells/the-time-machine",
        ),
    )


def test_book_parser_selects_the_compatible_epub_and_source_metadata():
    book = parse_standard_ebooks_book(
        BOOK_XHTML,
        "https://standardebooks.org/ebooks/h-g-wells/the-time-machine",
    )

    assert book == StandardEbooksBook(
        language="en-GB",
        acquisition_url=(
            "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/"
            "h-g-wells_the-time-machine.epub?source=download"
        ),
        cover_url=(
            "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/cover.jpg"
        ),
        reviewed_at="2026-06-30",
    )


class StubStandardEbooksClient:
    def __init__(self):
        self.search_calls = 0
        self.book_calls = 0

    async def search(self, query: str):
        self.search_calls += 1
        assert query == "The Time Machine"
        return parse_standard_ebooks_search(SEARCH_XHTML)

    async def get_book(self, canonical_url: str):
        self.book_calls += 1
        return parse_standard_ebooks_book(BOOK_XHTML, canonical_url)


@pytest.mark.anyio
async def test_dynamic_source_resolves_and_caches_a_title_outside_curated_fallback():
    client = StubStandardEbooksClient()
    source = StandardEbooksOpenEditionSource(client=client, cache_ttl_seconds=60)

    first = await source.find_all("The Time Machine", ["H. G. Wells"], None)
    second = await source.find_all("The Time Machine", ["H. G. Wells"], None)

    assert first == second
    assert len(first) == 1
    entry = first[0]
    assert entry.entry_id == "standardebooks:h-g-wells_the-time-machine"
    assert entry.download_policy.expected_sha256 is None
    assert entry.download_policy.allowed_hosts == frozenset({"standardebooks.org"})
    assert client.search_calls == 1
    assert client.book_calls == 1


@pytest.mark.anyio
async def test_dynamic_source_requires_the_confirmed_author():
    client = StubStandardEbooksClient()
    source = StandardEbooksOpenEditionSource(client=client)

    assert await source.find_all("The Time Machine", ["Ralph Ellison"], None) == ()
    assert client.book_calls == 0
