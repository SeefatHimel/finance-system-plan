# finance-web

When editing a transaction with an attached bank SMS, the editor warns if the
SMS sender conflicts with the selected account's known bank provider. The
source check must finish before an edit can be saved; if it fails, the reviewer
can retry loading the Original SMS. For a
generic bank deposit, it also warns when a category, counterparty, or note
claims details absent from the SMS. Reviewers must acknowledge visible warnings
before saving; they can still keep a verified choice based on other evidence.
The app does not alter existing ledger entries automatically.

The Transactions page has a **Check transactions** action. It scans 50 entries
at a time with the current rules, shows issues and advisory category suggestions,
and opens any finding in the existing transaction editor. A further 50 can be
checked from the result panel; checking again starts a fresh scan. This action
does not update past entries automatically.

Next.js web dashboard for managing and reviewing the finance system.

## Account Lanes timeline

`/timeline` shows selected accounts as parallel lanes. Scroll upward for earlier
days or downward for later days; the date control follows the visible day and
can jump to another date. The view keeps 21 days mounted and fetches complete
seven-day transaction activity windows on demand, paging through the existing
`GET /api/transactions/activity/` endpoint. It retains at most five fetched
weeks around the viewport, so long browsing does not keep an ever-growing
timeline in memory. The Amount, Balance, and Both controls change the visible
card values without editing ledger data. Transactions without a reported time
stay in a separate disclosure for their day.

A transfer appears in each selected involved account lane but remains one ledger
entry. If the other account is hidden, a “Show lane” link and the details panel
make that connection visible. Selecting a card opens account-specific reported
balances, the note, and linked SMS/statement sources; “Open ledger entry” uses
the existing editor. Possible balance gaps are advisory and are calculated only
between ordered reports when every day in that interval is loaded and no
time-unknown or differently dated account observation could change the order.
No transaction or balance is created by the timeline.

The avatar menu opens `/profile`, where users can edit their first name, last
name, and email. The username is shown read-only because it is the sign-in
identifier. Appearance can follow the operating system or be set to Light or
Dark. That choice is saved in this browser under `finance.theme.v1` and applies
to the web app; it does not change the separate mobile app. The light profile
header uses the generated `public/profile/mint-contours.png` asset.

The dashboard loads bounded activity previews with exact server counts. SMS
review initially loads 100 candidates and offers “Load 100 more messages” for
older work. Client-side review filters apply to the loaded portion and say so
until the full queue is loaded. The sidebar badge uses the exact queue count.
Production images use `Dockerfile.prod` with `next build` and `next start`;
the default Dockerfile remains for local development.

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
- Per-transaction history links into the audit log viewer, where updates show
  changed fields as before → after values and full JSON snapshots remain expandable
- Accounts page with account and category creation/listing/updating/deletion,
  derived ledger balances, latest provider-reported balance evidence, and
  all-time ledger transaction counts per category. A count opens the matching
  transactions; category totals are omitted because currencies and movement
  types can differ.
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
JavaScript. Concurrent refresh attempts within one Next.js process share one
rotation result, including slow in-flight requests. Successful results are reused
for five seconds after completion; failures are not cached. For local
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
outages. Replacement cookies are preserved even if the first profile or proxied
request after rotation fails. Automatic check/proxy failures do not erase cookies:
a late response may belong to a superseded session. Explicit sign-out clears
cookies; invalid/expired credentials still fail backend authorization and open
login after a fresh check. Cross-tab logout uses session-only
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
optional but recommended for useful monthly reports. The category table sorts
names alphabetically. Deleting an unused category returns a successful empty
response and removes it from the table; categories linked to ledger transactions
remain protected with a clear validation error.

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

## Transaction Search

Transaction search uses the backend across all ledger fields, including account
and category names, payment methods, amounts, balances, ISO dates/times, type,
direction, source, identifiers, references, notes and linked transfer evidence.
The hint and placeholder describe the expanded scope. Space-separated terms
can match different fields (for example `Food 500`); quotes keep a phrase together.
Formatted amounts such as `1,234.50` are accepted. Apply filters preserves the
date/account/category scope, URL search restoration and CSV parity. Search is
case-insensitive and limited to 256 characters/12 terms; an overlong term list
uses the existing validation/toast feedback.

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

The match dialog uses most of the viewport, up to 1100px wide. Its verification
warning and Entry being reviewed card stay above an independently scrolling
match list; Cancel and Keep separate remain at the bottom. Matches use two
columns on desktop and one on phones. The submitted draft, including edited
values, shows the same account path, amount, date and time as match cards.
References are hidden in this comparison. Missing times are explicit. Credit
drafts display sender-to-receiver order; saved-transfer Find match retains its
time and reference for matching. Match reasons and pending/recorded context stay
visible before the user links or keeps entries separate.

The transaction Add/Edit dialog uses a viewport-height layout up to 1000px wide.
Only its form scrolls; the header keeps the edited account/amount/date/time and
linked-correction warnings or validation errors visible. Shared dialogs ignore
backdrop clicks, including drags ending outside, to prevent accidental dismissal.
Explicit close/cancel controls and Escape still dismiss while no action is busy.

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

The selected message header places a compact Debit/Credit button with a change
icon beside the amount. Its caption names the selected reporting account and
whether money moves into or out of it. A click, Enter or Space switches direction
without submitting or changing Type/Category, account choices or edited fields.
The existing type/category default rules still apply when classification changes.
A hidden direction input preserves the confirmation and transfer-match payload.
The large direction dropdown is removed; the button uses text as well as color,
a visible keyboard focus ring and a 44px target, and is disabled during confirmation.

A compact Received dates toolbar sits above both panes, with All dates, Daily,
Monthly and Custom range views. Day/month arrows and Today/Current month retain
shared date semantics; custom dates apply together after validation. The date
basis is the SMS received date in the browser's local timezone.

The queue keeps search and a Filters button visible. Provider, pending condition,
confidence, account involved, direction, category (including Uncategorized) and
transaction-type controls open in a
viewport-centered dialog and apply immediately. Escape closes it and restores
focus to the trigger. Removable filter chips and a filtered/total count show the
current scope. Clear filters resets message filter choices, retaining search and dates.
Type/category filters use parsed/remembered candidate values; correction, involved-account
and direction filters use the current draft. Confidence uses the parser score.

Each queue row shows amount alongside the received day and local time,
counterparty/provider, a correction/review/ready status and parser confidence. Date
and time stack in the right-hand column to preserve compact rows. The full
received timestamp and confidence also remain in the selected message details; the
date/time also has a timestamp tooltip. Desktop queue and detail panes scroll independently within the viewport.
The editor footer keeps Previous/Next, position, Reject and Confirm & add visible;
navigation also scrolls the selected queue row into view without moving the page.
On phones, the queue is a bounded vertical list above the full-height editor;
all filters and footer navigation remain available.

Masked identifiers and original SMS/parser evidence are collapsible. Both open
for low-confidence messages; identifiers also open when the reporting account is
missing, and evidence opens for duplicates. Collapsing identifiers retains the
inputs and their confirmation payload. Received time is not a separately parsed
bank transaction time.

