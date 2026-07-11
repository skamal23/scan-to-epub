# Expo Go Functional Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Expo Go demo more resilient, privacy-preserving, and screen-reader understandable without changing the legal-content boundary or requiring a development build.

**Architecture:** Keep the present FastAPI service and Expo/React Native app. The backend gains small request-boundary protections that are safe for local Expo Go/LAN development; the app gains a reusable accessibility announcement primitive and explicit semantics for stateful screens. Existing fixture scenarios remain the deterministic E2E contract.

**Tech Stack:** FastAPI, Python 3.12, pytest/httpx, Expo SDK/React Native/TypeScript, Jest, Maestro, iOS Simulator, Expo Go.

## Global Constraints

- Keep Expo Go as the supported runtime; do not create a development build or change the phone QR workflow.
- Continue to allow local HTTP only for the explicit `development`, `fixture`, and `test` workflows documented in the README; do not expose a local backend to an untrusted network.
- Do not add authentication, user accounts, persistent histories, analytics, cover-image storage, or external deployment work.
- Do not log request bodies, cover image bytes, ISBN/title query values, download credentials, or source URLs with query data.
- Preserve the legal allowlist, rights decision before generation/acquisition, EPUB/PDF safety gates, EPUBCheck, and the final user-controlled iOS share sheet.
- Do not automate real camera behavior; Simulator coverage begins after the camera boundary and physical Expo Go checks remain manual.
- Retain the current simple visual system; visual/motion redesign belongs to Phase 10.

---

### Task 1: Harden the public request boundary without breaking Expo Go development

**Files:**

- Modify: `backend/src/book_backend/app.py`
- Create: `backend/tests/test_request_boundary.py`
- Modify: `Makefile`
- Modify: `render.yaml`
- Modify: `README.md`

**Interfaces:**

- Consumes: `create_app(Settings(...))` from `book_backend.app` and the existing `/health` and `/covers/recognize` routes.
- Produces: privacy-safe response headers on every route, an internally generated request identifier, deterministic 400/413 cover-upload failures rather than unhandled parsing errors, and launch commands that do not let Uvicorn log request targets.

- [x] **Step 1: Write the failing request-boundary tests**

```python
@pytest.mark.anyio
async def test_response_uses_a_server_generated_request_id_and_privacy_headers():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health", headers={"X-Request-ID": "untrusted-value"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] != "untrusted-value"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.anyio
async def test_cover_route_rejects_a_malformed_content_length_without_reading_a_body():
    app = create_app(Settings(environment="test", fixture_mode=True))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/covers/recognize",
            content=b"not-read",
            headers={"content-type": "image/jpeg", "content-length": "not-a-number"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cover size could not be read"


@pytest.mark.anyio
@pytest.mark.parametrize("content_length", ["+1", "-0", ""])
async def test_cover_route_accepts_only_ascii_decimal_content_length(content_length: str):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url="http://test") as client:
        response = await client.post(
            "/covers/recognize",
            content=b"not-read",
            headers={"content-type": "image/jpeg", "content-length": content_length},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Cover size could not be read"


def test_backend_launch_commands_disable_uvicorn_access_logging():
    workspace = Path(__file__).parents[2]
    assert (workspace / "Makefile").read_text().count("--no-access-log") == 4
    assert "startCommand: uvicorn book_backend.app:app --no-access-log" in (
        workspace / "render.yaml"
    ).read_text()
```

- [x] **Step 2: Run the new tests to verify they fail**

Run: `.venv/bin/python -m pytest backend/tests/test_request_boundary.py -q`

Expected: failures because the middleware currently reflects a supplied request identifier, emits no privacy headers, accepts signed `Content-Length` values, and the launch commands leave Uvicorn access logging enabled.

- [x] **Step 3: Implement the smallest safe middleware and header parser**

```python
def _cover_content_length(request: Request) -> int | None:
    value = request.headers.get("content-length")
    if value is None:
        return None
    if not value.isascii() or not value.isdecimal():
        raise HTTPException(status_code=400, detail="Cover size could not be read")
    return int(value)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = str(uuid4())
    response = await call_next(request)
    response.headers.update({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": request_id,
    })
    REQUEST_LOGGER.info("%s %s %s", request.method, request.url.path, response.status_code)
    return response
```

