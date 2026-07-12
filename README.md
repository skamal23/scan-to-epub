# Book to EPUB

An Expo iPhone app and a small FastAPI service for identifying a physical book and delivering a verified legal EPUB. Product rules and implementation gates live in [PLAN.md](./PLAN.md) and [phases.md](./phases.md).

## Runtime

- Node.js 24
- pnpm 11.7
- Python 3.12
- Tesseract 5 for deterministic front-cover OCR
- Java 21 and EPUBCheck 5.3 for EPUB validation
- Xcode with an iOS Simulator runtime

## First setup

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e './backend[dev]'
brew install -y tesseract epubcheck
cd mobile
pnpm install --frozen-lockfile
```

Copy `mobile/.env.example` to `mobile/.env.local` only when a non-default API address is needed. The iOS Simulator uses `http://127.0.0.1:8000` by default.

## Development

Run the backend:

```bash
make backend-run
```

In another terminal, run the Expo app:

```bash
cd mobile
pnpm ios
```

`make backend-run` uses deterministic local book fixtures. To exercise live metadata, set `BOOK_CONTACT_EMAIL` so Open Library can identify the low-volume client, optionally set `GOOGLE_BOOKS_API_KEY`, and run:

```bash
BOOK_CONTACT_EMAIL=you@example.com GOOGLE_BOOKS_API_KEY=optional-key make backend-run-live
```

Live searches use short result caches, respect Open Library's published request rate, and fall back when one catalog fails. EPUB resolution uses a lazy source chain: Standard Ebooks, Project Gutenberg, English Wikisource, Unglue.it, OAPEN, and then optional Google Books. Each source is queried only if every earlier source failed to produce a rights-eligible EPUB that downloads and passes EPUBCheck. The live adapters are not limited to a checked-in title list.

Fixture mode is for automation only. Its unchanged-download fixture is explicitly labeled **Deterministic test fixture** and contains no source-book text. The development-only scenario launcher also provides **Generated test EPUB** and **Generated plain-text EPUB**: both run the real deterministic generation, EPUBCheck, delivery-token, and native export path using purpose-built test text. For a real end-to-end EPUB demo, use `make backend-run-live` (or the phone-live command below): it discovers a matching live-source edition at runtime, downloads the source EPUB, computes its SHA-256, inspects the container, runs EPUBCheck, and keeps the verified bytes in memory for a short time. `BOOK_EPUB_ARTIFACT_TTL_SECONDS` controls that window and defaults to 600 seconds.

### Expo Go on a physical iPhone

Keep the Mac and iPhone on the same trusted Wi-Fi network, then run:

```bash
make backend-run-phone
ipconfig getifaddr en0
```

Create `mobile/.env.local` from `mobile/.env.example`, set `EXPO_PUBLIC_API_URL` to the printed LAN address (for example, `http://10.0.0.12:8000`), and restart Expo. The backend listens on all local interfaces only in this explicit phone-development command; do not expose it to an untrusted network.

The local demo sends no-store, no-referrer, and content-type hardening headers on every response. A hosted public backend must enforce HTTPS at its deployment boundary; do not treat the local Wi-Fi HTTP workflow as a public deployment configuration.

```bash
cd mobile
pnpm start
```

Scan that Expo QR code on the iPhone while both devices remain on the same network.

The front-cover shutter crops and compresses the photo on the phone, uploads only that bounded crop, and deletes both local temporary files after success, failure, timeout, or cancellation. The backend processes the crop in memory and does not retain it. Barcode scans do not upload a photo.

`make backend-run-phone` uses deterministic demo books. To scan arbitrary ISBNs against live catalogs, use the same `BOOK_CONTACT_EMAIL` and optional `GOOGLE_BOOKS_API_KEY` variables with `make backend-run-phone-live` instead.

For the actual legal-book handoff on a phone, prefer `make backend-run-phone-live`. After a verified result, **Open in Books** and **Save to Files** both open iOS's native share sheet with an EPUB file; the user makes the final Books or Files choice. The app never silently inserts a file into Apple Books. It verifies the downloaded byte length and SHA-256 before handing the file off, and removes its temporary cache copy when the user scans another book.

The app also supports `EXPO_PUBLIC_APP_ENV=hosted` with an HTTPS `EXPO_PUBLIC_API_URL`. The checked-in [render.yaml](./render.yaml) describes a reproducible development deployment for that path. Creating the hosted service is intentionally deferred until a remotely reachable backend is needed.

## Open source behavior

- **Standard Ebooks** is the first live source. The backend searches its public XHTML catalog, confirms title and author locally, reads the canonical book page, and selects the compatible EPUB. Results are cached briefly. The five hash-pinned records remain only as network-failure fallbacks and do not limit coverage.
- **Project Gutenberg** is queried through its official OPDS interface. The adapter confirms title and author, accepts only records explicitly marked public domain in the U.S., prefers EPUB3 with images, and follows at most one same-host redirect.
- **English Wikisource** is searched through the MediaWiki API. Complete/exportable works are downloaded through the official WS Export service and delivered only when the export itself passes container inspection and EPUBCheck. Wikisource attribution and CC BY-SA provenance are retained.
- **Unglue.it** uses its no-key ISBN widget/per-work feeds first and its title OPDS feed as fallback. Only Unglue-hosted EPUBs marked Public Domain, CC0, CC BY, or CC BY-SA are eligible; NC and ND licenses are rejected.
- **OAPEN** is queried dynamically through its REST API. Only existing EPUB bitstreams with matching CC0, CC BY, or CC BY-SA metadata are eligible. The backend pins the OAPEN-supplied MD5 and checks the OAPEN host, container safety, and EPUBCheck before delivery.
- **DOAB** is treated as a discovery directory, not a file host. Its reviewed record is retained separately from the final OAPEN file so provenance never implies that DOAB served the EPUB.
- **Google Books** is considered only when its API response says `US`, `FULL_PUBLIC_DOMAIN`, `publicDomain: true`, `ALL_PAGES`, and supplies a non-ACS EPUB download. Samples, account-bound downloads, partial views, and non-Google download hosts are rejected. Its download may make one explicitly allowlisted Google-host redirect; the resulting file is still inspected and EPUBCheck-validated.

