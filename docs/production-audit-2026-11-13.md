# Book: production readiness audit

Audited November 13, 2026. Repository revision: `088e34519b314c2948c0c57b4fdd428a07bb6cb6`.

This records the original repository before implementation. The subsequent local changes address the reader, library, interface, matching, recovery, and deployment configuration described below. See [the current README](../README.md) for implemented behavior, verification, and remaining release checks; this audit is not a description of the current app.

## Assessment

The repository is a substantial EPUB discovery-and-export prototype. It does not yet implement the requested consumer product: scan a physical book, identify it accurately, obtain an available full-text edition, read inside the app, and resume later offline.

Keep the Expo/React Native application and FastAPI service. Add an established reader and durable local library, repair identification and recovery, and make deployment reproducible. A Swift rewrite or a new EPUB layout engine is not justified by this audit.

The old PLAN.md explicitly excludes a built-in reader and personal library. Those decisions must be replaced before implementation; otherwise the existing plan and acceptance tests continue to target the wrong product.

## What was verified

| Check | Result | Meaning |
|---|---|---|
| Clone | Clean checkout of the revision above | Application source unchanged during audit |
| Mobile tests | 22 suites, 129 tests passed | Existing mocked/component behavior passes |
| TypeScript | Passed | Current mobile code type-checks |
| Peer dependency check | Passed | No reported peer conflicts |
| Backend tests | 250 passed, 6 failed, 2 skipped | Six failures require the absent EPUBCheck executable; two skipped checks require absent Tesseract |
| Backend lint/format | Passed; 77 files formatted correctly | Existing code meets repository checks |
| Expo Doctor | 14/18 checks passed | Three failures stem from missing npm in the audit runtime; one identifies three SDK patch mismatches |
| Live ISBN lookup | 9780141439518 resolved to Pride and Prejudice, with matching returned ISBN | One real barcode-metadata path checked |
| Live Standard Ebooks | The Time Machine discovered and downloaded: 535,571 bytes | A title outside the static fallback; archive inspection passed |
| Live Gutenberg | The Yellow Wallpaper discovered and downloaded: 228,881 bytes | A title outside the static fallback; archive inspection passed |

These are individual observations, not a coverage or latency benchmark. The Standard Ebooks discovery/download/inspection sample took about 17 seconds; Gutenberg took about 0.5 seconds. EPUBCheck was not run on either download because it is unavailable here. Xcode, an iOS Simulator runtime, Java, and Tesseract are also unavailable. No native build, real camera, visual device inspection, or complete scan-to-read test was performed.

Expo Doctor reported installed/expected versions of Expo 54.0.35/~54.0.37, expo-file-system 19.0.23/~19.0.24, and jest-expo 54.0.17/~54.0.18. Align the selected SDK's packages before a native build; these findings do not themselves prove a runtime failure.

## Findings, ordered by impact

### 1. P1 — The requested reading destination does not exist

`mobile/src/state/appState.ts:1` has scanner, search, edition, launch, and scenario states. There is no reader or library. `mobile/App.tsx:219` opens the system share sheet, and `mobile/src/api/epubDeliveryRuntime.ts:48` binds to expo-sharing. Both export intentions lead to that same sheet.

The current app cannot complete “open it and read in the app.” Add a reader route, a local publication record, and an Open book action. Export can become a secondary menu action. Reader failures must preserve the downloaded book and offer retry.

### 2. P1 — Book storage has demo lifetime semantics

`mobile/src/api/epubDelivery.ts:77` writes to a cache filename derived from title/author. `mobile/App.tsx:363` deletes that copy when scanning another book. There is no durable library index or saved reading location. `backend/src/book_backend/epubs/artifacts.py:29` keeps files and download credentials in process memory for a default ten minutes.

Consequences: no reliable offline library, no resume after relaunch, and backend delivery credentials disappear on restart or fail when a download reaches another worker.

Store verified EPUBs in persistent application storage and metadata/reading locators in SQLite. Use a publication ID/content hash rather than title-derived storage identity. Download to a temporary file, verify, then atomically promote it. Add startup reconciliation for missing files and interrupted imports. Persist locators during reading and on backgrounding, rather than saving a screen-dependent page number. Before multiple backend workers, move staged artifacts and token metadata into shared storage.

### 3. P1 — The checked-in hosted setup is a fixture demo

`render.yaml:10` selects development and sets `BOOK_FIXTURE_MODE=true`. Its build command only installs the Python package. It does not provision Tesseract, Java, or EPUBCheck. `backend/src/book_backend/app.py:168` returns healthy without checking these capabilities. `mobile/App.tsx:130` discards the health response's fixture/environment information. `backend/src/book_backend/config.py` also permits production plus fixture mode.

