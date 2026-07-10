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

Live searches use a short successful-result cache, respect Open Library's published request rate, and fall back to the remaining provider when one catalog fails. Google Books is enabled only when its API key is configured; that key also enables the separate, strict Google public-domain EPUB resolver.

Fixture mode is for automation only. Its download is explicitly labeled **Deterministic test fixture** and contains no source-book text. For a real end-to-end EPUB demo, use `make backend-run-live` (or the phone-live command below): it downloads one of the reviewed Standard Ebooks editions, checks its pinned SHA-256, inspects the container, runs EPUBCheck, and keeps the verified bytes in memory for a short time. `BOOK_EPUB_ARTIFACT_TTL_SECONDS` controls that window and defaults to 600 seconds.

### Expo Go on a physical iPhone

Keep the Mac and iPhone on the same trusted Wi-Fi network, then run:

```bash
make backend-run-phone
ipconfig getifaddr en0
```

Create `mobile/.env.local` from `mobile/.env.example`, set `EXPO_PUBLIC_API_URL` to the printed LAN address (for example, `http://10.0.0.12:8000`), and restart Expo. The backend listens on all local interfaces only in this explicit phone-development command; do not expose it to an untrusted network.

```bash
cd mobile
pnpm start
```

Scan that Expo QR code on the iPhone while both devices remain on the same network.

The front-cover shutter crops and compresses the photo on the phone, uploads only that bounded crop, and deletes both local temporary files after success, failure, timeout, or cancellation. The backend processes the crop in memory and does not retain it. Barcode scans do not upload a photo.

`make backend-run-phone` uses deterministic demo books. To scan arbitrary ISBNs against live catalogs, use the same `BOOK_CONTACT_EMAIL` and optional `GOOGLE_BOOKS_API_KEY` variables with `make backend-run-phone-live` instead.

For the actual legal-book handoff on a phone, prefer `make backend-run-phone-live`. After a verified result, **Open in Books** and **Save to Files** both open iOS's native share sheet with an EPUB file; the user makes the final Books or Files choice. The app never silently inserts a file into Apple Books. It verifies the downloaded byte length and SHA-256 before handing the file off, and removes its temporary cache copy when the user scans another book.

The app also supports `EXPO_PUBLIC_APP_ENV=hosted` with an HTTPS `EXPO_PUBLIC_API_URL`. The checked-in [render.yaml](./render.yaml) describes a reproducible development deployment for that path. Creating the hosted service is intentionally deferred until a remotely reachable backend is needed.

## Approved source behavior

- **Standard Ebooks** remains the first reviewed source for its curated public-domain/CC0 editions. Each enabled file has a pinned SHA-256 and does not permit redirects.
- **OAPEN** has a reviewed CC BY EPUB path. The backend checks the OAPEN host, the file's pinned SHA-256, the OAPEN-supplied MD5, container safety, and EPUBCheck before delivery. If OAPEN does not authorize a reusable cover, the app deliberately shows a neutral placeholder.
- **DOAB** is treated as a discovery directory, not a file host. Its reviewed record is retained separately from the final OAPEN file so provenance never implies that DOAB served the EPUB.
- **Google Books** is considered only when its API response says `US`, `FULL_PUBLIC_DOMAIN`, `publicDomain: true`, `ALL_PAGES`, and supplies a non-ACS EPUB download. Samples, account-bound downloads, partial views, and non-Google download hosts are rejected. Its download may make one explicitly allowlisted Google-host redirect; the resulting file is still inspected and EPUBCheck-validated.
- **Project Gutenberg** is never scraped from its main website at runtime. Its adapter accepts only a separately configured, reviewed HTTPS mirror/harvest manifest with pinned file hashes, preserving the included Project Gutenberg license. It is intentionally disabled until such a mirror is provisioned.

The resolver automatically selects the highest-priority approved edition. When one approved edition fails before verification, it can try the next distinct reviewed source and records the source sequence in the provenance details. It never expands to a general web search, shadow library, preview, lending source, or arbitrary file host.

## Verification

```bash
make test
make doctor
```

The development-only scenario launcher is controlled by React Native's `__DEV__` flag and is absent from release builds.

Camera framing and focus cannot be validated in iOS Simulator. The automated suite covers the permission, capture-boundary, processing, cancellation, recognition, ambiguity, recovery, and cleanup paths; a short real-camera check in Expo Go is intentionally manual.