For layout regression checks, use synthetic candidates to verify monthly/custom
filtering, combined filters and chip removal, an empty search, Escape/focus return,
Previous/Next, independent pane scrolling, and confirmation with identifiers
collapsed. Check a desktop viewport and a 390px phone for clipping and overflow.

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

Transactions with attached SMS or statement evidence also offer **Sources** in
the transaction list. This opens a read-only dialog with the saved messages and
statement rows, including archived PDF access when available. Opening Sources
does not start an edit or update the ledger.

Edit transaction opens an expanded Original SMS section above the fields.
It loads source messages on demand and shows the full plain text, sender and
received date/time in the browser's timezone. Matched transfers show all linked
SMS once each. Line breaks are preserved and long text wraps at phone widths.
The section can be collapsed. Redacted/excluded messages display an unavailable
notice. Entries without linked SMS hide the empty section. Loading failures
offer Retry loading SMS while the form remains usable. Closing or changing the
editor discards its component state; delayed responses cannot populate another
entry. SMS bodies are not saved to browser storage or copied into transaction
notes, and reading them does not update the ledger timestamp. The cookie proxy
preserves the API's private/no-store cache header for these responses.

The adjacent Statement evidence section shows each linked extracted row and
lets the owner open its archived PDF in the editor, then download or close it.
The PDF is fetched only when requested and its temporary browser URL is revoked
when closed. The same viewer is available from the statement import page. An
older import without an archived PDF shows a recovery link: upload the identical
PDF under the same account to attach it without changing review decisions or
posting duplicate money. Re-uploading a different PDF creates a separate import.
For older redacted transaction SMS, the editor points to Keep retention and the
mobile History scan; restoration requires the exact original SMS on the phone.

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
container on phones. A filter with no rows shows an empty state and resets stale
pagination. Statement details and reconciliation summary load independently, so
a temporary summary failure does not hide the selected statement or its rows.

The viewport-centered row editor shows immutable masked extraction alongside
editable date/time/value date, type/direction, other owned account, category,
amount, reported balance, reference, counterparty and note. Category/type changes
reuse the existing confirmation flow and preserve reported balance, including
zero. Save draft changes before accepting a match or adding. Possible matches
show their evidence; accepting counts one existing movement and preserves its
corrections. Adding despite suggestions requires a separate-movement confirmation.
Source discrepancies require acknowledgement. A reported-balance conflict
requires choosing the ledger or statement value for that account. Suggested
merchant, reference, note, and masked identifiers can be edited and selected
before accepting. Inline wallet fees have independent review rows.

Resolved rows can be reopened (skipped) or unlinked; unlinking leaves the ledger
entry. Make ledger corrections in Transactions, where linked original statement
rows load on demand. Readable inline errors and toasts include reload recovery
for stale versions. Reloading dismisses the obsolete error notification. Bulk approval reports added/unchanged/unresolved counts and
checks matches again on the server.

Multipart uploads use the cookie proxy with session refresh and body limits.
Passwords clear on submission and are never stored in the browser. Cancellation
aborts the response; a server draft may still finish and appear in history, but
upload never posts. Limits are 4 MiB, 30 pages and supported digital layouts;
scans and credit-card billing statements remain unsupported. Original PDFs are
retained encrypted and downloadable by their owner; unlock passwords are discarded.
Masked rows remain the review evidence.

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
Sort rows by statement order (default), date, or amount in either direction. Sorting
applies across the filtered import before pagination and returns to page one.

The row editor supports Save & next and Next unresolved row, including later pages
under the current filters. Save changes before moving next. Shortcuts within the
editor: Alt+S saves, Alt+Shift+S saves and moves next, Alt+Right opens the next row.
These controls never approve transactions implicitly.

The row dialog uses most of the viewport, with a scrolling review body and a
fixed decision footer. Every match fills the available width and compares the
saved statement draft with the existing ledger entry side by side; phones stack
the comparison. Match reasons expand on demand. Differing reported balances are
highlighted with an exact decimal difference, and the choice belongs to that
specific match. When two BDT reports differ by less than Tk 1, the higher value
is used automatically without an extra choice. Larger differences
still need a manual balance choice. Accept stays disabled until draft changes
are saved and any required source acknowledgments are checked. Saving refreshes
matches and clears choices. Linking retains both original observations and uses
the selected reported balance. Sub-taka BDT amount differences also use the
higher exact amount automatically. If a saved
statement category differs from the ledger category, a visible radio group
requires Keep ledger, Use statement, or Choose another before linking. The
chosen category and count-once result appear beside the action. Incompatible or
inactive statement categories cannot replace the ledger category; another
active category of the ledger transaction's type can be selected instead.
The other-owned-account field appears only for transfers. The classification
review checkbox confirms review and does not change the transaction type.

Remember my choices is explicit on individual add/link decisions. A later matching
source pattern offers Apply suggested choices for type/category/other owned account;
applying it creates an unsaved draft change and preserves reported financial fields.
When those suggested values already match the draft, the control shows Applied
instead of offering a redundant action. If applying a suggestion changes only
the category or counterparty, it keeps the existing transaction-type review;
changing the type or other owned account requires that review again.
Save and review before posting. Generic transfer descriptions are not learned.

The statement review table displays PDF rows alongside ledger suggestions, with
explicit confirmation in the row editor. If detailed pending-SMS matching exceeds
its safety limit, the editor explains the inconclusive check, links to SMS review,
and disables Add until matching can complete. The Statement vs ledger section shows
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

## Configurable Quick Add

Open **Quick Add presets** (`/quick-add`) to create, edit, duplicate, enable,
disable or reorder named shortcuts such as Lunch or Transport. Choose an
expense/income type and optional default account, category, amount, merchant
and note. Favorites feed the dashboard and global Quick Add menu; the initial
menu shows at most six, with See all for other enabled presets. Account/category
shortlists come from favorite presets and retain the current selection. See all
opens searchable active choices. No preset is created automatically.

A shortcut opens an amount-focused draft. It never saves by itself. Account,
category, type and optional details can be changed for one entry without editing
the preset. Switching presets preserves entered amount, note and merchant.
Full entry carries the complete draft into the existing transaction editor for
transfers and other advanced fields. The compact form supports expense/income.

Today and Now are defaults, resolved on the first Save. Yesterday, a calendar,
unknown time, or an hour-then-minute clock allow corrections. The web clock
supports tap/drag and exact hour/minute typing, including every minute and
AM/PM boundaries. The existing transaction editor also exposes this clock.
Dialogs stay centered in the viewport, scroll internally, and keep Save visible;
the phone toolbar has an accessible Quick Add button beside the account menu.

Saving uses the Quick Add API and refreshes mounted ledger/dashboard/accounts/
reports while preserving their filters. A successful Save displays a toast.
Before posting, the immutable request is stored in per-user/backend tab
`sessionStorage`. After an uncertain response, fields lock and Retry same entry
uses the same UUID and values, including after a reload. Closing the dialog keeps
that pending request. A known validation rejection permits correction. A 409
requires reviewing the ledger rather than creating a replacement automatically.
This is tab-local retry recovery; closing the browser tab may discard it. The
web client does not have a durable offline queue.

