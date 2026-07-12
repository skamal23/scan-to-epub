from book_backend.app import _live_dynamic_sources
from book_backend.config import Settings
from book_backend.content_sources.google_books import GoogleBooksOpenEditionSource
from book_backend.content_sources.gutenberg import ProjectGutenbergOpenEditionSource
from book_backend.content_sources.standard_ebooks import StandardEbooksOpenEditionSource


def test_live_mode_always_enables_standard_ebooks_and_project_gutenberg():
    sources = _live_dynamic_sources(
        Settings(environment="development", fixture_mode=False),
        user_agent="BookToEPUB/Test",
    )

    assert [type(source) for source in sources] == [
        StandardEbooksOpenEditionSource,
        ProjectGutenbergOpenEditionSource,
    ]


def test_google_books_remains_an_optional_third_dynamic_source():
    sources = _live_dynamic_sources(
        Settings(
            environment="development",
            fixture_mode=False,
            google_books_api_key="test-key",
        ),
        user_agent="BookToEPUB/Test",
    )

    assert [type(source) for source in sources] == [
        StandardEbooksOpenEditionSource,
        ProjectGutenbergOpenEditionSource,
        GoogleBooksOpenEditionSource,
    ]
