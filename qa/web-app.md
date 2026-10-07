# Web App Q&A

## What is the web app responsible for?

The web app is the command center for managing transactions, accounts,
categories, reports, SMS review, debts, credit cards, recurring bills, payment
methods, reconciliation, and audit review.

## Why Next.js App Router?

The App Router gives a modern React structure with server components, layouts,
routing, and flexible data loading. It is a good foundation for a dashboard that
will combine server-rendered status, authenticated pages, and interactive forms.

## What is implemented in the web app right now?

The web app has a responsive application shell with persistent navigation, a
data-backed overview dashboard, TypeScript setup, an environment-based API URL,
a server-rendered backend health check, and a local JWT login flow. The
dashboard is an automation-first command center. It combines the calculated net
position and monthly movement with cash-flow and spending-category charts,
mobile sync health, imported/auto-posted/review counts, a focused SMS review
queue, and recent transactions with account, category, source, import state,
status, and signed amounts. Manual transaction entry remains available but is a
secondary action. It also has a transactions page for listing and creating
manual transactions and an accounts page for managing accounts and
categories, an SMS settings page for managing payment methods and sender rules,
an SMS review inbox for parsed message candidates, a monthly reports page, and
a debt/lending dashboard for creating debt records and repayments, a credit
card bills page for statement balances, due dates, minimum dues, and payments,
and a recurring bills page for repeating payment schedules. It also has a
reconciliation page for expected-vs-actual account balance checks and balance
snapshot history, plus an audit logs page for transaction create/update/delete
history.

On phone-sized screens, the shell uses an accessible off-canvas navigation that
locks background scrolling and closes with Escape or the page scrim. Workspace
controls stack into touch-friendly layouts, tabs remain horizontally
scrollable, wide financial tables advertise and support horizontal swiping,
and forms, drawers, modals, toasts, and sticky review actions respect dynamic
viewport height and device safe areas.

## How does collapsing the sidebar create more workspace?

Above 820px, the header toggle changes the sidebar from a 208px labeled menu to
a 72px icon rail. The content margin and navigation progress indicator use the
same width variable, so the workspace gains 136px without covering content.
Links keep accessible names, hover titles, active-route styling, and pending SMS
badges. The browser stores the desktop preference in a versioned localStorage
key; storage failures leave the current-session toggle usable. Smaller screens
use the full off-canvas menu independently of this preference. Resizing back to
desktop closes an open mobile menu and releases its page scroll lock.

## Why start with a health-check dashboard?

It proves the web project can run and communicate with the backend. It is a
small but useful integration milestone before building login, tables, and forms.

## Why does the dashboard prioritize automation status?

The main product value is turning mobile financial SMS messages into trustworthy
ledger entries. The dashboard therefore shows capture, auto-post, pending-review,
and failure states before manual-entry controls. This makes sync freshness and
exceptions visible without forcing the user to open several operational pages.

## How is dashboard data kept trustworthy?

The web app uses the API's derived account `ledger_balance` values for the BDT
net position instead of recomputing from whatever transaction page happened to
load. The accounts table shows both that calculated ledger balance and the most
recent provider-reported balance/date, so users can see whether evidence is
stale or differs from the ledger. Monthly movement, category breakdown,
automation counts, review queue, and recent activity still come from their
existing API responses. It does not display invented confidence scores for
confirmed transactions because the current transaction response does not
expose parser confidence after confirmation; those rows use a textual
verified/manual import state instead.

## How does the web app know the backend URL?

It uses `NEXT_PUBLIC_API_BASE_URL`, defaulting to `http://localhost:8000` during
local development.

## Why use TypeScript?

TypeScript reduces mistakes in data-heavy UI work. It becomes more valuable as
forms, filters, reports, and generated API clients are added.

## How does the web app use generated contract types?

The web API wrapper still validates responses with local Zod schemas, but its
create/update input and filter types now reuse generated OpenAPI request and
enum types for accounts, categories, SMS settings, SMS review confirmation,
transactions, debts, credit card bills, and recurring bills. This is a
compatibility step before replacing more hand-written API response handling with
the generated client.

## Why use Zod?

Zod validates API responses and form data at runtime. TypeScript helps at build
time, but API responses still need runtime validation because they come from
outside the frontend process.

## What will the main web screens be?

Planned screens:

- Dashboard
- Transactions
- Accounts
- Categories
- Payment Methods
- SMS Sender Rules
- SMS Review
- Monthly Reports
- Debts
- Credit Cards
- Recurring Bills
- Reconciliation
- Audit Logs
- Settings

## How should the transaction table work?

