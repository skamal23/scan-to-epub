# Expanded Open-Source Discovery Implementation Plan

1. [x] Replace parallel dynamic discovery with a tested lazy sequential resolver that advances after discovery, acquisition, or validation failure and stops after the first success.
2. [x] Tighten Project Gutenberg parsing so only explicit U.S. public-domain records become approved entries.
3. [x] Add a tested English Wikisource search client and official WS Export EPUB adapter.
4. [x] Add a tested Unglue.it ISBN/OPDS adapter with permissive-license filtering and duplicate-source exclusions.
5. [x] Add a tested OAPEN REST adapter for permissively licensed EPUB bitstreams and checksum-pinned acquisition.
6. [x] Wire sources in the documented order, update operational documentation, and run focused, full backend, mobile, and live source smoke tests.

## Final verification

- `make test`: 258 backend tests and 129 mobile tests passed; Ruff, formatting, TypeScript, and peer checks passed.
- Live downloads passed archive inspection and EPUBCheck 5.3.0 from Standard Ebooks, Project Gutenberg, English Wikisource, Unglue.it, and OAPEN.
- A live full-chain resolution advanced through earlier no-match sources and delivered a checksum-verified OAPEN EPUB.
