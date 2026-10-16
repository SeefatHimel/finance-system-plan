# Dashboard Design QA

## Reference and implementation evidence

- Reference: `/Users/fullstackdev/.codex/generated_images/01a0e212-c35b-7d21-915a-109220d2ab02/exec-b9fedb8d-4305-4e31-a40b-4af904355792.png`
- Reference dimensions: 1487 × 1058 px
- Implementation: authenticated `/` route at `http://localhost:3001/`
- Implementation evidence: inline Browser/IAB captures from the authenticated dashboard. The IAB capture API does not expose a host filesystem path.
- Desktop comparison viewport: 1440 × 1024 CSS px at DPR 1. This is the largest available IAB viewport and is slightly smaller than the source image.
- Mobile verification viewport: 430 × 932 CSS px at DPR 1
- State: local seeded test data with accounts, posted transactions, and three pending SMS candidates

## Full-page comparison

The implemented desktop layout follows the reference composition:

- Fixed dark navigation rail with active-state treatment and review count.
- Compact utility header with page message, date, search, and account avatar.
- Primary row split between net position/cash flow and automation health.
- Secondary row split between expense composition and items needing attention.
- Four-row recent-transactions table completing the first viewport.

Measured implementation landmarks at 1440 × 1024:

| Region | Top | Height | Bottom |
| --- | ---: | ---: | ---: |
| Primary dashboard row | 92 px | 339 px | 431 px |
| Secondary dashboard row | 443 px | 268 px | 711 px |
| Recent transactions | 723 px | 305 px | 1028 px |

These align with the reference landmarks within the expected scaling difference of the available viewport.

## Focused comparisons

### Cash flow and automation

- Typography, card hierarchy, dark tonal separation, and mint emphasis match the selected direction.
- Cash-flow plotting uses real report values and a stable, non-animated capture state.
- Automation counts come from posted mobile imports and pending SMS candidates.
- The activity label uses the latest available message timestamp instead of presenting a fabricated live-sync time.

### Spending and attention queue

- The donut visual includes expense categories only; income is excluded from spending composition.
- Color, legend density, and attention-row spacing match the reference hierarchy.
- The review call to action opens the real SMS review workflow.

### Recent transactions

- The table matches the four-row reference density and carries account, category, source, status, and signed amount.
- Confirmed transactions show truthful `Verified` or `Manual` status because the current API does not preserve a confidence score after confirmation.

## Responsive and interaction checks

- At 430 × 932, navigation collapses behind a mobile menu and all dashboard regions stack without overlap or clipped labels.
- The review call to action was exercised and navigated to `/messages/review`.
- The Accounts screen and Add Account drawer were inspected under the shared dark shell.
- Browser console inspection showed no runtime errors on the desktop dashboard or mobile review flow.

## Motion and loading follow-up

- Route changes now expose a thin mint progress rail and a restrained content entrance instead of an abrupt swap.
- Initial workspace fetches use a shared branded activity mark plus layout-preserving shimmer blocks sized to the incoming content.
- Mutation buttons retain their width and pair a compact spinner with an explicit action label such as `Saving`, `Updating`, or `Recording`.
- Drawers, navigation scrims, and success toasts use the same easing and depth language as the dashboard.
- The actual slow-route state was captured in Browser/IAB by temporarily pausing the local test API, then allowing the request to complete after the API resumed.
- Both 1440 × 1024 desktop and 430 × 932 mobile layouts were checked after the motion update, with no relevant console warnings or errors.
- `prefers-reduced-motion` collapses animations and transitions to an effectively immediate state.

## Iteration history

### Pass 1 findings

- P1: Spending composition incorrectly included income categories.
- P2: Chart animations caused incomplete visual captures.
- P2: Dashboard row heights drifted from the selected composition.
- P2: SMS source labels used inconsistent capitalization.

### Fixes

- Filtered spending data to expense categories.
- Disabled chart animation for a stable UI and deterministic visual review.
- Tuned dashboard row, chart, donut, and table dimensions to the reference landmarks.
- Standardized source labels and refined the BDT/amount hierarchy.

### Pass 2 result

- No remaining actionable P0, P1, or P2 visual issues.
- Above-the-fold copy differences are intentional and data-driven: current date, real balances and counts, the latest message timestamp, and non-fabricated verification status.
- System typography is used because the reference font is not an identified project asset; weight, size, rhythm, and hierarchy are closely matched.
- Phosphor outline icons replace brand-specific raster marks to keep the interface consistent and dependency-backed.

## Final result

**Passed**


## Web review follow-up — 17 October 2026

The original reference comparison above records an earlier dashboard pass. The
current web layout intentionally prioritizes financial context and review work:
compact dates and totals precede net position plus Needs attention; optional
favorite shortcuts follow recent transactions. Internal transfers use a neutral
amount and show both accounts, and review cards show exact amounts.

Statement selection collapses the import library and places review rows ahead of
source/reconciliation details. Exception counts remain visible. Secondary row
filters and bulk actions preserve their selections while collapsed. Add/edit and
SMS fields share a consistent order, with optional payment methods in details.
Combined review surfaces exact balance and date differences without changing
matching, acknowledgement or posting rules.

Verification uses only the synthetic local preview at 127.0.0.1:3174, plus web
TypeScript and regression checks. Screenshots are stored outside the repository.

Verified at 1280 × 720 and 390 × 844 in the in-app browser with no relevant
console warnings/errors or horizontal page overflow. A selected statement's first
review row starts within the desktop viewport. The table keeps its own horizontal
scrolling on narrow screens. Exercised statement selection/reload, collapsed
filter retention, source-check access, both combined and ledger balance-conflict
reviews, SMS focus/draft preservation, and manual add followed by edit. The saved
synthetic entry reloaded its exact balance and payment method after saving with
More details collapsed. TypeScript and all 78 web regression tests passed.