Checks: `npm run test:quick-add`, `npm run test:auth`, `npm run test:workflows`,
`npm run test:dates`, `npm run typecheck`, and `npm run build`. Browser QA uses
synthetic data, including a lost success response followed by reload and retry.

## Transfer direction and reported balance fields

Add/Edit transaction shows two optional account-labelled balance fields for a
transfer. Values are keyed by account ID, so reversing From/To preserves each
account's reported balance. Blank means unknown; zero and negative provider
balances are valid. The amount itself remains positive. Incoming income/refund
entries converted to transfers place the reporting account in To and ask the user
to select From. The receiving bank's SMS balance remains on that bank. Reopening
loads both saved reports; leaving a transfer selects the sending/receiving account
according to the chosen non-transfer type and keeps that account's balance.

Manual Add retains its reporting-account Debit/Credit perspective and labels each
balance as sending or receiving. Both reports are saved on one canonical transfer,
and existing matching/linking decisions remain explicit. All-account transaction
lists show internal transfers with a neutral unsigned amount; filtering a single
account shows its debit/credit sign. Transfers count as neither income nor expense.
Original SMS and statement evidence remains available in the editor. Existing
linked correction confirmation still applies when its accounts/type/amount change.

Verified with workflow tests, typecheck/lint/build and synthetic Playwright flows
for incoming conversion, reverse/reload, both balances, manual Add and mobile fit.

Deploy the updated API before this web workflow; both editable balances require
the account-bound report API. No database migration is needed for this change.

### Optional transfer fields and reported-balance comparison

The other-account selector appears only for transfers. The original reporting
account's balance stays visible even when it is the receiver or the transfer
is reversed. Expand “Other account’s reported balance (optional)” to edit a
second balance. Collapsing it preserves its value; saved evidence is also
collapsed by default.

Match dialogs show account-labelled balances for both entries. If the same
account has different reported balances, choose which entry's balance to keep
for each conflict before linking or merging. Nothing is preselected; “Keep
separate” remains available. Different sender/receiver balances and unknown
balances do not trigger this warning. The API rechecks reviewed values before
writing and rejects stale choices; cancel and search again if reports changed.

Payment methods remain optional account-linked instruments (for example a
bank account identifier, debit/credit card, cash, or wallet). Their provider,
masked identifiers and aliases assist SMS/PDF account recognition. They do
not replace the ledger account or add another transaction.

### Compact transfer help

Transfer matching and balance forms show concise labels. Info icons hold optional explanations (direction, reported balances, references, recognition instruments and match reasons); conflicts retain a visible “Balances differ” warning and explicit balance choices. Web help works on hover, keyboard focus or tap, remains hoverable, and closes on Escape, blur or outside tap. Help is rendered in the active dialog and positioned within the viewport so scroll containers cannot clip it. Matching dialogs initially focus their heading so help stays closed until interaction. Hidden help does not change stored values or merge validation.

### Short identifier review choices

Account recognition and payment-method identifiers accept at least three ending
digits. Prefer longer masked values; a three-digit SMS ending matches their ending
without adding another identifier. Full numbers entered in account settings are
encrypted by the API and displayed as a safe suffix; statement/ledger evidence
remains masked. Previously saved identifiers reduced to last-four must be
re-entered to recover the full number. Masked source evidence still matches by
safe suffix; a source exposing the complete number can use an exact encrypted-value
comparison to disambiguate equal suffixes.
One/two-digit suffixes are rejected.

SMS review shows sender/receiver account suggestions when only three digits
overlap, with the saved account and card/method name. No account or method is
preselected from weak evidence, even for one match or a stale parsed default.
Choosing a reporting-account suggestion also selects its payment method; choosing
the other transfer account respects the current Debit/Credit direction. Choices
only update the draft and preserve edited amount, note, time and category; the
user must still **Confirm & add** or explicitly accept a transfer match. Normal
account selectors remain available when the suggestion is wrong or absent.

Statement upload offers explicit account-choice buttons for weak/colliding header
identifiers and keeps the verification warning. Older APIs remain readable through
empty/default optional suggestion fields. Re-run the parser for older pending SMS
whose three-digit identifiers were previously discarded.

Visible prefix digits never satisfy the three-ending-digit minimum, even when a
masked value exposes more than ten digits. The form rejects those incomplete endings.

### Shared transaction editor and Edit/Undo recovery

Add and Edit use one controlled form, field order, validation and submit path.
Payment method, masked identifiers, source and review flag are available in both;
only original-source evidence and the linked-correction acknowledgement are edit
specific. The create request keeps one retry key for the opened form. Synchronous
submission guards prevent repeated Enter/click events from creating duplicates.

Successful additions, edits, SMS approvals and transfer resolutions show a
15-second toast with Edit and Undo (paused while hovered/focused). A compact
Last action bar on Transactions and SMS review remains after toast dismissal and
reload. It uses the server's latest user-owned descriptor, not browser-stored
financial snapshots. Edit opens the exact saved record through `?edit=<UUID>`
and fetches it directly even when current date/account filters exclude it. Undo
refreshes the transaction list/review queue and respects server stale-state
checks. The latest unchanged action can be undone for 24 hours; reading help or
pressing Edit never accepts or undoes a transaction. Auth changes clear recovery
state; late responses cannot carry it across users. Deletions and bulk PDF posting
are outside this recovery flow. Apply the API migration before deploying the web
client. Native recovery buttons are not part of this web editor change.

### Compact date/time and contextual transfer accounts

SMS review and the shared Add/Edit editor group date and time in one compact
form section. Controls wrap when available space or larger text requires it,
keeping separate labels, native pickers and comfortable tap targets. SMS review
shows From/To account selectors only for transfers, with labels following the
reporting account's Debit/Credit perspective. Non-transfer submissions explicitly
send no transfer account. Switching types preserves the other-account draft and
account-bound balances; returning to a transfer restores its prior direction
and account pair where the currently selected account still belongs to it.
Existing linked-transfer correction acknowledgement remains required.

### Account balance differences, status badges and browser icons

Accounts show each latest reported amount and date on separate lines. The API's
comparison at that report's cutoff appears beneath it: a red amount says how much
higher/lower the report is than the ledger, while a matching report is labelled
in green. Later activity does not create a mismatch. Missing/equal same-day times
show **Check report timing**; credit-card balances remain **Card balance
reference**, since providers may report available credit. The table-header help
explains this on hover/focus/tap. These hints never adjust balances. Older APIs
show **Comparison unavailable** rather than guessing from current balances.

Status badges use restrained dark-theme backgrounds, borders and readable text;
account Active/Inactive labels include a small decorative dot and remain plain
status text. The app's four-diamond SVG logo also supplies `app/favicon.ico` at
16/32/48/64 pixels and an opaque 180-pixel `app/apple-icon.png`. Next.js file-based
metadata serves all icon routes publicly, including the login page.

## Account table columns

Accounts has a Columns menu alongside search and filters. Type, Currency, Ledger
balance, Latest reported, and Status can be hidden independently. Name and Actions
stay visible so accounts can always be identified and edited. All columns are shown
initially; Show all restores that view. Preferences are saved only in this browser
under `finance.accounts.columns.v1`, separately from Transactions. Hiding columns
does not change balances, records, or search/filter results. The table narrows as
columns are hidden, with horizontal scrolling available on smaller screens.

