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
npm run test:auth
npm run test:workflows
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
- Search across reference, counterparty, note, and duplicate key. Done.
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

## Recently Added and Updated Transactions

Transactions offers By transaction date, Recently added and Recently updated
views. Recently added sorts by ledger `created_at`, clears the transaction-month restriction when
selected, and displays an Added timestamp in the browser's local timezone next
to the original transaction date/time. Other filters remain available; dates use the selected transaction/added/updated
basis (Recently added selects Added date, Recently updated selects Updated date). Switching back opens the
current transaction month. Ordering and an explicitly empty month survive URL
reloads, including Clear filters. Newly added backdated records appear first.
Edits and extra evidence linked to an existing transfer do not change its added
time or produce another ledger record. Recently updated sorts by `updated_at`
and shows an Updated timestamp for the latest save, including new entries,
edits, newly linked transfer evidence and merges. Reads and transfer retries do
not promote entries. It uses the same All dates default, remaining filters and
URL persistence as Recently added. This is a latest-first view, with no fixed
lookback period. CSV export retains chronological order.

Month arrows and the month input update immediately and stay usable while data
loads. A 250 ms debounce combines rapid month changes into one transaction
request. Each new selection cancels queued/in-flight work; a request-generation
guard also prevents late responses or errors from replacing the latest selection.
Apply filters, Clear and ordering switches load immediately and cancel a pending
month request. Previous results remain visible with their original ordering and
a loading message identifying the requested and displayed month. A failed
refresh preserves those results and offers Retry loading transactions. Initial
loads still use the page loading/error state.

Navigation reuses the workspace's account, category and payment-method lists;
only transactions are fetched again. Initial loads and successful transaction
mutations refresh all four lists so account balances stay current. This reuse is
limited to the mounted workspace, with no persistent transaction cache.

## Original SMS in the Transaction Editor

Edit transaction opens an expanded Original SMS section above the fields.
It loads source messages on demand and shows the full plain text, sender and
received date/time in the browser's timezone. Matched transfers show all linked
SMS once each. Line breaks are preserved and long text wraps at phone widths.
The section can be collapsed. Redacted/excluded messages display an unavailable
notice, and entries without SMS display an empty explanation. Loading failures
offer Retry loading SMS while the form remains usable. Closing or changing the
editor discards its component state; delayed responses cannot populate another
entry. SMS bodies are not saved to browser storage or copied into transaction
notes, and reading them does not update the ledger timestamp. The cookie proxy
preserves the API's private/no-store cache header for these responses.

## Skipping Promotional Messages

Promotional offers are excluded by default, including recognized English/Bangla
anniversary messages with numbers or links. SMS settings exposes Promotional:
Excluded/Allowed alongside OTP/security and balance-notice controls. Reject's
Apply to menu includes “This message and skip its non-transaction type”; this
saves a recognized type exclusion and removes matching pending notices without
disabling the bank sender. Unknown formats and financial messages cannot be
learned as skip types. Undo through SMS settings. Reapply rules to pending after
the API migration to remove older offers already in review.

## Complete Ledger Editing

The transaction editor exposes date/time, type, direction, account, destination,
category, amount, reported balance, transaction reference, counterparty, note,
payment method, source, review status and all four masked sender/receiver
identifiers. Payment-method choices belong to the selected account; changing
that account clears its payment method; the reported balance is cleared only if
its reporting account changes. Needs review is
also visible in the transaction list. Full numeric identifiers are reduced to
safe suffixes by the API. Original SMS and generated IDs/timestamps remain
read-only evidence; corrections are available in History.

