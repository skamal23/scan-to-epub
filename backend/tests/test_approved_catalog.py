from book_backend.content_sources.approved_catalog import (
    ApprovedEpubCatalog,
    ApprovedEpubEntry,
    EpubDownloadPolicy,
)


def _entry(
    *,
    entry_id: str,
    source_key: str,
    priority: int,
    digital_identifier: str,
    work_title: str = "Pride and Prejudice",
    authors: tuple[str, ...] = ("Jane Austen",),
) -> ApprovedEpubEntry:
    return ApprovedEpubEntry(
        entry_id=entry_id,
        source_key=source_key,
        priority=priority,
        work_title=work_title,
        aliases=("Pride & Prejudice",),
        authors=authors,
        digital_title=work_title,
        language="en",
        digital_identifier=digital_identifier,
        publisher="Reviewed publisher",
        source_organization="Reviewed source",
        canonical_url=f"https://catalog.example/{entry_id}",
        acquisition_url=f"https://files.example/{entry_id}.epub",
        cover_url="https://covers.example/cover.jpg",
        rights_evidence="us_public_domain",
        license_name="Public domain (U.S.)",
        license_url="https://example.com/rights",
        rights_statement="Rights evidence was reviewed.",
        attribution=None,
        reviewed_at="2026-07-10",
        download_policy=EpubDownloadPolicy(
            allowed_hosts=frozenset({"files.example"}),
            expected_sha256="a" * 64,
        ),
    )


def test_catalog_returns_distinct_matching_editions_in_source_priority_order():
    standard = _entry(
        entry_id="standard:pride",
        source_key="standard_ebooks",
        priority=10,
        digital_identifier="https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice",
    )
    duplicate_directory_record = _entry(
        entry_id="doab:pride",
        source_key="doab",
        priority=50,
        digital_identifier=standard.digital_identifier,
    )
    oapen = _entry(
        entry_id="oapen:pride",
        source_key="oapen",
        priority=40,
        digital_identifier="https://library.oapen.org/handle/open-edition",
    )
    catalog = ApprovedEpubCatalog(entries=(oapen, duplicate_directory_record, standard))

    matches = catalog.find_all(
        title="Pride & Prejudice",
        authors=["Jane Austen"],
        physical_isbn13="9780141439518",
    )

    assert [entry.entry_id for entry in matches] == ["standard:pride", "oapen:pride"]


def test_catalog_requires_both_work_title_and_author_evidence():
    catalog = ApprovedEpubCatalog(
        entries=(
            _entry(
                entry_id="standard:invisible-man",
                source_key="standard_ebooks",
                priority=10,
                digital_identifier="https://standardebooks.org/ebooks/h-g-wells/the-invisible-man",
                work_title="The Invisible Man",
                authors=("H. G. Wells",),
            ),
        )
    )

    assert catalog.find_all("Invisible Man", ["Ralph Ellison"], None) == ()