It should feel close to the spreadsheet workflow: filter by month, account,
category, type, debit/credit direction, source, and text; add/edit rows
quickly; and support display modes like spreadsheet sign mode, ledger mode,
and money-in/money-out mode. Month arrows should refresh the ledger in place,
and users should be able to persist the columns that matter to them.

## What does the current transactions page do?

The current transactions page uses the saved local JWT access token to load
accounts, categories, and transactions from the Django API. The synced ledger
and its filters are the primary surface; manual create/edit forms open in a
focused, viewport-centered dialog only when requested. The compact table combines type, direction,
reference, and counterparty context into a scannable description while keeping
reported balance, signed amount, history, edit, and delete actions visible. It
supports filters for month, type, account, category, debit/credit direction,
source, and search text. Search matches transaction id/reference,
sent-to/received-from text, note, and backend duplicate key. It supports
updating and deleting transaction rows, and can download a CSV export using the
same active filters. Each transaction row also links to the audit log page
filtered to that transaction id. Transaction date and time are independently
editable. Previous/current/next month controls refresh without a form submit,
and the column picker remembers the browser's visible-column preference. The
picker includes sender and receiver identifier evidence, allowing masked
account/card suffixes to be shown only when useful.

## How does dashboard transaction search work?

Submitting the dashboard search opens the transactions page with a shareable
`search` query parameter. The transactions workspace reads that parameter,
removes the default current-month restriction for a global search, applies the
backend filter immediately, and keeps later filter submissions in the URL. This
prevents the header from looking functional while silently showing unrelated
rows.

## Why add transaction filters early?

Filtering is essential for a finance workflow because transaction lists grow
quickly. Month, account, category, type, debit/credit, and source filters make
the web app useful for checking entries and comparing the transaction table
with monthly reports. Text search helps find SMS-confirmed transactions by
TrxID, merchant/person text, note, or duplicate key.

## What does the current accounts page do?

The current accounts page uses the saved local JWT access token to create and
list accounts and categories. It supports full CRUD for accounts and categories
in a tabbed workspace with summary metrics, structured data tables, and focused
create/edit dialogs. Successful mutations update visible rows immediately, with
backend constraints still preventing deletion when records are referenced by
transactions.

## Why does the page no longer flash a loading screen after every save?

Mutation workflows keep the existing workspace visible while synchronizing
fresh API data in the background. Accounts and categories update their local
collections directly after successful API responses; the other workspaces
perform a quiet refetch. Initial page loads and explicit filter changes still
show loading feedback, while buttons expose the pending state for the specific
action being performed.

## What does the current SMS settings page do?

The SMS settings page uses the saved local JWT access token to load accounts,
payment methods, sender rules, SMS capture preferences, and actual mobile
device health. A setup checklist and focused tabs separate capture/privacy,
sender rules, and payment methods. It supports
creating, listing, updating, and deleting payment methods and sender rules so
SMS import can map trusted senders back to real accounts. Provider dropdowns
include the contract-supported
wallet, bank, card, EBL, City Bank, and Pathao Pay values used by parser and
sender-rule workflows. Capture policy controls can exclude entire providers or
OTP/security and balance-notice message kinds; the API enforces the choice
before retaining the raw SMS body. The user can also choose whether confirmed
raw SMS text is removed immediately, after 7 or 30 days, or kept until manual
redaction.

## What does the current SMS review page do?

The SMS review page uses a queue-and-detail layout rather than rendering every
candidate as a full form. Reviewers can search, filter by provider, issue,
category (including Uncategorized), or transaction type,
navigate between candidates, and keep context while editing one focused item.
Dashboard attention rows deep-link to the exact candidate, and the review page
keeps the selected candidate id in the URL so the state can be shared or
revisited.
Each queue item shows the SMS received date and time in the browser's local
timezone, consistent with the detail form. It is labeled Received because SMS
receipt time is not necessarily the bank's transaction time. Filters combine
and use the latest loaded candidate category/type, not unsaved form edits.
It shows raw SMS evidence, parser
notes, parser confidence, review or duplicate reason, detected
provider/message kind, amount, reference, balance, fee, counterparty text, and
possible internal-transfer/related-message hints. The user can confirm a
candidate into an SMS-sourced transaction or reject it with a reason. Rejection
can also redact the original SMS, deactivate the matched sender rule, or exclude
the provider. The confirmation flow supports debit/credit direction and
transfer destination selection, and can explicitly remember corrected account,
category, payment method, and type for the matched sender and message kind. The
choice is applied immediately to similar pending items, so purchase and transfer
messages from the same bank no longer overwrite each other's defaults. Transfer
paths with a counterparty additionally retain the reporting account, direction,
and other account rather than using a bank-wide destination default. The
resulting transaction preserves reference, balance, masked sender/receiver
account and card identifiers, and counterparty evidence without copying the
complete SMS into its note.
The page can also redact the raw SMS body after review while keeping parsed
ledger evidence available.
The evidence panel also includes a `Re-run parser` recovery action for pending
messages. It refreshes parser-derived fields in place and gives visible busy,
success, and error feedback without requiring another mobile history scan.
The header also offers `Reapply rules to pending`, with a confirmation prompt
and result counts, to refresh the whole review queue after parser or mapping
changes. Confirmed ledger entries are never changed by that action.
If the refreshed message has no numeric content, the API auto-discards it and
the workspace immediately removes it from review with explicit feedback.

