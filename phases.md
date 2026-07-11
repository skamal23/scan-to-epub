# Physical Book to EPUB — Implementation Phases

> **Implementation rule:** Complete and verify one phase before beginning the next. Each phase delivers a usable vertical slice across the backend and iOS app. Exact files, APIs, libraries, and code-level tasks will be decided when that phase begins.

**Goal:** Build an iPhone demo that scans a physical book, identifies the work, finds or creates a verified legal EPUB, and lets the user open it in Apple Books or save it to Files.

**Architecture:** An Expo/React Native iPhone app performs camera capture, barcode recognition, confirmation, download, and export. A small stateless backend performs ephemeral front-cover OCR and comparison, normalizes book metadata, applies source and rights rules, acquires or generates EPUBs, validates them, and returns provenance. There are no user accounts or persistent scan histories; front-cover crops are deleted after each recognition request.

**Expected stack:** Expo with React Native and TypeScript, Expo Camera, Expo FileSystem, and Expo Sharing; Expo Go during the initial functional phases; an Expo development build when native configuration, native modules, stable E2E binaries, or release behavior require it; a small Python HTTP service by default because its image/document ecosystem suits recognition, EPUB, and PDF work; EPUBCheck on the backend; and a reviewed catalog stored in a simple local database or structured data set. Exact package choices remain phase-level decisions.

## Global constraints

- Build a real iPhone app, not a browser app. Expo Go is the initial development runtime, not the distributed product.
- Start with a U.S.-only, English-language demo.
- Require no login, account, subscription, or cloud library.
- Export to Apple Books and Files; do not build a native reader in this implementation sequence.
- Do not scan or OCR the pages of a user's physical book.
- Use hybrid scanning: confidence-gated automatic capture plus a manual shutter.
- Validate barcode observations on-device. Upload only a bounded front-cover crop when cover recognition is requested; exclude it from logs and delete it on success, failure, cancellation, or timeout.
- Prefer an existing authorized EPUB over generating one.
- Use only allowlisted public-domain or explicitly open-licensed content sources.
- Never use shadow libraries, random file searches, loans, previews, DRM, or physical-book ownership as authorization.
- Never use generative AI to rewrite, repair, modernize, translate, or fill in book text.
- Permit PDF conversion only for rights-cleared, text-based PDFs that pass layout and fidelity gates.
- Require every delivered EPUB to pass EPUBCheck without conformance errors.
- Keep the UI simple and coherent through the functional phases: system typography, neutral colors, one accent, clear cards/sheets, and restrained transitions.
- Defer the cinematic visual system, refined motion, and detailed styling until the app is functionally complete.
- Every phase includes automated tests and an extensive live Simulator walkthrough through Computer Use.
- Camera hardware, haptics, performance, and Apple Books acceptance are consolidated into a user-run physical-iPhone pass after the functional and visual phases; they do not block earlier phase completion.

## How each phase will be executed

For every phase, we will follow the same completion loop:

1. Re-read this phase and the relevant sections of [PLAN.md](./PLAN.md).
2. Decide the exact code structure and interfaces only for the current phase.
3. Add deterministic test fixtures before relying on live third-party services.
4. Build the backend and iOS work together so the phase ends in a visible user outcome.
5. Run backend tests, TypeScript tests, component tests, contract tests, and repeatable mobile E2E tests appropriate to the phase.
6. Launch the Expo app in iOS Simulator, using Expo Go until the project moves to its development build.
7. Use Computer Use to inspect and interact with the real Simulator UI: complete the primary path, alternate paths, cancellation, retry, offline/slow states, long content, and the phase's deterministic failure scenarios.
8. Capture evidence for important screens and record any hardware behavior that remains intentionally unverified.
9. Compare the result with the phase exit gate.
10. Fix failures, rerun the automated and Computer Use checks, commit the completed phase, and only then proceed.

The browser is not a substitute for the iOS app. Backend endpoints may be inspected with command-line tools, but the user-facing experience is validated in the actual Expo iOS app inside Simulator. Physical-iPhone validation is a separate final gate.

## Development and testing setup

This Mac now has Xcode 26.6 and the iOS 26.5 Simulator runtime installed. Expo Go is installed in the iPhone 17 Pro Simulator, and the project can be launched there for automated and Computer Use validation.

The phone QR-code workflow remains available independently: the user installs Expo Go on the iPhone and scans the development QR code while the app remains compatible with Expo Go. A physical phone can reach the local backend over trusted Wi-Fi through the documented LAN configuration, or use the checked-in hosted-development configuration when HTTPS access is needed.

