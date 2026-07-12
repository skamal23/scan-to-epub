import pytest

from book_backend.content_sources.wikisource import (
    WikisourceOpenEditionSource,
    WikisourcePageDetails,
    parse_wikisource_page,
    parse_wikisource_search,
)

SEARCH_RESPONSE = b"""{
  "query": {"pages": {
    "1": {
      "pageid": 1, "title": "Pride and Prejudice",
      "touched": "2026-07-08T20:04:00Z", "lastrevid": 10,
      "canonicalurl": "https://en.wikisource.org/wiki/Pride_and_Prejudice"
    },
    "2": {
      "pageid": 2, "title": "Pride and Prejudice (1817)",
      "touched": "2026-07-01T11:36:41Z", "lastrevid": 20,
      "canonicalurl": "https://en.wikisource.org/wiki/Pride_and_Prejudice_(1817)"
    }
  }}
}"""

PAGE_RESPONSE = b"""{
  "parse": {
    "title": "Pride and Prejudice (1817)",
    "categories": [{"*": "Validated_texts"}, {"*": "Ready_for_export"}, {"*": "PD-old"}],
    "wikitext": {"*": "{{header\\n|title=Pride and Prejudice\\n|author=Jane Austen\\n}}"}
  }
}"""


def test_wikisource_parsers_keep_only_safe_canonical_page_metadata():
    pages = parse_wikisource_search(SEARCH_RESPONSE)
    details = parse_wikisource_page(PAGE_RESPONSE)

    assert len(pages) == 2
    assert pages[1].page_id == 2
    assert pages[1].revision_id == 20
    assert details == WikisourcePageDetails(
        page_title="Pride and Prejudice (1817)",
        work_title="Pride and Prejudice",
        authors=("Jane Austen",),
        ready_for_export=True,
    )


class StubWikisourceClient:
    def __init__(self):
        self.details_calls = []

    async def search(self, title, authors):
        assert title == "Pride and Prejudice"
        assert authors
        return parse_wikisource_search(SEARCH_RESPONSE)

    async def details(self, page):
        self.details_calls.append(page.page_id)
        if page.page_id == 1:
            return WikisourcePageDetails(
                page_title=page.title,
                work_title="Pride and Prejudice",
                authors=("Jane Austen",),
                ready_for_export=False,
            )
        return parse_wikisource_page(PAGE_RESPONSE)


@pytest.mark.anyio
async def test_wikisource_skips_a_portal_page_and_builds_official_export_url():
    client = StubWikisourceClient()
    source = WikisourceOpenEditionSource(client)

    entries = await source.find_all("Pride and Prejudice", ["Jane Austen"], None)

    assert client.details_calls == [1, 2]
    assert len(entries) == 1
    entry = entries[0]
    assert entry.entry_id == "wikisource:en:2:20"
    assert entry.rights_evidence == "cc_by_sa"
    assert entry.canonical_url == "https://en.wikisource.org/wiki/Pride_and_Prejudice_(1817)"
    assert entry.acquisition_url == (
        "https://ws-export.wmcloud.org/tool/book.php?lang=en&format=epub-3&"
        "page=Pride+and+Prejudice+%281817%29"
    )
    assert entry.download_policy.allowed_hosts == frozenset({"ws-export.wmcloud.org"})


@pytest.mark.anyio
async def test_wikisource_requires_the_confirmed_author_and_export_ready_work():
    source = WikisourceOpenEditionSource(StubWikisourceClient())

    assert await source.find_all("Pride and Prejudice", ["Charlotte Bronte"], None) == ()
