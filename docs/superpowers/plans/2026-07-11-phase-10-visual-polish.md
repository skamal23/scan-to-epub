# Phase 10 Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Expo Go demo feel like one polished, trustworthy iOS product while preserving every functional, legal, accessibility, and test contract from Phases 0–9.

**Architecture:** Keep the FastAPI service and product state machines unchanged. Add a small UI foundation for theme tokens, platform Reduce Motion, and entrance/press feedback, then apply it to the existing launch, scanner, search, and edition screens. The UI keeps using React Native core `Animated` so it remains Expo Go compatible without an additional animation runtime.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript, React Native `Animated`/`AccessibilityInfo`, Jest, Maestro, iOS Simulator, Expo Go.

## Global Constraints

- Do not change routes, reducers, API payloads, legal allowlists, provenance, delivery, or share-sheet behavior.
- Do not add a UI kit, remote font dependency, native development build requirement, generated artwork, or a custom reader.
- Keep iOS system typography and all user-visible functional copy stable unless a deterministic test is intentionally updated with it.
- Use only `opacity` and `transform` for new motion; no looping decorative animation or motion on per-tick download progress.
- Respect the current and changing `AccessibilityInfo` Reduce Motion setting. Motion must never block input.
- Keep VoiceOver alerts/live regions, test scenario labels, 44 pt targets, keyboard behavior, and Expo Go compatibility intact.
- Preserve simple source boundaries: `ui/theme.ts` owns visual tokens, `ui/useReducedMotion.ts` owns the platform preference, and `ui/Entrance.tsx` owns optional entrance animation.

---

### Task 1: Establish the visual and motion foundation

**Files:**

- Create: `mobile/src/ui/theme.ts`
- Create: `mobile/src/ui/useReducedMotion.ts`
- Create: `mobile/src/ui/Entrance.tsx`
- Create: `mobile/src/ui/__tests__/useReducedMotion.test.tsx`
- Create: `mobile/src/ui/__tests__/Entrance.test.tsx`
- Modify: `mobile/src/ui/primitives.tsx`
- Modify: `mobile/src/ui/__tests__/primitives.test.tsx`

**Interfaces:**

- Consumes: React Native `AccessibilityInfo`, `Animated`, and the existing button primitive API.
- Produces: `colors`, `spacing`, `radius`, `type`, and `motion` tokens; `useReducedMotion(): boolean`; and `<Entrance children distance? delay? testID?>` for stateful screen/card entrances.

- [x] **Step 1: Write the failing preference and motion primitive tests**

```tsx
test('uses the current Reduce Motion preference and listens for later changes', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const view = render(<Probe />);

  await waitFor(() => expect(view.getByText('full')).toBeTruthy());
  reduceMotionListener?.(true);
  expect(view.getByText('reduced')).toBeTruthy();
});

test('keeps an Entrance visible without a translate transform when motion is reduced', async () => {
  mockReducedMotion(true);
  const view = render(<Entrance testID="entrance"><Text>Ready</Text></Entrance>);

  expect(view.getByTestId('entrance')).toBeTruthy();
  expect(Animated.timing).not.toHaveBeenCalled();
});
```

Extend the primitives test with a press-state assertion that verifies `PrimaryButton` changes only opacity/transform and keeps the same accessible role and label.

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `cd mobile && pnpm test -- useReducedMotion.test.tsx Entrance.test.tsx primitives.test.tsx`

Expected: module-not-found failures for the new hook and component, plus the new press-style assertion failing against the old opacity-only primitive.

- [x] **Step 3: Add the smallest reusable foundation**

Create `theme.ts` with immutable tokens, keeping literals out of new screen styles:

```ts
export const colors = {
  canvas: '#F6F3EC', surface: '#FFFFFF', ink: '#19231D', mutedInk: '#5E625D',
  evergreen: '#203B2F', evergreenSoft: '#E5EEE7', line: '#D7D3C9',
  warning: '#8B6429', danger: '#9C4946', scannerBase: '#0D1511',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { control: 16, card: 22, sheet: 26, pill: 999 } as const;
export const type = { eyebrow: 12, title: 34, display: 40, body: 17, metadata: 14 } as const;
export const motion = { pressScale: 0.975, contentDistance: 8, cardDistance: 12, quickMs: 160, contentMs: 180, cardMs: 220 } as const;
```