Use `_cover_content_length(request)` in `recognize_cover` before streaming. Keep the existing bounded streaming check and `finally: image_bytes.clear()` unchanged.

Add `--no-access-log` to all four Uvicorn Make targets and to `render.yaml`'s `startCommand`; the application logger already records only method, path, and status.

- [x] **Step 4: Run the focused backend checks**

Run: `.venv/bin/python -m pytest backend/tests/test_request_boundary.py backend/tests/test_cover_api.py backend/tests/test_health.py -q && .venv/bin/python -m ruff check backend && .venv/bin/python -m ruff format --check backend`

Expected: all selected tests pass with no Ruff violations.

- [x] **Step 5: Document the local-vs-public boundary**

Add one short README sentence beside the phone workflow stating that the response privacy headers apply to the local demo too, while HTTPS enforcement is a hosted-deployment concern and must not be bypassed for a public service.

- [x] **Step 6: Commit the isolated task**

```bash
git add backend/src/book_backend/app.py backend/tests/test_request_boundary.py Makefile render.yaml README.md
git commit -m "feat: harden backend request boundary"
```

### Task 2: Add reliable accessibility announcements for changing product states

**Files:**

- Create: `mobile/src/accessibility/useAccessibilityAnnouncement.ts`
- Create: `mobile/src/accessibility/__tests__/useAccessibilityAnnouncement.test.tsx`
- Modify: `mobile/src/screens/EditionResolutionFlow.tsx`
- Modify: `mobile/src/scanner/ScannerScreen.tsx`
- Modify: `mobile/src/ui/primitives.tsx`
- Modify: `mobile/src/screens/__tests__/EditionResolutionFlow.test.tsx`
- Modify: `mobile/src/scanner/__tests__/ScannerScreen.test.tsx`

**Interfaces:**

- Consumes: React Native `AccessibilityInfo.announceForAccessibility`, the existing scanner state message, and `EditionState`/`ExportState` labels.
- Produces: `useAccessibilityAnnouncement(message: string | null | undefined): void`, used once per meaningful state message without duplicate announcements on ordinary rerenders.

- [x] **Step 1: Write the hook test first**

```tsx
function Probe({ message }: { message: string | null }) {
  useAccessibilityAnnouncement(message);
  return null;
}

test('announces each nonempty state message once', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockResolvedValue();
  const view = render(<Probe message="Checking approved sources" />);
  view.rerender(<Probe message="Checking approved sources" />);
  view.rerender(<Probe message="Open edition ready" />);

  expect(announce).toHaveBeenCalledTimes(2);
  expect(announce).toHaveBeenNthCalledWith(1, 'Checking approved sources');
  expect(announce).toHaveBeenNthCalledWith(2, 'Open edition ready');
});
```

- [x] **Step 2: Verify the hook test fails**

Run: `cd mobile && pnpm test -- useAccessibilityAnnouncement.test.tsx`

Expected: module-not-found failure before the hook exists.

- [x] **Step 3: Implement the hook without adding an animation or timer**

```tsx
import { AccessibilityInfo } from 'react-native';
import { useEffect, useRef } from 'react';

export function useAccessibilityAnnouncement(message: string | null | undefined): void {
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!message || message === announced.current) return;
    announced.current = message;
    void AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
```

- [x] **Step 4: Wire only meaningful state transitions**

In `EditionResolutionFlow.tsx`, announce the searching label, an unavailable/error message, the ready title, and export status/error copy. In `ScannerScreen.tsx`, announce scanner messages only when the reducer state changes. Add `accessibilityLiveRegion="polite"` to visible state-message containers as an Android-compatible fallback, and set `accessibilityRole="alert"` on error/unavailable message bodies. Do not announce static labels, provenance rows, or every render.

- [x] **Step 5: Add screen-level semantics tests**

Extend the existing tests to assert that a refusal message has the alert role and the ready/export status has a polite live region. Keep assertions on user-visible labels rather than implementation class names.

