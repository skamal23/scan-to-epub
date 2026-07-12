from book_backend.app import _live_dynamic_sources
from book_backend.config import Settings
from book_backend.content_sources.google_books import GoogleBooksOpenEditionSource
from book_backend.content_sources.gutenberg import ProjectGutenbergOpenEditionSource
from book_backend.content_sources.oapen_live import OapenOpenEditionSource
from book_backend.content_sources.standard_ebooks import StandardEbooksOpenEditionSource
from book_backend.content_sources.unglue import UnglueOpenEditionSource
from book_backend.content_sources.wikisource import WikisourceOpenEditionSource


def test_live_mode_enables_dynamic_sources_in_legal_quality_order():
    sources = _live_dynamic_sources(
        Settings(environment="development", fixture_mode=False),
        user_agent="BookToEPUB/Test",
    )

    assert [type(source) for source in sources] == [
        StandardEbooksOpenEditionSource,
        ProjectGutenbergOpenEditionSource,
        WikisourceOpenEditionSource,
        UnglueOpenEditionSource,
        OapenOpenEditionSource,
    ]


def test_google_books_remains_the_optional_last_dynamic_source():
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
        WikisourceOpenEditionSource,
        UnglueOpenEditionSource,
        OapenOpenEditionSource,
        GoogleBooksOpenEditionSource,
    ]
