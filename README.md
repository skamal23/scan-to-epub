# Book to EPUB

An Expo iPhone app and a small FastAPI service for identifying a physical book and delivering a verified legal EPUB. Product rules and implementation gates live in [PLAN.md](./PLAN.md) and [phases.md](./phases.md).

## Runtime

- Node.js 24
- pnpm 11.7
- Python 3.12
- Tesseract 5 for deterministic front-cover OCR
- Java 21 for EPUBCheck in later phases
- Xcode with an iOS Simulator runtime

## First setup

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e './backend[dev]'
brew install -y tesseract
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

Live searches use a short successful-result cache, respect Open Library's published request rate, and fall back to the remaining provider when one catalog fails. Google Books is enabled only when its API key is configured.

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

The app also supports `EXPO_PUBLIC_APP_ENV=hosted` with an HTTPS `EXPO_PUBLIC_API_URL`. The checked-in [render.yaml](./render.yaml) describes a reproducible development deployment for that path. Creating the hosted service is intentionally deferred until a remotely reachable backend is needed.

## Verification

```bash
make test
make doctor
```

The development-only scenario launcher is controlled by React Native's `__DEV__` flag and is absent from release builds.

Camera framing and focus cannot be validated in iOS Simulator. The automated suite covers the permission, capture-boundary, processing, cancellation, recognition, ambiguity, recovery, and cleanup paths; a short real-camera check in Expo Go is intentionally manual.
