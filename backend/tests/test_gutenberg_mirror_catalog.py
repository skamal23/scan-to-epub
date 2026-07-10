from dataclasses import replace

import pytest

from book_backend.content_sources.gutenberg import (
    GutenbergMirrorEntry,
    ProjectGutenbergMirrorCatalog,
)


def _manifest_entry() -> GutenbergMirrorEntry:
    return GutenbergMirrorEntry(
        ebook_id=1342,
        work_title="Pride and Prejudice",
        aliases=("Pride & Prejudice",),
        authors=("Jane Austen",),
        language="en",
        relative_epub_path="cache/epub/1342/pg1342-images.epub",
        expected_sha256="a" * 64,
    )


def test_gutenberg_uses_only_a_reviewed_mirror_asset_not_the_main_site():
    catalog = ProjectGutenbergMirrorCatalog(
        mirror_base_url="https://mirror.example/project-gutenberg/",
        entries=(_manifest_entry(),),
        reviewed_at="2026-07-10",
    )

    matches = catalog.find_all("Pride & Prejudice", ["Jane Austen"], None)

    assert len(matches) == 1
    entry = matches[0]
    assert entry.source_key == "project_gutenberg"
    assert entry.canonical_url == "https://www.gutenberg.org/ebooks/1342"
    assert entry.acquisition_url == (
        "https://mirror.example/project-gutenberg/cache/epub/1342/pg1342-images.epub"
    )
    assert entry.download_policy.allowed_hosts == frozenset({"mirror.example"})
    assert entry.download_policy.expected_sha256 == "a" * 64
    assert entry.license_name == "Project Gutenberg License"


@pytest.mark.parametrize(
    "base_url",
    ["http://mirror.example/project-gutenberg/", "https://www.gutenberg.org/"],
)
def test_gutenberg_catalog_rejects_an_insecure_or_main_site_download_base(base_url):
    with pytest.raises(ValueError):
        ProjectGutenbergMirrorCatalog(
            mirror_base_url=base_url,
            entries=(_manifest_entry(),),
            reviewed_at="2026-07-10",
        )


def test_gutenberg_catalog_rejects_a_manifest_path_that_escapes_the_reviewed_mirror():
    entry = replace(
        _manifest_entry(),
        relative_epub_path="https://untrusted.example/book.epub",
    )

    with pytest.raises(ValueError):
        ProjectGutenbergMirrorCatalog(
            mirror_base_url="https://mirror.example/project-gutenberg/",
            entries=(entry,),
            reviewed_at="2026-07-10",
        )
