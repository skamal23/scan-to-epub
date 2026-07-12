# Scanner Minimal Copy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the nonessential default privacy/process sentence from the scanner so its first screen tells the user only how to scan a book.

**Architecture:** Keep the scanner state machine, permission messaging, barcode/cover capture behavior, controls, and accessibility labels unchanged. Delete only the unconditional `privacyHint` text and its no-longer-used style; replace its old positive assertion with an absence contract. The existing visual flow captures the resulting scanner state.

**Tech Stack:** Expo Go, React Native, TypeScript, Jest, Maestro, iOS Simulator.

## Global Constraints

- The camera-first default remains scan → confirm → open.
- Retain user-action guidance: title, back-barcode hint, capture control, and manual-search option.
- Do not add a native reader, disclosure, legal/process copy, dependency, or behavior change.
- Preserve accessibility labels, controls, 44 pt targets, Reduce Motion support, and Expo Go compatibility.

---

### Task 1: Remove default scanner process copy

**Files:**

- Modify: `mobile/src/scanner/ScannerScreen.tsx`
- Modify: `mobile/src/scanner/__tests__/ScannerScreen.test.tsx`
- Modify: `.maestro/phase10-launch-scanner.yaml`

**Interfaces:**

- Consumes: the granted-camera `ScannerView` fixture and existing `onCaptureCover` callback.
- Produces: the same scanner controls and capture callback without the default `privacyHint` text/style.

- [ ] **Step 1: Write the failing scanner contract**

In the existing `manual shutter captures a cover when no fresh ISBN is visible` test, replace the current positive privacy-copy assertion with:

```tsx
expect(view.queryByText('Cover photos are processed temporarily and not saved.')).toBeNull();
```

Keep the existing title, capture-button, cover-callback, and no-ISBN-callback expectations unchanged.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
cd mobile && pnpm test -- ScannerScreen.test.tsx
```

Expected: the changed test fails because the current granted-camera screen still renders the privacy/process sentence.

- [ ] **Step 3: Make the minimal scanner change**

Delete the following unconditional block from `ScannerView` after the manual-search button:

```tsx
<Text style={styles.privacyHint}>
  Cover photos are processed temporarily and not saved.
</Text>
```

Then delete the unused `privacyHint` style from the same file. In `.maestro/phase10-launch-scanner.yaml`, add:

```yaml
- assertNotVisible: Cover photos are processed temporarily and not saved.
```

immediately before the scanner screenshot. Do not change scanner guidance, actions, callbacks, or camera/permission behavior.

- [ ] **Step 4: Verify the focused behavior and refreshed visual shell**

Run:

```bash
cd mobile && pnpm test -- ScannerScreen.test.tsx App.test.tsx && pnpm typecheck
maestro test .maestro/phase10-launch-scanner.yaml
```

Expected: focused tests and typecheck pass; the launch/scanner Maestro flow exits 0 and refreshes its scanner screenshot without the removed sentence.

- [ ] **Step 5: Commit the minimal cleanup**

Run:

```bash
git add mobile/src/scanner/ScannerScreen.tsx mobile/src/scanner/__tests__/ScannerScreen.test.tsx .maestro/phase10-launch-scanner.yaml
git commit -m "fix: remove default scanner process copy"
```
