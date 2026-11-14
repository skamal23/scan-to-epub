# Book

Scan a cover or ISBN, confirm the title and author, then automatically find an open edition, save it to the library, and open the in-app reader. Built with Expo for iOS / Expo Go, with a browser preview of the same library and reader.

The UI uses Instrument Sans, white and soft gray surfaces, a floating library bar, a scanning animation, and a lifted book confirmation. After confirmation, the cover stays visible until the first EPUB page is rendered, then a 480 ms fade through white reveals the reader. Reduce Motion skips the fade. The reader provides chapters, bookmarks, full-book search, themes, font size, typeface, line spacing, and saved position.

## Run the browser preview

Requires Node 24, pnpm 11, Python 3.12. Chrome is enough for visual development; Xcode is optional.

```sh
cd mobile
pnpm install --frozen-lockfile
pnpm web
```

Open **http://localhost:8081/?demo=ready**. Demo mode is enabled only in development on the web. Scanning and discovery are simulated; saving, importing, deduplicating, reading, bookmarks, and reading position use the real implementation and a complete Project Gutenberg EPUB. The screen labels this mode. It cannot select fake services in a release build or Expo Go.

The ready demo uses bundled cover art and in-memory book matches (120 ms), so recognition does not wait on a catalog. The 760 ms cover lift and background fade run alongside recognition. Reduce Motion skips the transform. EPUB saving and reading remain real.

Other query values: `barcode`, `ambiguous`, `no-match`, `permission`, `offline`, `unavailable`, `download-error`, `long-title`. Remove `?demo=…` for live services. Browser data lives in IndexedDB; clearing site data removes it.

## Run live discovery

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -c backend/constraints.txt -e './backend[dev]'
brew install tesseract epubcheck
make backend-run-live
```

`GET /health` checks the process. `GET /ready` also checks OCR and EPUBCheck. Live discovery requires both tools. Optional `GOOGLE_BOOKS_API_KEY` adds Google Books; `BOOK_CONTACT_EMAIL` identifies requests to catalogs.

The app uses `http://127.0.0.1:8000` by default. `mobile/.env.local` can override `EXPO_PUBLIC_API_URL`. Hosted mode (`EXPO_PUBLIC_APP_ENV=hosted`) requires HTTPS. The backend allows browser requests only from `BOOK_CORS_ORIGINS` (comma-separated; localhost:8081 by default).

## Expo Go on an iPhone

Install the Expo Go version supporting SDK 58. On the Mac run `make backend-run-phone-live`. Connect both devices to the same Wi-Fi, find the Mac's address with `ipconfig getifaddr en0`, and set:

```dotenv
EXPO_PUBLIC_APP_ENV=local
EXPO_PUBLIC_API_URL=http://YOUR_MAC_LAN_IP:8000
```

Save that in `mobile/.env.local`, restart `pnpm start`, and scan Expo's QR code. No custom native module is required: epub.js runs in the Expo Go WebView with React Native reader controls. Barcode recognition is local; a cropped cover image is sent to the service and discarded. Scanning has a manual title/author/ISBN fallback.

On iOS, EPUB files live in the app's document directory and metadata/preferences in SQLite. Books remain available offline. Imported duplicates retain their bookmarks and position. Removing a book requires confirmation. Files protected by DRM, active/remote content, or exceeding 25 MB are refused with a recovery message.

## Coverage and edition accuracy

Identification searches Open Library and optionally Google Books. Discovery searches Standard Ebooks, Project Gutenberg, English Wikisource, Unglue.it, and OAPEN dynamically; it is not limited to the reviewed fallback books. Sources must establish eligible public-domain or open-license access. The app asks for confirmation before acquisition and distinguishes the physical publication from the available reading edition.

Coverage is broad, not universal. Most commercially copyrighted books have no freely distributable full EPUB. Those books receive an honest unavailable result and an import option. Current source eligibility is U.S.-based; source language must match the requested language. Cover OCR currently has English language data. Title search accepts Unicode. OCR accuracy still depends on lighting, print, and framing.