Transfers use From account and To account, with Reverse transfer direction
swapping them and clearing the payment method. A reversal clears the reported
balance when its reporting account changes. They are saved
as canonical debit transfers. Changing the amount, accounts or type of an entry
with multiple transfer observations requires the checkbox acknowledging that
the linked messages were reviewed. Core edits reset that acknowledgement and
Save stays disabled until it is checked. The request sends
`allow_linked_correction=true`; the API independently enforces the requirement.
Account corrections clear old balances/fees on remapped observations. Changing
type retains linked SMS as history while web/API reporting ignores historical
transfer balances. Original SMS is never rewritten by these edits. Identifier
fields use two columns on desktop and one on phones inside the scrollable
viewport modal.

## Optional References

Add/Edit transaction labels the field Reference and explains that it is optional
and may repeat. It holds the bank/wallet Ref or TrxID, rather than the generated
transaction UUID; search uses the same terminology. Synthetic examples include
`DEMO-TRF-1042`, `DEMO-PAY-7Q2M` and `DEMO-ATM-0091`. Leave it blank if the provider
supplies no code; no invented unique value is required.

Distinct SMS may reuse references. Transfer matching still requires compatible
accounts, equal currencies/principal and nearby dates; its explanation identifies
reference agreement as supporting evidence. Users accept a match to retain both
observations on one ledger movement. The same SMS cannot be added again merely
by editing its reference.

## Category and Type Decisions

Add/Edit transaction and SMS review ask before applying a category whose kind
conflicts with the draft type. Change category and type applies both; Keep current
type changes only the category; Cancel leaves both unchanged. Nothing is persisted
until Save/Update/Confirm. Expense categories preserve fee types, income categories
preserve refunds, and debt categories require choosing lending, borrowing or a
repayment direction. System categories and No category do not infer a type.
Manual type selection remains available.

A type change resets debit/credit to its default; leaving a transfer clears the
other account. Reported balances, including zero, survive type/category changes
while the reporting account stays the same in Add/Edit and SMS review. A new transfer requires
another account. SMS confirmation respects explicit reclassification instead of
reopening a transfer match based solely on the original parser result. Linked
ledger corrections still require reviewing and acknowledging the original SMS.

## Actionable Request Errors

The shared client reads API detail and validation errors with readable field labels
(for example, “Amount: Enter a valid number.”). Forms retain entered values and show
inline errors plus persistent, dismissible toasts inside the active dialog.
Permission, missing-item, conflict, throttling, server and connection failures have
clear fallback/retry messages. Server failure bodies are ignored to avoid rendering
debug or HTML content. Confirmed 401 responses retain the existing session recovery
flow; other failures do not sign the user out. `npm run test:workflows` covers error
formatting, safe fallbacks and category/type compatibility without a running API.

## Loading Reported Balances While Editing

The editor loads the stored transaction balance, including zero. If a transfer's
main balance is empty, it uses only the primary transfer report identified by the
API. It never substitutes the opposite account's balance or a calculated ledger
balance. The field identifies the reporting account, and an expanded Saved transfer
reported balances section shows each linked account's stored balance separately.
Missing balances remain blank. Type, category, direction and ordinary detail
changes preserve the report while its account stays the same. Changing the other
side of a transfer also preserves the primary report. Changing the reporting
account or reversing a transfer to a different reporting account clears the draft
with an inline explanation; users may enter a balance for the new account. Other
linked observations remain read-only. Explicitly blanking the field persists a
clear and is not restored on later updates. These rules also apply to manual Add
transaction and SMS review. The API enforces the same account ownership rule.

## Statement PDF Imports

The authenticated `/statements` page accepts supported BDT bank/wallet PDFs and
saves review drafts. Uploading does not post transactions. Choose the reporting
account, upload a PDF, inspect original checks, then review rows individually or
explicitly approve validated new rows on the visible page (maximum 50).

Saved import history preserves corrections and decisions across navigation and
same-file retries. Filters cover review state, search, debit/credit, type,
category and dates across the entire batch; results paginate in groups of 50.
Search/filter requests are debounced and stale responses aborted. Row actions
wait for the displayed filters to finish loading. Tables scroll within their
container on phones.

