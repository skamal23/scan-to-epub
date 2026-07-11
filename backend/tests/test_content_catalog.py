from book_backend.content_sources.catalog import (
    APPROVED_EPUB_CATALOG,
    APPROVED_PDF_CATALOG,
    APPROVED_STRUCTURED_CATALOG,
)


def test_combined_catalog_keeps_standard_ebooks_first_and_includes_oapen():
    standard = APPROVED_EPUB_CATALOG.find_all("Pride and Prejudice", ["Jane Austen"], None)
    oapen = APPROVED_EPUB_CATALOG.find_all(
        "Media Use in Digital Everyday Life",
        ["Brita Ytre-Arne"],
        None,
    )

    assert [entry.source_key for entry in standard] == ["standard_ebooks"]
    assert [entry.source_key for entry in oapen] == ["oapen"]


def test_structured_catalog_starts_empty_until_each_source_snapshot_is_reviewed():
    assert APPROVED_STRUCTURED_CATALOG.entries == ()
    assert APPROVED_PDF_CATALOG.entries == ()
