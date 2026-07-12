import pytest

from book_backend.content_sources.unglue import (
    UnglueOpenEditionSource,
    parse_unglue_downloads,
    parse_unglue_feed,
    parse_unglue_work_feed,
)

OPDS = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/">
  <updated>2026-07-11T12:00:00Z</updated>
  <entry>
    <title>The Classic Short Story, 1870-1925: Theory of a Genre</title>
    <id>https://unglue.it/api/id/work/136328/</id>
    <updated>2021-03-05T23:57:44</updated>
    <author><name>Florence Goyet</name></author>
    <dcterms:publisher>Open Book Publishers</dcterms:publisher>
    <dcterms:language>en</dcterms:language>
    <link dcterms:rights="CC BY" href="https://unglue.it/download_ebook/2314/?feed=opds"
      rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip"/>
  </entry>
  <entry>
    <title>Restricted Example</title><id>https://unglue.it/api/id/work/2/</id>
    <author><name>Example Author</name></author>
    <link dcterms:rights="CC BY-NC-ND" href="https://unglue.it/download_ebook/2/"
      rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip"/>
  </entry>
</feed>"""


def test_unglue_parser_keeps_permissive_epub_and_rejects_nc_nd():
    records = parse_unglue_feed(OPDS)

    assert len(records) == 1
    assert records[0].work_id == 136328
    assert records[0].rights_evidence == "cc_by"
    assert records[0].acquisition_url.endswith("/download_ebook/2314/?feed=opds")


DOWNLOAD_PAGE = b"""
<div class="ebook_download">
  <a href="/download_ebook/2314/"><img alt="CC BY" src="/static/images/ccby.png" /></a>
  <a href="/download_ebook/2314/"><img alt="epub at Unglue.it" src="epub.png" /></a>
  <a href="/download_ebook/99/"><img alt="CC BY-NC-ND" src="cc.png" /></a>
  <a href="/download_ebook/99/"><img alt="epub at Internet Archive" src="epub.png" /></a>
</div>
"""


def test_unglue_isbn_work_route_extracts_only_unglue_hosted_permissive_epub():
    work = parse_unglue_work_feed(OPDS)
    downloads = parse_unglue_downloads(DOWNLOAD_PAGE)

    assert work.work_id == 136328
    assert work.title.startswith("The Classic Short Story")
    assert downloads == ((2314, "CC BY", "cc_by"),)


class StubUnglueClient:
    def __init__(self):
        self.calls = 0

    async def search(self, title, physical_isbn13=None):
        self.calls += 1
        assert title == "The Classic Short Story, 1870-1925: Theory of a Genre"
        assert physical_isbn13 in {None, "9781909254770"}
        return parse_unglue_feed(OPDS)


@pytest.mark.anyio
async def test_unglue_source_matches_author_and_uses_only_official_hosted_epub():
    client = StubUnglueClient()
    source = UnglueOpenEditionSource(client, cache_ttl_seconds=60)

    first = await source.find_all(
        "The Classic Short Story, 1870-1925: Theory of a Genre",
        ["Florence Goyet"],
        "9781909254770",
    )
    second = await source.find_all(
        "The Classic Short Story, 1870-1925: Theory of a Genre",
        ["Florence Goyet"],
        "9781909254770",
    )

    assert first == second
    assert len(first) == 1
    entry = first[0]
    assert entry.entry_id == "unglue:136328:2314"
    assert entry.canonical_url == "https://unglue.it/work/136328/"
    assert entry.download_policy.allowed_hosts == frozenset(
        {"unglue.it", "tieulgnu.s3.amazonaws.com"}
    )
    assert entry.download_policy.max_redirects == 1
    assert client.calls == 1


@pytest.mark.anyio
async def test_unglue_source_requires_confirmed_author():
    source = UnglueOpenEditionSource(StubUnglueClient())

    assert (
        await source.find_all(
            "The Classic Short Story, 1870-1925: Theory of a Genre", ["Someone Else"], None
        )
        == ()
    )
