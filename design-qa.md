# Finance Mobile design QA

- Source visual truth: `projects/finance-mobile/docs/design-qa/source-option-3.png`
- Implementation screenshot: `projects/finance-mobile/docs/design-qa/implementation-review.png`
- Side-by-side comparison: `projects/finance-mobile/docs/design-qa/comparison.png`
- Target viewport: 390 × 844 CSS pixels
- Source pixels: 853 × 1844 (normalized to 390 × 844 for comparison)
- Implementation pixels: 390 × 844 at device scale factor 1
- State: signed-in review-first Home with one pending SMS candidate

## Full-view comparison evidence

The implementation preserves the selected concept's dark navy shell, compact
header and sync status, two-state review/captured control, large review card,
evidence panel, confirm/edit actions, and persistent five-item bottom tab bar.
Its vertical density is intentionally lower when only one candidate is returned;
the additional queue rows appear only when more candidates exist.

## Focused region comparison evidence

- Header: menu, Signal Inbox identity, subtitle, and compact sync state match the
  source hierarchy without clipping at 390 px.
- Review card: provider, date, confidence, amount, description, parser suggestion,
  raw SMS evidence, and actions remain legible and follow the source order.
- Navigation: all five tabs fit the viewport with visible selected and unread
  states. The secondary drawer was opened and inspected at the same viewport.
- Login: inspected separately at 390 × 844; fields, disabled state, status state,
  and copy fit without overlap.

## Findings

- No actionable P0, P1, or P2 visual issues remain.
- The source mock uses a bKash brand mark, while the implementation uses a
  provider-neutral wallet icon. This is an intentional asset constraint: bKash's
  published terms prohibit unauthorized reproduction of its logo, so the app
  does not fabricate or bundle that trademark without permission.
- The source includes three review items and a manual-entry floating action. The
  captured implementation state contains one candidate, and manual entry is
  intentionally secondary on Activity because automatic capture is the product's
  primary workflow.

## Required fidelity surfaces

- Fonts and typography: system sans typography closely matches the reference's
  geometric product font; hierarchy, weights, wrapping, and truncation passed.
- Spacing and layout rhythm: 16 px outer gutters, grouped surfaces, 44+ px touch
  targets, card padding, and bottom navigation clearance passed.
- Colors and visual tokens: navy, slate, cyan, mint, coral, and muted text roles
  match the selected direction with accessible contrast.
- Image and icon fidelity: Material Community Icons provide consistent vector
  navigation and finance symbols; no placeholder, emoji, handcrafted SVG, or
  fabricated brand assets are used.
- Copy and content: automation, review confidence, SMS evidence, and actions are
  product-specific and match the intended workflow.

## Interaction and runtime verification

- Tested Home, Activity, and the slide-out secondary menu in the Expo web QA
  renderer at 390 × 844.
- Verified the production login screen after removing the fictional visual-QA
  seed.
- Browser console contained no errors. Two web-only warnings were observed:
  React Native Web's shadow deprecation and Animated falling back to its JS
  driver. Neither affects the Android build target.
- `npm run typecheck` passed after removing the visual-QA seed.
- `npx expo export --platform android` produced the Hermes Android bundle and
  Material Community Icons font asset successfully.

## Comparison history

1. The initial bundle failed because `expo-asset` was only nested beneath Expo.
   It was promoted to a direct dependency, after which the bundle rendered.
2. The first visual pass confirmed the app shell and login layout. A fictional,
   in-memory candidate was then used to inspect the selected review state without
   transmitting credentials or real financial data.
3. The final side-by-side pass found no actionable P0/P1/P2 differences. The
   fictional seed was removed before final verification.

## Follow-up polish

- P3: add licensed provider artwork later if each provider grants permission or
  supplies an approved partner asset kit.
- P3: capture the same screen on a physical Android device to compare platform
  font rasterization and safe-area behavior.

final result: passed
