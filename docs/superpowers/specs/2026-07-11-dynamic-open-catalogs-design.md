# Dynamic Open Catalogs Design

## Goal

Replace the curated five-title Standard Ebooks demo and disabled Gutenberg mirror with live, source-owned catalog discovery that can resolve any matching book exposed by Standard Ebooks or Project Gutenberg, retrieve its EPUB, validate it, and deliver it through the existing Expo flow.

## Source architecture

Each source is an asynchronous catalog adapter behind the existing `DynamicReviewedCatalog` contract. A source receives the confirmed work title and authors, queries its public catalog interface, locally ranks candidates, resolves the source's canonical EPUB link, and returns an `ApprovedEpubEntry`. Results are cached in memory for a short period to reduce repeated source traffic.

Standard Ebooks uses the public `/ebooks?query=` XHTML catalog and each result's canonical book page. The page supplies the exact compatible EPUB link and cover. This avoids a hard-coded title list and does not require the credentialed full OPDS feed.

Project Gutenberg uses its official XML OPDS search and per-book OPDS acquisition feeds, which Project Gutenberg documents for machine-to-machine discovery. It prefers EPUB3 with images, then EPUB with images, then no-images EPUB. Same-host redirects to generated files are allowed. The unchanged Project Gutenberg license remains inside the delivered file.

## Matching

Source search is seeded with the confirmed title. Candidate ranking compares normalized titles and authors, tolerating punctuation, subtitle, diacritic, initials, and Gutenberg's `Family, Given` author ordering. A result must have a strong title match and an author match when authors were supplied; the app does not select a merely popular search result.

## Retrieval and verification

Only HTTPS canonical hosts declared by the adapter are accepted. Dynamic files do not have a pre-known hash; the backend computes SHA-256 after retrieval, runs archive safety checks and EPUBCheck, records the source URL and computed hash, and stages the exact validated bytes for the existing authenticated download endpoint. Static pinned entries remain available as an offline fallback but no longer limit catalog coverage.

## Failure behavior

Source timeouts and malformed feeds are isolated per source. The resolver tries Standard Ebooks first, Project Gutenberg second, then existing approved sources. A source returning no confident match is not an error. If one live source fails but another produces a valid edition, delivery continues. Invalid downloads are rejected and the next candidate/source is attempted.

## Testing

Parser and ranking tests use captured minimal XHTML/OPDS fixtures and must fail before implementation. Integration tests verify source wiring and fallback behavior. Live smoke tests query several titles outside the original five, download real EPUBs from both sources, inspect their containers, and run EPUBCheck. The full backend and mobile suites remain green.