A free Apple developer account is sufficient to test the app directly on your own iPhone through Xcode. A paid Apple Developer Program membership is only needed when we want TestFlight or App Store distribution. Apple currently documents both the free on-device testing path and the paid TestFlight/distribution path on its [Developer Program page](https://developer.apple.com/programs/).

For the later physical-device pass:

1. Install and open Xcode.
2. Sign in to Xcode with your Apple Account.
3. Connect the iPhone to the Mac and trust the Mac when prompted.
4. Use Expo Go while the project remains compatible with it, or select the phone as the Xcode run destination and use automatic signing after the project moves to a development build.
5. Enable Developer Mode on the iPhone when Xcode prompts for it. Apple documents this under [Enabling Developer Mode](https://developer.apple.com/documentation/Xcode/enabling-developer-mode-on-a-device).
6. Keep Apple Books installed for the export phases.

The Simulator covers UI, networking, navigation, state transitions, errors, file handling, sharing, accessibility, and nearly the entire backend pipeline. It does not emulate the camera. Therefore, the app includes a development-only scenario launcher that can inject a barcode observation, upload a fixture cover image, and select any later pipeline result while using the same production state and UI code after the camera boundary. [Expo's iOS Simulator guide](https://docs.expo.dev/workflow/ios-simulator/) documents the camera limitation.

Critical golden paths will also receive Maestro E2E coverage against an installable simulator build. Expo documents local and hosted Maestro testing for iOS Simulator builds. [Expo Maestro E2E guide](https://docs.expo.dev/eas/workflows/examples/e2e-tests/)

If we later want TestFlight, the paid program currently costs $99 annually and provides TestFlight distribution. We can postpone that decision until the release phase; direct Xcode installation on your own device is enough during development.

---

## Phase 0 — Foundation and a running Expo shell

### Purpose

Establish a real Expo iOS project, a real backend service, repeatable test commands, Simulator control, and the later device-development path before implementing book features.

### Backend work

- Create the backend service with a health endpoint and clear development/test configuration.
- Establish a simple structure for metadata providers, content-source adapters, rights decisions, generated files, and provenance without implementing all of them yet.
- Add a fixture mode so later tests can use deterministic local responses instead of depending on Google Books or Open Library.
- Establish environment handling for third-party API keys without committing secrets.
- Prepare local development and a reproducible HTTPS development deployment that a physical iPhone can reach.
- Add basic request logging that excludes request bodies, cover photos, personal data, and persistent book-query history.

### iOS work

- Create the Expo/React Native TypeScript app and its test targets, with Expo Go as the initial runtime.
- Establish the core navigation/state structure for permission, scanner, processing, confirmation, result, and error screens.
- Implement a simple launch screen with a backend connectivity status and a button that enters a placeholder scanner screen.
- Add environment selection for fixture, local development, and hosted development backends.
- Establish simple reusable visual primitives: primary button, secondary button, book card, status message, loading indicator, and sheet container.
- Add a development-only scenario launcher with placeholder success, loading, offline, and error states; keep it structurally separate so release builds cannot expose it.
- Keep styling intentionally modest: system font, neutral background, one accent color, no elaborate motion.

### Automated testing

- Backend health and configuration tests.
- TypeScript app-state, app-launch, and navigation tests.
- React Native component tests for the initial screens and reusable primitives.
- A contract test proving the app can decode the backend health response.
- A failure test for backend unavailable/timeout behavior.
- Clean backend, frontend, and simulator-build test commands.

### Live validation

- Build and launch the app in iOS Simulator.
- Use Computer Use to tap through the launch and placeholder scanner screens and inspect loading, success, and offline states.
- Use Computer Use to open the scenario launcher and traverse success, loading, offline, timeout, and retry states.

### What the app looks like at the end

A basic Expo app launches reliably in iOS Simulator, shows a minimal connection status, and opens a bare scanner-shaped screen. It does not identify books yet, but the app, backend, automated tests, scenario harness, Expo runtime, and Computer Use loop are connected.

### Exit gate

- Backend tests pass.
- Frontend unit/component tests pass.
- The app builds from a clean checkout.
- Computer Use confirms the Simulator flow behaves correctly.
- Every Phase 0 scenario can be reached and inspected through Computer Use in Simulator.

### User involvement

Install and open full Xcode with an iOS Simulator runtime. Apple-account sign-in, phone pairing, and Developer Mode can wait until the consolidated physical-device pass.

---

## Phase 1 — Manual book identification and confirmation

### Purpose

Prove metadata lookup, normalized candidates, app/backend contracts, and the confirmation experience before introducing camera uncertainty.

### Backend work

- Integrate Google Books and Open Library for low-volume ISBN/title/author lookup.
- Normalize their different records into one internal representation of works, editions, identifiers, authors, language, dates, publishers, and cover references.
- Deduplicate the same work or edition returned by multiple providers.
- Add conservative candidate ranking for manual ISBN, title, and author input.
- Add fixture responses for success, ambiguity, provider disagreement, empty result, rate limiting, and provider failure.
- Respect provider identification, caching, and rate-limit requirements.

### iOS work

- Replace the placeholder scanner's fallback action with a minimal manual-search form.
- Support ISBN entry and title/author entry.
- Display honest processing stages while the backend searches.
- Show one confident candidate or up to three ambiguous candidates.
- Let the user confirm a work, choose “None of these,” edit the search, or retry.
- Preserve the difference between the physical edition record and the underlying work in app state.

### Automated testing

- Metadata normalization and deduplication tests.
- ISBN formatting and checksum tests.
- Candidate-ranking tests for exact, ambiguous, and conflicting provider data.
- Contract tests using recorded provider fixtures.
- TypeScript state tests for loading, results, ambiguity, no result, retry, and cancellation.
- UI tests for manual entry and candidate selection.

### Live validation

- Use Computer Use in Simulator to search by a known ISBN, by title/author, and with an intentionally ambiguous title.
- Inspect long titles, missing covers, provider errors, and offline behavior.
- Traverse every deterministic candidate outcome through the scenario launcher and verify back, cancel, retry, and “None of these” behavior.
- Run at least one live lookup against each metadata provider without relying on that live response for automated test success.

### What the app looks like at the end

The UI is still plain, but a user can type an ISBN or title, see believable candidate cards, and confirm the correct work. There is no camera recognition or EPUB yet.

### Exit gate

- Known ISBNs resolve to the correct edition in the test set.
- Ambiguous searches do not auto-select the wrong work.
- Provider outages degrade to retry or the remaining provider.
- Candidate confirmation works in Simulator through Computer Use.

### User involvement

Optional review of whether the basic confirmation wording feels understandable. No physical-device-only feature is required in this phase.

---

## Phase 2 — ISBN barcode scanning

### Purpose

Turn the app into a real book scanner using the strongest recognition path: a valid ISBN barcode on the back cover.

### Backend work

- Accept a validated ISBN observation from the app and resolve it through the Phase 1 metadata pipeline.
- Reconcile provider disagreement while preserving the original scanned ISBN.
- Return a confidence outcome that tells the app whether to show one confirmation or multiple candidates.
- Record only minimal operational information needed to diagnose provider failures.

### iOS work

- Replace the scanner shell with the Expo Camera experience.
- Request camera permission with clear purpose copy and provide denied/restricted recovery.
- Detect EAN-13 book barcodes in the scan region.
- Validate ISBN prefix and checksum locally.
- Require a stable repeated observation before automatic capture.
- Keep the manual shutter available as the hybrid fallback.
- Freeze the camera briefly, provide restrained visual/haptic capture feedback, then transition to processing and confirmation.
- Extend the development scenario launcher so it injects valid, invalid, unstable, and repeated ISBN observations at the camera boundary without pretending Simulator has a camera.

### Automated testing

- Valid and invalid EAN-13/ISBN checksum cases.
- Repeated-observation stability and duplicate-capture suppression.
- Permission allowed, denied, and restricted states.
- ISBN-observation and scanner-state tests using recorded payload sequences.
- UI tests that inject a recognized ISBN and complete confirmation.
- Backend contract and provider-fallback tests for scanned ISBNs.

### Live validation

- Use Computer Use to verify the permission, scanner, injected-barcode, processing, and confirmation flows in Simulator.
- Exercise stable success, invalid barcode, repeated capture suppression, cancellation, retry, and permission-recovery scenarios through deterministic inputs.
- Inspect the scanner at small and large simulated phone sizes, over light and dark fixture backgrounds.

### What the app looks like at the end

The app opens into a functional, minimal camera scanner. Holding a valid ISBN barcode inside the guide automatically captures it, performs a real lookup, and asks the user to confirm the book.

### Exit gate

- Every valid injected barcode in the curated Phase 2 fixture set resolves to the correct physical edition.
- Invalid/non-book barcodes do not produce book matches.
- Automatic capture is stable and manual capture remains available.
- Computer Use confirms the complete post-camera barcode flow and every scanner UI state in Simulator.

### User involvement

No required involvement during this phase. Real barcode-camera accuracy is intentionally deferred to the consolidated physical-iPhone pass after the app is functionally complete.

---

## Phase 3 — Front-cover recognition

### Purpose

Support the more magical but less deterministic path: identify a book from its front cover and involve the user when evidence is uncertain.

### Backend work

- Accept a tightly size-limited front-cover crop at a dedicated recognition endpoint.
- Correct perspective where confidence permits, run deterministic OCR, and extract likely title, author, subtitle, series, and publisher terms.
- Generate multiple conservative metadata queries and retrieve a small candidate set with permitted cover references.
- Compare the temporary crop with candidate covers and combine textual, author, language, publication, and image evidence.
- Delete the uploaded image and derived image features on success, failure, cancellation, or timeout; never include them in logs or backups.
- Add fixtures for ornate covers, missing authors, subtitles, series names, duplicate editions, no useful OCR, oversized images, corrupt images, and recognition timeouts.

### iOS work

- Use the scanner guide and manual shutter for front covers while barcode capture remains automatic.
- Capture a high-resolution frame, crop it to the guide, correct orientation, and compress it within the backend's request limit.
- Explain concisely on first use that the cover crop is sent temporarily for identification and not retained.
- Upload the crop with cancellation, timeout, offline, and retry behavior.
- Present the backend's high, medium, and low confidence outcomes without implying certainty the evidence does not support.
- Auto-advance only when one candidate clearly wins; otherwise show up to three choices.
- Offer clear recovery: rescan, scan the back barcode, or enter the title manually.
- Delete the local temporary capture when the request or session no longer needs it.

### Automated testing

- A growing image corpus containing straight, angled, dim, glossy, partial, ornate, and worn covers.
- OCR normalization and title/author extraction tests.
- Cover-feature comparison tests with known positive and negative editions.
- Confidence and refusal tests so visual similarity alone cannot force a wrong match.
- Upload size/type tests and server-side deletion tests for success, failure, cancellation, and timeout.
- Privacy tests proving barcode requests contain no image and cover images appear only in the dedicated ephemeral recognition request.
- UI tests for high-confidence, ambiguous, and failed-cover paths.

### Live validation

- Use fixture images in Simulator and Computer Use to send straight, angled, dim, glossy, partial, ornate, and negative covers through the real recognition endpoint.
- Inspect upload progress, cancellation, timeout, ambiguity, no match, retry, scan-the-back recovery, and manual-search recovery.
- Confirm that local UI state and backend logs contain no retained cover after every completed or interrupted scenario.

### What the app looks like at the end

The same simple camera screen recognizes either the front cover or back barcode. Successful covers flow into confirmation; uncertain covers produce a calm choice or a clear suggestion to scan the back.

### Exit gate

- The correct work is first or within the displayed choices for at least 95% of the curated fixture-cover set.
- There are no confidently auto-selected wrong works in the release corpus.
- Local and backend cover images are cleaned up according to the ephemeral processing contract.
- Computer Use confirms every recognition, confirmation, and recovery state in Simulator.

### User involvement

No required involvement during this phase. Real front-cover framing and camera-image quality are deferred to the consolidated physical-iPhone pass. Failures found there become regression fixtures when storing the image is permitted.

---

## Phase 4 — Rights-aware resolution and the first existing EPUB

### Purpose

Connect confirmed book identity to one verified legal digital edition and show an honest ready/unavailable result. Start narrowly with a reviewed Standard Ebooks catalog.

### Backend work

- Create the first reviewed catalog of approximately 5–10 Standard Ebooks works with known identifiers, canonical URLs, rights evidence, and file hashes.
- Map confirmed physical editions to underlying works and then to approved digital editions.
- Implement the deterministic rights decision outcomes: deliver, generate later, source-only, or reject.
- Enforce the initial U.S. public-domain/CC0/CC BY/CC BY-SA policy and reject unclear, NC, ND, all-rights-reserved, borrowed, preview, and DRM cases.
- Acquire the existing EPUB from the approved source.
- Inspect the container safely, run EPUBCheck, and produce a provenance record.
- Return both a positive verified result and an honest “identified, but no authorized open edition” result.

### iOS work

- Show truthful source-search and validation progress after confirmation.
- Add the minimal ready screen with the authorized digital cover, title, author, source, and “Verified open edition” status.
- Add the explanation that the digital edition may differ from the scanned physical edition.
- Add a provenance/details sheet with source, license, territory, retrieval time, transformation status, and validation result.
- Add the unavailable screen without links to questionable alternatives.
- Keep export buttons visible but disabled or marked as the next phase until file delivery is connected.

### Automated testing

- Table-driven tests for every allow/reject row in the rights policy.
- Work-versus-edition mapping tests.
- Provenance completeness and hash tests.
- Safe-download, wrong-content-type, redirect, malformed ZIP, encrypted EPUB, and EPUBCheck-failure tests.
- Positive Standard Ebooks fixtures and negative copyrighted-book fixtures.
- UI tests for verified, unavailable, validation-failed, and source-offline states.

### Live validation

- Complete recognition in Simulator using fixtures and inspect the ready and unavailable states through Computer Use.
- Perform controlled low-volume live acquisition from Standard Ebooks.
- Use deterministic supported and unsupported observations to confirm that their rights outcomes and recovery choices differ correctly.

### What the app looks like at the end

A user can scan and confirm a book, then see either a verified legal EPUB result with provenance or a clear unavailable result. The EPUB has been fetched and validated, but the final Apple Books/Files handoff is completed next.

### Exit gate

- No tested rejected license can reach the ready state.
- Every positive result has source, rights, territory, hashes, and EPUBCheck evidence.
- A modern copyrighted negative example stops cleanly.
- The scanned edition and digital edition are never presented as identical unless established.

### User involvement

Optional review of the one-sentence edition-difference explanation and rights-details presentation. Physical scans remain deferred.

---

## Phase 5 — Apple Books and Files export: first complete end-to-end demo

### Purpose

Complete the first genuine user journey from physical book to a usable EPUB outside the app.

### Backend work

- Deliver the validated EPUB and provenance through a short-lived, safe result.
- Support retry without rerunning book recognition.
- Clean up temporary files after a defined expiry.
- Ensure filenames and response metadata are safe and stable.
- Keep direct-source versus cached-file behavior compliant with the approved source policy.

### iOS work

- Download the validated EPUB to temporary local storage with progress and cancellation.
- Confirm the file type and expected hash before export.
- Add the real “Open in Books” action using the iOS share workflow and tell the user to choose Books.
- Add “Save to Files” using the iOS share workflow with a concise instruction to choose Save to Files.
- Use a clean filename based on title and author.
- Return to a stable ready screen if the user cancels either share workflow.
- Clean up temporary files without deleting a file still being shared.
- Handle Apple Books not being available by keeping Files/other compatible apps usable.

### Automated testing

- File-download, hash, cancellation, retry, expiry, and cleanup tests.
- UI tests for ready, downloading, downloaded, sharing, cancelled, saved, and failed states.
- Simulator Files-export test.
- Contract tests proving the delivered file matches the provenance hash.

### Live validation

- Use Computer Use in Simulator to validate download progress, cancellation, Files export, and return-to-ready behavior.
- Open the real iOS share sheet from deterministic barcode and cover paths, inspect compatible destinations, cancel it, reopen it, and verify stable return behavior.
- Save the same file to Simulator Files when available and reopen it through the simulated Files workflow.

### What the app looks like at the end

This is the first complete functional demo: scan a supported book, confirm it, verify a legal edition, tap Open in Books, choose Books, and read. The UI is still intentionally plain but coherent.

### Exit gate

- The full deterministic barcode and front-cover paths reach the real iOS share sheet in Simulator.
- Save to Files produces a reusable `.epub` file.
- Cancellation and retry do not require rescanning.
- No invalid or unverified file can reach a share sheet.

### User involvement

No required involvement during this phase. The final Apple Books import and reopen check remains explicitly pending until the consolidated physical-iPhone pass.

---

## Phase 6 — Expand approved sources and fallback behavior

### Purpose

Move beyond the first curated Standard Ebooks slice while keeping one consistent rights and provenance model.

### Backend work

- Add Project Gutenberg through its approved catalog/download behavior.
- Add Google Books acquisition only for U.S. `FULL_PUBLIC_DOMAIN` items with an actual allowed download.
- Add OAPEN and DOAB discovery for explicitly licensed EPUBs and record licensed PDF candidates for the later conversion gate.
- Apply source priority: best existing authorized EPUB first, then other authorized EPUBs, then authorized structured conversion candidates.
- Expand the reviewed catalog toward 25–50 demonstrable works.
- Add source-specific rate limiting, caching rules, redirects, content checks, and outage fallback.
- Deduplicate the same digital edition found through more than one directory.
- Preserve one normalized provenance format across all sources.

### iOS work

- Keep source selection automatic unless the user genuinely benefits from choosing between materially different authorized editions.
- Show the selected source and edition without turning the app into a catalog browser.
- Add graceful progress when one source fails and the resolver tries the next approved source.
- Expand the rights-details sheet for open licenses and attribution.
- Keep the ready/unavailable screens visually unchanged so source expansion does not complicate the user flow.
- Treat a PDF candidate as “conversion support coming in a later phase” internally; do not expose a broken or premature conversion action before Phase 8.

### Automated testing

- Recorded fixtures for every provider and every important response shape.
- Source priority, deduplication, fallback, rate limit, timeout, and broken-link tests.
- Territory and license mismatch tests.
- Google partial/sample/browser-only rejection tests.
- DOAB metadata versus final-file license disagreement tests.
- End-to-end contract tests for one representative result per source.

### Live validation

- Run low-volume real checks against each source outside the automated suite.
- Use Computer Use in Simulator to observe fallback and source-details states.
- Inject representative books resolving through Standard Ebooks, Gutenberg, Google public domain, and OAPEN/DOAB and complete each path through the Simulator UI.

### What the app looks like at the end

The same simple scan flow now works across several trustworthy collections. The user sees one best verified edition, not a noisy list of repositories.

### Exit gate

- Every first-tier source has deterministic fixtures and at least one live smoke test.
- Source outages fall back or produce a retryable error without broadening to unapproved sources.
- All delivered files still carry the same complete rights/provenance evidence.

### User involvement

Optional help selecting representative physical books for the later final demo. All Phase 6 functional acceptance uses deterministic observations and live source smoke tests.

---

## Phase 7 — Generate EPUBs from authorized HTML and structured text

### Purpose

Support legal works that lack a deliverable existing EPUB but provide clean, rights-cleared HTML or plain text.

### Backend work

- Classify authorized structured sources as eligible or ineligible for generation.
- Build deterministic source-specific cleanup and chapter-detection behavior.
- Preserve wording while normalizing encoding, paragraph breaks, headings, emphasis, poetry, links, and footnotes; reject source images and unsupported markup rather than silently simplifying them.
- Create the EPUB package, navigation, metadata, accessibility information, attribution, license notice, and an original typographic cover when necessary.
- Record the original source hash, transformation steps, generated file hash, and converter version.
- Compare source and output text to detect omissions, duplications, reordering, or unintended changes.
- Run EPUBCheck and reject any failing result.

### iOS work

- Show that the app is preparing an EPUB rather than downloading an existing one.
- Show the generated-edition notice and source attribution on the ready screen.
- Reuse the existing Books/Files export flow without introducing a separate product path.
- Add clear failure copy when a structured source cannot be converted safely.

### Automated testing

- Golden fixtures for prose, chapters, poetry, footnotes, special characters, and plain text, plus explicit refusal fixtures for images and unsupported attributes.
- Text-integrity tests comparing normalized source and output.
- EPUBCheck tests for every generated fixture.
- Attribution, license, navigation, accessibility, and cover metadata tests.
- Failure tests for malformed HTML, missing chapters, unsupported images, and ambiguous structure.
- UI tests for generation progress, generated result, and generation refusal.

### Live validation

- Use Computer Use to run a structured-text conversion through the Simulator UI and inspect its result/provenance.
- Exercise at least two generated EPUBs through the Simulator download/share flow and inspect their package, navigation, links, footnotes, metadata, and rendered chapter fixtures.

### What the app looks like at the end

If no EPUB exists but a legal structured source does, the user sees a slightly longer “Preparing EPUB” step and then the same ready/export screen, clearly marked as a generated open edition.

### Exit gate

- Generated fixtures preserve all intended text in order.
- Every generated EPUB passes EPUBCheck.
- Generated books pass deterministic navigation, link, metadata, and share-flow checks; physical Apple Books reading remains pending until Phase 11.
- No AI-generated content enters the book.
- XML/XHTML declaration normalization and source-image reuse remain deferred until they have dedicated structural and per-asset rights rules; the initial generator rejects them safely.

### User involvement

No required involvement during this phase. Physical Apple Books reading quality is part of the consolidated Phase 11 device checklist.

---

## Phase 8 — Guarded PDF-to-EPUB conversion

### Purpose

Convert rights-cleared, text-based PDFs with simple trustworthy structure while failing closed on scans and complex layouts.

### Backend work

- Apply the rights decision before inspecting or converting the PDF.
- Classify the PDF as born-digital/text-based versus image-only/scanned.
- Measure extractable text coverage, character quality, page consistency, and reading-order confidence.
- Reject ambiguous multi-column layouts, dense tables, mathematics, forms, marginalia, image-led books, and unclear footnote relationships.
- Extract text blocks with layout signals and reconstruct structured intermediate HTML.
- Remove only classified running headers, footers, and page numbers.
- Rejoin line-end hyphenation only when evidence is unambiguous.
- Require every body-text block to appear exactly once in expected reading order, with every removal recorded.
- Feed eligible intermediate HTML through the Phase 7 EPUB pipeline and validation.
- Produce a specific refusal reason for ineligible PDFs.

### iOS work

- Show a PDF-analysis stage before promising conversion.
- Continue to the normal generated-edition result when all gates pass.
- Show a respectful refusal such as “We found an authorized PDF, but could not safely convert its layout into an EPUB” when a gate fails.
- Let the user inspect source/provenance without exporting a broken EPUB.
- Keep image-only whole-book OCR outside the demo.

### Automated testing

- Simple single-column born-digital PDF success fixtures.
- Repeated header/footer/page-number removal fixtures.
- Paragraph and line-end hyphenation fixtures.
- Multi-column, tables, math, image-only scans, reordered blocks, duplicated blocks, and missing-block refusal fixtures.
- Rights-denied PDF fixtures that never enter conversion.
- Text-accounting, EPUBCheck, provenance, and generated-file tests.
- UI tests for analysis, conversion, success, and refusal.

### Live validation

- Use Computer Use to exercise a successful PDF and multiple refusal reasons in Simulator.
- Compare several rendered chapters of a successful fixture with its original PDF and inspect refusal behavior for complex and scanned PDFs.
- Confirm through the UI and backend evidence that rejected fixtures never produce a downloadable file.

### What the app looks like at the end

A simple legal PDF can become a clean EPUB through the same scan flow. Complex or scanned PDFs produce an honest explanation instead of a low-quality book.

### Exit gate

- Every successful PDF fixture accounts for each body-text block exactly once and in order.
- Every complex/image-only fixture fails closed.
- PDF-derived EPUBs pass EPUBCheck, deterministic content/render checks, and the Simulator share flow; physical Apple Books reading remains pending until Phase 11.
- The UI never implies that every PDF can be converted.

### User involvement

Optional review of the refusal wording. The physical side-by-side reading check is consolidated into Phase 11.

---

## Phase 9 — Functional hardening, privacy, security, and accessibility

### Purpose

Turn all implemented capabilities into a reliable functional beta before major visual polish begins.

### Backend work

- Enforce HTTPS, source allowlists, redirect rules, request limits, timeouts, download/expanded-size limits, archive path safety, safe XML processing, and temporary-file expiry.
- Add rate limiting and abuse protection without user accounts.
- Ensure logs minimize book-query data and never retain cover photos.
- Add health/diagnostic information that does not expose secrets or user data.
- Make live-provider behavior resilient to rate limits, schema drift, and partial outages.
- Finalize the 25–50-work reviewed demo catalog, including positive, ambiguous, unsupported, and conversion examples.
- Establish repeatable deployment and rollback for the development/demo backend.

### iOS work

- Complete every error/recovery path from PLAN.md: permissions, unreadable cover, invalid ISBN, ambiguity, offline, timeout, source outage, invalid file, conversion refusal, Books unavailable, and cancelled export.
- Preserve session progress through transient network failures while deleting local and backend cover images as soon as recognition no longer needs them.
- Move from stock Expo Go to an Expo development build here if no earlier native requirement triggered the move, so the complete app has its own stable installable runtime before polish.
- Add VoiceOver labels/announcements, Dynamic Type, contrast, Reduce Motion, and non-color status cues.
- Confirm manual search and manual shutter remain available.
- Remove development-only controls from the normal UI while retaining test hooks inside test builds.
- Make the existing plain components consistent across every state.

### Automated testing

- Malicious/oversized file and archive-security suites.
- Network fault, retry, cancellation, timeout, and cleanup suites.
- Privacy tests for requests, logs, storage, and temporary files.
- Full accessibility audit tests and UI automation at large text sizes.
- All required end-to-end scenarios from PLAN.md using deterministic fixtures.
- Maestro golden flows against the installable iOS Simulator development build.
- Performance measurements for capture-to-candidate, confirmation-to-ready, downloads, generation, and conversion.

### Live validation

- Use Computer Use to traverse every screen and failure state in Simulator, including large text and Reduce Motion.
- Test offline/online transitions and slow responses.
- Run the complete deterministic golden scenario suite in Simulator: barcode, front cover, ambiguity, unsupported modern book, source outage, HTML generation, PDF conversion, PDF refusal, sharing, and Files.
- Repeat important paths at multiple simulated phone sizes and capture the baseline screenshots used by the polish phase.

### What the app looks like at the end

The app is functionally complete. It is intentionally simple rather than visually spectacular, but every component is present, every path is understandable, and the complete product works without hidden developer intervention.

### Exit gate

- All automated suites pass from a clean checkout.
- All PLAN.md golden scenarios pass.
- No known rights/security/privacy failure can deliver a file.
- Accessibility works across the full flow.
- The Expo development build passes automated, Maestro, and Computer Use acceptance in Simulator; hardware acceptance is explicitly pending.

### User involvement

Optional review of the functional flow and copy from Simulator screenshots. No physical-device work is required yet.

---

## Phase 10 — Visual design and motion polish

### Purpose

Transform the verified functional beta into the cinematic, modern demo without destabilizing its behavior.

### Backend work

- Expose accurate progress states and timings needed by the polished transitions.
- Optimize slow source-resolution or conversion steps revealed by measured development-build profiling.
- Ensure response payloads contain the authorized digital cover, edition distinction, source, license, and status text needed by the final UI.
- Keep contracts backward-compatible while visual work proceeds.

### iOS work

- Establish the final visual system: typography, spacing, dark camera treatment, materials, cards, iconography, and one restrained status accent.
- Refine adaptive scan guides, focus pulse, stable-detection feedback, capture freeze, processing transition, candidate presentation, and card-to-result motion.
- Add purposeful success/error haptics without overusing them.
- Polish ready, unavailable, provenance, Files, and permission states.
- Preserve Dynamic Type, VoiceOver, Reduce Motion, contrast, and touch targets.
- Avoid decorative elements that resemble generated landing-page UI or obscure the camera.

### Automated testing

- Visual snapshot/regression tests for every screen and important state.
- UI tests with light/dark camera backgrounds, small/large phones, large text, and Reduce Motion.
- Contract tests confirming progress states remain truthful.
- Existing functional suites must remain unchanged and green.

### Live validation

- Use Computer Use to inspect every Simulator screen at multiple device sizes and capture comparison screenshots.
- Slow animations in Simulator to inspect continuity and accidental jumps.
- Exercise light/dark backgrounds, large text, Reduce Motion, long titles, sheets, keyboard states, and every major transition.
- Have you approve the final visual direction from captured Simulator screens and any iterations.

### What the app looks like at the end

The product now feels intentional and demo-ready: a quiet cinematic scanner, clear confirmation, elegant processing, trustworthy rights messaging, and a satisfying transition into a ready EPUB. The flow is polished without becoming busy.

### Exit gate

- Functional behavior and automated coverage remain intact.
- Visual regression baselines are approved.
- Reduce Motion and accessibility alternatives are equally usable.
- All interaction and visual states pass Simulator review; real-device motion and haptics remain pending for Phase 11.
- You approve the presentation for a public demo.

### User involvement

Review and approve the Simulator screenshots and interaction recordings. Physical camera legibility, motion, haptics, and one-handed feel are consolidated into Phase 11.

---

## Phase 11 — Release candidate and demo delivery

### Purpose

Freeze a reproducible build, verify the real deployment, and make the app easy for you to install, demonstrate, and optionally share through TestFlight.

### Backend work

- Deploy the production-like demo service behind HTTPS with health monitoring, backups for reviewed catalog data, rate limits, and rollback.
- Pin the catalog, source-adapter versions, rights rules, converter versions, and EPUBCheck version used by the release.
- Verify source terms, feed access, cover-display behavior, caching behavior, and authorization evidence for every enabled provider.
- Prepare a minimal operational runbook for source outage, credential rotation, deployment failure, and disabling a problematic source.
- Verify that logs and metrics match the documented privacy posture.

### iOS work

- Finalize app identity, icons, camera purpose string, privacy/legal screen, open-source notices, and build configuration.
- Remove debug fixture access from the release UI.
- Produce the standalone signed iOS release candidate from the Expo project and archive the exact build and configuration.
- Install directly as a local development/release build for personal demo use, or configure EAS Build/App Store Connect/TestFlight if you choose paid membership.
- Prepare a short in-app or external demo script using the curated positive and negative books.

### Automated testing

- Clean release build and full automated suite.
- Contract tests against the deployed backend.
- Fresh-install and upgrade-state tests.
- Release configuration check for secrets, debug flags, fixture routes, logging, and territory.
- Final provenance/hash verification for all curated demo outcomes.
- Final Maestro suite against the release-candidate Simulator build.

### Live validation

- Use Computer Use to run a clean Simulator release build from first launch through every deterministic golden path and every important failure/recovery state.
- Install the exact release candidate on the iPhone and have the user run the consolidated physical suite: barcode, cover, focus/torch, haptics, performance, Apple Books import/reopen, Files, and representative generated/PDF-derived EPUB reading checks.
- Rehearse the public demo using the same books, network, backend, and build that will be shown.
- Test one controlled failure so the demo has a graceful recovery if a live source is unavailable.

### What the app looks like at the end

The app is installable, reproducible, backed by the real rights-aware service, and ready to film or demonstrate. A curated book produces the magical success path; a modern unsupported book produces the equally important honest refusal path.

### Exit gate

- The release build and deployed backend pass all automated and live tests.
- The exact physical demo sequence has been rehearsed successfully.
- The user can reinstall the app without development improvisation.
- Source, privacy, legal, and open-source documentation are present.
- If TestFlight is chosen, the build installs and runs through TestFlight before public sharing.

### User involvement

Choose direct Xcode installation or paid TestFlight distribution, run the final device acceptance, and rehearse/record the demo.

---

## Feature coverage matrix

| Product capability | Primary phase | Final verification |
|---|---:|---:|
| Expo app/backend/test foundation | 0 | 11 |
| Manual ISBN/title fallback | 1 | 9 |
| Candidate normalization and confirmation | 1 | 9 |
| ISBN barcode scanning | 2 | 11 physical gate |
| Hybrid auto/manual capture | 2 | 10 |
| Front-cover OCR and matching | 3 | 9 fixtures and 11 physical gate |
| Work-versus-edition distinction | 1 and 4 | 9 |
| Rights decision engine | 4 | 9 and 11 |
| Standard Ebooks existing EPUB | 4 | 5 and 11 |
| Apple Books handoff | 5 | 11 physical gate |
| Save to Files | 5 | 9 and 11 |
| Project Gutenberg | 6 | 9 |
| Google full-public-domain acquisition | 6 | 9 |
| OAPEN/DOAB | 6 | 9 |
| Provenance and license details | 4 and 6 | 9 |
| HTML/structured-text EPUB generation | 7 | 9 and 11 |
| Guarded text-based PDF conversion | 8 | 9 and 11 |
| Image-only/complex PDF refusal | 8 | 9 |
| Privacy and file/network security | 4 through 9 | 11 |
| Error and recovery states | Each relevant phase | 9 |
| Accessibility | Each phase at a basic level | 9 and 10 |
| Final visual design and motion | 10 | 11 |
| Deployment and installable release | 11 | 11 |

## What I can test versus what requires you

### I can perform independently once Xcode is installed

- Backend unit, integration, contract, security, and source-fixture tests
- TypeScript state, React Native component, and app/backend contract tests
- Maestro E2E flows against installable iOS Simulator builds
- Clean Expo Go, Expo development, and release-candidate Simulator launches/builds as each becomes relevant
- Simulator launches and interactions
- Extensive Computer Use inspection and interaction in Simulator after every phase
- Files export inside Simulator
- Visual regression and accessibility checks
- Deterministic barcode, cover upload, ambiguity, source, conversion, sharing, and failure scenarios
- Live low-volume provider smoke tests
- Backend deployment and health validation when authorized during implementation

### You will be needed for setup and the final physical-device gate

- Installing full Xcode with an iOS Simulator runtime so I can perform Computer Use testing
- Later, signing in with your Apple Account, pairing your iPhone, and enabling Developer Mode if the custom build path requires it
- Holding books in front of the real camera
- Evaluating scan framing, glare, haptics, and touch feel
- Confirming Apple Books import on your device
- Comparing generated/PDF-derived EPUBs with their sources during reading
- Choosing whether to pay for Apple Developer Program membership and use TestFlight
- Approving final visual polish and recording the demo

Apart from installing Xcode for Simulator access, these handoffs are concentrated in Phase 11 so they do not interrupt the functional implementation phases.

## First milestone that proves the idea

Phase 5 is the first major milestone. At that point, the UI is intentionally simple, source coverage is narrow, and EPUB generation has not yet been added—but the complete honest pipeline can be exercised in Simulator from a deterministic barcode or cover observation:

```text
Scan cover or ISBN
→ identify and confirm the work
→ resolve one reviewed legal Standard Ebooks edition
→ validate the EPUB and provenance
→ open it in Apple Books or save it to Files
```

After Phase 10, the user repeats this flow with real physical books in the Phase 11 device pass. That final pass validates the camera and Apple Books experience; it does not replace the automated and Computer Use evidence accumulated throughout implementation.

That milestone proves the product before we invest in broader catalogs, document conversion, hardening, or visual polish.
