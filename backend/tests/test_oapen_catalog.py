from book_backend.content_sources.oapen import OAPEN_CATALOG


def test_oapen_catalog_uses_an_explicit_cc_by_epub_bitstream_and_no_unlicensed_cover():
    matches = OAPEN_CATALOG.find_all(
        "Media Use in Digital Everyday Life",
        ["Brita Ytre-Arne"],
        None,
    )

    assert len(matches) == 1
    entry = matches[0]
    assert entry.entry_id == "oapen:20.500.12657/61404"
    assert entry.source_organization == "OAPEN"
    assert entry.rights_evidence == "cc_by"
    assert entry.license_name == "CC BY 4.0"
    assert entry.cover_url is None
    assert entry.acquisition_url.startswith("https://library.oapen.org/rest/bitstreams/")
    assert entry.download_policy.allowed_hosts == frozenset({"library.oapen.org"})
    assert entry.download_policy.expected_sha256 == (
        "cae6797fdf63b0a91cd7b6a7a8c5ce0a08405d4778390303c48cf0221859b666"
    )
    assert entry.download_policy.expected_md5 == "981844836d05d7a11c82bd3fe2483b7b"
