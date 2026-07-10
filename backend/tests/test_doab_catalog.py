from book_backend.content_sources.catalog import APPROVED_EPUB_CATALOG
from book_backend.content_sources.doab import DOAB_CATALOG, doab_final_epub_rights


def test_doab_record_keeps_directory_and_final_file_provenance_distinct():
    matches = DOAB_CATALOG.find_all(
        "Media Use in Digital Everyday Life",
        ["Brita Ytre-Arne"],
        None,
    )

    assert len(matches) == 1
    entry = matches[0]
    assert entry.source_key == "doab"
    assert entry.canonical_url == "https://directory.doabooks.org/handle/20.500.12854/97704"
    assert entry.acquisition_url.startswith("https://library.oapen.org/rest/bitstreams/")
    assert entry.rights_evidence == "cc_by"
    assert entry.download_policy.expected_md5 == "981844836d05d7a11c82bd3fe2483b7b"


def test_combined_catalog_deduplicates_the_oapen_file_discovered_via_doab():
    matches = APPROVED_EPUB_CATALOG.find_all(
        "Media Use in Digital Everyday Life",
        ["Brita Ytre-Arne"],
        None,
    )

    assert [entry.source_key for entry in matches] == ["oapen"]


def test_doab_final_file_license_wins_over_more_permissive_directory_metadata():
    record = {
        "metadata": [{"key": "dc.rights", "value": "CC-BY"}],
        "bitstreams": [
            {
                "mimeType": "application/epub+zip",
                "code": "CC-BY-NC",
            }
        ],
    }

    assert doab_final_epub_rights(record) is None
