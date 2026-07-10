# Physical Book to EPUB — Implementation Phases

> **Implementation rule:** Complete and verify one phase before beginning the next. Each phase delivers a usable vertical slice across the backend and iOS app. Exact files, APIs, libraries, and code-level tasks will be decided when that phase begins.

**Goal:** Build a native iPhone demo that scans a physical book, identifies the work, finds or creates a verified legal EPUB, and lets the user open it in Apple Books or save it to Files.

**Architecture:** A native SwiftUI app performs camera capture, barcode recognition, OCR, local image comparison, confirmation, and export. A small stateless backend normalizes book metadata, applies source and rights rules, acquires or generates EPUBs, validates them, and returns provenance. There are no user accounts and cover photos remain on the phone in the normal path.

**Expected stack:** Native SwiftUI with Apple Vision/VisionKit on iOS; a small Python HTTP service by default because its document-processing ecosystem suits EPUB and PDF work; EPUBCheck on the backend; a reviewed catalog stored in a simple local database or structured data set. Exact package choices remain phase-level decisions.

## Global constraints

- Build a native iPhone app, not a browser app and not an Expo Go prototype.
- Start with a U.S.-only, English-language demo.
- Require no login, account, subscription, or cloud library.
- Export to Apple Books and Files; do not build a native reader in this implementation sequence.
- Do not scan or OCR the pages of a user's physical book.
- Use hybrid scanning: confidence-gated automatic capture plus a manual shutter.
- Keep cover photos on-device in the normal recognition flow.
- Prefer an existing authorized EPUB over generating one.
- Use only allowlisted public-domain or explicitly open-licensed content sources.
- Never use shadow libraries, random file searches, loans, previews, DRM, or physical-book ownership as authorization.
- Never use generative AI to rewrite, repair, modernize, translate, or fill in book text.
- Permit PDF conversion only for rights-cleared, text-based PDFs that pass layout and fidelity gates.
- Require every delivered EPUB to pass EPUBCheck without conformance errors.
- Keep the UI simple and coherent through the functional phases: system typography, neutral colors, one accent, clear cards/sheets, and restrained transitions.
- Defer the cinematic visual system, refined motion, and detailed styling until the app is functionally complete.
- Every phase includes automated tests, live Simulator inspection through Computer Use, and physical-device testing whenever hardware behavior is involved.

## How each phase will be executed

For every phase, we will follow the same completion loop:

1. Re-read this phase and the relevant sections of [PLAN.md](./PLAN.md).
2. Decide the exact code structure and interfaces only for the current phase.
3. Add deterministic test fixtures before relying on live third-party services.
4. Build the backend and iOS work together so the phase ends in a visible user outcome.
5. Run backend tests, Swift tests, contract tests, and UI tests.
6. Build and launch the app in iOS Simulator.
7. Use Computer Use to inspect and interact with the real Simulator UI rather than accepting screenshots from code alone.
8. Run the phase's physical-iPhone test when the feature depends on the camera, Apple Books, actual touch interaction, or device performance.
9. Compare the result with the phase exit gate.
10. Fix failures, record evidence, commit the completed phase, and only then proceed.

The browser is not a substitute for the iOS app. Backend endpoints may be inspected with command-line tools, but the user-facing experience is validated in Simulator and on an iPhone.

## Development and testing setup

Full Xcode is not currently installed on this Mac; only Apple's command-line developer tools and Swift are present. Before Phase 0 can finish, install the latest stable Xcode from the Mac App Store and open it once so it can install the selected iOS platform support.