Implement `useReducedMotion` with an initial `AccessibilityInfo.isReduceMotionEnabled()` read, the `reduceMotionChanged` subscription, and listener cleanup. Implement `Entrance` with two native-driver `Animated.Value`s for opacity and translateY; when reduced motion is true, render immediately at opacity 1 and translateY 0. Update `PrimaryButton`, `SecondaryButton`, and the scanner-specific button style call sites to use `transform: [{ scale: pressed ? motion.pressScale : 1 }]` together with the current opacity feedback.

- [x] **Step 4: Run focused mobile verification**

Run: `cd mobile && pnpm test -- useReducedMotion.test.tsx Entrance.test.tsx primitives.test.tsx && pnpm typecheck`

Expected: all focused tests pass and TypeScript has no errors.

- [x] **Step 5: Commit the foundation**

```bash
git add mobile/src/ui/theme.ts mobile/src/ui/useReducedMotion.ts mobile/src/ui/Entrance.tsx \
  mobile/src/ui/__tests__/useReducedMotion.test.tsx mobile/src/ui/__tests__/Entrance.test.tsx \
  mobile/src/ui/primitives.tsx mobile/src/ui/__tests__/primitives.test.tsx
git commit -m "feat: add polished mobile UI foundation"
```

### Task 2: Polish the launch and scanner experience

**Files:**

- Modify: `mobile/App.tsx`
- Modify: `mobile/src/scanner/ScannerScreen.tsx`
- Modify: `mobile/src/__tests__/App.test.tsx`
- Modify: `mobile/src/scanner/__tests__/ScannerScreen.test.tsx`
- Create: `.maestro/phase10-launch-scanner.yaml`

**Interfaces:**

- Consumes: Task 1’s tokens, `Entrance`, and existing `PrimaryButton`/`SecondaryButton` APIs.
- Produces: the same launch/scanner callbacks and test IDs with a consistent editorial launch frame and a cinematic scanner frame.

- [ ] **Step 1: Add failing visual-contract tests**

Add component assertions that the launch root uses `colors.canvas`, the scanner root uses `colors.scannerBase`, the scanner guide keeps `accessibilityLabel="Book scan guide"`, and both normal and fixture camera views expose the same capture action. The token-color assertions must fail against the current `#F4F1EA` / `#111713` literals. Add a Maestro flow that launches Expo Go, opens the scanner fixture, captures screenshots for the launch and scanner states, and asserts the existing labels:

```yaml
appId: host.exp.Exponent
name: Phase 10 launch and scanner visuals
---
- launchApp
- tapOn: Book to EPUB
- assertVisible: Book to EPUB
- assertVisible: Backend connected
- takeScreenshot: .maestro/artifacts/phase10-launch
- tapOn: Open scanner
- assertVisible: Scan a cover or ISBN
- assertVisible: Search manually
- takeScreenshot: .maestro/artifacts/phase10-scanner
```

- [ ] **Step 2: Run the targeted tests and Maestro flow before visual changes**

Run: `cd mobile && pnpm test -- App.test.tsx ScannerScreen.test.tsx` and `maestro test .maestro/phase10-launch-scanner.yaml`

Expected: existing functional assertions pass; the new explicit visual/semantic assertions identify the unpolished style contracts before Task 2 implementation.

- [ ] **Step 3: Apply the launch and scanner design**

In `App.tsx`, wrap the launch content in `Entrance`, apply the canvas/typography tokens, make the connection row visually compact, retain one dominant scanner action, and leave the dev-only scenario action secondary. In `ScannerScreen.tsx`, use the scanner-base fallback, a more deliberate scrim, tokenized header/control spacing, a 56 pt press-responsive shutter, and the existing book scan guide/capture semantics. Use `Entrance` only for the scanner guide readiness and static screen content—never for barcode processing or control availability.

- [ ] **Step 4: Verify regression safety**

