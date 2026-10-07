# finance-web

Next.js web dashboard for managing and reviewing the finance system.

## Current Status

The web app is scaffolded with:

- Next.js App Router
- TypeScript
- Environment-based API URL
- Server-rendered backend health check
- Initial dashboard shell
- Login page connected to JWT auth
- Shared session guard and header account menu with sign out
- Transactions page that loads accounts, categories, and transactions
- Manual transaction creation form
- Manual transaction update form
- Transaction deletion from the list
- Transaction filters for month, type, debit/credit direction, source, account, category, and search text
- Transaction CSV export using the active filters
- Web API input/filter typing reuses generated OpenAPI request and enum types
- Per-transaction history links into the audit log viewer
- Accounts page with account and category creation/listing/updating/deletion,
  derived ledger balances, and latest provider-reported balance evidence
- SMS settings page with payment method and sender rule creation/listing/updating/deletion
- SMS capture policy controls for provider, OTP/security, and balance-notice
  exclusions enforced by the API
- SMS settings provider options align with contract-supported bKash, EBL, City Bank, and Pathao Pay sources
- SMS review inbox with parsed candidate details, parser confidence,
  review/duplicate reasons, internal-transfer hints, raw SMS redaction,
  confirm, and structured rejection actions that can also exclude a sender or
  provider
- Transaction table displays debit/credit direction, reported balance after, provider
  reference, and sent-to/received-from text when available
- Monthly reports page with income, expense, net, category, and account totals
- Debts page with debt/lend creation, person-wise balances, due tracking, and
  repayment recording
- Credit card bills page with statement balances, due dates, minimum dues,
  open/overdue totals, and payment recording
- Recurring bills page with repeating payment schedules, due/overdue totals,
  reminder windows, and payment recording
- Reconciliation page with expected-vs-actual balance checks, snapshot history,
  status warnings, and likely missing/duplicate money causes
- Audit logs page with transaction create/update/delete history, URL-backed
  filters, and before/after snapshots

## Responsibilities

- Main dashboard
- Spreadsheet-like transaction table
- Account management
- Payment method management
- Category management
- Monthly reports
- SMS review inbox
- Debt and lend management
- Credit card bill management
- Recurring bill management
- Reconciliation workflow
- Transaction audit review

## Suggested Stack

- Next.js App Router
- TypeScript
- React
- TanStack Query
- React Hook Form
- Zod
- Tailwind CSS or the chosen design system
- Generated API client from `finance-contracts` later