### SMS review Focus mode

The expand button beside Previous/Next enters Focus mode for the whole review
workspace: received-date controls, searchable/filterable message queue and editor.
It fills the browser viewport, hides app chrome, and keeps an
amount/account/message-position header plus navigation, Reject and Confirm
actions visible. Desktop retains the side-by-side queue/editor; small screens
stack them. Hide/Show messages works on every screen size to give the editor more space without
remounting it. Exit focus or Escape returns to the same queue and outer-page
position. Matching, rejection and category dialogs handle Escape first. Focus
continues when approval/rejection advances to another message and exits when
the review queue is empty. A search, type/category/provider filter or received-date
range that returns no matches keeps Focus open so those controls remain available.

Focus changes layout in place: the workspace and current form are not moved to a
portal, cloned or remounted. Browser-managed text/date/time values, controlled
account/category/balance choices, checkboxes and open evidence sections survive
entering/exiting. Drafts remain scoped to each candidate, including native text/date/time fields
and the remember-choice checkbox. They survive changing messages and temporarily
filtering an entry out, and reset after re-parsing or leaving the workspace. Toggling Focus never saves, fetches or re-runs parsing.
Queue filters remain intact and usable; this temporary mode is not persisted across reloads.
Updating search results keeps keyboard focus in the search field. The selected
message is scrolled into view when the workspace or small-screen queue expands.

Background controls become inert while focused, keyboard navigation stays within
the review, and exiting restores focus to its trigger. Toasts appear inside the
focused surface; nested native dialogs remain above it. The shared body scroll
lock prevents closing one layer from unlocking another or leaving the page stuck.
Small screens use a single column and safe-area spacing; visual-viewport updates
keep the editor above a mobile keyboard without disabling pinch zoom. Browser
Fullscreen API permissions and browser-UI removal are not used.

Run `npm run test:focus`, `npm run test:workflows`, `npm run typecheck`,
`npm run lint` and `npm run build`. Synthetic browser checks cover full field and
DOM preservation, no implicit saves, live queue/date filters including no matches,
nested Escape behavior, message navigation,
confirmation/queue completion, contextual Undo, and desktop/phone/short viewport
layouts. Real-device virtual keyboard and assistive-technology checks remain
separate from Chromium viewport simulation.

## Review and transaction usability

SMS readiness uses the current account, amount, type, category and other-account
draft rather than stale parser values. Required corrections and advisory notes
are separate: an uncategorized or low-confidence message can still be confirmed
after verification. Transfers need distinct accounts; a missing other account
can first be resolved by accepting an existing transfer match. Choosing to add a
separate transfer returns to that field if it is still missing. Editing the
selected message keeps it visible through readiness-filter changes until a new
selection/filter is chosen. Re-parsing resets that candidate's learned drafts.

The sidebar receives a user-scoped queue count after review loads, approvals,
rejections and re-parsing. Transaction/Undo changes and window focus refresh it.
Request generations prevent older responses from overwriting a newer count;
account/session changes discard earlier requests and counts. Only the count and
user ID are broadcast in memory, with no SMS or transaction snapshots in storage.

Add and Edit keep Save/Cancel outside the scrolling field area. Source, masked
identifiers and Needs review remain editable under **More details**. Date/time
remain compact and second-account fields appear only for transfers. Empty Original
SMS panels are hidden; linked and redacted SMS still show their evidence.
Required/native checks and server validation identify fields with a readable
message and `aria-invalid`/`aria-describedby`. The first affected control receives
focus; a collapsed detail section opens automatically. Overall outcomes retain
the contextual toast. Linked-evidence correction acknowledgement remains required.

New transaction column preferences start with Date, Time, Description, Account,
Category and Amount. Existing stored selections are preserved. **Show all** reveals
all ten columns; **Reset default** restores the six-column view. At 640px and below,
transaction cards replace the desktop table, retain Edit/History/Delete/Find match,
and respect the same display preferences. Additional selected metadata expands
under More details. Both layouts share display logic, including neutral internal
transfers, account-filtered debit/credit and zero reported balances.

The dashboard says **Recorded from SMS/mobile**: a source indicates origin and
does not prove unattended approval. On phones, the navigation drawer traps Tab,
closes with Escape or its close control, makes the background inert and restores
focus to its trigger. Closed off-screen navigation is inert as well. Shared
scroll locks preserve other active dialogs/Focus mode.

Verification: `npm run test:review-feedback`, the existing web test scripts,
`npm run typecheck`, `npm run lint`, and `npm run build`. Browser QA uses an isolated
synthetic database; real financial data is never required for UI tests.

Synthetic Chrome checks covered the six-column desktop view, inline error focus,
manual save, draft readiness, approval/queue badge updates, 400×740 transaction
cards, navigation Tab/Escape focus restoration, and both saved transfer balances.
Real-device virtual keyboards and screen-reader announcements still need manual QA.

The SMS inbox heading, pending count, reapply action and received-date controls
share one wrapping toolbar. Guidance is available through the adjacent info
control. Last action uses a compact, borderless line with Edit/Undo beside its
label, wrapping only when needed. Touch buttons retain 44px targets. On small screens,
controls wrap within the panel instead of adding another full-width section.
Focus uses the same mounted date controls while hiding the normal inbox heading,
bulk actions and recovery row; switching layouts preserves custom-date drafts.

The same compact Last action presentation is shared by SMS review and Transactions.
Its latest-action eligibility, busy/expired states and help tooltip are unchanged.

### Focus header and pending-review filters

Focus combines entry context, received-date controls and Filters/queue/exit actions
in one top bar on wide screens. Smaller screens wrap dates below the context and
use labelled icon buttons for header actions. Queue visibility can be toggled on
all screen sizes without unmounting the editor or dates. Ready entries have a
single green status; corrections/duplicates and review notes use amber, while
related-transfer hints use an informational status. Details remain in tooltips.

Filters cover pending messages only. Parser confidence supports exact bands
(90–100%, 85–<90%, 65–<85%, below 65%), unknown values, or an inclusive custom
0–100% range. An invalid custom range shows an error and is not applied until
valid. Confidence describes SMS parsing, not a calibrated transfer-match
probability. Transfer suggestions retain their matching reasons.

Conditions include required corrections, category/account verification, duplicate
and related-SMS hints, unknown/non-transaction formats, and eligibility for match
lookup, re-parsing or redaction. Provider, account involved, reporting direction,
original parsed category/type, search and received dates combine with these
filters. Edited entries remain visible through changing correction conditions;
explicit condition selection honors the new filter. Action-eligibility filters
indicate an available action, not proof that a matching entry exists.

Message actions near the status expose Find transfer match when eligible, parser
re-run, source redaction and rejection/skip-rule options. A direct match lookup
uses the current draft and never adds an entry merely by searching or returning
to review. Accepting a match is an explicit confirmation. Existing confirmation
and per-account conflicting-balance choices remain unchanged.