A reachable green health endpoint therefore does not establish that arbitrary-book recognition or real EPUB validation works. Provide a reproducible deployment image with required binaries and locked dependencies; distinguish liveness from capability readiness. Reject fixture mode in production. The release app should reject accidental fixture backends. `mobile/src/config/environment.ts:14` requires a hosted URL but does not enforce HTTPS; enforce it for hosted configuration.

### 4. P1 — Resolution has incompatible time budgets

`mobile/App.tsx:81` gives resolution 35 seconds. `backend/src/book_backend/editions/service.py:134` walks sources sequentially. Individual source requests can take 10–20 seconds; acquisition adds a 15-second HTTP timeout, and EPUBCheck allows 30 seconds plus its version check. Sources can make several requests and try several entries.

Later sources can be unreachable within the client's budget even when they contain a valid book. No overall backend resolution deadline or explicit client-disconnect cancellation governs this pipeline.

First add one bounded end-to-end deadline, per-provider budgets, deduplication of simultaneous identical requests, and caching of verified editions. Measure each stage. If cold lookup/validation cannot fit the interactive budget, return a job ID and expose status and cancellation. Bounded concurrent discovery can follow measurement; unrestricted parallel downloads and validator processes would increase resource pressure.

### 5. P1 — Cover matching can overstate confidence and miss better queries

`backend/src/book_backend/cover/service.py:54` stops after the first OCR query returning any candidates, before scoring whether they are useful. Later title-only or shorter-title queries never run in that case. Candidates found by fallback queries are still scored against `queries[0]`.

At line 262, similarity takes the maximum of sequence similarity and token intersection divided by the smaller token count. A direct normal-input check returned **1.0 for Hamlet versus Hamlet study guide**. This is a heuristic score, not measured recognition accuracy. The visual comparison is a simple difference hash and likewise has no real-photo calibration dataset in the repository.

Collect candidates across a bounded set of queries, retain which query produced each candidate, and rank using title, author, edition evidence, and score separation. Penalize conflicting qualifiers such as workbook, study guide, adaptation, or abridged. Do not automatically accept cover matches until thresholds have been evaluated on held-out photographs. Keep one-tap candidate correction.

### 6. P2 — The framing guide and uploaded crop are not the same region

`mobile/src/scanner/ScannerScreen.tsx:561` lays out a 64%-width guide within the screen. `mobile/src/scanner/coverCapture.ts:42` crops the largest centered 2:3 rectangle from the full photo, without receiving the guide's position or the camera preview transform.

Matching the aspect ratio alone does not match the photographed area. This can include background text and place the intended cover incorrectly in the crop. Map the guide rectangle through preview scaling/orientation to image coordinates, or detect the cover rectangle. Verify with real device framing across supported screen sizes.

### 7. P2 — Recovery and confidence handling need repair

- `mobile/src/screens/ManualSearchFlow.tsx:40` accepts recognitionConfidence but never uses it. High-confidence cover and exact-ISBN paths still require the generic candidate flow.
- `mobile/App.tsx:352` returns from resolution to search without restoring the candidates state. Search remains confirmed and renders `ConfirmedScreen` (`ManualSearchFlow.tsx:290`), which has no action to retry resolution or choose another candidate; its action resets the search.
- `mobile/src/screens/EditionResolutionFlow.tsx:40` and line 50 replace detailed error/unavailable reasons with generic messages. Users cannot distinguish a network outage, failed validation, unsupported conversion, and an identified book with no available edition.
- Metadata provider failures can accompany zero candidates, but the empty state says “No books found.” Cover no-match similarly hides provider failures.

Restore the prior candidate list when backing out, preserve useful search input, and model outcomes explicitly. Once accuracy is measured, exact ISBN matches may proceed automatically, with a visible correction escape. Ambiguous covers should show a short candidate sheet.

### 8. P2 — Generation is implemented but has no live production inputs

`backend/src/book_backend/content_sources/catalog.py:12` and line 16 define empty structured-text and PDF catalogs. The generators are exercised by fixtures, but cannot convert arbitrary discovered source texts in production. This is deliberate, documented scope—not a missing function hidden by tests.

Keep existing EPUB acquisition as the first release path. Expand generation only when a repeatable source adapter supplies complete text, structural information, and appropriate reuse evidence. A cover photograph contains identification information; it cannot supply a book's missing contents. Do not reconstruct a book from model output.

