# Dynamic Open Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dynamically discover and deliver matching EPUBs from the complete Standard Ebooks and Project Gutenberg catalogs.

**Architecture:** Add two async catalog adapters using each publisher's public catalog pages/feeds, with strict local matching, short-lived caches, canonical download policies, and existing EPUB validation/delivery. Wire both adapters into every live backend instance ahead of optional Google Books.

**Tech Stack:** Python 3.12, FastAPI, httpx, defusedxml, pytest, EPUBCheck, Expo/React Native.

## Global Constraints

- Preserve the existing camera, confirmation, and native-share user flow.
- Discover titles at runtime; no source may be limited to a checked-in title list.
- Fetch only HTTPS URLs parsed from source-owned catalog responses.
- Validate every delivered EPUB with archive inspection, SHA-256, and EPUBCheck.
- Use test-first red-green cycles and run live multi-title smoke checks.

---

### Task 1: Shared dynamic matching and cache behavior

**Files:**
- Create: `backend/src/book_backend/content_sources/matching.py`
- Test: `backend/tests/test_dynamic_source_matching.py`

**Interfaces:**
- Produces `title_match_score(query: str, candidate: str) -> float`, `authors_match(query: list[str], candidate: tuple[str, ...]) -> bool`, and a monotonic TTL cache used by both source adapters.

- [x] Write failing tests for punctuation, subtitles, initials, diacritics, and Gutenberg author order.
- [x] Run the focused test and confirm it fails because the module is absent.
- [x] Implement normalization, scoring, and caching.
- [x] Run the focused tests and confirm they pass.

### Task 2: Dynamic Standard Ebooks adapter

**Files:**
- Modify: `backend/src/book_backend/content_sources/standard_ebooks.py`
- Replace: `backend/tests/test_standard_ebooks_catalog.py`

**Interfaces:**
- Produces `HttpStandardEbooksClient` and `StandardEbooksOpenEditionSource.find_all(...)` implementing `DynamicReviewedCatalog`.

- [x] Write failing parser/source tests using XHTML search and book-page fixtures.
- [x] Confirm tests fail for missing dynamic classes.
- [x] Implement source search, confident local matching, canonical detail parsing, compatible EPUB selection, cover extraction, and TTL caching.
- [x] Confirm the focused tests pass.

### Task 3: Dynamic Project Gutenberg adapter

**Files:**
- Modify: `backend/src/book_backend/content_sources/gutenberg.py`
- Replace: `backend/tests/test_gutenberg_mirror_catalog.py`

**Interfaces:**
- Produces `HttpProjectGutenbergOpdsClient` and `ProjectGutenbergOpenEditionSource.find_all(...)` implementing `DynamicReviewedCatalog`.

- [x] Write failing OPDS search/detail tests covering EPUB3, image, and no-image preference plus rights metadata and redirects.
- [x] Confirm tests fail for missing dynamic classes.
- [x] Implement OPDS parsing, ranking, per-book acquisition lookup, and TTL caching.
- [x] Confirm the focused tests pass.

### Task 4: Live app wiring and fallback behavior

**Files:**
- Modify: `backend/src/book_backend/app.py`
- Modify: `backend/src/book_backend/rights/policy.py`
- Test: `backend/tests/test_edition_api.py`
- Test: `backend/tests/test_rights_policy.py`

**Interfaces:**
- Live `create_app` supplies Standard Ebooks and Project Gutenberg sources unconditionally, with optional Google Books after them.

- [x] Write failing tests for default live-source wiring and unchanged Project Gutenberg delivery rights.
- [x] Confirm focused failures.
- [x] Wire adapters and add an explicit source-authorized unchanged-distribution rights class.
- [x] Confirm focused tests pass.

### Task 5: Live retrieval and complete verification

**Files:**
- Create: `backend/scripts/live_catalog_smoke.py`
- Modify: `README.md`

**Interfaces:**
- Smoke script resolves multiple titles beyond the original curated set from both sources, downloads the returned EPUBs, checks source identity, archive safety, and EPUBCheck.

- [x] Add deterministic tests for source parsing, matching, caching, and runtime wiring.
- [x] Run live discovery and download checks for varied titles from each source.
- [x] Run the complete backend test/lint/format gate.
- [x] Run the mobile test/typecheck/peer gate.
- [x] Update README source behavior and phone-live instructions.
- [x] Audit every goal requirement against fresh command output.