Verification: all 47 web tests, typecheck, lint and production build pass. Chrome
with isolated synthetic data covered 400×740 and 320×568 layouts, percentage bands,
custom ranges/validation, empty daily results and recovery, queue visibility, and
draft restoration after date filtering. Native Chrome fullscreen caused delayed
UI controls; testing outside fullscreen restored reliable interaction. Console
connection errors were observed at document line 1; no framework error overlay
appeared, and the application does not call Chrome extension messaging APIs.
Actual phone keyboards and other browsers remain outside this desktop-emulation
check. No live financial records were modified.

### Small-screen SMS review behavior

Entering Focus at widths up to 820px starts with the message queue hidden, leaving
space for the current editor. Show/Hide messages remains available in the header;
its choice persists during that Focus session. Wider screens start with the queue
visible. Compact date controls and status/action summaries retain 44px touch
targets. Filter fields scroll independently of the fixed Clear/Done controls.

Native transaction fields (date/time, counterparty, reference, note and masked
identifiers) and the remember-choice checkbox now retain page-local drafts per
candidate. Switching messages or filtering a candidate out restores those values
when it returns. Drafts are not stored in browser storage or submitted by
navigation. Re-running the parser resets that message's draft and refreshes its
form; bulk re-parsing resets all pending drafts. Account-bound balances continue
to use their existing controlled behavior.

## Reviewed statement detail enrichment

Possible matches expose `detail_suggestions` for merchant/counterparty, reference,
note, and masked sender/receiver account/card identifiers. “Fill missing details
from statement” selects only empty fields with a nonempty suggestion. Existing
values stay untouched unless the user explicitly selects a replacement; proposed
values can be edited before accepting the match. No field is selected by default.
Selections apply atomically with linking via `StatementDecision.detail_choices`,
which includes each field's exact reviewed `existing_value` and desired `value`.
Changed ledger values return 409 without partial updates; unsupported financial
fields and duplicate selections are rejected. Identifier edits are masked before
transmission and again before persistence. Choices and before/after values are
audited. Unlinking or rescanning confirmed SMS does not undo these corrections.

New statement drafts strip anchored labels such as “CARD PURCHASE” and “PURCHASE
CARD” from the merchant field while retaining the original masked description.
Merchant case/punctuation and manually saved draft corrections are preserved.
References and explicitly labelled identifier metadata are excluded from merchant
suggestions. The statement header identifies only the reporting account; transfer
counterpart identifiers need explicit sender/receiver evidence. Ambiguous values
remain empty. Payment methods, accounts, classifications, amount, date and time
are not changed by this metadata shortcut. Deploy web and API together. API
migration `statements.0003_reapply_pending_merchants` also refreshes the saved
Counterparty field of older, untouched pending statement drafts. Refresh an open
review row after deployment to see it; manually edited or resolved rows remain
unchanged. The original extracted description and full Note remain available.

Existing pending imports get these suggestions when their rows are reopened after
deployment; they do not need to be uploaded again. The shortcut never posts or
changes a ledger entry by itself. A previously saved merchant correction remains
the proposal, and a nonempty ledger value still needs an explicit replacement
selection. Rows already linked or added are not retroactively rewritten.

### Reviewing pending SMS and statement evidence together

Eligible pending SMS candidates appear in an unresolved statement row editor.
The user verifies the pair, resolves any reported-balance conflict and approves
both in one action. The ledger keeps the SMS date/time and source, while statement
evidence is linked and counted once. This is optional; independent review actions
still work. Editable metadata suggestions let the user fill or replace merchant,
note, reference and masked identifiers before approval. The row list shows the
pending SMS match count and includes such rows in Possible matches. If existing
ledger suggestions also appear, compare them and acknowledge that each is a
different movement before combining; a changed suggestion list requires reload.
Already pending rows gain suggestions on refresh without a PDF re-upload or migration.

The statement table labels an unmatched ledger entry **Not in ledger**. It also
shows a unique Unified review pair even when the statement and SMS parsed types
disagree (for example, expense versus transfer). **Review both sources** opens
that exact pair. Bulk approval leaves these rows unresolved so the two sources
are reviewed once; separate posting remains an explicit individual decision.
Ambiguous pending sources are flagged for individual review, and an oversized
queue is marked unavailable rather than shown as a confirmed non-match.
Search rows covers saved and original extracted row fields, including merchant,
description, note, reference/code, account/category, dates, amounts, direction,
type, and page/row within the selected statement import.

### Unified matched SMS and statement review

Open **Unified review** (`/review`) from the sidebar to compare all pending SMS
candidates with saved pending statement rows. Account, daily/monthly/custom dates
and combined-source search apply before pagination. Review-condition filters narrow
the queue to strong or possible pairs, balance or type differences, or pairs needing
correction before pagination. Overview totals cover the selected account and dates
before search and review-condition filtering; ambiguous sources link to their
individual statement and SMS review pages. The page shows only reciprocal
one-to-one pairs backed by evidence beyond amount/date; unmatched and ambiguous
sources remain in their dedicated review pages. Source totals explain how many are
matched, ambiguous, statement-only or SMS-only in the selected scope. The default
**SMS pairs found** condition shows all eligible pairs; the other conditions
narrow those same pairs rather than switching to unmatched sources. Unknown
dates/account/amounts and non-financial SMS need their source editor first. SMS
dates are received timestamps and statement dates are transaction dates, but both
are formatted consistently. Statement fee rows remain independently reviewable.

The statement table's More row filters includes SMS pairing status. It filters
the full selected import before pagination, distinguishing a unique pair,
several candidates, a possible same-type SMS suggestion, no suggestion, and an
unavailable pairing check. Empty results offer Clear filters; failed row loads
keep the selected filters and offer Retry.
Unified review uses the same distinction: no pairs under active filters offers
Clear filters, while a failed match request keeps the filters and offers Retry.