Run: `cd mobile && pnpm test -- App.test.tsx ScannerScreen.test.tsx && pnpm typecheck` and `maestro test .maestro/phase10-launch-scanner.yaml`

Expected: launch, manual scanner entry, camera-permission fixture, barcode capture, cover capture, cancellation, and accessibility labels all pass without changed user actions.

- [ ] **Step 5: Commit the vertical slice**

```bash
git add mobile/App.tsx mobile/src/scanner/ScannerScreen.tsx mobile/src/__tests__/App.test.tsx \
  mobile/src/scanner/__tests__/ScannerScreen.test.tsx .maestro/phase10-launch-scanner.yaml
git commit -m "feat: polish launch and scanner experience"
```

### Task 3: Polish manual search, candidates, and confirmation

**Files:**

- Modify: `mobile/src/screens/ManualSearchFlow.tsx`
- Create: `mobile/src/screens/__tests__/ManualSearchFlow.test.tsx`

**Interfaces:**

- Consumes: the existing `SearchState`, `MetadataCandidate`, navigation callbacks, and Task 1 UI foundation.
- Produces: unchanged search/confirmation actions with a tokenized form, cover-led candidate card, and visually quiet match metadata.

- [ ] **Step 1: Add focused search visual/interaction tests**

Create or extend a screen test that verifies a candidate card remains one accessible button named `Choose <title> by <author>`, retains its cover fallback, and renders its match reason after a press-state render. Add token-style expectations that the title uses `colors.ink` and the match reason uses `colors.evergreen`; both expectations fail against the current literal colors. Keep the existing long-title regression and add a case that verifies the title has no fixed single-line truncation.

- [ ] **Step 2: Run the new test before changing styles**

Run: `cd mobile && pnpm test -- ManualSearchFlow.test.tsx App.test.tsx`

Expected: the new card/typography contract fails only where the current component lacks the new explicit visual behavior.

- [ ] **Step 3: Apply the editorial search treatment**

Replace local palette literals with theme tokens, use `Entrance` for the form/candidate result content, increase title/cover hierarchy, use quiet surface borders, and make match-reason text a small evergreen supporting line. Preserve every form label, `testID`, `accessibilityLabel`, keyboard behavior, candidate button, provider warning, and long-title wrapping.

- [ ] **Step 4: Exercise the deterministic UI flows**

Run: `cd mobile && pnpm test -- App.test.tsx ManualSearchFlow.test.tsx && pnpm typecheck`, then run each Simulator flow in its own process:

```bash
maestro test .maestro/phase1.yaml
maestro test .maestro/phase3.yaml
```

Expected: manual ISBN, ambiguity, catalog warning, long-title, strong-cover confirmation, ambiguous-cover recovery, and no-cover fallback all pass.

- [ ] **Step 5: Commit the search slice**

```bash
git add mobile/src/screens/ManualSearchFlow.tsx mobile/src/screens/__tests__/ManualSearchFlow.test.tsx
git commit -m "feat: polish book search and confirmation"
```

### Task 4: Polish edition, export, provenance, and recovery states

**Files:**

- Modify: `mobile/src/screens/EditionResolutionFlow.tsx`
- Modify: `mobile/src/screens/__tests__/EditionResolutionFlow.test.tsx`

**Interfaces:**

- Consumes: `EditionState`, `ExportState`, rights/provenance data, export callbacks, and Task 1 UI primitives.
- Produces: unchanged ready, generated, unavailable, source-error, download, share, and provenance behavior with an editorial result hierarchy and a readable recovery composition.

- [ ] **Step 1: Add failure-first UI contract tests**

Add tests asserting that the ready screen keeps the digital title as the polite live region, maintains the primary Books and secondary Files action order, retains the alert role for unavailable/export errors, and keeps the provenance toggle as an individually reachable button. Add style-level checks that the details card has `backgroundColor: colors.surface`, `borderColor: colors.line`, and `borderRadius: radius.card`; the missing border contract fails before the screen is polished.

- [ ] **Step 2: Run the focused tests to verify the new contracts fail**

Run: `cd mobile && pnpm test -- EditionResolutionFlow.test.tsx`