The viewport-centered row editor shows immutable masked extraction alongside
editable date/time/value date, type/direction, other owned account, category,
amount, reported balance, reference, counterparty and note. Category/type changes
reuse the existing confirmation flow and preserve reported balance, including
zero. Save draft changes before accepting a match or adding. Possible matches
show their evidence; accepting counts one existing movement and preserves its
corrections. Adding despite suggestions requires a separate-movement confirmation.
Source discrepancies and balance conflicts require acknowledgement. Inline wallet
fees have independent review rows.

Resolved rows can be reopened (skipped) or unlinked; unlinking leaves the ledger
entry. Make ledger corrections in Transactions, where linked original statement
rows load on demand. Readable inline errors and toasts include reload recovery
for stale versions. Reloading dismisses the obsolete error notification. Bulk approval reports added/unchanged/unresolved counts and
checks matches again on the server.

Multipart uploads use the cookie proxy with session refresh and body limits.
Passwords clear on submission and are never stored in the browser. Cancellation
aborts the response; a server draft may still finish and appear in history, but
upload never posts. Limits are 4 MiB, 30 pages and supported digital layouts;
scans and credit-card billing statements remain unsupported. Original PDFs and
passwords are discarded; masked rows are retained as evidence.

### Faster statement review

Statement review shows strong/possible match explanations, separate saved-draft
reconciliation and an import summary. Summary amounts describe draft observations;
linked ledger transactions may have later corrections. Skipped rows still contribute
to the statement's arithmetic, while decision counts show review progress.

Select unresolved rows on the current page to approve validated new rows or skip
selected rows. Confirmation captures their IDs/versions; fresh matches, stale
versions and source/draft discrepancies stay for individual review. Selection clears
when the import, page or applied filters change. Bulk skipping never deletes ledger
records. The existing approve-all-new action remains available for each page.

The row editor supports Save & next and Next unresolved row, including later pages
under the current filters. Save changes before moving next. Shortcuts within the
editor: Alt+S saves, Alt+Shift+S saves and moves next, Alt+Right opens the next row.
These controls never approve transactions implicitly.

Remember my choices is explicit on individual add/link decisions. A later matching
source pattern offers Apply suggested choices for type/category/other owned account;
applying it creates an unsaved draft change and preserves reported financial fields.
Save and review before posting. Generic transfer descriptions are not learned.

The statement review table displays PDF rows alongside ledger suggestions, with
explicit confirmation in the row editor. The Statement vs ledger section shows
comparison counts and a paginated ledger-only list for the selected account's
printed statement period. Entries with pending suggestions are excluded from the
ledger-only list. Warnings identify provisional coverage; absence never triggers
automatic deletion. Linked rows retain printed date/time/description/balance as
separate statement evidence accessible from Transactions.

Statement rows with stale financial links display “Linked entry needs review”
instead of “Confirmed match”. The row editor shows correction issues even while
evidence is attached; unlink evidence to review again without deleting money.

The dashboard offers Daily, Monthly and Custom range controls, inclusive of both
selected dates. Daily/month navigation remains available during loading; requests
are debounced for 250 ms and aborted/ignored on a newer selection. Existing data
stays visible with its loaded date label until the next response succeeds.
Income, spending, net movement, daily chart and recent transactions use the same
period. Current net position, device health and pending-review queue remain live.
Custom dates apply together and are limited to 366 days. The BDT chart uses complete
API daily totals rather than a possibly paginated transaction list. Transfers are
excluded from income/spending and uncategorized spending is included.

Payment-method settings let users save bank/card identifier types, multiple masked
identifiers with friendly labels, and newline-separated text aliases. Transactions
have an Identifier display selector: Numbers (default), Labels, or Both. The
preference is stored locally per signed-in user; ambiguous/unmapped numbers remain
visible. Labels are derived from current settings, never written into transactions.
Editing forms, CSV exports and original source evidence retain their identifiers.
Saved statement headers show account mapping suggestions/conflicts, while transfer
row suggestions can use a mapped number or confirmed text alias. Suggestions
require review and never record money by themselves.

