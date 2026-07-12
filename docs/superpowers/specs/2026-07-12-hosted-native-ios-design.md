# Hosted Backend and Native iOS Demo Design

## Goal

Run the complete book-scanning demo on a physical iPhone without Expo Go, Metro, LAN access, or a temporary tunnel. The iPhone app will be installed directly from Xcode over USB and will call a publicly reachable HTTPS backend deployed on Render.

## Selected approach

Use the existing Expo application to generate an iOS project with Expo Prebuild, then produce a self-contained native build through Xcode. JavaScript and assets are bundled into the installed app, so it does not require Metro after installation. Deploy the existing FastAPI service as a Docker-based Render web service so its native OCR and EPUB validation dependencies are reproducible.

Alternatives considered were a third-device private network with Expo Go and an EAS/TestFlight build. A private network would retain the current LAN dependency, while EAS/TestFlight adds Expo and Apple distribution-account requirements without removing the need for a hosted backend. Direct Xcode installation is the shortest native route because Xcode is already installed.

## Hosted backend

The Render service will run with `BOOK_FIXTURE_MODE=false` and expose the existing health, metadata, cover-recognition, edition-resolution, and temporary EPUB-delivery endpoints over HTTPS. A Dockerfile will install:

- Python 3.12 and the backend package;
- Tesseract OCR and its runtime data;
- Java;
- EPUBCheck 5.3.0, pinned and placed on `PATH`.

The container will listen on Render's `$PORT`, retain EPUB files only in the existing short-lived in-memory store, and perform live sequential source resolution. The deployment will be treated as a temporary demo service because the API intentionally has no user authentication. It should be suspended or deleted when public testing is finished.

## Native iOS application

The Expo configuration will receive a stable iOS bundle identifier and the final hosted backend URL. Expo Prebuild will generate the `ios/` project. The Release configuration will bundle JavaScript and assets into the application, eliminating Expo Go and Metro at runtime.

The user will connect the iPhone by USB, trust the Mac if prompted, select their Apple development team in Xcode, and approve device signing. Those account/signing screens are the only required manual portion. After Xcode installs the app, it will launch from the iPhone home screen like a normal native app and will require only internet access.

## Runtime flow

1. The installed app opens its native scanner.
2. ISBN or cover data is sent to the hosted HTTPS backend.
3. The backend identifies the work and searches approved sources sequentially.
4. A matching legal EPUB is downloaded, inspected, EPUBCheck-validated, and staged temporarily.
5. The iPhone verifies the delivered file and opens the native share sheet for Books or Files.

No shadow library, unrestricted OCR, silent Books insertion, or native reader is added.

## Security and operational boundaries

- The hosted service accepts only the existing bounded image types and request sizes.
- Source downloads retain the existing HTTPS allowlists, license filters, checksums, container inspection, and EPUBCheck gate.
- API responses remain `no-store`; uploaded cover crops remain memory-only.
- The random hosted URL is not a security boundary. The demo service must be stopped when it is no longer needed.
- Google Books remains optional and requires a separately configured API key.

## Verification

Before device signing:

- build the Docker image locally;
- run its health check and a live source resolution through the container;
- run all backend and mobile tests, linting, formatting, and TypeScript checks;
- generate the iOS project and run an unsigned simulator/native build check;
- verify the hosted health endpoint reports `fixtureMode: false`;
- verify the native app configuration contains the hosted HTTPS URL and no localhost address.

Final device installation and camera testing require the user's connected iPhone and Apple signing approval.
