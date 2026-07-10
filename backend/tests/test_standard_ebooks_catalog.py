from book_backend.content_sources.standard_ebooks import STANDARD_EBOOKS_CATALOG


def test_reviewed_catalog_has_five_pinned_unique_entries():
    assert len(STANDARD_EBOOKS_CATALOG.entries) == 5
    assert len({entry.entry_id for entry in STANDARD_EBOOKS_CATALOG.entries}) == 5
    assert all(len(entry.expected_sha256) == 64 for entry in STANDARD_EBOOKS_CATALOG.entries)
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