Compare opens an editable transaction result, prefilled from the saved statement
draft and missing SMS details. When types differ, the reviewer must choose the
statement type, SMS type or a different type; date/time, category, merchant,
reference and note suggestions remain individually editable. Amount stays tied
to the matched source amounts and must be corrected in source review. The two
originals, match reasons and reported balances remain expandable for comparison.
**Check review items** can mark the type/account-path and applicable balance or
source-review acknowledgments after the type choice. The reviewer still confirms
the SMS and statement describe the same movement individually.
A BDT statement/SMS balance difference below Tk 1 does not show the amber
conflict banner or checkbox in unified review. For a new transaction, the higher balance is selected initially and the user may
choose the other; both source values remain visible. Missing-report enrichment
when linking an existing transfer follows the stricter rules below.
Larger differences and existing-ledger conflicts retain the warning.
A compact comparison of source date/time, type and reported balance appears before
the result form, and focus starts there when the dialog opens. When the statement
has no time and its date matches the SMS received date, the form suggests the SMS
received time with its provenance visible; reviewers can clear it. A different
statement date does not get an inferred time. Changing the date away from the SMS
date clears that suggested time so it cannot silently become a timestamp on a
different day.
Inactive saved categories are cleared from the proposed result so the reviewer
can choose an active category or leave it uncategorized.
Edit statement draft still uses the existing editor in save-only mode and refreshes the
queue and reopens the same comparison with fresh source versions and acknowledgments
reset. Its footer offers Back to comparison and Save draft & compare; posting and
next-row actions remain in the full statement workflow. SMS corrections use the
existing SMS review deep link, which provides a visible return to matched review.
Record one transaction lists every outstanding requirement beside the disabled action.
The combined review puts the editable transaction and confirmation decisions side by
side on wide screens, then stacks them on smaller screens. Its compact source strip
highlights material differences; the type choice is made beside the final type,
and the balance choice stays visible in Finish review. The agreed amount appears
prominently above the type choice; to correct it, edit a source before combining.
The final description / note stays visible below the merchant for routine edits.
Less-used balance editing, value date and reference fields sit in More transaction
details. Value date is the bank's printed effective date and can
help matching; the final transaction Date remains the ledger date.
Original PDF/SMS values and match reasons remain available in separate
disclosures, and collapsing them does not discard edits or bypass any checks.
The source comparison offers Use as final note beside each description. This
copies the chosen saved statement wording or parsed SMS description into the
editable Final description / note field; original source evidence stays intact.
The current merchant also offers a one-click note suggestion when it is readable;
it updates as the merchant changes and never replaces a typed note automatically.
The statement shortcut uses its saved wording rather than copying a separately
retained full Citytouch code into the ledger note.
Finish review groups required acknowledgments, including the type and account-path
check, in one checklist. Check required marks the currently applicable items
together after any differing transaction type is chosen; later edits or changed
choices reset them as before. The optional Remember choices setting stays separate
and is never checked by that action. Balance decisions remain independent.
A verified Citytouch mapping can prefill the merchant and a compatible active
category. If the mapping suggests a different type, its category waits until the
reviewer chooses that type. An existing saved compatible category takes precedence
on initial load; reviewers can change the result, and switching types clears
incompatible categories.
Original extraction issues, failed statement checks, and saved draft discrepancies
are shown alongside the required acknowledgment so users can inspect each reason.
For a new entry, the reviewed result's classification/date/time form the ledger movement. When
both sources report a balance, the higher amount is selected initially; the user
can change it. A BDT difference below Tk 1 still needs no extra balance
acknowledgment, while larger differences do. If the statement has a separate fee,
the SMS balance is selected because the statement balance cannot be used for the
combined entry; if SMS reports no balance, review the fee separately.
Both original reported balances remain in their source records; an unavailable
balance is disabled when the other source reports one. Transfer account reports
use the reviewed choice. If ledger suggestions already exist, the dialog shows
each candidate's saved account path, date and time, source-side reference, note,
counterparty and reported balance, plus its match reasons. An attached original
SMS can be opened on demand. Missing receiving-account evidence is labeled as
such, so sender details are not mistaken for a receiving-account report. A
linkable candidate can be selected to keep its existing ledger balance. For a
genuinely different movement, choose to record the SMS and statement as a
separate transaction, mark every ledger suggestion as different, and explicitly
confirm that review. This also works when a suggestion is already attached to
another row in the same statement. The server rechecks the exact suggestion IDs
before posting; new or changed suggestions require another review.
An inline edit does not hide saved ledger suggestions; the API revalidates all
matching and posting rules atomically before it changes either source. A failed
review leaves both sources pending and prompts a refresh or source correction.
Editing after selecting an existing ledger entry clears that selection and shows
a notice to verify and choose the entry again. On small screens, the dialog footer
has its own bounded scroll area so the result and action buttons remain reachable.
The two sources in a reviewed pair still count as one new movement when the
suggested ledger entries are confirmed to be separate.

The queue shows each unique one-to-one SMS + statement match once, so its count is
a count of review items rather than source observations. Unmatched sources and
ambiguous repeated candidates stay in SMS review or Statements until they can be
resolved safely. Compact rows separate match strength from balance conflicts, and
stable cursors prevent page drift as earlier pairs are resolved. Account,
statement-date and combined-source search filters apply before pair pagination.

One server transaction confirms the SMS candidate and links the statement row to
one ledger entry. Both leave the pending queue together. SMS evidence is available
in Transactions alongside the retained PDF evidence, subject to SMS-text retention.
No sources are automatically posted and inferred matches do not prove identity.
Multiple overlapping suggestions are kept out of this one-review-per-pair queue.
That ambiguity check uses the complete pending account scope before the statement
date filter is applied, so a nearby source outside the visible date range cannot
make a pair look unique. Counterparty wording alone remains a possible match;
strong matches require same-day reference, balance, or known account-path evidence.
Different accounts, amounts or directions never pair. Up to three calendar days
are allowed, with matching reference or balance required beyond one day. Every
pair also needs matching reference, balance, counterparty wording or known transfer
counterpart; amount/date by themselves are insufficient. Conflicting nonempty
references are excluded. Detail and confirmation recheck reciprocal uniqueness.
Stale versions/timestamps fail without partial writes;
retries of the same confirmed pair do not create another movement.
Direct links to pending SMS load that candidate by ID even when it lies beyond
the first 100 inbox rows. An unavailable, foreign, or already-resolved link
shows a notice and the current inbox; other request failures remain visible as
errors. Large statement lists distinguish an unchecked SMS match count from a
verified zero; an inconclusive detail check blocks separate posting until the
pending SMS queue can be reviewed.

The queue compares up to 2,000 pending sources of each kind in the selected account
scope and refuses excessive overlapping comparisons explicitly. Narrow by account
or resolve items when limits are reached. Deploy the API before the new web client;
no database migration or mobile APK rebuild is needed.

Transactions' Original SMS section also displays saved parsed amounts and reported
balances for attached confirmed SMS candidates, even after text retention redacts
an original message. It distinguishes those values from the editable ledger balance.

## Recurring statement identifiers

The Statements page links to `/statement-counterparties`, an authenticated
directory of recurring City Bank `CT-FT` codes and bKash recipient, recharge,
merchant, and biller clues. It separates debit and
credit observations per reporting account, shows recent masked statement rows,
uses every visible digit of the second code when matching, and warns that a
four-digit masked suffix can still refer to multiple parties. It displays the
complete masked second segment as printed in a statement row (for example
`***5678`); the bank does not provide the hidden digits. The user can label a
code as an external party or link another owned account. Type and category
suggestions are optional and remain editable in the
statement-row review form. Saving a mapping does not post or change ledger data.
The first varying reference segment is not matched as a party identifier.
For bKash, the unique `TRX ID` is excluded. Full phone numbers are visible only
to the signed-in owner in this directory; other source displays stay masked.
New bKash `Pay Bill` and `Mobile Recharge` debit drafts use `Utilities & Bills`
when that category is active. Older pending bills get the category after the
backend migration. Existing edits remain.
On a saved bKash import, **Refresh identifiers from saved PDF** can enrich
older rows without reuploading the PDF. Enter its password only if the PDF was
locked; a missing archive still needs an identical reupload.
The statement-identifier directory also offers **Find identifiers in saved
bKash PDFs**. This scans available archives without a password, lists imports
that need a PDF password or reupload, and switches to the bKash filter afterward.
**Reload import list** on the Statements page only fetches the history; it does
not extract identifiers.
Import history cards follow the selected light or dark appearance, with a
visible active, hover and keyboard-focus state.
Exact full-number matches to another owned bKash wallet appear as review suggestions for Send
Money, including that account's name. A verified phone-code mapping suggests
its saved display name in Counterparty and a readable note containing the name;
an explicit note template takes precedence. The combined review prefills these
only while the saved fields still contain unedited source text. Manual edits
and original statement evidence remain intact.
Specific bKash bill categories appear only for recognized bill wording and
remain editable during review.

