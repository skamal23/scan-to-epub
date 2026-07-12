import json

import pytest

from book_backend.content_sources.oapen_live import OapenOpenEditionSource, parse_oapen_results


def _payload(code="CC-BY", uri="https://creativecommons.org/licenses/by/4.0/"):
    return json.dumps(
        [
            {
                "uuid": "5b2e9a03-dfc2-40de-855a-94f1ea226b49",
                "name": "Media Use in Digital Everyday Life",
                "handle": "20.500.12657/61404",
                "lastModified": "2025-03-18 14:38:11.156",
                "metadata": [
                    {"key": "dc.title", "value": "Media Use in Digital Everyday Life"},
                    {"key": "dc.contributor.author", "value": "Ytre-Arne, Brita"},
                    {"key": "dc.language", "value": "English", "code": "eng"},
                    {"key": "publisher.name", "value": "Emerald Publishing"},
                ],
                "bitstreams": [
                    {
                        "uuid": "2701eb6f-7f54-4914-8493-daed57eaadd8",
                        "name": "9781802623857.epub",
                        "mimeType": "application/epub+zip",
                        "bundleName": "ORIGINAL",
                        "retrieveLink": (
                            "/rest/bitstreams/2701eb6f-7f54-4914-8493-daed57eaadd8/retrieve"
                        ),
                        "checkSum": {
                            "value": "981844836d05d7a11c82bd3fe2483b7b",
                            "checkSumAlgorithm": "MD5",
                        },
                        "code": code,
                        "metadata": [{"key": "dc.rights.uri", "value": uri}],
                    }
                ],
            }
        ]
    ).encode()


def test_oapen_parser_extracts_epub_license_and_checksum():
    records = parse_oapen_results(_payload())

    assert len(records) == 1
    record = records[0]
    assert record.handle == "20.500.12657/61404"
    assert record.authors == ("Ytre-Arne, Brita",)
    assert record.rights_evidence == "cc_by"
    assert record.expected_md5 == "981844836d05d7a11c82bd3fe2483b7b"


def test_oapen_accepts_legacy_http_creative_commons_metadata_without_fetching_it():
    records = parse_oapen_results(
        _payload("CC-BY-SA", "http://creativecommons.org/licenses/by-sa/3.0/")
    )

    assert len(records) == 1
    assert records[0].rights_evidence == "cc_by_sa"
    assert records[0].license_url == "https://creativecommons.org/licenses/by-sa/3.0/"


@pytest.mark.parametrize(
    ("code", "uri"),
    [
        ("CC-BY-NC", "https://creativecommons.org/licenses/by-nc/4.0/"),
        ("CC-BY-ND", "https://creativecommons.org/licenses/by-nd/4.0/"),
        ("All rights reserved", "All rights reserved"),
    ],
)
def test_oapen_parser_rejects_restricted_epub_licenses(code, uri):
    assert parse_oapen_results(_payload(code, uri)) == ()


class StubOapenClient:
    def __init__(self):
        self.calls = 0

    async def search(self, title):
        self.calls += 1
        assert title == "Media Use in Digital Everyday Life"
        return parse_oapen_results(_payload())


@pytest.mark.anyio
async def test_oapen_source_dynamically_matches_and_pins_the_epub_md5():
    client = StubOapenClient()
    source = OapenOpenEditionSource(client, cache_ttl_seconds=60)

    entries = await source.find_all("Media Use in Digital Everyday Life", ["Brita Ytre-Arne"], None)

    assert len(entries) == 1
    entry = entries[0]
    assert entry.entry_id == (
        "oapen:5b2e9a03-dfc2-40de-855a-94f1ea226b49:2701eb6f-7f54-4914-8493-daed57eaadd8"
    )
    assert entry.acquisition_url == (
        "https://library.oapen.org/rest/bitstreams/2701eb6f-7f54-4914-8493-daed57eaadd8/retrieve"
    )
    assert entry.download_policy.expected_md5 == "981844836d05d7a11c82bd3fe2483b7b"
    assert client.calls == 1