## Local Setup

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
cp .env.example .env.local
```

Start the backend API from `../finance-api`, then run the web app:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

The dashboard will call:

```txt
http://localhost:8000/api/health/
```

Create a backend user first:

```bash
cd ../finance-api
python manage.py createsuperuser
```

Then open the login page:

```txt
http://localhost:3000/login
```

For the local development version, JWT tokens are stored in browser
`localStorage`. Production builds always disable this temporary browser token
storage. In production, the shared session guard and login use
same-origin Next.js auth routes that store access and refresh tokens in
HTTP-only, Secure, SameSite=Strict cookies. Authenticated workspace API calls
use a same-origin backend proxy, so refresh tokens stay out of browser
JavaScript. Concurrent refresh attempts share one rotation result. For local
development, authenticated web API calls use the stored refresh token to rotate
tokens and retry once after an expired access token response.
See `../../docs/auth-token-storage-plan.md`.

All financial workspaces require a verified session. Missing credentials and
confirmed expiry open the dedicated login page, preserving a validated internal
return path and filters. The account menu in every workspace exposes Sign out.
Logout clears the visible workspace and credentials and returns to login;
already signed-in users visiting login return to their workspace. Successful
sign-in/logout discard page caches with fresh navigation. Unsubmitted financial
forms are not replayed after reauthentication.

Temporary session-check/refresh outages keep credentials and offer Try again.
Production middleware checks cookie presence early; the current-user endpoint
and Django authorization verify identity and permissions. Cookie auth routes
return 401 only for confirmed authentication failure and 502 for upstream
outages, preserving cookies on the latter. Cross-tab logout uses session-only
BroadcastChannel messages, with storage/focus checks as fallbacks.

Run `npm run test:auth` for return-path and auth-error regression checks, alongside
`npm run typecheck`, `npm run lint`, and `npm run build`.

Transactions page:

```txt
http://localhost:3000/transactions
```

Accounts and categories:

```txt
http://localhost:3000/accounts
```

Create at least one account before using the transaction form. Categories are
optional but recommended for useful monthly reports.

Monthly reports:

```txt
http://localhost:3000/reports
```

Payment methods and SMS sender rules:

```txt
http://localhost:3000/sms-settings
```

SMS review inbox:

```txt
http://localhost:3000/messages/review
```

Audit logs:

```txt
http://localhost:3000/audit-logs
```

## Docker

From `projects/finance-infra`:

```bash
cp .env.example .env
docker compose up --build -d postgres finance-api finance-web
```

Important environment note:

- `NEXT_PUBLIC_API_BASE_URL` is used by browser-side calls.
- `NEXT_SERVER_API_BASE_URL` is used by server-rendered calls.

## Verification

```bash
npm run typecheck
npm run lint
```

## Primary Screens

```txt
/dashboard
/transactions
/accounts
/sms-settings
/messages/review
/debts
/credit-cards
/recurring-bills
/reports/monthly
/reconciliation
/audit-logs
/settings
```

## Transaction Table Requirements

- Fast date/month filters.
- Account filter.
- Category filter.
- Search across transaction ID, counterparty, note, and duplicate key. Done.
- Source filter for web, mobile, SMS, import, and system-created rows. Done.
- Display mode switch:
  - spreadsheet mode: expenses negative, income positive
  - ledger mode: positive amount plus transaction type
  - money in/out mode: separate columns
- Bulk edit later.
- CSV export. Done for active transaction filters, including source and search text.

## Dashboard Requirements

- Current total balance.
- Account balances.
- This month income.
- This month expense.
- This month savings.
- Category breakdown.
- Pending SMS review count.
- Missing/reconciliation amount warnings.

## Reconciliation UX

The user can enter the real-life balance for an account. The UI shows:

- Expected balance.
- Actual balance.
- Difference.
- Possible causes: missing expense, missing income, wrong account, duplicate.
- Synced account selection between the check panel and snapshot form. Done.
- Button to create an adjustment transaction.

## Phase 1 Web Milestones

1. Connect to backend health endpoint. Done.
2. Login screen. Done.
3. Dashboard shell. Done.
4. Accounts CRUD. Done.
5. Categories CRUD. Done.
6. Transaction table and form. Done.
7. Monthly report. Done.
8. Payment methods and sender rules. Done.
9. Debt/lending dashboard. Done.
10. Balance reconciliation screen. Done.
11. Credit card bill tracking. Done.
12. Recurring bill tracking. Done.

## Suggested Transfer Matches

Manual transfer creation and SMS confirmation check for matching existing
transfers or opposite pending SMS before saving. The match dialog requires an
explicit link/confirm-as-one action and offers Keep separate and Cancel.
Account history includes incoming transfers with a credit sign. The ledger
shows both account names and linked account-specific references/balances.
“Find match” on a saved transfer supports audited merging of already-posted
duplicates. A manual credit transfer is entered from the receiving account;
choose its sender as the other transfer account. SMS review uses the same
selected-account perspective: Credit receives from the other account and Debit
sends to it. Incoming SMS preselects the receiving account and Credit. The API
normalizes both flows to canonical source/destination order. Matching never
automatically changes the ledger.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.

## Collapsible Navigation

On screens wider than 820px, the header's Collapse sidebar button switches the
208px menu to a 72px icon rail, giving the workspace another 136px of width.
Expand sidebar restores the labels. Active routes and pending SMS badges remain
visible in either state; links retain accessible names and hover titles.

The preference is stored locally in `finance.sidebarCollapsed.v1` and survives
navigation and reloads. If browser storage is unavailable, the toggle still works
for the current session. At 820px and below, navigation uses the full off-canvas
menu. Returning to desktop closes an open mobile menu and restores the saved
desktop preference.

## Viewport Dialogs And Action Feedback

Transaction editors, account/category editors, SMS rejection, and transfer
matching use native modal dialogs portaled to the document body. They center
within the visible viewport and scroll internally for long forms, including
when the page was already scrolled. Native focus trapping and Escape dismissal
are available; Escape closes the top dialog and focus returns to its trigger.
Dismissal is disabled while a save is running. Page scrolling is locked until
all nested dialogs close.

A shared toast provider gives success/error feedback for transaction actions,
SMS review, setup, debt and bill forms, reconciliation, and SMS settings. Toasts
anchor to the viewport and render inside the active modal when one is open, so
errors remain visible above the modal backdrop. Successes dismiss after six
seconds, paused while hovered or focused. Errors remain until dismissed or
replaced by a later notification. Existing inline feedback is retained for
context; repeating the same action produces a fresh notification.

## SMS Review Queue

Queue items show the SMS received date and time in the browser's local timezone.
Provider, review-state, category, and transaction-type filters combine with
search. Category filtering includes Uncategorized and uses parsed/remembered
candidate values, not unsaved detail-form choices. All filters remain available
on phone layouts. Received time is not a separately parsed bank transaction time.

## Transfer Suggestions In SMS Review

The Other transfer account dropdown displays a suggested account and its reason:
saved identifier evidence, remembered choices, matching confirmed history, or
account/payment-method name and provider alias. Ambiguous matches keep the field
unresolved with an explanation. Suggestions can be changed and still require
confirmation or acceptance of a transaction match.

The selected Account remains the reporting account; Debit/Credit describes its
balance effect. Remembered direction corrections populate that control, so a
receiving SMS keeps the reporting account as the destination. The masked
identifier inputs are evidence fields, not account selectors. The review grid
shrinks to phone widths so suggestion explanations remain visible. For older
pending items, use Re-run parser or Reapply rules to pending after the API migration.

## Recently Added Transactions

Transactions offers By transaction date and Recently added views. Recently added
sorts by ledger `created_at`, clears the transaction-month restriction when
selected, and displays an Added timestamp in the browser's local timezone next
to the original transaction date/time. Other filters remain available; selecting
a month still filters the original transaction date. Switching back opens the
current transaction month. Ordering and an explicitly empty month survive URL
reloads, including Clear filters. Newly added backdated records appear first.
Edits and extra evidence linked to an existing transfer do not change its added
time or produce another ledger record. CSV export retains chronological order.

## Skipping Promotional Messages

Promotional offers are excluded by default, including recognized English/Bangla
anniversary messages with numbers or links. SMS settings exposes Promotional:
Excluded/Allowed alongside OTP/security and balance-notice controls. Reject's
Apply to menu includes “This message and skip its non-transaction type”; this
saves a recognized type exclusion and removes matching pending notices without
disabling the bank sender. Unknown formats and financial messages cannot be
learned as skip types. Undo through SMS settings. Reapply rules to pending after
the API migration to remove older offers already in review.