The resolver walks this order sequentially and stops immediately after the first verified EPUB. When an existing EPUB cannot be legally delivered or verified, it tries the next distinct edition and then the next source; reviewed structured and PDF snapshots remain final fallbacks. It never expands to a general web search, shadow library, preview, lending source, or arbitrary file host.

## Structured-source generation behavior

An existing reviewed EPUB is always preferred. If no existing EPUB can be legally delivered and verified for the confirmed work, the backend can use a separately reviewed structured-source snapshot and generate an EPUB only when all of these hold:

- The source snapshot is explicitly modeled in the structured catalog with its source URL, retrieval timestamp, rights evidence, format, and pinned SHA-256.
- The rights policy permits a generated EPUB in the U.S. for public domain, CC0, and CC BY with reviewed attribution. CC BY-SA remains fail-closed until the generator can attach and verify an explicit compliant derivative license.
- The source fits the deliberately small supported subset: strict HTML documents/fragments or plain text with explicit `# ` chapter markers. Scripts, remote/embedded images, active elements, malformed markup, unsupported attributes, and ambiguous chapter structure fail closed.
- The generated archive passes container safety inspection, a normalized source/output text-integrity comparison, and EPUBCheck before a short-lived delivery token is issued.

Generated files include a navigation document, source and license notice, a typographic cover, language and accessibility metadata, and provenance for the source retrieval time, conversion time, source hash, final EPUB hash, converter version, and transformation steps. The iOS result explicitly says **Generated open edition** and never describes it as an unchanged download. A source that cannot be safely converted shows an honest refusal and has no export action.

This first generator intentionally does **not** normalize XML/XHTML declarations or reuse source images. Those capabilities require separate structural and rights rules, so such input is refused rather than silently simplified.

The production structured catalog intentionally starts empty: no external HTML or text source is enabled until its exact rights evidence and content snapshot have been reviewed. The two development fixture routes exist solely to exercise this end-to-end path without presenting fixture text as a real book source.

## Guarded PDF conversion behavior

PDF conversion is a separate, stricter fallback. An existing reviewed EPUB and a reviewed structured source are still preferred. A PDF may proceed only from a reviewed, hash-pinned snapshot after the U.S. rights decision has authorized transformation.

- The current gate accepts only unencrypted, consistently sized, text-based PDFs with one stable body left edge, simple prose-only punctuation, and no images, forms/XFA data, tables (including a single tightly spaced borderless row), mathematical notation, footnote markers, or unclassified footer/marginalia.
- It removes only repeated top-of-page running headers and numeric page footers, records every removal, and requires every remaining source line to be accounted for exactly once and in reading order.
- It preserves ordinary line-end hyphens; it removes only an explicit soft hyphen, whose discretionary meaning is unambiguous.
- Every accepted snapshot must also match its reviewed structural-profile hash. Its deterministic HTML output enters the same EPUB safety, text-integrity, EPUBCheck, delivery-token, Books, and Files path as other generated editions.

Complex layouts and scans fail closed with “We found an authorized PDF, but could not safely convert its layout into an EPUB.” They never get a download action. The production PDF catalog also starts empty until each exact PDF snapshot, source URL, source hash, reviewed analysis profile, license, and retrieval timestamp has been reviewed. The development-only PDF scenario uses a purpose-built fixture and is not a source for a real book.

## Verification

```bash
make test
make doctor
```

To repeat live source verification against titles outside the curated fallback, including real downloads, archive inspection, SHA-256, and EPUBCheck:

```bash
.venv/bin/python backend/scripts/live_catalog_smoke.py
```

### Expo Go Simulator golden flow

With the fixture backend (`make backend-run`) and Metro/Expo Go already open in a booted iOS Simulator, run:

```bash
make maestro-golden
```

This is the repeatable app-owned smoke gate for the deterministic scenarios. It intentionally excludes the older flows that tap into the native iOS share sheet, because that sheet is owned by iOS rather than Expo Go and can leave an automation driver waiting. After the gate, use Computer Use or a manual Simulator check to open the generated-PDF scenario, confirm the native share sheet appears, then dismiss it without choosing a destination. Separately, do a short physical-iPhone Expo Go pass for camera permission, framing, focus, barcode detection, and the final Apple Books/Files choice.

### Expo Go Simulator visual gate

Start the fixture backend in one terminal and Metro in another, then make sure the **Book to EPUB** project is already open in Expo Go on a booted iOS Simulator:

```bash
make backend-run
cd mobile && pnpm ios
```

From the repository root, run:

```bash
make maestro-visual
```

This serial gate saves stable screenshots for the camera shell and fallback home, confirmation, ready, long-title, unavailable, Details, and guarded-PDF-refusal states. Each Maestro flow runs in its own process because they share one Simulator. It deliberately never taps into the native iOS share sheet and makes no physical-camera claim. Check camera framing/focus/barcode behavior on a real iPhone in Expo Go, and manually confirm the Apple Books and Files destinations from a ready EPUB after the automated gate.

The development-only scenario launcher is controlled by React Native's `__DEV__` flag and is absent from release builds.

Camera framing and focus cannot be validated in iOS Simulator. The automated suite covers the permission, capture-boundary, processing, cancellation, recognition, ambiguity, recovery, and cleanup paths; a short real-camera check in Expo Go is intentionally manual.
