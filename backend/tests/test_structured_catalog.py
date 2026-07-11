import hashlib
from datetime import UTC, datetime

from book_backend.content_sources.approved_catalog import (
    ApprovedStructuredCatalog,
    ApprovedStructuredEntry,
)


def _entry(
    *,
    entry_id: str,
    priority: int,
    digital_identifier: str,
    work_title: str = "Structured Open Text",
    authors: tuple[str, ...] = ("Example Author",),
) -> ApprovedStructuredEntry:
    content = b"# First chapter\n\nA reviewed source snapshot."
    return ApprovedStructuredEntry(
        entry_id=entry_id,
        source_key="reviewed_structured_source",
        priority=priority,
        work_title=work_title,
        aliases=("Structured & Open Text",),
        authors=authors,
        digital_title=work_title,
        language="en",
        digital_identifier=digital_identifier,
        publisher="Reviewed publisher",
        source_organization="Reviewed source",
        canonical_url=f"https://catalog.example/{entry_id}",
        source_url=f"https://source.example/{entry_id}.txt",
        cover_url=None,
        content_format="plain_text",
        content=content,
        expected_source_sha256=hashlib.sha256(content).hexdigest(),
        snapshot_retrieved_at=datetime(2026, 7, 10, 17, 0, tzinfo=UTC),
        rights_evidence="cc0",
        license_name="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        rights_statement="The source snapshot is explicitly licensed CC0.",
        attribution=None,
        reviewed_at="2026-07-10",
    )


def test_structured_catalog_returns_distinct_matching_sources_in_priority_order():
    first = _entry(
        entry_id="structured:preferred",
        priority=20,
        digital_identifier="https://source.example/preferred",
    )
    duplicate = _entry(
        entry_id="structured:duplicate",
        priority=30,
        digital_identifier=first.digital_identifier,
    )
    later = _entry(
        entry_id="structured:later",
        priority=40,
        digital_identifier="https://source.example/later",
    )

    matches = ApprovedStructuredCatalog(entries=(later, duplicate, first)).find_all(
        "Structured & Open Text",
        ["Example Author"],
        None,
    )

    assert [entry.entry_id for entry in matches] == ["structured:preferred", "structured:later"]


def test_structured_catalog_requires_title_and_author_evidence():
    catalog = ApprovedStructuredCatalog(
        entries=(
            _entry(
                entry_id="structured:other-author",
                priority=20,
                digital_identifier="https://source.example/other-author",
                authors=("Different Author",),
            ),
        )
    )

    assert catalog.find_all("Structured Open Text", ["Example Author"], None) == ()