## What does the current reports page do?

The current reports page calls the Django monthly report endpoint and shows
income, expense, net total, category totals, and account movement for a selected
month. This is the first web version of the spreadsheet's monthly summary view.

## What does the current reconciliation page do?

The reconciliation page loads accounts, balance snapshots, and per-account
expected balances from the Django API. The user can select an account, compare
the expected ledger balance with the latest real-life snapshot, save a new
actual balance snapshot, and review the latest difference, status badge, and
warning reason such as missing expenses, missing income, or duplicate
transactions. The account selector is shared between checking and saving a
snapshot, so users do not accidentally save a snapshot against a different
account than the one they are inspecting.

## What does the current audit logs page do?

The audit logs page loads read-only audit entries from the Django API. It can
filter by action, entity type, and entity id, summarizes create/update/delete
counts, and shows expandable before/after snapshots for transaction changes. It
also reads URL query filters, so transaction rows can deep-link directly to
their history.

## What does the current credit cards page do?

The credit cards page loads credit-card accounts and bill records from the API.
The user can create statement bills, track statement balance, minimum due,
remaining balance, due status, and record payments against open bills. Payments
reduce the remaining bill balance and move bills to partially paid or paid.

## What does the current recurring bills page do?

The recurring bills page loads accounts, categories, and recurring schedules
from the API. The user can create repeating bills for weekly, monthly,
quarterly, or yearly payments, see due-soon and overdue counts, and record a
payment that advances the next due date.

## What does the transaction table show now?

The transaction table can show date, time, type, debit/credit direction, account,
source, category, amount, balance after, provider transaction id/reference,
sent-to/received-from text, note, history links, and delete actions. The page
can export the filtered rows as CSV for spreadsheet backup or external review.
This makes SMS-confirmed transactions inspectable without opening the raw
message every time.

## Why not copy the spreadsheet exactly?

The spreadsheet is a useful mental model, but the app should improve structure,
validation, filtering, reports, and review workflows. Copying every spreadsheet
layout detail would preserve old limitations.

## How does login work?

The current web app submits username/password to `/api/auth/login/`, stores the
returned JWT tokens for local development, and calls `/api/auth/me/` to verify
the signed-in user before any financial workspace mounts. When browser token
storage is disabled, the login form uses same-origin Next.js auth routes that call the backend and store
access/refresh tokens in HTTP-only cookies for session status, refresh, and
logout.

## Why use a shared session guard and a login page?

`AuthProvider` makes authentication a workspace-wide decision, rather than
letting each page render an independent "Sign in" error. Startup waits for a
verified current user, missing/expired sessions redirect to login, and a safe
internal `next` path preserves filters for the return journey. Already signed-in
users bypass login. A dedicated page removes stale financial forms from view;
interrupted actions require explicit review/submission after reauthentication.

Every page exposes Sign out in the header account menu. Logout hides private
content, revokes/clears credentials, and uses fresh navigation to discard client
state. Other tabs receive a session-only logout/expiry message, or recheck when
focused. Protected pages disable caching and revalidate when restored from the
browser Back/Forward cache. Superseded checks cannot replace newer session state.
Cookie sessions also get an early middleware redirect when both cookies are absent; API checks
still enforce authorization, and middleware does not verify development tokens.

## Does a network error mean the user has been signed out?

No. Only a confirmed authentication rejection ends the session. Expired access
credentials first attempt refresh; missing or rejected refresh credentials
require login. Profile/refresh outages preserve credentials and offer retry,
and 403 responses remain permission errors. Cookie auth routes return 502 for
upstream failures and retain cookies, while definitive auth failures return 401
and clear them. If cookie logout cannot reach the same-origin server, the UI
offers retry instead of falsely reporting success. Return-URL and error-status
regressions are covered by `npm run test:auth`.

## Where should auth tokens be stored?