## Shared date controls and backend availability

Daily, Monthly and Custom range controls are shared by the dashboard, reports,
transactions, SMS review, statement imports/rows/ledger comparison, debt history,
credit-card bills, recurring bills, reconciliation snapshots and audit history.
Dashboard/reports start in the current month; other histories offer All dates.
Transactions retain their current-month default and share the selected period and
date basis in the URL. Transaction, Added and Updated date are separate choices;
Recently added/updated selects the corresponding date basis and opens All dates.
CSV exports use the same date basis and inclusive boundaries as the table.

Each view labels its date basis: SMS received time, bill statement/due date, debt
opened/due date, next bill due date, snapshot check time or audit event time.
Timestamp collections filtered in the browser use the browser's local calendar;
server-filtered transaction/import timestamps use the API's Asia/Dhaka timezone.
Date-only fields keep their recorded calendar day. Unknown dates remain visible
under All dates and are excluded from a chosen period. Current balances, outstanding
totals, forms and review counts stay live while their history tables are filtered.

Custom ranges apply both dates together and allow at most 366 inclusive days.
Date navigation stays enabled during loading. Server-filtered views cancel stale
requests; reports, transactions and statement histories debounce rapid changes.
Paginated statement views filter on the API before pagination. Ledger-only date
filters narrow the table inside the printed statement period; comparison totals
continue to describe the whole statement.

A root-level heartbeat calls the public same-origin `/api/health` proxy when the
app opens and every ten minutes while online. The proxy checks the configured
backend `/api/health/` without credentials, auth refresh, financial data or caching.
Requests have bounded timeouts; failures stay quiet. Reconnection or returning to
the tab checks again if due. Tabs share their latest successful check through
optional local storage, reducing repeat traffic. Browser suspension/closure stops
reliable scheduling: this is best-effort keep-alive, not an uptime guarantee.

Run `npm run test:dates` for calendar, range, heartbeat timing/offline/abort checks.

Date-control browser QA used the installed Playwright/Chromium fallback because
the Browser plugin was unavailable. Synthetic data in an isolated temporary
SQLite database covered desktop and 390px mobile layouts, daily/custom filtering,
rapid navigation, URL restoration, matching CSV exports and paginated statements.
The actual login-page heartbeat was verified with accelerated browser time,
including offline/reconnect behavior. No production financial data was used.

## Account numbers and PDF account suggestions

Accounts → Add/Edit account includes optional recognition metadata: bank/wallet
provider, masked account/card number or last four digits, additional cards/accounts
with labels, and text aliases. Credit-card creation defaults the number kind to
Card; bank/wallet numbers use Account. Full numeric input is reduced to the last
four digits before transmission, and the API repeats this validation. Account
search includes saved masked identifiers, labels, and aliases. Disabling the
profile preserves its values and does not disable other payment methods in SMS
settings. Those settings share the same registry; historical ledger values remain
unchanged.

Choosing a PDF starts a read-only account check before import. The form shows the
masked header and a suggested account with a Use suggested account button. A
manually selected account remains selected; a differing suggestion produces a
warning. Missing or ambiguous matches require manual selection. Locked PDFs can
be retried with the transient password via Check account suggestion. Passwords
are cleared when uploading the draft; no browser persistence is used. Changing
file/password aborts pending recognition, and stale replies cannot change the
suggestion. Cancel account check allows immediate manual selection/import. Import waits for an active recognition check and still creates only a
review draft. Recognition failures allow manual selection and normal import.

Run `npm run test:identities` for request-masking regressions, alongside typecheck,
lint, and build. Card-billing statements and scans still require new parsers.

Masked identifiers exposing more than ten digits also reduce to a last-four
suffix, so adding a mask character cannot preserve a nearly complete card number.