## Compact transaction controls and review navigation

Transactions keeps search, account and sorting in the primary toolbar. Daily,
monthly, all-date and custom periods use the compact date control; rapid month
changes retain the existing cancellable debounce. Type, direction, source,
category, date basis and CSV export are under **More filters**. Applied secondary
filters remain summarized when collapsed, and unapplied changes are labeled.
Display-only identifier/column controls are under **Display options**. Collapsing
controls preserves their values; reloadable filter URLs and added/updated date
semantics are unchanged.

The sidebar exposes Dashboard, Transactions, Review inbox, Accounts and Reports.
Planning and Settings are expandable, open automatically for their active route,
and remain usable in collapsed and phone navigation. **Review inbox** groups
**Matched sources**, **SMS** and **Statements** with a shared route switcher.
Existing `/review`, `/messages/review` and `/statements` links—including selected
source IDs—still work. The badge specifically counts pending SMS, not the sum of
all source types. SMS focus mode continues to cover the complete workspace and
retain edits while entering/exiting.


## Dashboard and review layout (web)

The dashboard prioritizes compact period controls, period totals and current net
position beside the pending SMS queue. Review cards show the amount and one
review status. Quick Add remains in the shared header; favorite shortcuts are a
compact section below recent activity. Current net position is the BDT ledger
sum, separate from reported bank balances in Accounts. Date filters affect
activity totals/charts and recent rows, while balances and review remain current.
Recent transfers show both accounts with a neutral amount; ordinary debits and
credits retain their signs, currency and two decimal places.

The transaction add/edit and SMS forms follow type/category, accounts, amount
and reported balance, date/time, then description/reference. Transfer accounts
stay adjacent; SMS review shows the money path and its reporting account.
Optional payment methods stay mounted inside details, so collapsing the section
or entering/exiting focus mode preserves the choice. The selected method remains
named in the summary. Existing error focus opens a disclosure containing the
first invalid field. Balances stay bound to their reporting accounts.

Selecting a statement closes the upload/history library and puts review rows
first. Search, review state, sort and compact date controls are visible; less
frequent row filters and bulk actions expand on demand. Source failures, warnings,
unavailable checks and saved draft discrepancies remain summarized above the
rows. **View checks & PDF** opens the original PDF, extraction checks, ledger
comparison and import summary. Back to the import library clears the selected
review, while toggling the library retains its form values. Original-file refresh,
matching, approval guards and row pagination keep their existing semantics.

Combined-source and ledger-match reviews show exact balance differences and
calendar-day date gaps. Differences under BDT 1 are labeled small, without
claiming that rounding caused them. Existing balance choices and acknowledgement
rules are unchanged; neither original report is rounded or overwritten by the UI.

## Shared presentation and accessibility

See [shared interface conventions](../../docs/interface-conventions.md). Core
transaction/account/report displays share exact decimal and date/time formatting
with mobile; displayed and typed date fields use `dd/mm/yyyy`, timestamps use local
24-hour time, and calendar/clock inputs stay readable on dark surfaces. The date
field accepts validated day/month/year text, eight digits on a numeric keyboard,
or the calendar button and submits
ISO dates to the existing API. Quick Add selections use
soft mint/check marks rather than competing with its primary Save button.
Run `node --test tests/presentation.test.cjs` for exact-cent and timezone checks,
and the complete web suite for transfer perspective, drafts and request races.

### Filling a missing transfer balance in combined review

Selecting an existing transfer with `can_fill_missing_balance=true` reveals
**Missing balance to add · Account**. Agreeing reports or the sole available
report are preselected. If the SMS and statement differ, neither is selected and
linking stays disabled until the user chooses one; the larger report is not
silently preferred for enrichment. The chosen source is submitted with the
existing transaction ID. Reports from both sources remain preserved.

Known reports (including zero), reviewed clears and ambiguous protected blanks
retain their existing selection. The screen explains that correction belongs in
Transactions. Filling a report changes neither the movement nor the other
account's balance; the final link footer describes attaching sources rather than
recording another entry. Fee-inclusive statement balances remain ineligible.

Deploy the API first. Older-server responses default missing eligibility metadata
to false. No APK rebuild or new database migration is needed for this API/web fix.
Previously affected records are not automatically rewritten; the historical
revalidation workflow is available from Transactions as described below. Run the statement-review regressions,
web typecheck/lint/build and synthetic browser checks at desktop/phone widths.

### Statement search and PDF password autofill

Statement row search has its own named search form, disables credential autofill
hints and ignores background changes to an unfocused field. Only editing the
search control changes its debounced API filter; reload starts empty. PDF unlock
inputs are mounted only after choosing “PDF password (if needed)”, have distinct
document-only names and `new-password` autocomplete semantics, and remain separate
from login fields. Hiding the field clears its transient value; submission still
clears passwords. Saved login/password-manager behaviour on the actual login form
is unchanged. Browser extensions may ignore hints; validate the deployed browser
if unwanted autofill recurs.

### Session continuity after refresh failures

A request's late 401 now prompts fresh session verification before discarding the
workspace or broadcasting expiry. Current-user checks share one browser request;
a 401 is checked once more after 250 ms using the current cookie jar.
Expiry notices from another tab are revalidated without rebroadcast loops; an
explicit cross-tab sign-out still clears the workspace immediately. Network,
429/5xx and malformed upstream responses do not declare logout. Verified sessions
keep their forms during temporary failures; initial connection failures still
show Try again. Invalid credentials, revoked sessions and explicit logout remain
protected. Financial actions are not silently replayed after reauthentication.
JWT lifetimes, refresh rotation/blacklisting, HttpOnly/Secure/SameSite settings
and the production ban on JavaScript token storage are unchanged.

`npm run test:auth` now covers pending/completed refresh deduplication, rotated
cookie preservation, browser verification and explicit logout. Server deduplication
remains process-local; this change does not introduce a distributed refresh cache
or a grace period accepting blacklisted tokens. Production multi-instance races,
actual credential-manager profiles and backend revocations need deployment/browser
validation if symptoms persist. No backend migration or APK rebuild is required.

### Compact statement draft editor

The standalone statement-row dialog groups date/time into one grid slot and uses
three columns when the dialog body is at least 900px wide, two at intermediate
widths and one on phones. Date/time stack when their slot needs more space. Amount,
reported balance, type, category, counterparty and the transfer account stay in
the main form. Amount and Note now lead the draft form, before date, type and
other controls, so reviewers can see and edit context immediately. The saved-note
suggestion stays beside the open Note field. Original extraction,
funding-account candidates and optional reference/value-date fields use
disclosures; a summary indicates when those optional values exist. Opening or
closing a disclosure keeps the same controlled draft.
Funding explanations use the existing keyboard/touch-accessible info tooltip.
The other owned account is shown only for transfers. Source discrepancies and
required acknowledgements remain visible.
When Add transaction is unavailable, its fixed footer lists each outstanding
action from the saved-row posting checks: confirm transfer-like wording, save
draft edits, resolve posting issues, restore pending-source matching, or
acknowledge source discrepancies. The disabled button references that list for
assistive technology. A failed save/posting request also appears in the footer,
so the reason remains visible without scrolling through a long row review.