- [x] **Step 6: Run focused mobile verification**

Run: `cd mobile && pnpm test -- useAccessibilityAnnouncement.test.tsx EditionResolutionFlow.test.tsx ScannerScreen.test.tsx && pnpm typecheck`

Expected: all selected suites pass and TypeScript reports no errors.

- [x] **Step 7: Commit the isolated task**

```bash
git add mobile/src/accessibility mobile/src/screens/EditionResolutionFlow.tsx mobile/src/scanner/ScannerScreen.tsx mobile/src/ui/primitives.tsx mobile/src/screens/__tests__ mobile/src/scanner/__tests__
git commit -m "feat: announce app state changes accessibly"
```

### Task 3: Codify the Expo Go golden-flow gate and run the accessible Simulator pass

**Files:**

- Modify: `Makefile`
- Modify: `README.md`
- Create: `.maestro/phase9-golden.yaml`

**Interfaces:**

- Consumes: the existing phase-specific Maestro flows and `maestro test` against `host.exp.Exponent`.
- Produces: `make maestro-golden`, a repeatable ordered Expo Go Simulator gate, and a README command sequence that explains the manual system-owned share-sheet check.

- [ ] **Step 1: Create the failing golden-flow manifest**

```yaml
appId: host.exp.Exponent
name: Phase 9 Expo Go golden smoke
---
- launchApp
- tapOn: Book to EPUB
- assertVisible: Book to EPUB
- assertVisible: Backend connected
- tapOn: Test scenarios
- scrollUntilVisible:
    element:
      text: PDF conversion refused
    direction: DOWN
- tapOn: PDF conversion refused
- assertVisible: Book identified, open edition unavailable
- assertNotVisible: Open in Books
```

The manifest deliberately verifies one success/unavailable handoff boundary only; phase-specific files continue to cover their dedicated flows.

- [ ] **Step 2: Run it before adding the Make target**

Run: `maestro test .maestro/phase9-golden.yaml`

Expected: the file runs independently against Expo Go once the fixture backend and Metro server are already running.

- [ ] **Step 3: Add the repeatable Make target**

```make
.PHONY: maestro-golden

maestro-golden:
	maestro test .maestro/phase0.yaml .maestro/phase1.yaml .maestro/phase2.yaml .maestro/phase3.yaml .maestro/phase4.yaml .maestro/phase5.yaml .maestro/phase6.yaml .maestro/phase7.yaml .maestro/phase8.yaml .maestro/phase8-refusal.yaml .maestro/phase9-golden.yaml
```

Do not include a `tapOn` action that leaves Maestro blocked in the system-owned iOS share sheet. That handoff remains a Computer Use/manual Simulator check.

- [ ] **Step 4: Document and execute the gate**

Add `make maestro-golden` to README’s Verification section with prerequisites: `make backend-run`, Metro/Expo Go already open in the booted simulator, and a separate physical-phone camera pass. Run the target once, then use Computer Use to verify the generated-PDF native share sheet and the refusal screen at the current Dynamic Type default.

- [ ] **Step 5: Commit the isolated task**

```bash
git add Makefile README.md .maestro/phase9-golden.yaml
git commit -m "test: add Expo Go golden flow gate"
```

## Scope deliberately deferred

- An Expo development build, standalone signing, TestFlight, and production HTTPS deployment require a distribution decision and remain Phase 11 work.
- A 25–50-work externally sourced catalog requires reviewed source records and deployment authority; fixture flows remain the demo’s deterministic test data.
- Camera optics, barcode recognition accuracy, focus, haptics, and Apple Books import are physical-iPhone checks the user will perform in Expo Go.
- Visual overhaul, gesture tuning, cinematic motion, and animation work remain Phase 10.

## Final verification for this slice

```bash
make test
make doctor
cd mobile && pnpm exec expo export --platform ios
make maestro-golden
git diff --check
```

Then use Computer Use in iOS Simulator to inspect the generated EPUB’s native share sheet and the PDF refusal screen. Do not tap an external share target or save a file during automated verification.