Existing deterministic EPUB generation from approved structured text / suitable text PDFs remains in the service. Its reviewed live conversion catalogs are empty: it does not invent a book's text or turn a cover into a full book. EPUB delivery requires container validation, EPUBCheck, byte length, and SHA-256 verification.

## Checks

```sh
make test
cd mobile
pnpm test:e2e
E2E_LIVE=1 pnpm test:e2e   # also requires the backend and internet
pnpm exec expo export --platform ios --output-dir dist-ios
```

Browser tests exercise the full reading journey, visible chapter navigation, search, preferences, bookmarks, refresh/resume, offline reading, removal, import, deduplication, ambiguity, permission denial, cancellation, and failure states. Tests use Chrome by default; set `PLAYWRIGHT_CHANNEL=chromium` after `pnpm exec playwright install chromium` to use bundled Chromium. Screenshots and traces go to `mobile/test-results`.

Before release, verify real iPhone camera framing/autofocus, barcode recognition, haptics, document picker, WebView pagination, VoiceOver, large text, background/foreground, and relaunch in airplane mode. Browser tests do not establish those hardware behaviors.

## Hosting

`backend/Dockerfile` includes OCR, a checksum-pinned EPUBCheck 5.3.0, and constrained Python dependencies. `render.yaml` uses live production mode, `/ready`, and a persistent disk for expiring downloads. Production rejects fixture mode. SQLite deliveries survive process restarts, expire after ten minutes, hash their credentials at rest, and have a 500 MB capacity limit. Resolution and OCR have deadlines and concurrency limits; provider caches are bounded.

This configuration targets one service instance. Before horizontal scaling, move delivery storage and provider request budgets to shared infrastructure; deploy behind HTTPS and apply an edge rate limit. Configure the contact email, browser origins, monitoring, and backups for the chosen host. The repository does not contain a deployed endpoint or signing credentials.

## Third-party notices

The bundled reader is epub.js (BSD-2-Clause) and JSZip (MIT/GPL dual license, used under MIT); license files are in `mobile/src/reader/vendor`. `pnpm install` regenerates the browser engine from the locked packages, with no CDN dependency. Instrument Sans is under the SIL Open Font License. The browser demo EPUB is an unchanged Project Gutenberg file with its full license retained; see `mobile/public/demo/README.txt`.

The original audit is in `docs/production-audit-2026-11-13.md`. `PLAN.md`, `phases.md`, and older design documents describe the superseded export-only demo; this README describes the current app.

Standalone builds have `preview` and `production` profiles in `mobile/eas.json`. Set `EXPO_PUBLIC_API_URL` to the deployed HTTPS service in the matching EAS environment before building. Apple signing, App Store privacy disclosures, and device acceptance are release steps, not part of browser verification.

### Interface references

The interface uses native React Native adaptations of these 21st.dev patterns:

- [3D Card Effect](https://21st.dev/@manuarora700/components/3d-card-effect): perspective, layered page edges, and a shared cover position through scan and confirmation.
- [Floating Dock](https://21st.dev/@manuarora700/components/floating-dock) and [Animated Tabs](https://21st.dev/@manuarora700/components/tabs): a restrained floating navigation bar and moving selection indicators.
- [Interactive Hover Button](https://21st.dev/@dillionverma/components/interactive-hover-button): subtle pointer/press feedback, translated to touch controls.
- [Skeleton](https://21st.dev/@shadcn/components/skeleton): placeholders matching the content, with a quiet shimmer.

These are original native implementations of the visual patterns, not imports of their DOM/Tailwind source. No new animation dependencies or web-only UI are needed. Motion respects Reduce Motion, controls retain readable labels and minimum touch areas, and secondary actions have less visual emphasis. References: [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/), [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion), and [2025 Design Awards](https://developer.apple.com/design/awards/2025/) (CapWords, iA Writer, Mela).
