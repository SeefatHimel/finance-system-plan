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
focused drawer only when requested. The compact table combines type, direction,
reference, and counterparty context into a scannable description while keeping
reported balance, signed amount, history, edit, and delete actions visible. It
supports filters for month, type, account, category, debit/credit direction,
source, and search text. Search matches transaction id/reference,
sent-to/received-from text, note, and backend duplicate key. It supports
updating and deleting transaction rows, and can download a CSV export using the
same active filters. Each transaction row also links to the audit log page
filtered to that transaction id. Transaction date and time are independently
editable. Previous/current/next month controls refresh without a form submit,
and the column picker remembers the browser's visible-column preference.

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
create/edit drawers. Successful mutations update visible rows immediately, with
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
candidate as a full form. Reviewers can search, filter by provider or issue,
navigate between candidates, and keep context while editing one focused item.
Dashboard attention rows deep-link to the exact candidate, and the review page
keeps the selected candidate id in the URL so the state can be shared or
revisited.
It shows raw SMS evidence, parser
notes, parser confidence, review or duplicate reason, detected
provider/message kind, amount, reference, balance, fee, counterparty text, and
possible internal-transfer/related-message hints. The user can confirm a
candidate into an SMS-sourced transaction or reject it with a reason. Rejection
can also redact the original SMS, deactivate the matched sender rule, or exclude
the provider. The confirmation flow supports debit/credit direction and
transfer destination selection, and can explicitly remember corrected account,
category, payment method, and type as future defaults on the matched sender
rule. The resulting transaction preserves reference, balance, and counterparty
evidence without copying the complete SMS into its note.
The page can also redact the raw SMS body after review while keeping parsed
ledger evidence available.
The evidence panel also includes a `Re-run parser` recovery action for pending
messages. It refreshes parser-derived fields in place and gives visible busy,
success, and error feedback without requiring another mobile history scan.
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
returned JWT tokens for local development, and calls `/api/auth/me/` to show the
signed-in user on the dashboard. When browser token storage is disabled, the
login form uses same-origin Next.js auth routes that call the backend and store
access/refresh tokens in HTTP-only cookies for session status, refresh, and
logout.

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