A free Apple developer account is sufficient to test the app directly on your own iPhone through Xcode. A paid Apple Developer Program membership is only needed when we want TestFlight or App Store distribution. Apple currently documents both the free on-device testing path and the paid TestFlight/distribution path on its [Developer Program page](https://developer.apple.com/programs/).

For physical-device development:

1. Install and open Xcode.
2. Sign in to Xcode with your Apple Account.
3. Connect the iPhone to the Mac and trust the Mac when prompted.
4. Select the phone as the Xcode run destination and use automatic signing.
5. Enable Developer Mode on the iPhone when Xcode prompts for it. Apple documents this under [Enabling Developer Mode](https://developer.apple.com/documentation/Xcode/enabling-developer-mode-on-a-device).
6. Keep Apple Books installed for the export phases.

The Simulator will cover most UI, networking, navigation, error, Files, and accessibility work. It does not emulate the camera, and Apple recommends hardware testing for hardware-specific behavior and real interaction. See [Simulator versus hardware devices](https://developer.apple.com/documentation/xcode/testing-in-simulator-versus-testing-on-hardware-devices). Therefore, camera phases include a deterministic image-fixture path for automation and a separate real-iPhone acceptance test.

If we later want TestFlight, the paid program currently costs $99 annually and provides TestFlight distribution. We can postpone that decision until the release phase; direct Xcode installation on your own device is enough during development.

---

## Phase 0 — Foundation and a running native shell

### Purpose

Establish a real native iOS project, a real backend service, repeatable test commands, and the device-development path before implementing book features.

### Backend work

- Create the backend service with a health endpoint and clear development/test configuration.
- Establish a simple structure for metadata providers, content-source adapters, rights decisions, generated files, and provenance without implementing all of them yet.
- Add a fixture mode so later tests can use deterministic local responses instead of depending on Google Books or Open Library.
- Establish environment handling for third-party API keys without committing secrets.
- Prepare local development and a reproducible HTTPS development deployment that a physical iPhone can reach.
- Add basic request logging that excludes cover photos, personal data, and persistent book-query history.

### iOS work

- Create the native SwiftUI app and its test targets.
- Establish the core navigation/state structure for permission, scanner, processing, confirmation, result, and error screens.
- Implement a simple launch screen with a backend connectivity status and a button that enters a placeholder scanner screen.
- Add environment selection for fixture, local development, and hosted development backends.
- Establish simple reusable visual primitives: primary button, secondary button, book card, status message, loading indicator, and sheet container.
- Keep styling intentionally modest: system font, neutral background, one accent color, no elaborate motion.

### Automated testing

- Backend health and configuration tests.
- iOS app-launch and navigation-state tests.
- A contract test proving the app can decode the backend health response.
- A failure test for backend unavailable/timeout behavior.
- Clean backend test command and clean iOS build/test command.

### Live validation

- Build and launch the app in iOS Simulator.
- Use Computer Use to tap through the launch and placeholder scanner screens and inspect loading, success, and offline states.
- Run the app on your physical iPhone through Xcode and confirm it reaches the hosted development backend.

### What the app looks like at the end

A basic native app launches reliably, shows a minimal connection status, and opens a bare scanner-shaped screen. It does not identify books yet, but the iOS app, backend, tests, Simulator, signing, and physical phone are connected.

### Exit gate

- Backend tests pass.
- iOS unit/UI tests pass.
- The app builds from a clean checkout.
- Computer Use confirms the Simulator flow behaves correctly.
- Your iPhone can launch the development build and reach the backend.

### User involvement

Install Xcode, sign in with an Apple Account, pair the iPhone, enable Developer Mode, and perform the first physical launch. This is the only significant setup blocker currently known.

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
- Swift state tests for loading, results, ambiguity, no result, retry, and cancellation.
- UI tests for manual entry and candidate selection.

### Live validation

- Use Computer Use in Simulator to search by a known ISBN, by title/author, and with an intentionally ambiguous title.
- Inspect long titles, missing covers, provider errors, and offline behavior.
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

- Replace the scanner shell with the actual camera experience.
- Request camera permission with clear purpose copy and provide denied/restricted recovery.
- Detect EAN-13 book barcodes in the scan region.
- Validate ISBN prefix and checksum locally.
- Require a stable repeated observation before automatic capture.
- Keep the manual shutter available as the hybrid fallback.
- Freeze the camera briefly, provide restrained visual/haptic capture feedback, then transition to processing and confirmation.
- Provide a debug/test input that feeds recorded barcode images into the same recognition logic without pretending Simulator has a camera.

### Automated testing

- Valid and invalid EAN-13/ISBN checksum cases.
- Repeated-observation stability and duplicate-capture suppression.
- Permission allowed, denied, and restricted states.
- Recorded barcode-image recognition tests.
- UI tests that inject a recognized ISBN and complete confirmation.
- Backend contract and provider-fallback tests for scanned ISBNs.

### Live validation

- Use Computer Use to verify the permission, scanner, injected-barcode, processing, and confirmation flows in Simulator.
- On your iPhone, scan several real back-cover barcodes at different distances and under different lighting.
- Confirm the app does not capture repeatedly, accepts the manual shutter, and recovers after a failed scan.

### What the app looks like at the end

The app opens into a functional, minimal camera scanner. Holding a valid ISBN barcode inside the guide automatically captures it, performs a real lookup, and asks the user to confirm the book.

### Exit gate

- Every normal-light barcode in the curated Phase 2 set resolves to the correct physical edition.
- Invalid/non-book barcodes do not produce book matches.
- Automatic capture is stable and manual capture remains available.
- Physical-device acceptance passes; Simulator-only evidence is not sufficient.

### User involvement

Hold the books and perform the real camera tests on the iPhone. I can automate and inspect the rest, but I cannot independently point your physical phone at the books.

---

## Phase 3 — Front-cover recognition

### Purpose

Support the more magical but less deterministic path: identify a book from its front cover and involve the user when evidence is uncertain.

### Backend work

- Accept normalized OCR terms rather than a cover photo.
- Generate multiple conservative metadata queries from likely title, author, subtitle, series, and publisher terms.
- Return a small candidate set with enough metadata and permitted cover references for local comparison.
- Extend candidate ranking with textual evidence while leaving cover-image similarity on-device.
- Add fixtures for ornate covers, missing authors, subtitles, series names, duplicate editions, and no useful OCR.

### iOS work

- Detect the likely book/document rectangle in the scan region.
- Gate automatic capture on stable geometry and useful recognized text.
- Capture a high-resolution frame and correct perspective.
- Run accurate on-device OCR and extract likely title/author terms.
- Download the small candidate cover set and compare it locally with the captured cover.
- Combine text and cover evidence into high, medium, and low confidence outcomes.
- Auto-advance only when one candidate clearly wins; otherwise show up to three choices.
- Offer clear recovery: rescan, scan the back barcode, or enter the title manually.
- Delete the captured cover when the session no longer needs it.

### Automated testing

- A growing image corpus containing straight, angled, dim, glossy, partial, ornate, and worn covers.
- OCR normalization and title/author extraction tests.
- Cover-feature comparison tests with known positive and negative editions.
- Confidence and refusal tests so visual similarity alone cannot force a wrong match.
- Privacy tests proving the normal request contains text/ISBN metadata rather than the cover image.
- UI tests for high-confidence, ambiguous, and failed-cover paths.

### Live validation

- Use fixture images in Simulator and Computer Use to inspect the entire confirmation/recovery experience.
- On your iPhone, scan the front of each curated physical book under several lighting and angle conditions.
- Compare the top candidate and confirmation list with the recorded expected work.

### What the app looks like at the end

The same simple camera screen recognizes either the front cover or back barcode. Successful covers flow into confirmation; uncertain covers produce a calm choice or a clear suggestion to scan the back.

### Exit gate

- The correct work is first or within the displayed choices for at least 95% of normal-light captures in the curated set.
- There are no confidently auto-selected wrong works in the release corpus.
- Captured cover images remain local and are cleaned up.
- Real-device cover scanning passes.

### User involvement

Perform the physical cover corpus on the iPhone and report any covers that consistently fail. Those become permanent regression fixtures where licensing permits storing the test image.

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
- On the iPhone, scan one supported public-domain work and one modern unsupported book and confirm that the outcomes differ correctly.

### What the app looks like at the end

A user can scan and confirm a book, then see either a verified legal EPUB result with provenance or a clear unavailable result. The EPUB has been fetched and validated, but the final Apple Books/Files handoff is completed next.

### Exit gate

- No tested rejected license can reach the ready state.
- Every positive result has source, rights, territory, hashes, and EPUBCheck evidence.
- A modern copyrighted negative example stops cleanly.
- The scanned edition and digital edition are never presented as identical unless established.

### User involvement

Review the one-sentence edition-difference explanation and rights-details presentation. Perform one positive and one negative scan on the iPhone.

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
- Add “Save to Files” using the system document picker.
- Use a clean filename based on title and author.
- Return to a stable ready screen if the user cancels either system sheet.
- Clean up temporary files without deleting a file still being shared.
- Handle Apple Books not being available by keeping Files/other compatible apps usable.

### Automated testing

- File-download, hash, cancellation, retry, expiry, and cleanup tests.
- UI tests for ready, downloading, downloaded, sharing, cancelled, saved, and failed states.
- Simulator Files-export test.
- Contract tests proving the delivered file matches the provenance hash.

### Live validation

- Use Computer Use in Simulator to validate download progress, cancellation, Files export, and return-to-ready behavior.
- On your physical iPhone, complete the entire path from scan to opening the EPUB in Apple Books.
- Close and reopen the imported book in Apple Books and confirm navigation/metadata are usable.
- Save the same file to Files and reopen it from Files.

### What the app looks like at the end

This is the first complete functional demo: scan a supported book, confirm it, verify a legal edition, tap Open in Books, choose Books, and read. The UI is still intentionally plain but coherent.

### Exit gate

- The full barcode and front-cover paths can reach Apple Books on a real iPhone.
- Save to Files produces a reusable `.epub` file.
- Cancellation and retry do not require rescanning.
- No invalid or unverified file can reach a share sheet.

### User involvement

Perform the Apple Books import and Files export on your iPhone. This cannot be certified by Simulator because the Simulator lacks the real camera and is not a substitute for the device's Books integration.

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
- On the iPhone, scan representative books resolving through Standard Ebooks, Gutenberg, Google public domain, and OAPEN/DOAB where physical examples are available.

### What the app looks like at the end

The same simple scan flow now works across several trustworthy collections. The user sees one best verified edition, not a noisy list of repositories.

### Exit gate

- Every first-tier source has deterministic fixtures and at least one live smoke test.
- Source outages fall back or produce a retryable error without broadening to unapproved sources.
- All delivered files still carry the same complete rights/provenance evidence.

### User involvement

Help select or obtain representative physical books for the expanded source catalog and perform any source path that cannot be reproduced with an existing book on hand.

---

## Phase 7 — Generate EPUBs from authorized HTML and structured text

### Purpose

Support legal works that lack an existing EPUB but provide clean, rights-cleared HTML, XML, XHTML, or plain text.

### Backend work

- Classify authorized structured sources as eligible or ineligible for generation.
- Build deterministic source-specific cleanup and chapter-detection behavior.
- Preserve wording while normalizing encoding, paragraph breaks, headings, emphasis, poetry, links, footnotes, and permitted images.
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

- Golden fixtures for prose, chapters, poetry, footnotes, images, special characters, and plain text.
- Text-integrity tests comparing normalized source and output.
- EPUBCheck tests for every generated fixture.
- Attribution, license, navigation, accessibility, and cover metadata tests.
- Failure tests for malformed HTML, missing chapters, unsupported images, and ambiguous structure.
- UI tests for generation progress, generated result, and generation refusal.

### Live validation

- Use Computer Use to run a structured-text conversion through the Simulator UI and inspect its result/provenance.
- On the iPhone, open at least two generated EPUBs in Apple Books and inspect chapter navigation, font resizing, links, footnotes, and metadata.

### What the app looks like at the end

If no EPUB exists but a legal structured source does, the user sees a slightly longer “Preparing EPUB” step and then the same ready/export screen, clearly marked as a generated open edition.

### Exit gate

- Generated fixtures preserve all intended text in order.
- Every generated EPUB passes EPUBCheck.
- Generated books open and navigate correctly in Apple Books on a real iPhone.
- No AI-generated content enters the book.

### User involvement

Open and spot-check the generated books in Apple Books, especially chapter navigation and footnotes, because reading feel cannot be proven by unit tests alone.

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
- On the iPhone, import a PDF-derived EPUB into Apple Books and inspect several chapters against the original PDF side by side.
- Confirm a complex or scanned PDF fails without generating a file.

### What the app looks like at the end

A simple legal PDF can become a clean EPUB through the same scan flow. Complex or scanned PDFs produce an honest explanation instead of a low-quality book.

### Exit gate

- Every successful PDF fixture accounts for each body-text block exactly once and in order.
- Every complex/image-only fixture fails closed.
- PDF-derived EPUBs pass EPUBCheck and open correctly in Apple Books.
- The UI never implies that every PDF can be converted.

### User involvement

Perform the side-by-side reading check on a physical iPhone and confirm that rejected complex PDFs fail in a way that feels understandable rather than broken.

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
- Preserve session progress through transient network failures without retaining cover photos longer than necessary.
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
- Performance measurements for capture-to-candidate, confirmation-to-ready, downloads, generation, and conversion.

### Live validation

- Use Computer Use to traverse every screen and failure state in Simulator, including large text and Reduce Motion.
- Test offline/online transitions and slow responses.
- Run the complete golden scenario suite on the physical iPhone: barcode, front cover, ambiguity, unsupported modern book, source outage, HTML generation, PDF conversion, PDF refusal, Apple Books, and Files.
- Check device heat, responsiveness, camera framing, and touch-target comfort.

### What the app looks like at the end

The app is functionally complete. It is intentionally simple rather than visually spectacular, but every component is present, every path is understandable, and the complete product works without hidden developer intervention.

### Exit gate

- All automated suites pass from a clean checkout.
- All PLAN.md golden scenarios pass.
- No known rights/security/privacy failure can deliver a file.
- Accessibility works across the full flow.
- The same build passes Simulator and real-device acceptance.

### User involvement

Run the full physical-device acceptance checklist and identify any confusing copy or interaction before visual polish locks in the presentation.

---

## Phase 10 — Visual design and motion polish

### Purpose

Transform the verified functional beta into the cinematic, modern demo without destabilizing its behavior.

### Backend work

- Expose accurate progress states and timings needed by the polished transitions.
- Optimize slow source-resolution or conversion steps revealed by real-device profiling.
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
- Test real-device motion, haptics, camera legibility, and one-handed touch comfort.
- Have you approve the final visual direction and any iterations.

### What the app looks like at the end

The product now feels intentional and demo-ready: a quiet cinematic scanner, clear confirmation, elegant processing, trustworthy rights messaging, and a satisfying transition into a ready EPUB. The flow is polished without becoming busy.

### Exit gate

- Functional behavior and automated coverage remain intact.
- Visual regression baselines are approved.
- Reduce Motion and accessibility alternatives are equally usable.
- Real-device animation/haptic review passes.
- You approve the presentation for a public demo.

### User involvement

Review and approve visual iterations on the physical iPhone. Simulator screenshots help, but the camera overlay, motion, haptics, and touch feel require the device.

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
- Verify automatic signing and archive the exact release build.
- Install directly through Xcode for personal demo use, or configure App Store Connect/TestFlight if you choose paid membership.
- Prepare a short in-app or external demo script using the curated positive and negative books.

### Automated testing

- Clean release build and full automated suite.
- Contract tests against the deployed backend.
- Fresh-install and upgrade-state tests.
- Release configuration check for secrets, debug flags, fixture routes, logging, and territory.
- Final provenance/hash verification for all curated demo outcomes.

### Live validation

- Use Computer Use to run a clean Simulator release build from first launch through all non-camera golden paths.
- Install the exact release candidate on the iPhone and run the complete physical golden suite.
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
| Native app/backend/test foundation | 0 | 11 |
| Manual ISBN/title fallback | 1 | 9 |
| Candidate normalization and confirmation | 1 | 9 |
| ISBN barcode scanning | 2 | 9 and 11 |
| Hybrid auto/manual capture | 2 | 10 |
| Front-cover OCR and matching | 3 | 9 and 11 |
| Work-versus-edition distinction | 1 and 4 | 9 |
| Rights decision engine | 4 | 9 and 11 |
| Standard Ebooks existing EPUB | 4 | 5 and 11 |
| Apple Books handoff | 5 | 9 and 11 |
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
- Swift unit and UI tests
- Clean builds with Xcode command-line tools
- Simulator launches and interactions
- Computer Use inspection of Xcode and Simulator
- Files export inside Simulator
- Visual regression and accessibility checks
- Live low-volume provider smoke tests
- Backend deployment and health validation when authorized during implementation

### You will be needed for physical-device gates

- Installing Xcode and signing in with your Apple Account
- Pairing your iPhone and enabling Developer Mode
- Holding books in front of the real camera
- Evaluating scan framing, glare, haptics, and touch feel
- Confirming Apple Books import on your device
- Comparing generated/PDF-derived EPUBs with their sources during reading
- Choosing whether to pay for Apple Developer Program membership and use TestFlight
- Approving final visual polish and recording the demo

These handoffs are concentrated at explicit exit gates so they do not interrupt every small implementation step.

## First milestone that proves the idea

Phase 5 is the first major milestone. At that point, the UI is intentionally simple, source coverage is narrow, and EPUB generation has not yet been added—but a real physical book can travel through the entire honest pipeline:

```text
Scan cover or ISBN
→ identify and confirm the work
→ resolve one reviewed legal Standard Ebooks edition
→ validate the EPUB and provenance
→ open it in Apple Books or save it to Files
```

That milestone proves the product before we invest in broader catalogs, document conversion, hardening, or visual polish.
