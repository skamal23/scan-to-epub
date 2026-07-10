from book_backend.content_sources.catalog import APPROVED_EPUB_CATALOG


def test_combined_catalog_keeps_standard_ebooks_first_and_includes_oapen():
    standard = APPROVED_EPUB_CATALOG.find_all("Pride and Prejudice", ["Jane Austen"], None)
    oapen = APPROVED_EPUB_CATALOG.find_all(
        "Media Use in Digital Everyday Life",
        ["Brita Ytre-Arne"],
        None,
    )

    assert [entry.source_key for entry in standard] == ["standard_ebooks"]
    assert [entry.source_key for entry in oapen] == ["oapen"]