### 9. P2 — Identity is too shallow for broad edition coverage

Resolution accepts work/edition source IDs, but dynamic sources are called with title, authors, and physical ISBN only (`editions/service.py:136`). There is no requested reading language or translator/abridgment constraint in `editions/models.py:17`. Open Library normalization chooses the first embedded edition and first valid ISBN (`metadata/providers.py:94`), rather than explicitly selecting the scanned ISBN from all edition identifiers.

The sampled ISBN lookup was correct; this is an edge-case and generalization risk, not an observed failure rate. Make the chain explicit: scanned physical edition → canonical work → eligible digital edition. Match the observed ISBN directly, preserve canonical work identifiers, and distinguish original work, translation, adaptation, and edition. Present meaningful edition differences before reading.

### 10. P2 — Operational limits and release infrastructure are incomplete

The service has useful per-file size/format boundaries, but lacks application-level admission limits for OCR/validation, global artifact-byte limits, and bounded caches. The generic TTL cache (`content_sources/matching.py:73`) removes expired entries only when their exact key is read; the metadata cache similarly retains distinct expired keys. Each backend process also owns its own provider rate gate.

Add bounded storage/cache eviction, worker concurrency limits, provider-wide request budgets, and request/stage timing with correlation IDs. Run image preparation away from the event loop (`cover/ocr.py:126` prepares it synchronously before entering a thread). Reuse bounded HTTP clients. Test normal bursts and restart recovery before scaling workers.

There is no checked-in CI pipeline or standalone iOS build configuration. `mobile/app.json` lacks an iOS bundle identifier, and no EAS configuration is checked in. Add a reproducible development/release build, CI checks, real EPUB fixtures, and a small scheduled live-provider smoke test. Do not require user accounts merely to supply server-side resource limits.

## Reader choice

| Option | Fit | Recommendation |
|---|---|---|
| Readium via react-native-readium | Existing React Native bridge; local EPUBs, locators, contents, preferences, highlights and search | First integration candidate for this production product |
| Readium Swift Toolkit through a small Expo native module | Direct ownership of iOS integration, more bridge work | Fallback if the existing bridge cannot meet compatibility/accessibility needs |
| epub.js via @epubjs-react-native/core | EPUB rendered inside an in-app WebView; documented Expo integration | Smaller alternative for an initial reading slice, subject to the same acceptance tests |
| FolioReaderKit | Repository archived in 2020 | Do not adopt for a new production app |
| Custom EPUB parser/layout engine | Must maintain pagination, navigation, fonts, images, footnotes, selection and accessibility | Avoid |

Readium Swift uses BSD-3-Clause; the React Native bridge uses MIT. The epub.js React Native wrapper uses MIT and epub.js itself uses BSD. Preserve notices. Treat bridge compatibility with this repository's React Native 0.81/new architecture and chosen Expo SDK as an integration gate, not a verified fact.

A Readium native integration requires a development/standalone build; Expo Go cannot load arbitrary additional native modules. Keep the React Native app shell. Prove the reader first with a local EPUB, saved locator, typography changes, footnotes, offline relaunch, and VoiceOver before connecting downloads. For epub.js, explicitly disable publication scripts: its wrapper documents a different iOS default from upstream epub.js. Apply reader-level network/navigation restrictions as well as archive validation. EPUBCheck conformance is not a substitute for reader isolation.