A pending statement transfer with no saved category proposes the sole active
category of kind `transfer` (normally Account Transfer). No category is guessed
when zero or several such categories exist. Saved category choices are preserved
on opening; explicit clearing stays blank during the edit and after saving.
Changing type drops an incompatible category and may propose the transfer
category. The proposal remains an unsaved draft change: save and refresh matches
before adding/linking. It neither guesses the funding account nor changes posted
transactions or immutable PDF extraction. No API or database migration is needed.

Category regressions: `node --test tests/statement-draft-category.test.cjs`.
The editor was also checked with synthetic data at 1440px, 900px and 390px for
category suggestions, explicit clearing, disclosure state, account selection and
draft saving. These checks do not exercise a live statement import or backend.

### Compact combined review and transaction add/edit

Combined SMS + statement review and the shared transaction add/edit dialog now
use a named container grid. The available editor width determines one column at
640px or below, two at intermediate widths, and three at 900px or above. Date and
time occupy one grid slot, wrap when needed, and stack on phone viewports. The
combined dialog may grow to 1640px while retaining its separate decision panel;
the transaction dialog grows to 1240px. Both stay within the viewport.

The combined result keeps the final note open beside a highlighted amount on
wide screens and below it on phones, followed by type, category, direction,
other account and merchant. The More
transaction details disclosure holds balance, reference and value date, and
indicates when those optional values exist. Note suggestions and all date/time
rules still use the same controlled draft. Balance choices, conflicting reports,
classification decisions and required acknowledgements stay in the decision
panel, outside the optional fields.

Transaction add and edit continue to share one form. Note stays visible below the
merchant/counterparty for routine edits. Reference, payment method, source and
masked identifiers remain under More details. Original SMS
and statement evidence start collapsed and remain available to expand. Account,
amount, category, date/time and the reporting account's balance stay visible; the
second transfer balance remains optional. Required linked-correction consent
stays visible. The footer stays outside the scrolling field area.

Disclosures keep their controls mounted. Collapse/expand and responsive resizing
change presentation without resetting draft values, balance ownership or review
checkboxes. Existing field validation still opens any containing disclosure,
focuses the invalid control and preserves the other inputs. Submission handlers,
duplicate checks, API payloads and undo behaviour are unchanged. No migration or
APK rebuild is required.

Verification includes the transaction-workflow, unified category/merchant/time,
statement-review and review-feedback tests. Synthetic browser checks exercise
combined review, create and edit at 1920px, 1440px, 900px and 390px, comparing
inputs before/after collapse and resizing, checking account-bound balances and
review confirmations, and validating the submitted values. Hidden-field server
errors must expand the disclosure and focus its control without clearing edits.

### Compact SMS review editor

SMS review uses the same named container grid as combined review and transaction
add/edit. It measures the editor's available width, including when the Focus
queue is shown or hidden: one column at 640px or below, two at intermediate
widths, three at 900px or above. Date and time share one slot and stack on phone
viewports. Labels and controls remain aligned when an info button is present.

Account, amount, type/category, reported balance, date/time and merchant stay
visible. Reference, ledger note and payment method expand under **More details**.
Masked identifiers retain their own disclosure and open automatically for a
missing reporting account or low parser confidence. Original SMS evidence keeps
its existing low-confidence/duplicate auto-open behaviour. Account suggestions,
transfer path, balance-ownership warnings and confirmation actions stay outside
the optional details.

The controls stay mounted when details close, Focus changes or the viewport
resizes. Existing per-message native and controlled drafts retain all edits when
moving between messages, including identifiers and the remember-choice checkbox.
These are temporary workspace drafts, not storage across a reload or sign-out.
Server validation opens the affected disclosure and focuses its field without
clearing the rest of the draft. Confirmation, transfer matching, duplicate
protection, learning and reported-balance ownership use the existing handlers.

Verification: `npm run lint`, `npm run typecheck`, `npm run build`, and
`node --test tests/review-feedback.test.cjs tests/review-focus.test.cjs tests/transaction-workflows.test.cjs`.
Synthetic browser checks cover 1920px, 1440px, 900px and 390px: responsive columns,
Focus/queue toggles, disclosure and message navigation retention, hidden-field
validation, low-confidence corrections and confirmation payloads. These checks
use a local synthetic API; they do not exercise a live account or SMS import.

### Automatic sub-taka values in source review

Matched SMS/PDF pairs and standalone statement comparisons show both exact
amounts and reported balances. For BDT differences strictly below Tk 1.00, the
result displays the higher value automatically; there is no additional rounding
dialog, checkbox or lower-value choice. Normal review/link controls remain.
Larger differences and other currencies retain their existing review gates.
The final amount summary uses exact cents and compares the full range across
SMS, statement and a selected ledger entry, preventing chained tolerances.

Both sources stay available after linking, one movement is counted once, and
corrections appear in audit history. Source dates, descriptions, categories,
account paths and unsaved edits keep their existing behavior. Small same-account
balances auto-select the higher report; another transfer account's balance is
never compared. Previously reviewed blank reports and fee-inclusive balances
retain their protections. Stale source or ledger snapshots fail without partial
writes. Existing statement/debt/bill relationships can block an amount increase
and show the reason. No historical transactions are silently repaired.

Run the statement Node tests, typecheck, lint/build and synthetic browser checks
for both source orders, retries, ambiguity and desktop/phone layouts. Deploy the
API first; no migration or APK rebuild is needed.

### Revalidate confirmed transactions

Transactions provides **Revalidate** on each entry and beside **Check transactions**
findings. The dialog compares already attached SMS/PDF observations and current
SMS rules without changing anything. It shows exact source values, each eligible
current → proposed correction, and warnings that need manual Edit. All correction
checkboxes start unchecked. Select individual suggestions and use **Apply selected**;
Cancel, opening the preview and **Refresh preview** never write the ledger.

Supported suggestions are higher BDT amounts/balances within a full span strictly
below Tk 1, restoration of missing account-specific balances, and an unambiguous
current category compatible with the saved type. Original text may be unavailable
because of retention; saved observations remain inspectable. Conflicting or unsafe
sources are flagged. Revalidation does not discover new matches, merge entries or
change account paths/type/date automatically. No re-import or SMS resync is needed.

The API binds a 15-minute signed preview to ledger/evidence/current suggestions.
After an error or uncertain response the dialog clears approval and requires a
fresh preview; successful apply refreshes Transactions and displays a toast.
Original evidence stays unchanged, corrections appear in History and latest-action
Undo remains available. Desktop/phone layouts use the existing focus-trapped modal,
scrolling body and visible action footer. Deploy API before web; no new APK needed.
