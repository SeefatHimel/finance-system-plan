# Future Implementation And Upgrade Plan

Last updated: 2026-05-31

This plan lists the next implementation targets after the current local-first
finance workflow. It is ordered to favor fast validation first, then reliability,
then product upgrades. Keep this file practical: every item should have a clear
reason, dependency, and acceptance check.

## Planning Rules

- Do not expand parser rules from guesses when real anonymized SMS samples are
  available or can be collected.
- Keep finance correctness ahead of UI polish. Ledger fields, duplicate
  handling, audit history, and reconciliation should stay conservative.
- Prefer deterministic rules before AI. AI can assist classification later, but
  should not silently create or alter money records.
- Keep Android SMS capture sender-scoped. The app should never track all
  messages by default.
- Update OpenAPI contracts, docs, and Q&A whenever API behavior changes.

## Priority 1: Validation And Hardening

Goal: prove that the implemented core works on real infrastructure and a real
Android device.

Tasks:

- Run Docker validation in an environment with Docker CLI:
  `docker compose config`, full stack startup, API health check, and web login.
- Run native Android SMS capture on a real device or emulator with a custom dev
  client/personal APK build.
- Perform cookie-backed web auth runtime smoke with
  `NEXT_PUBLIC_ALLOW_LOCAL_TOKEN_STORAGE=false`.
- Collect anonymized real SMS fixtures for bKash, EBL, City Bank, and Pathao
  Pay.
- Add parser regression tests from those anonymized fixtures before expanding
  parser behavior.

Acceptance checks:

- Full Docker stack starts with `postgres`, `finance-api`, and `finance-web`.
- Android receives allowed sender SMS messages and stores them in the local raw
  queue without capturing unrelated senders.
- Cookie-backed login, refresh, logout, and authenticated workspace API calls
  work without browser localStorage tokens.
- Real fixture tests document supported and unsupported SMS formats.

## Priority 2: SMS Parsing And Review Upgrades

Goal: make automatic transaction capture more accurate while keeping user
review in control.

Tasks:

- Expand provider parsing from real fixture variants, including fees, partial
  reversals, refunds, failed transactions, card settlement messages, and
  ambiguous transfers.
- Add editable parser mapping rules for power users, scoped by provider and
  sender rule.
- Add review actions for bulk confirm, bulk ignore, and "always ignore this
  sender/body pattern".
- Add parser health reporting: unsupported format count, duplicate count,
  confidence distribution, and latest parse failures.
- Add candidate merge support for related SMS messages that describe the same
  transfer from two sides.

Acceptance checks:

- New parser behavior is covered by anonymized fixture tests.
- Low-confidence or ambiguous messages stay in review instead of creating
  transactions automatically.
- Duplicate candidates do not create duplicate transactions.

## Priority 3: Ledger Reliability And Reconciliation

Goal: make the system trustworthy enough to become the primary finance record.

Tasks:

- Add account balance ledger snapshots by day and month.
- Add reconciliation history with unresolved/resolved status and reviewer notes.
- Add stricter transfer invariants so internal transfers require both source and
  destination accounts.
- Add immutable audit views for transaction creation, updates, deletes, SMS
  confirmation links, and reconciliation decisions.
- Add export bundles containing transactions, accounts, categories, payment
  methods, raw-message metadata, and audit logs.

Acceptance checks:

- Account balances can be explained from opening balance plus ledger movement.
- Reconciliation differences have a clear lifecycle and history.
- Exports are enough to rebuild or audit the user's finance record.

## Priority 4: Product Workflow Polish

Goal: reduce daily friction on web and mobile without hiding important finance
state.

Tasks:

- Add dashboard summaries for cashflow, top categories, upcoming bills, open
  debts, card bill due dates, and unresolved reconciliation differences.
- Add faster transaction entry with recent category/payment-method suggestions.
- Add web table improvements: saved filters, column visibility, date presets,
  keyboard-friendly editing, and better mobile-width behavior.
- Add mobile notification or local reminder support for bill due dates,
  reconciliation checks, and failed sync items.
- Add onboarding screens for first account, first payment method, sender rules,
  and backup setup.

Acceptance checks:

- A user can complete daily entry, SMS review, and monthly reconciliation without
  reading setup docs.
- Empty, error, offline, and permission states are explicit.
- UI changes keep finance data dense, scannable, and audit-friendly.

## Priority 5: Deployment, Security, And Backup

Goal: move from local-only usage toward a reliable private deployment.

Tasks:

- Choose the first deployment target and document environment-specific settings.
- Add CI checks for backend tests, web typecheck/lint/build, mobile typecheck,
  contract generation, and OpenAPI drift.
- Add encrypted remote backup storage with retention, restore drills, and
  monitoring alerts.
- Add production observability for API errors, failed SMS imports, parser
  failures, auth refresh failures, and backup job status.
- Add secret rotation runbooks for Django secret key, database credentials, JWT
  signing settings, and deployment tokens.

Acceptance checks:

- A fresh environment can be deployed from documented commands.
- Backup restore is tested, not just scripted.
- Production cannot start with unsafe local defaults.

## Priority 6: Analytics And Smart Assistance

Goal: add helpful intelligence while preserving deterministic money records.

Tasks:

- Add category trend reports, monthly comparisons, budget thresholds, and
  recurring expense detection.
- Add anomaly detection for unusual transaction amount, unknown merchant,
  duplicate-looking payment, or unexpected balance drop.
- Add optional AI-assisted categorization suggestions with a clear review step.
- Add natural-language search over transactions, debts, bills, and notes.
- Add forecasting for upcoming bills, card payments, debt repayments, and
  expected month-end balance.

Acceptance checks:

- AI or smart suggestions never silently modify committed transactions.
- The user can see why a suggestion was made.
- Analytics can be exported or traced back to source transactions.

## Priority 7: Multi-User Or Product Upgrade Path

Goal: keep a path open if the personal system becomes a shared product.

Tasks:

- Add tenant/workspace boundaries before adding multiple users.
- Add role-based permissions for owner, editor, and read-only reviewer.
- Add per-workspace encryption and data retention policies.
- Add import tools for existing spreadsheets and bank exports.
- Add billing/subscription only after privacy, backup, audit, and tenant
  isolation are production-grade.

Acceptance checks:

- No user can access another workspace's financial data.
- Administrative actions are audited.
- Product features do not weaken the single-user personal finance workflow.

## Fastest Useful Next Targets

These are the best short tasks to pick next because they are small, valuable,
and do not require changing the whole architecture:

1. Add real-fixture parser test placeholders and an anonymization guide.
2. Add parser health counts to the backend review inbox response.
3. Add bulk ignore and bulk confirm actions to web SMS review.
4. Add first dashboard summary cards for unresolved review items, upcoming bills,
   open debts, and reconciliation differences.
5. Add CI workflow documentation and a local command checklist.