Sources: [Readium Swift Toolkit](https://github.com/readium/swift-toolkit), [React Native Readium](https://github.com/5-stones/react-native-readium), [epub.js React Native](https://github.com/victorsoares96/epubjs-react-native), [epub.js](https://github.com/futurepress/epub.js), [FolioReaderKit](https://github.com/FolioReader/FolioReaderKit), [Expo native code guidance](https://docs.expo.dev/workflow/customizing/).

## Broad coverage without a handpicked-title product

Live adapters already discover beyond the static fallback. The current chain is Standard Ebooks → Gutenberg → English Wikisource → Unglue.it → OAPEN → optional Google Books. DOAB is represented as discovery provenance/static reviewed records, not a separate live adapter in this chain. Production generation catalogs are empty.

Measure two separate rates: how often the app identifies the scanned work, and how often it can obtain a suitable full-text edition. Broad identification can include modern books even when none of the configured sources offers a downloadable edition. Offer importing a user's EPUB and preserve an identified-but-unavailable book as a distinct outcome. Additional publisher, library, or licensed integrations are separate product work, not another fuzzy-search fallback.

Improve existing sources' candidate recall, canonical IDs, language/edition handling, caching, and failure reporting before adding more adapters. Open Library explicitly describes its API as low-volume and discourages use as a high-traffic backend; plan shared caching and an appropriate data/access arrangement before scale. [Open Library API guidance](https://openlibrary.org/developers/api)

Build a versioned evaluation set with a held-out portion: ordinary and decorative covers, glare, skew, tiny text, duplicate titles, editions, translations, nonfiction, textbooks, and works with no downloadable edition. Track top-1/top-3 identification, incorrect automatic acceptance, download availability conditioned on a correct work match, reader-open success, and p50/p95 stage latency. Save identifiers and outcomes without retaining users' cover photographs by default.

For iOS, evaluate on-device Apple Vision OCR against current Tesseract on that same set. It offers text observations and speed/accuracy controls, but no comparative accuracy improvement was established in this audit. [Apple Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images)

## UI direction

The current code has reusable theme tokens, press feedback, haptics, entrance animations, accessibility announcements, and reduced-motion support. Preserve those. The problem is the product structure: a chain of export/demo screens with no place to keep reading. The palette is static despite the automatic interface-style setting; a complete dark theme is missing. These conclusions are from source inspection, not a device screenshot review.

Use three main destinations: Library, Scan, and Settings. Start first-time users at Scan; return readers to their last book or library.

- **Library:** prominent Continue reading item, restrained cover grid, useful progress, local search, and a clear empty state with Scan and Import EPUB actions.
- **Scan:** full camera, compact instruction, generous shutter, torch where supported, accessible manual search, and a guide matching the real crop. Keep the camera stable while showing a result sheet.
- **Identification:** one concise confirmation sheet when uncertain; title, author, cover, and meaningful edition/language difference. Avoid an extra full-screen confirmation for an exact match once evidence warrants automatic progression.
- **Preparation:** a visible sequence of identifying, finding a copy, and downloading, with real download progress and cancellation. Preserve the recognized book if acquisition fails.
- **Reader:** content fills the screen; a tap reveals back/contents/search/type controls. Provide font size, margins/line spacing, light/sepia/dark themes, bookmarks, and durable reading location. Keep source/license details accessible from book information.
- **Unavailable:** retain the identified title and explain whether no copy is available or a source could not be checked. Offer Retry or Import as appropriate.

Use short sheet transitions, restrained cover-to-reader motion, and a success haptic. Respect Reduce Motion, Dynamic Type, VoiceOver focus, contrast, and large touch targets. Animation is polish after navigation and saved reading work.

## Smallest implementation sequence

1. **Prove reading and persistence.** Adopt the reader; import one local EPUB; persist it and its location; reopen after app termination in airplane mode. Then connect the existing verified download to that same import path. This closes the largest product gap.
2. **Make discovery reliable.** Fix framing, query fallback/scoring, exact ISBN selection, recovery states, deadlines, and production configuration. Establish the held-out evaluation set. Make every existing provider measurable.
3. **Build the consumer UI.** Library/Scan/Settings navigation, compact identification sheets, reader controls, actual dark mode, accessibility, and measured animations. Remove Apple Books from the primary path.
4. **Release and operate.** Reproducible backend image and signed iOS build; CI; TestFlight on physical devices; capacity limits and diagnostics; interruption, offline, and provider-outage tests. Add source adapters and authorized conversion only when coverage measurements justify them.

Ponytail cleanup: extract scan orchestration and acquisition/import lifecycle from the 501-line App.tsx while adding those features; replace loosely coordinated screen/search/export states with clear transitions; share the repeated verify-and-stage portion of acquisition/generation without removing validation. Keep functioning adapters and tests. Defer accounts, sync, social features, a general crawler, speculative source integrations, and a custom rendering engine.

## Acceptance gates

- A new book outside fixture titles can be identified, downloaded, opened in-app, and reopened offline after termination at the same text location.
- Typography changes, chapter navigation, footnotes, and images preserve readable content and usable navigation.
- Uncertain covers do not silently select a different work; the user can correct a match in one step.
- Network failure, cancellation, expired delivery, and invalid files preserve useful state and never erase a saved book.
- Fixture mode cannot enter production; readiness fails when required capabilities are unavailable; restart and multi-worker delivery behavior is tested.
- Native device checks cover permission denial, glare/skew, camera framing, small screens, large text, VoiceOver, Reduce Motion, backgrounding, low storage, and offline resume.

No application source was changed or deployed in this audit. The native UI, camera accuracy, full EPUBCheck path, every live provider, and production capacity remain unverified.
