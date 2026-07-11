# Phase 10 Visual and Motion Polish Design

## Decision

Use the approved hybrid direction: a cinematic, dark scanner that feels purpose-built for a physical object, followed by warm, quiet editorial screens that make the rights-aware result feel trustworthy. The visual language must make the app more memorable without hiding its legal boundary, adding a new flow, or weakening its Expo Go support.

## Goals

- Make the primary demo path feel intentional from scan to Apple Books handoff.
- Give every existing state a coherent hierarchy: action first, explanation second, technical provenance last.
- Preserve the existing plain-language rights and edition-difference messages.
- Keep all interactive controls, accessibility semantics, fixture behavior, and network contracts unchanged.
- Use only small, interruptible motion that explains a state change or acknowledges a touch.

## Non-goals

- No native reader, user accounts, new source adapters, camera-recognition behavior, or backend contract changes.
- No remote font loading, generated artwork, heavy UI kit, or development-build-only dependency.
- No decorative animation around repeated actions, download percentages, or error states.
- No visual treatment that suggests physical ownership grants digital rights.

## Visual system

### Character

The app should feel like a modern field guide for books: warm paper surfaces, nearly-black ink, a deep evergreen action color, and a dark camera field. It is not a vintage-library imitation and not a glossy AI dashboard. Book covers are the only richly visual objects; the surrounding interface remains deliberately calm.

### Typography

Use the iOS system typeface already available in Expo Go. The editorial feeling comes from hierarchy rather than a fragile custom font:

- Small uppercase eyebrow: 12 pt, semibold, generous tracking.
- Display title: 36–42 pt, bold, tight tracking, short line lengths.
- Screen title: 30–34 pt, bold.
- Body: 16–18 pt with 1.4–1.5 line-height.
- Metadata: 13–15 pt, medium/regular, visibly quieter than primary copy.

Dynamic Type remains enabled; titles wrap naturally instead of shrinking below the intended type scale.

### Color and elevation

| Token | Role | Value |
| --- | --- | --- |
| `canvas` | Editorial screen background | `#F6F3EC` |
| `surface` | Cards and grouped details | `#FFFFFF` |
| `ink` | Primary text | `#19231D` |
| `mutedInk` | Supporting copy | `#5E625D` |
| `evergreen` | Main action and verified state | `#203B2F` |
| `evergreenSoft` | Positive emphasis / badges | `#E5EEE7` |
| `line` | Quiet borders | `#D7D3C9` |
| `warning` | Partial-catalog state | `#8B6429` |
| `danger` | Failure state | `#9C4946` |
| `scannerBase` | Camera fallback / dark field | `#0D1511` |

Cards use a white surface, 1 px quiet border, 20–24 pt corner radius, and no exaggerated shadow. Depth comes from contrast, spacing, and the scanner/result transition—not a floating-card stack.

### Spacing and controls

Adopt a four-point rhythm with 24 pt screen gutters on standard phones. The primary action is full-width, 56 pt high, and always visually singular. Secondary actions are full-width outlined buttons only when they represent a peer path; compact back/edit actions stay content-width. Related metadata is grouped in one card rather than separated by multiple boxes.

## Screen direction

### Launch

The launch screen remains sparse: a small trust-oriented eyebrow, a confident title, one short promise, a compact connection indicator, and the scanner action anchored near the lower half. Development scenarios remain visually secondary and remain absent from production builds.

### Scanner

The scanner is the cinematic moment. It uses the real camera or dark fixture preview under a restrained vertical scrim. The scan guide becomes a single strong rectangular frame with subtle corner emphasis. The header has a compact back control, title, and one-line barcode guidance. The shutter remains familiar and central; manual search and the privacy statement stay visible below it. Nothing decorative competes with the book image.

### Search and confirmation

Manual search uses one clear form surface. Candidate cards use the cover as the visual anchor, align metadata to a stable vertical rhythm, and make the match rationale supportive rather than dominant. The confirmation screen uses the same editorial title and one physical-edition card, avoiding duplicate headings and excessive borders.

### Edition result and provenance

The ready screen makes the digital book cover and title the hero. The verified/generated label is compact; the edition-difference explanation follows immediately. The primary handoff action is visually unambiguous, with Files as the secondary action. Provenance remains available in a collapsible details card, but the common path does not require reading it.

Unavailable, source-error, permission, and cover-recovery states follow the same centered composition as the result screen: direct headline, concise reason, one clear recovery action, then a secondary escape route. Error color supplements copy and icons; it never carries meaning alone.

## Motion and feedback

Motion is functional and calm. It must run on transform/opacity only, never block a tap, and be disabled or reduced when the platform requests Reduce Motion.

| Moment | Purpose | Standard motion | Reduced Motion |
| --- | --- | --- | --- |
| Pressable controls | Immediate acknowledgement | Scale to `0.975` while pressed | Opacity/color only |
| Screen content entrance | Prevent abrupt replacement after an intentional navigation | 8 pt rise + opacity over 180 ms, ease-out | 120 ms opacity only |
| Candidate/result card entrance | Explain the newly resolved object | 12 pt rise + opacity over 220 ms, ease-out | 120 ms opacity only |
| Scanner guide readiness | Indicate active scanning, not progress | One 180 ms opacity/scale settle | No movement |
| Status change | Explain changed state | 160 ms opacity transition | 120 ms opacity transition |

Do not add looping pulses, long spinners, parallax, confetti, bounce on ordinary buttons, or percentage-by-percentage animation. Existing barcode-success haptics remain; Phase 10 does not add haptics that cannot be meaningfully checked in Simulator.

## Accessibility and reliability constraints

- Preserve the Phase 9 VoiceOver announcements and Android live-region fallbacks exactly once per meaningful state change.
- Preserve 44 pt minimum targets, clear labels, alert roles for failures, and existing keyboard behavior.
- Check both normal and large Dynamic Type on every touched screen.
- Query and subscribe to the platform Reduce Motion setting through a reusable hook; animations must update if it changes while the app is running.
- Keep the visual test fixtures and all user-visible test strings stable unless a corresponding test and Maestro assertion are intentionally updated.

## Validation

- Add focused component tests for the motion/accessibility primitive, pressed treatment, and Reduce Motion behavior.
- Keep the existing backend, state, and mobile test suites unchanged and green.
- Add deterministic Maestro screenshots for launch, scanner, candidate, ready, unavailable, and long-title states; use them as a visual regression baseline.
- Run the full Expo Go golden gate and an iOS export after each cohesive visual slice.
- Inspect the final Simulator output at default and large text sizes. The system-owned share-sheet check remains a separate iOS/Computer Use validation.

## Acceptance criteria

Phase 10 is complete when the existing functional flows look like one product, each critical state is legible without reading provenance, motion improves comprehension without causing delay, and all existing accessibility and deterministic behavior remain intact. The result must still be runnable in Expo Go on the user’s iPhone.
