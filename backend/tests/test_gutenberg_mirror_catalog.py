from dataclasses import replace

import pytest

from book_backend.content_sources.gutenberg import (
    GutenbergMirrorEntry,
    GutenbergOpdsListing,
    GutenbergOpenBook,
    ProjectGutenbergMirrorCatalog,
    ProjectGutenbergOpenEditionSource,
    parse_gutenberg_book_feed,
    parse_gutenberg_search_feed,
)
from book_backend.editions.errors import SourceUnavailable


def _manifest_entry() -> GutenbergMirrorEntry:
    return GutenbergMirrorEntry(
        ebook_id=1342,
        work_title="Pride and Prejudice",
        aliases=("Pride & Prejudice",),
        authors=("Jane Austen",),
        language="en",
        relative_epub_path="cache/epub/1342/pg1342-images.epub",
        expected_sha256="a" * 64,
    )


def test_gutenberg_uses_only_a_reviewed_mirror_asset_not_the_main_site():
    catalog = ProjectGutenbergMirrorCatalog(
        mirror_base_url="https://mirror.example/project-gutenberg/",
        entries=(_manifest_entry(),),
        reviewed_at="2026-07-10",
    )

    matches = catalog.find_all("Pride & Prejudice", ["Jane Austen"], None)

    assert len(matches) == 1
    entry = matches[0]
    assert entry.source_key == "project_gutenberg"
    assert entry.canonical_url == "https://www.gutenberg.org/ebooks/1342"
    assert entry.acquisition_url == (
        "https://mirror.example/project-gutenberg/cache/epub/1342/pg1342-images.epub"
    )
    assert entry.download_policy.allowed_hosts == frozenset({"mirror.example"})
    assert entry.download_policy.expected_sha256 == "a" * 64
    assert entry.license_name == "Project Gutenberg License"


@pytest.mark.parametrize(
    "base_url",
    ["http://mirror.example/project-gutenberg/", "https://www.gutenberg.org/"],
)
def test_gutenberg_catalog_rejects_an_insecure_or_main_site_download_base(base_url):
    with pytest.raises(ValueError):
        ProjectGutenbergMirrorCatalog(
            mirror_base_url=base_url,
            entries=(_manifest_entry(),),
            reviewed_at="2026-07-10",
        )


def test_gutenberg_catalog_rejects_a_manifest_path_that_escapes_the_reviewed_mirror():
    entry = replace(
        _manifest_entry(),
        relative_epub_path="https://untrusted.example/book.epub",
    )

    with pytest.raises(ValueError):
        ProjectGutenbergMirrorCatalog(
            mirror_base_url="https://mirror.example/project-gutenberg/",
            entries=(entry,),
            reviewed_at="2026-07-10",
        )


SEARCH_OPDS = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <updated>2026-07-11T12:00:00Z</updated>
  <entry>
    <id>https://www.gutenberg.org/ebooks/35.opds</id>
    <title>The Time Machine</title>
    <content type="text">H. G. Wells</content>
    <link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/35.opds"/>
  </entry>
  <entry>
    <title>The Time Machine</title>
    <content type="text">Untrusted</content>
    <link rel="subsection" href="https://evil.example/35.opds"/>
  </entry>
</feed>"""


BOOK_OPDS = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/">
  <updated>2026-07-11T12:00:00Z</updated>
  <entry>
    <title>The Time Machine</title>
    <rights>Public domain in the USA.</rights>
    <author><name>Wells, H. G. (Herbert George)</name></author>
    <dcterms:language>en</dcterms:language>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition"
      title="EPUB (no images, older E-readers)"
      href="https://www.gutenberg.org/ebooks/35.epub.noimages"/>
  </entry>
  <entry>
    <title>The Time Machine</title>
    <rights>Public domain in the USA.</rights>
    <author><name>Wells, H. G. (Herbert George)</name></author>
    <dcterms:language>en</dcterms:language>
    <link type="application/epub+zip" rel="http://opds-spec.org/acquisition"
      title="EPUB3 (E-readers incl. Send-to-Kindle)"
      href="https://www.gutenberg.org/ebooks/35.epub3.images"/>
    <link type="image/jpeg" rel="http://opds-spec.org/image"
      href="https://www.gutenberg.org/cache/epub/35/pg35.cover.medium.jpg"/>
  </entry>
</feed>"""