Production uses HTTP-only, Secure, SameSite=Strict cookies and cannot opt into
browser `localStorage` token storage. Cookie-authenticated mutations reject
cross-origin requests. Logout asks the API to blacklist the session refresh
token before clearing cookies. The same-origin backend proxy deduplicates
concurrent refresh attempts and briefly reuses the rotated result so an expired
access token does not sign the user out when several dashboard requests arrive
together. Local development retains the direct bearer-token flow for debugging.

## How will the web app fetch data?

The likely choice is TanStack Query for client-side authenticated data fetching,
caching, retries, and mutation flows. Server-rendered pages can still be used
where they make sense.

For production-style cookie sessions, the existing shared web API wrapper sends
workspace requests to `/api/backend/...`; the Next.js route handler attaches the
access cookie server-side, refreshes once on 401, rotates cookies, and forwards
the backend response.

## How would you handle loading, empty, and error states?

Each main screen has an explicit, shared loading state that preserves the
expected page structure while data is fetched. A branded activity indicator,
subtle shimmer, navigation progress rail, and inline button spinners distinguish
route changes, initial fetches, and mutations without making the UI feel frozen.
The motion system respects `prefers-reduced-motion`. Empty states and error
messages remain visually distinct, so finance users can tell "nothing found"
from "still loading" or "the request failed."

## How would you handle responsive design?

Dashboards and forms should remain usable on small screens. Dense transaction
tables may need column hiding, horizontal scroll, or mobile-friendly list views.

## What is the biggest web UI challenge?

The transaction table. It needs to be dense like a spreadsheet but safer and
more ergonomic than a spreadsheet, with validation, filters, quick edits, and no
layout breakage on smaller screens.

## How does the web app avoid posting both sides of a transfer twice?

Before saving a manual transfer or confirming transfer-like SMS, it asks the API
for matching transfers and opposite pending messages. A dialog shows the
accounts, amount, date/time, and reference; the user can link, keep separate, or
cancel. Linking preserves account-specific evidence without another balance
movement. The transaction table displays A → B and each linked account's
reference/balance. Account filters include both sides with the appropriate
debit/credit sign. “Find match” on a saved transfer supports an explicit audited
merge of two already-posted matching transfers. Both manual entry and SMS
review use the selected account’s perspective: Credit receives from the other
account, and Debit sends to it. Incoming review drafts default to Credit and the
receiving account. SMS submissions set `account_perspective: true`; the backend
normalizes source/destination order and keeps the reported balance on the
selected account’s evidence.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.

## Why are dialogs and notifications rendered outside the page content?

The route transition uses a CSS transform, which creates a containing block for
fixed descendants. An overlay inside it can follow the full page height and
appear outside the visible viewport after scrolling. Shared native dialogs are
portaled to document.body, center in the viewport, scroll internally, and trap
focus. A shared scroll lock handles nested editor/match dialogs and restores
page scrolling when the last modal closes. Native Escape handling replaces the
editor's global keyboard listener so closing a match leaves its editor open.
Focus returns to the opening control, and dismissal is blocked during saves.

Action messages publish to a shared toast provider while keeping inline context.
Notifications appear near the viewport edge; while a dialog is open they render
inside its top layer so errors remain visible and dismissible. Success toasts
expire after six seconds with hover/focus pause; errors persist until dismissed
or replaced. Every action generates a new notice, including identical messages.

## How does the other transfer account suggestion work?

The review dropdown shows the suggested ledger account and explains whether it
came from saved identifiers, remembered choices, confirmed history, or a unique
name/provider alias. Multiple matching accounts and conflicting history display
an explanation and require selection. Masked identifier inputs explicitly tell
the reviewer to select ledger accounts in the dropdown instead of entering an
account name as identifier evidence.

Remembered paths preserve Debit/Credit relative to the reporting account and
apply only to that account/counterparty pattern. A transfer still requires
explicit confirmation or acceptance of a match. Existing pending rows need
Re-run parser or Reapply rules to pending to use the new resolver.

## How can users find transactions they just added?

The Recently added view orders the ledger by creation time and shows Added
timestamps alongside transaction date/time. Selecting it removes the default
current-month restriction so approving an old SMS is immediately discoverable.
Account, category, type, source, direction and search filters still apply.
Month, when chosen, filters transaction date. The URL preserves ordering and
all-month selection on reload. Edits and linked evidence do not make an existing
transfer a new addition. Switching back restores the current transaction month.

## Can rejection teach the app to skip advertisements?

Yes, for recognized non-transaction types. The Apply to menu can save a skip for
promotional, OTP/security or balance notices, immediately removing matching
pending items and excluding future captures. SMS settings reverses the choice.
Promotional offers are excluded by default; older review items need Reapply rules
after the API migration. The rule applies to the recognized type across trusted
senders, not just one bank. Unknown messages are individually reviewed rather
than treated as a blanket skip category, and financial senders remain active.
