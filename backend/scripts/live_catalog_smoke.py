#!/usr/bin/env python3
import asyncio
from dataclasses import dataclass

from book_backend.content_sources.gutenberg import (
    HttpProjectGutenbergOpdsClient,
    ProjectGutenbergOpenEditionSource,
)
from book_backend.content_sources.standard_ebooks import (
    HttpStandardEbooksClient,
    StandardEbooksOpenEditionSource,
)
from book_backend.editions.acquisition import HttpEpubFetcher, SafeEpubAcquirer
from book_backend.epubs.safety import inspect_epub
from book_backend.epubs.validator import EpubcheckValidator


@dataclass(frozen=True, slots=True)
class SmokeCase:
    source: str
    title: str
    authors: tuple[str, ...]


CASES = (
    SmokeCase("standard_ebooks", "The Time Machine", ("H. G. Wells",)),
    SmokeCase("standard_ebooks", "The Man Who Was Thursday", ("G. K. Chesterton",)),
    SmokeCase("standard_ebooks", "A Room with a View", ("E. M. Forster",)),
    SmokeCase("project_gutenberg", "The Yellow Wallpaper", ("Charlotte Perkins Gilman",)),
    SmokeCase("project_gutenberg", "Alice's Adventures in Wonderland", ("Lewis Carroll",)),
    SmokeCase("project_gutenberg", "The Souls of Black Folk", ("W. E. B. Du Bois",)),
)


async def main() -> None:
    user_agent = "BookToEPUB/0.1 (live catalog verification)"
    sources = {
        "standard_ebooks": StandardEbooksOpenEditionSource(
            HttpStandardEbooksClient(user_agent, timeout_seconds=30),
            cache_ttl_seconds=0,
        ),
        "project_gutenberg": ProjectGutenbergOpenEditionSource(
            HttpProjectGutenbergOpdsClient(user_agent, timeout_seconds=30),
            cache_ttl_seconds=0,
        ),
    }
    acquirer = SafeEpubAcquirer(HttpEpubFetcher(user_agent, timeout_seconds=30))
    validator = EpubcheckValidator()

    for case in CASES:
        entries = await sources[case.source].find_all(
            case.title,
            list(case.authors),
            None,
        )
        if not entries:
            raise RuntimeError(f"{case.source} did not resolve {case.title}")
        entry = entries[0]
        if entry.source_key != case.source:
            raise RuntimeError(f"{case.title} resolved from the wrong source")
        acquired = await acquirer.acquire(entry)
        inspection = inspect_epub(acquired.content)
        validation = await validator.validate(acquired.content)
        if not validation.valid:
            raise RuntimeError(f"EPUBCheck rejected {case.source}: {case.title}")
        print(
            f"PASS {case.source}: {case.title} | {len(acquired.content)} bytes | "
            f"{inspection.package_path} | sha256={acquired.sha256}"
        )


if __name__ == "__main__":
    asyncio.run(main())