def test_opds_search_parser_discovers_canonical_gutenberg_records():
    assert parse_gutenberg_search_feed(SEARCH_OPDS) == (
        GutenbergOpdsListing(
            ebook_id=35,
            title="The Time Machine",
            authors=("H. G. Wells",),
            detail_url="https://www.gutenberg.org/ebooks/35.opds",
        ),
    )


def test_book_feed_parser_prefers_epub3_with_images():
    assert parse_gutenberg_book_feed(BOOK_OPDS, ebook_id=35) == GutenbergOpenBook(
        title="The Time Machine",
        authors=("Wells, H. G. (Herbert George)",),
        language="en",
        acquisition_url="https://www.gutenberg.org/ebooks/35.epub3.images",
        cover_url="https://www.gutenberg.org/cache/epub/35/pg35.cover.medium.jpg",
        rights_statement="Public domain in the USA.",
        reviewed_at="2026-07-11",
    )


class StubGutenbergClient:
    def __init__(self):
        self.search_calls = 0
        self.book_calls = 0

    async def search(self, query: str):
        self.search_calls += 1
        assert query == "The Time Machine"
        return parse_gutenberg_search_feed(SEARCH_OPDS)

    async def get_book(self, detail_url: str, ebook_id: int):
        self.book_calls += 1
        assert detail_url == "https://www.gutenberg.org/ebooks/35.opds"
        return parse_gutenberg_book_feed(BOOK_OPDS, ebook_id)


@pytest.mark.anyio
async def test_dynamic_gutenberg_source_resolves_and_caches_the_official_opds_result():
    client = StubGutenbergClient()
    source = ProjectGutenbergOpenEditionSource(client=client, cache_ttl_seconds=60)

    first = await source.find_all("The Time Machine", ["H. G. Wells"], None)
    second = await source.find_all("The Time Machine", ["H. G. Wells"], None)

    assert first == second
    assert len(first) == 1
    entry = first[0]
    assert entry.entry_id == "project_gutenberg:35"
    assert entry.rights_evidence == "source_authorized_distribution"
    assert entry.download_policy.allow_redirects is True
    assert entry.download_policy.max_redirects == 1
    assert client.search_calls == 1
    assert client.book_calls == 1


@pytest.mark.anyio
async def test_dynamic_gutenberg_source_requires_the_confirmed_author():
    client = StubGutenbergClient()
    source = ProjectGutenbergOpenEditionSource(client=client)

    assert await source.find_all("The Time Machine", ["Ralph Ellison"], None) == ()


@pytest.mark.anyio
async def test_dynamic_gutenberg_checks_past_unavailable_duplicate_editions():
    class LaterAvailableClient:
        async def search(self, _query: str):
            return tuple(
                GutenbergOpdsListing(
                    ebook_id=ebook_id,
                    title="Shared Title",
                    authors=("Example Author",),
                    detail_url=f"https://www.gutenberg.org/ebooks/{ebook_id}.opds",
                )
                for ebook_id in range(1, 7)
            )

        async def get_book(self, _detail_url: str, ebook_id: int):
            if ebook_id < 6:
                raise SourceUnavailable("edition unavailable")
            return GutenbergOpenBook(
                title="Shared Title",
                authors=("Example Author",),
                language="en",
                acquisition_url="https://www.gutenberg.org/ebooks/6.epub3.images",
                cover_url=None,
                rights_statement="Public domain in the USA.",
                reviewed_at="2026-07-11",
            )

    source = ProjectGutenbergOpenEditionSource(LaterAvailableClient())

    entries = await source.find_all("Shared Title", ["Example Author"], None)

    assert len(entries) == 1
    assert entries[0].entry_id == "project_gutenberg:6"