Expected: new token/structure assertions fail before the edition screen consumes the foundation.

- [ ] **Step 3: Apply the result and recovery design**

Use `Entrance` for the ready card and centered recovery content. Make the cover/title card the hero, keep the edition-difference explanation immediately below it, make the primary export action singular, and put provenance inside a quiet surfaced details card. Apply the same centered hierarchy to unavailable, source-error, incomplete-result, download, sharing, and export-error states. Do not animate share-sheet state, download percentage, or the disclosure toggle.

- [ ] **Step 4: Run focused and end-to-end validation**

Run: `cd mobile && pnpm test -- EditionResolutionFlow.test.tsx App.test.tsx && pnpm typecheck`, then each command separately:

```bash
maestro test .maestro/phase4.yaml
maestro test .maestro/phase6.yaml
maestro test .maestro/phase8.yaml
maestro test .maestro/phase8-refusal.yaml
```

Expected: verified, unavailable, fallback, generated EPUB, guarded PDF, and PDF-refusal outcomes retain all existing action/no-action guarantees.

- [ ] **Step 5: Commit the edition slice**

```bash
git add mobile/src/screens/EditionResolutionFlow.tsx mobile/src/screens/__tests__/EditionResolutionFlow.test.tsx
git commit -m "feat: polish edition and export states"
```

### Task 5: Lock visual regressions and complete Phase 10 verification

**Files:**

- Create: `.maestro/phase10-visual.yaml`
- Modify: `Makefile`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-11-phase-10-visual-polish.md`

**Interfaces:**

- Consumes: the already independent Maestro flows, Expo Go fixture backend, and visual screenshot artifacts.
- Produces: `make maestro-visual`, documented visual-gate prerequisites, and a finished Phase 10 checklist.

- [ ] **Step 1: Write the Phase 10 visual gate**

Create a focused flow that captures the polished launch, scanner, candidate, ready, long-title, and refusal screens without tapping into the native share sheet. It must launch Expo Go before each stateful subflow or use existing independently bootable phase files in separate Make recipe lines.

- [ ] **Step 2: Run the visual gate before wiring the Make target**

Run: `maestro test .maestro/phase10-visual.yaml`

Expected: the independent visual flow passes against the fixture backend and leaves the required screenshot artifacts before it is folded into a reusable Make target.

- [ ] **Step 3: Add the serial visual target and documentation**

Add a `.PHONY` `maestro-visual` target that runs the Phase 10 visual flow and the existing independent Phase 0/1/3/4/8/refusal flows one process at a time. Document that it requires `make backend-run`, Metro/Expo Go in the booted Simulator, and that native share-sheet/physical-camera verification remains separate.

- [ ] **Step 4: Run the complete acceptance suite**

Run, from the worktree root:

```bash
make test
make doctor
cd mobile && pnpm exec expo export --platform ios
make maestro-golden
make maestro-visual
git diff --check
```

Use Computer Use when the Mac is unlocked to inspect the launch, scanner, candidate, ready, long-title, unavailable, and native-share-sheet states at default Dynamic Type. Repeat at a large Dynamic Type setting and with Reduce Motion enabled; record any iOS-system-owned limitation in the plan.

- [ ] **Step 5: Request an adversarial review and address findings**

Ask an independent reviewer to inspect the final Phase 10 diff for visual regressions, accessibility regressions, unnecessary dependencies, animation misuse, hard-coded duplicate tokens, and accidental behavior changes. Fix every Critical/Important finding, then rerun the commands from Step 4.

- [ ] **Step 6: Commit the completed phase**

```bash
git add .maestro/phase10-visual.yaml Makefile README.md docs/superpowers/plans/2026-07-11-phase-10-visual-polish.md
git commit -m "test: verify polished Expo Go demo"
```

## Scope deliberately deferred

- Physical camera autofocus/framing, one-handed scanner ergonomics, and haptic feel remain a user-run iPhone check.
- System-owned Apple Books and Files destination selection remains a manual/Computer Use check.
- Production deployment, accounts, a native reader, and TestFlight stay in Phase 11.
- No visual work adds a claim that the user is entitled to a digital copy merely by owning a paper copy.
