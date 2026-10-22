# Web App Q&A

### What does Check transactions do?

The Transactions action scans saved entries in pages of 50 and lists findings
with a Review entry action. Current learned rules may suggest a different
category, but the scan never applies it automatically. Reviewers use the
existing editor and attached source evidence to decide what to change.

### How does editing flag a mismatch with the original SMS?

When a linked SMS shows a known bank sender that differs from the selected
ledger account's known provider, transaction editing surfaces the conflict.
A transaction edit waits for its SMS source check; a failed load can be retried
from Original SMS before saving.
A generic deposit SMS also prompts review of category, counterparty, and note
because its purpose is not stated. Saving requires an explicit acknowledgment
of these warnings, while preserving the option to use other evidence.

### How do profile editing and light/dark appearance work?

The avatar menu opens a dedicated responsive profile page. Name and email are
saved through the authenticated current-user API, then the shell updates its
displayed name. Username remains read-only. System, Light, and Dark appearance
choices apply across the web app immediately and persist in this browser; the
System choice follows operating-system changes. The mobile app keeps its own
appearance until it gets a separate implementation.

### What date format does the web app show?

Parsed calendar dates, local timestamps, and typed date fields display
`dd/mm/yyyy`. The picker button opens the browser calendar; ISO dates remain the
form/API values. Invalid typed dates are not submitted. Original PDF and SMS
text is preserved as evidence, including whatever format the source printed.

### Why are the amount and note prominent in combined SMS + statement review?

The final amount is shown in a highlighted, read-only summary because the two
sources must agree on it before combining. The final description/note is always
visible and editable beside the amount on wide screens and below it on phones,
with saved and merchant note suggestions nearby. Balance, reference, and value
date remain under More transaction details.
The originals remain attached as evidence when the user edits the final note.

### How does the statement review show shared category hints?

The row list says a review suggestion is available, rather than calling every
hint a remembered choice. Opening the row shows the suggested category and its
reason, and applying it is an explicit action. Combined SMS + statement review
can also prefill a compatible category from the statement suggestion. The user
can change the result before recording; a verified personal mapping takes
priority over the shared hint.

### How can a user recover full original financial source data?

Statement imports and linked transaction editors show whether an encrypted
original PDF is available. The owner can open and download it on demand. For
older imports, re-upload the identical PDF under the same account to attach it
without new rows or ledger entries. Linked SMS remain visible beside statement
evidence; older redacted text can be restored only by an explicit mobile history
scan when the exact message is still on the phone. Account settings submit full
numbers to the API for encrypted storage while showing safe suffixes in ordinary
views. Previously truncated numbers must be entered again.

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
an SMS review inbox for parsed message candidates, a period reports page, and
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
supports filters for daily/monthly/custom dates, type, account, category, debit/credit direction,
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
transactions. The category table shows each category's all-time ledger entry
count, linking nonzero counts to a matching all-dates transaction view. It
does not sum amounts because categories can span currencies and movement types;
unavailable counts display as unavailable rather than zero. The table sorts
categories alphabetically, and a successful delete removes the row after the
proxy forwards the backend's bodyless `204 No Content` response.

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
A compact Received dates toolbar spans both panes; search and a Filters button
stay above the queue. Provider, condition, confidence, involved-account, direction, category and type filters apply immediately
in a viewport-centered dialog, with removable chips and a filtered/total count.
Escape restores focus to the trigger. Clear filters retains search and dates.
Three-line rows show amount/received day, counterparty/provider and the first
correction or ready state. The selected details retain confidence and the full
received timestamp in the browser's local timezone; SMS receipt time is not
necessarily the bank's transaction time. Filters combine and use the latest
loaded candidate category/type, not unsaved form edits.

Desktop panes scroll independently inside a bounded workspace, leaving the
queue and editor footer visible. Previous/Next and position sit with Reject and
Confirm & add; the selected queue row follows navigation without moving the page.
Phones use a bounded vertical queue above the editor. Masked
identifiers and parser evidence collapse to reduce form height; low confidence
opens both, a missing account opens identifiers, and duplicates open evidence.
The editable ledger note remains visible beside the main review fields, even
when More details is closed; that disclosure holds reference and payment method.
The Message actions button opens an anchored dropdown over the form rather than
stretching the status banner, and an outside click or Escape closes it.
Collapsed inputs remain mounted and included in confirmation. Synthetic browser
checks cover filtering, search/empty states, navigation, disclosure, collapsed
identifier submission, focus return and desktop/phone overflow.
It shows raw SMS evidence, parser
notes, parser confidence, review or duplicate reason, detected
provider/message kind, amount, reference, balance, fee, counterparty text, and
possible internal-transfer/related-message hints. The user can see the
separately saved SMS parsed debit/credit direction;
unknown direction is labeled as such. Statement review labels the PDF-extracted
direction apart from the editable draft and warns when they disagree. The
transaction issue scan flags source-versus-ledger direction conflicts without
silently changing either side. The user can confirm a
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
daily, monthly or custom period.

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
counts, and shows changed transaction fields as before → after values. Full
before/after JSON snapshots remain available for detail. It
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
without letting an old automatic response clear newer cookies. The browser
rechecks its current session before declaring expiry. Explicit logout clears the
credential cookies. If cookie logout cannot reach the same-origin server, the UI
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

## How can users find transactions they just added or edited?

The Recently added view orders the ledger by creation time and shows Added
timestamps alongside transaction date/time. Selecting it removes the default
current-month restriction so approving an old SMS is immediately discoverable.
Account, category, type, source, direction and search filters still apply.
Periods filter the selected transaction/added/updated date basis. The URL preserves
ordering, period and date basis on reload. Edits and linked evidence do not make an existing
transfer a new addition. Switching back restores the current transaction month.
Recently updated instead orders by latest saved change and shows Updated time,
including new entries, edits, newly linked transfer evidence and merges. It also
opens All dates and preserves filters on reload, with no fixed lookback period.
Reading an entry or retrying an accepted transfer link does not promote it.

## Why does navigating several months remain responsive on a slow connection?

The selected month changes immediately; controls remain enabled during loading.
A 250 ms debounce combines rapid navigation into one transaction request. A new
selection cancels pending work and aborts the old request immediately, while a
generation guard prevents an outdated response, error or finalizer from changing
the newest state. Explicit filter application, Clear and ordering switches load
immediately and cancel any queued month navigation. Unmounting cancels the work.

The table keeps the last successful results, labels the requested and displayed
month while loading, and preserves their ordering labels until replacement data
arrives. A failed refresh keeps the table and offers Retry. Navigation fetches
transactions only, reusing account/category/payment-method data in the mounted
workspace. Initial loads and successful mutations refresh all lists, including
account balances. There is no persistent cache. Regression tests cover rapid
clicks, queued cancellation and late responses/finalizers; browser checks cover
delayed responses, navigation during a request and failure/retry.

## Can rejection teach the app to skip advertisements?

Yes, for recognized non-transaction types. The Apply to menu can save a skip for
promotional, OTP/security or balance notices, immediately removing matching
pending items and excluding future captures. SMS settings reverses the choice.
Promotional offers are excluded by default; older review items need Reapply rules
after the API migration. The rule applies to the recognized type across trusted
senders, not just one bank. Unknown messages are individually reviewed rather
than treated as a blanket skip category, and financial senders remain active.

## Can users see the original message while correcting a transaction?

Yes. Transactions with saved SMS or statement evidence expose a read-only
**Sources** action from the ledger list, so source inspection does not require
opening Edit. The dialog shows retained SMS text, masked statement rows and
archived PDF access when available; redacted or missing originals remain
explicitly labeled.

When linked SMS exists, the edit dialog also loads an expanded Original SMS section with full plain text,
sender and received time. It preserves line breaks, wraps long text and shows
all linked transfer messages once. Users can collapse it while editing.
Redacted/excluded SMS have explicit explanations. Entries without linked SMS hide
the empty section.
Loading failures have a retry control and do not block the form. Component state
is discarded on closing or switching entries, including any revealed full
account/card number; stale responses are ignored, and
bodies are not persisted to browser storage or transaction notes. The cookie
proxy preserves the API's private/no-store response header.

## Can users edit all ledger details?

Yes. The editor includes existing financial fields plus payment method, source,
Needs review and four masked sender/receiver identifiers. Methods are filtered
by account; account changes clear the old method. Reported balance clears only
when its reporting account changes. Review status is visible in the table. Original SMS and system IDs/timestamps are
read-only; History records ledger corrections.

Transfer direction uses explicit From/To fields and a Reverse action. Changing
the type, accounts or principal of a matched entry shows a required linked-SMS
acknowledgement; Save remains disabled until checked, and further core edits
reset it. The API enforces the same rule. Remapped observations lose obsolete
balances/fees; reclassified entries retain their messages as history without
displaying historical transfer balances. The viewport modal scrolls, and the
identifier fields collapse to one column on phones.

## What belongs in the transaction Reference field?

Use the bank or wallet's Ref/TrxID code, such as the synthetic `DEMO-TRF-1042`.
It is optional and may repeat; the generated transaction UUID is separate. The
Add/Edit labels, helper text and search placeholder use Reference consistently.
There is no need to invent a unique code when the SMS provides none.

The API allows distinct SMS to reuse references and protects retries using the
raw capture identity. A transfer match displays matching-reference evidence
alongside account/amount/currency/date compatibility and still needs acceptance.
That keeps two sides visible while counting the accepted movement once.

## Should changing a category automatically change the transaction type?

Category kinds provide suggestions because type changes affect balances and
reports. In Add/Edit and SMS review, an incompatible category opens a decision:
change category and type, keep the current type, or cancel. Compatible fee/expense
and refund/income choices retain their subtype. Debt categories ask for a specific
movement; neutral system/empty categories do not infer one. Changes stay in the
draft until submitted. Type changes reset direction and preserve reported balance
while its reporting account stays the same; leaving a transfer clears its other
account. Linked corrections still require acknowledgement, and explicit SMS reclassification is respected before matching.

## How does the web app make API failures useful to the user?

The shared request layer converts API detail/field errors into readable messages,
shown inline and in persistent toasts near the active form. Inputs remain available
for correction. Non-JSON responses have safe fallbacks; server failure bodies are
ignored. Connection, permission, missing-item, conflict and throttling messages
explain the next action. Only confirmed authentication failures end a session.
`npm run test:workflows` tests formatting, fallback behavior and category/type
compatibility, alongside `npm run test:auth` for session semantics.

## Why could a reported balance appear blank when editing a matched transfer?

The transaction's main balance can be empty while linked transfer observations
contain per-account balances. The editor now falls back only to the primary report
identified by the API, labels its account and lists all saved linked balances.
Zero is preserved; missing values stay blank rather than borrowing another
account's balance or the calculated ledger balance. Type/category and ordinary
corrections preserve this report while its reporting account stays the same.
Changing the non-reporting side of a transfer also preserves it; changing the
reporting account clears it with an inline explanation. SMS review and Add follow
the same rule. Explicit blank input clears the report without later restoration.
Other linked reports are read-only here.

## Can users upload bank and wallet statement PDFs?

Yes. Statements saves supported digital BDT imports and resumes them from history.
Review filters and the sort selector apply across all rows before pagination. Sort
by statement order (the default), date in either direction, or amount in either
direction; changing the order returns to page one and clears row selection.
The viewport-centered row editor shows original masked evidence beside all
editable draft details. Saving
refreshes matches; linking preserves one existing ledger entry, while adding
despite suggestions asks for separate-movement confirmation. Bulk approval only
posts validated new visible rows and reports unresolved items. Toasts complement
readable errors and stale-version reload recovery; reload clears the obsolete
error toast. Wallet fees have separate rows.

The cookie proxy keeps auth refresh and upload limits. Passwords clear on submit;
cancelled responses cannot overwrite the UI. A cancelled server upload may save
a draft but never posts. Resolved drafts require unlink/reopen before editing;
ledger corrections remain in Transactions, with original statement rows available
on demand. Scans/card billing layouts and automatic posting remain unsupported.

### How can users review a large statement efficiently?

They can select pending rows for validated-new approval or skipping, with an explicit
confirmation and fresh server validation. Save & next and Alt+S / Alt+Shift+S /
Alt+Right navigate unresolved rows without implicit approval. Remembered choices
are displayed for explicit application and saving. The import summary separates
principal/fee amounts and decision counts; saved-draft checks remain separate from
original extraction checks, and skipped rows remain part of statement arithmetic.

### How can users compare a PDF statement with their recorded transactions?

Statement rows show suggested ledger movements alongside the PDF values. Users
confirm links in the editor or approve validated new rows. A separate paginated
ledger-only list highlights recorded entries with no statement suggestion within
that account's printed period. Warnings explain provisional absence; no automatic
deletion occurs. PDF evidence remains separate from edited ledger details.

The row dialog fills most of the viewport, keeps decision buttons visible, and
uses a full-width comparison for every suggested match. Statement and ledger
details appear side by side on desktop and stack on phones. Each balance conflict
has its own acknowledgment; acknowledging one match does not authorize another.
Accept is disabled while the draft is unsaved or required acknowledgments are
missing. Saving clears acknowledgments for the refreshed suggestions. Exact
decimal differences remain reviewable even at one cent. Linking preserves the
existing ledger balance and both observations instead of silently reconciling
them. Source-discrepancy acknowledgment still applies to all posting/linking
decisions, and the API repeats validation at decision time.
When a saved choice suggestion already matches the draft's type, category,
other account and suggested counterparty, the editor shows Applied instead of
an Apply button. A suggestion that changes type or other account clears the
reviewed-type confirmation; matching values do not reset it.

### How does statement review show a ledger edit that breaks an accepted match?

The table derives confirmation from review state as well as the attached ledger
ID. Invalid financial links show “Linked entry needs review”; the editor shows
its correction issue and retains the explicit unlink action. Evidence is preserved
and unlinking does not delete the ledger transaction.

### How does dashboard date navigation stay fluid and consistent?

Daily/month controls change immediately; period requests are debounced by 250 ms
and stale responses are ignored. Existing data and its date label stay visible
until a new response succeeds. Custom dates apply together. Totals, daily chart,
spending categories and recent activity use that period, while current balances
and the review queue remain live. The chart uses complete API daily aggregates.

### Can reports show friendly names instead of masked numbers?

Yes. Payment-method settings attach optional labels to additional bank/card
identifiers and maintain text aliases for matching. Transactions offer Numbers,
Labels and Both, remembered per signed-in user on that browser. The app derives
labels from settings at display time and retains raw numbers for ambiguous or
unmapped values. Editing, original evidence and CSV data are unchanged. Renaming a
label changes presentation without modifying the ledger or transaction timestamps.

## How do date controls work across the web app?

A shared controlled component provides Daily, Monthly, Custom range and optional
All dates. Each dated list names its date basis, and current financial totals and
forms remain live. Transactions can filter transaction, added or updated dates;
the URL and CSV retain that choice. Reports/dashboard default to the current
month, while histories can include all dates. Custom drafts apply together after
validation, with a 366-day inclusive limit. Date navigation remains enabled while
requests debounce/abort; previously loaded report/transaction data keeps its own
period label until replacement succeeds. Paginated statements filter server-side,
including ledger-only rows, without narrowing whole-statement coverage totals.
An empty filtered page resets its offset. Statement details and reconciliation
summary refresh independently, so a summary error leaves the selected review
visible with a retry action.
Browser-filtered timestamp histories use local days; API-filtered timestamps use
Asia/Dhaka. Unknown dates are included only in All dates.

## Can the frontend keep an idle backend awake?

The root heartbeat checks a public same-origin health proxy on startup and every
ten minutes while online, including the login page. It uses no auth refresh or
financial data, skips overlapping requests, times out, and cleans up on unmount.
Optional shared storage reduces repeat checks between tabs. Failures are quiet;
reconnection and returning to a tab check again when due. A browser that suspends
or closes the page cannot provide reliable uptime. `npm run test:dates` covers
calendar boundaries, custom validation and heartbeat timing/offline/cleanup.

## Can users save account/card numbers while adding or editing an account?

Yes. Optional recognition fields include provider, primary account/card kind,
number, additional typed numbers with labels, and aliases. The client reduces full
unmasked numbers to last four before submitting; the API sanitizes again. The
profile uses the shared SMS payment-method registry. Disabling it leaves other
payment methods available, and profile changes do not rewrite existing money.

PDF selection starts an account check and shows masked header evidence, an
explanation and a Use suggested account action. It never replaces a manual
selection or posts money automatically. Ambiguous/no matches leave selection to
the user. Locked files can be checked again with a transient password. File and
password changes cancel old requests; aborted/stale results cannot update the
suggestion. Checks can be cancelled to continue manually. Upload creates only a
review draft for the selected account.

## What makes Quick Add configurable without slowing down manual entry?

The preset page stores user-defined shortcuts, optional defaults and favorite/
enabled/order choices. Six favorites form the initial menu and dashboard tiles;
See all and searchable account/category lists keep the complete choices nearby.
Amount receives focus. Entry overrides and switching presets do not edit saved
defaults. Full entry carries all draft values into the existing detailed editor
over the current page, so its filters and scroll position remain in place.
A viewport dialog with a visible Save footer and toast completes the flow.

## How do time selection and uncertain saves work in Quick Add?

Today/Now resolve at first Save; users can select Yesterday, calendar dates,
unknown time or a draggable hour-then-minute clock with exact numeric fallback.
Every minute is retained. The immutable request is stored in per-user/backend
sessionStorage before posting. Uncertain saves lock fields and retry the same
request after close/reload; known rejections permit correction. This recovery
lasts within the browser tab, not a durable web offline queue. Successful saves
refresh mounted ledger and summary screens without resetting selected filters.

## How can users compare a possible duplicate without remembering the original?

Transfer match dialogs pin the warning and entry being reviewed above a scrolling
suggestion list. The enlarged viewport dialog keeps Cancel and Keep separate
visible. The current card reflects edited draft values, not the initial parser
output. Both show the money-flow account path, amount, date and time; references
are hidden and missing times are explicit. Pending/recorded context remains.
Credit drafts normalize to sender-to-receiver order.
Saved-transfer Find match preserves time and reference. Linking still requires
an explicit action; an error retains both sides for comparison. Compact SMS queue
rows also retain visible local received time beside their received day.

## How do edit dialogs avoid accidental dismissal and lost context?

Shared viewport dialogs ignore backdrop clicks and pointer drags ending outside.
Users close them with an explicit control or Escape, except while an action is
busy. The enlarged transaction editor scrolls its form independently, keeping
the account summary, linked-correction warning and validation errors in its
fixed header. These changes preserve edited fields during incidental side clicks.

## Does transaction search cover all the fields users can review?

Search runs on the backend across ledger metadata, related account/category/
payment-method names, amounts/balances, ISO dates/times, identifiers, review status
and linked transfer evidence. It is not restricted to reference/person/note.
`Food 500` can match a category plus an amount, while quotes preserve a phrase.
Apply filters, URL restoration and CSV export retain the same search and other
filters. Formatted amounts are supported; query limits use existing error/toast
feedback. Each transfer remains one result even with multiple matching reports.

## Why is SMS direction a compact button near the amount?

The review header shows Debit or Credit with a change icon and a caption naming
the reporting account. It replaces the full direction dropdown, keeps direction
visible near the amount and works with click, Enter and Space. The next action
is named for assistive technology; color is supplementary. Switching updates
the per-candidate direction draft and hidden form input without submitting or
resetting other edits, accounts, Type or Category. Incoming SMS still defaults
to Credit for the receiving account. Existing classification defaults and explicit
confirmation/match decisions remain unchanged; busy confirmation disables the button.

## Why are there two reported balance fields for a transfer?

Each tracked account can report a different balance after the same movement.
Add/Edit shows one optional field per account, explicitly labelled sending/debit
or receiving/credit. Drafts use account IDs rather than From/To position, so reversal
preserves their values. Incoming entries converted to transfers keep the reporting
bank in To and ask for From. Unknown balances stay blank; zero and negative reported
balances remain valid, while the transfer amount remains positive.

The editor loads both reports after saving/reopening and retains original SMS/PDF
source evidence. Both fields belong to one canonical transfer; matching/linking is
still explicit. All-account lists show a neutral transfer amount and internal
movement label; an account filter shows its debit or credit. Transfers do not count
as income or expense. Linked correction confirmation still applies where required.

### How does the transfer editor keep optional fields out of the way?

Non-transfers hide the other-account selector. Transfers keep the original
reporting account's balance visible and collapse the optional other balance;
closing it never clears a saved value. Matching compares labelled account
balances and blocks acceptance until every same-account conflict has an
explicit choice. Different sender/receiver balances are normal. Optional
payment methods identify account-linked instruments and their recognition
aliases, while the ledger account controls the money movement.

### Why use help icons in transfer forms?

Keep optional explanations out of the default layout while retaining visible account names, amounts and required conflict choices. Help must work with hover, keyboard and touch, avoid clipping inside dialogs, and dismiss before the parent dialog on Escape. Important conflict and balance-clear statuses remain visible in short form.

### What happens when an SMS exposes only three card digits?

SMS review shows compatible saved accounts/cards as choices, including collisions,
without automatically selecting even a unique match. Selecting a reporting choice
updates account/payment method; the other choice follows the draft Debit/Credit
role. Amount, note, time and category edits survive; saving still requires an
explicit action. Account settings accept three digits but recommend longer masked
values, whose endings can match shorter SMS without duplicate mappings. Statement
header choices similarly remain manual and require verification.

### How do Add, Edit and Undo avoid accidental or confusing saves?

One controlled form serves Add and Edit, with the same fields and validation.
Synchronous in-flight guards and a stable create key handle repeated Enter/clicks.
Successful actions offer Edit/Undo in a 15-second toast and a persistent latest
action bar. Edit directly fetches the saved UUID independently of list filters.
Undo uses the server descriptor, refreshes lists/review, and refuses later changes.
User/session changes clear recovery state; no financial snapshots are stored in
the browser. Only the latest unchanged action is undoable for 24 hours.

### Why group date/time and hide unrelated transfer fields?

Date and time need readable controls rather than two full-width columns. A
wrapping compact group serves Add, Edit and SMS review, stacking when a small
viewport or larger text needs it. Only transfers can submit a second ledger
account. SMS selectors say From/To according to the reporting perspective; type
switches retain draft transfer choices and account-bound reported balances.
Hiding a field alone neither changes a balance nor saves a transaction.

### Why does Accounts show a red reported-balance difference?

It means the report differs from the ledger at the report's cutoff, not from
today's ledger. The red line states higher/lower and the amount; green text
identifies a match. Later activity is excluded, ambiguous timing asks for review,
and card balances stay references because available credit and ledger balances
can have different meanings. Header help explains this without adding actions
that change money. Active/Inactive badges are quiet, readable status text. Browser
and Apple icons reuse the existing four-diamond Finance logo.

### Can users choose which Accounts columns to show?

Yes. The Columns menu uses the same checkbox pattern as Transactions and saves
the selection locally in the browser. Type, currency, ledger balance, latest
reported evidence, and status are optional; Name and Actions remain visible.
All columns start visible and Show all resets the selection. The table narrows
when columns are hidden. These preferences do not modify account data or filters
and remain separate from transaction column preferences. Unavailable or malformed
browser storage falls back to the default view.

### How does SMS review Focus mode avoid losing unsaved edits?

It expands the same mounted workspace (dates, queue and editor); changing Focus never moves
fields into a new modal/portal or changes their keys. Native input values,
controlled choices, checkboxes and evidence disclosure state therefore survive
entering/exiting. Candidate keys switch the rendered form when changing messages, while sparse
page-local native-field and checkbox drafts restore edits when the message
returns. Amount, account and classification drafts remain candidate-scoped too;
re-parsing or leaving resets them. Focus itself performs no API mutation.

App chrome and other background controls are hidden/inert. The queue, search,
filters and received-date controls stay interactive, with a persistent Exit control,
header and action footer. Desktop uses two columns; small screens stack the queue
above the editor. All screen sizes offer Hide/Show messages while keeping the form mounted.
Changing search results does not move keyboard focus away from the search field.
An empty filter result keeps Focus open so the filter can be corrected; completing
the actual review queue exits it. Tab stays within the workspace; Escape closes a nested dialog
first, then Focus, restoring the trigger and queue/page position. Native modal
and Focus scroll locks share ownership, so cleanup order cannot leave scrolling
stuck. Contextual Edit/Undo toasts stay accessible. Focus persists across reviewed
messages and respects mobile safe areas/visual viewport
without requesting browser fullscreen or preventing zoom.

### How does review readiness follow corrections without pretending to be automation?

Readiness evaluates the edited amount/account/type and transfer counterpart.
Optional category and low-confidence notes are advisory. An existing transfer
match may supply a missing other account; adding separately still requires it.
The selected edited draft stays visible while a readiness filter would otherwise
remove it. Queue count events carry only a count and owner ID, are accepted only
for the current session, and supersede older count requests. Review mutations,
Undo/transaction changes and returning to the window refresh the badge. Dashboard
wording describes SMS/mobile origin rather than claiming every entry was auto-posted.

### How do compact forms remain complete and accessible?

Add/Edit use a scrollable field area with persistent Save/Cancel. More details
contains source, masked identifiers and review flags, without removing fields
from submission. Note stays visible below the merchant/counterparty in both modes;
its edit and validation use the same save path. Empty SMS evidence sections
disappear; retained/redacted sources
remain inspectable. Field validation preserves backend messages, highlights the
control, opens collapsed details and focuses the first problem. A linked-evidence
acknowledgement cannot be bypassed by the new footer. Overall feedback still uses
the toast. Mobile navigation has a labelled dialog, Tab containment, inert
background/closed drawer, Escape and trigger-focus restoration.

### Why offer transaction cards and fewer default columns?

Six useful columns start visible, with source/balances/identifiers still selectable.
Saved selections survive the update; Show all and Reset default are separate.
At phone widths cards use the same formatting/actions and column preferences as
the table. Extra selected metadata expands within each card. Internal transfers
remain neutral in the all-account view, while account filters show debit/credit.
This changes presentation, not matching, amounts, balances or ledger calculations.

### Why combine the SMS heading and received-date filters?

They belong to the same inbox controls and can share a wrapping toolbar, reducing
separate panel padding and gaps. The heading retains guidance through an accessible
info control; queue count and reapply remain available. Last action and Edit/Undo
share a compact borderless line, distinct from filtering, with natural wrapping
and 44px touch targets. Focus keeps the same date-control
instance mounted, so an unfinished custom range survives entering/exiting Focus.

### How do confidence and action filters work in SMS Focus mode?

They filter pending review candidates in the browser. Parser confidence has exact
bands and an inclusive custom percentage range; malformed/reversed ranges display
an error and remain unapplied. This percentage is confidence in parsing an SMS,
not a transfer-match probability. Transfer suggestions explain their evidence.
Conditions cover required inputs, duplicate/related SMS, identifier suggestions,
unknown/non-transaction formats and actions supported by the retained evidence.
Account involved includes the other account only for transfer drafts. Other
filters combine using AND. Correction filters keep the currently edited draft
mounted while its errors clear; explicitly selecting another condition resets
that exception. Completed-message history remains outside this inbox.

The Focus top bar shares the already-mounted date controls with entry context,
Filters, queue visibility and exit. On small screens actions become accessible
icon buttons and dates wrap. One status distinguishes ready, corrections/review
notes and related-transfer hints. A nearby disclosure exposes message actions.
Find transfer match submits a lookup for the current draft, without confirming it
when no match exists or the user returns to review. Linking still requires an
explicit acceptance and per-account balance-conflict choices where needed.

### What changed after testing SMS Focus on phones?

Chrome checks at 400×740 and 320×568 found that the visible queue and status
summary crowded the editor, filter completion buttons required scrolling, and
empty date results discarded native input edits. Focus now starts with the queue
hidden up to 820px, uses compact date/status/message-action controls, and keeps
Clear/Done outside the filter-fields scroll area. The queue toggle preserves the
mounted editor and is still available at every screen size.

A sparse in-memory draft cache restores native text/date/time fields and the
remember-choice checkbox per candidate after navigation or temporary filter
exclusion. It never writes to localStorage or sends edits on navigation. Parser
re-runs clear the affected drafts and increment the form revision so refreshed
parser values replace dirty native inputs. Controlled account/amount/category and
account-bound balance logic remain separate. Tests cover empty strings, unchecked
choices, message isolation and single/bulk draft reset. Desktop Chrome emulation
cannot establish actual mobile soft-keyboard behavior or other-browser coverage.

### How does statement review resolve conflicting reported balances?

Each possible match compares the statement draft with the existing transaction.
When two BDT reports differ by less than Tk 1, the higher current ledger or
statement report is preselected; the user can choose the other. Differences of
Tk 1 or more and non-BDT differences still require a manual choice. Accept
remains disabled until the choice and any required source acknowledgment are
complete. Choices belong to one match and exact reviewed values/version, and
reset after saving. The modal uses desktop space for
a side-by-side comparison, stacks on phones, and keeps its decision footer visible.
The choice changes a reported balance, never the movement amount or money count.
If detailed pending-SMS matching reaches its safety limit, the row editor
explains why Add is unavailable and directs the user to review pending SMS.


### How can users fill or improve transaction details when accepting a statement match?

Each match has an expandable metadata comparison with editable proposed values.
The fill-missing shortcut selects only empty fields with statement evidence.
Nonempty replacements must be explicitly selected; acceptance applies only those
fields. Clean merchant suggestions remove anchored card-purchase labels while
preserving source text, merchant names and user edits. Date/time and financial
identity stay unchanged, and full identifiers are masked before transmission.

### Why can an older statement row show raw card-purchase wording?

Older saved drafts kept the statement description in Counterparty. After the API
runs migration `statements.0003_reapply_pending_merchants`, refresh the row to
see the cleaned merchant if that draft was untouched and is still pending. The
original extracted description and Note remain available for review. A manual
merchant correction and any resolved row are not rewritten.

### What if the SMS and PDF are both still pending?

Open the statement row. Eligible pending SMS appear beside the statement values,
with separate dates, descriptions and balances. The original SMS is available
while retained by the user's SMS policy. Verify the same movement and
choose a reported balance if both sources disagree, then use “Review both · count
once.” The SMS time/date and SMS source are retained; missing merchant/reference
details can come from the corrected statement draft. The existing SMS-only and
statement-only review actions still work. Optional merchant, note, reference and
masked identifier suggestions can be edited and selected before combined approval;
unselected nonempty SMS values remain unchanged. If a ledger suggestion already
exists, review it first rather than making another transaction. A separate
statement movement requires explicit separate confirmation. Pending-SMS counts
also appear in the statement row list and Possible matches filter. If a ledger
suggestion remains, compare every suggestion and affirm that each is distinct
before combining; a changed suggestion list requires a fresh review.
### Where can users review pending SMS and PDF rows together?

The statement table distinguishes ledger comparison from source pairing:
**Not in ledger** means no ledger transaction is linked or suggested, while
**SMS pair available** links directly to the one-to-one Unified review pair.
This also works when parsed transaction types disagree. Bulk approval excludes
such pairs; the user reviews both sources once or explicitly chooses a separate
movement. Search rows includes saved and extracted row details such as notes,
codes, amounts, dates, category, and page/row within the selected import.
The statement table also filters pending rows by SMS pairing before pagination:
pair found, several candidates, possible same-type SMS, no suggestion, or
pairing unavailable. Empty results offer Clear filters; load failures keep the
selected filters and offer Retry.
Unified review also separates an empty filtered result from a failed match
request and retains the current filter choices on retry.

Unified review (`/review`) lists only unique one-to-one pending pairs, one item per
SMS + statement movement, with account, statement-date and combined-source search
filters. The default **SMS pairs found** option shows those pairs; review
condition also filters strong/possible matches, differing balances or types,
and items needing correction before pagination. Overview totals remain
for the selected account and date before condition/search filtering. Ambiguous
sources link to the separate statement and SMS queues. Compact rows display match strength and balance conflict independently;
the scope summary links unmatched source counts back to their dedicated review
pages. Each item opens an editable, prefilled result with original SMS/PDF evidence.
Differing parsed types require an explicit choice; merchant, category, date/time,
reference and note can be corrected in place before saving. Explicit confirmation
resolves both sources into one transaction; a new entry uses the reviewed
classification/date/time and chosen balance. The combined dialog places the
editable result and Finish review decisions side by side on desktop and stacks
them on smaller screens. A compact source strip receives initial focus. The note
stays visible beside the main fields; less-used balance, reference, value date,
and full source evidence open on demand without losing draft values or waiving
the existing confirmation checks. Required acknowledgments, including
the type and account-path check, share one Finish review checklist. Check review items
marks the applicable items after a differing type is chosen, while the reviewer
must personally confirm that both sources describe the same movement. The separate optional
Remember setting is excluded, and edits reset confirmations. Balance choice stays
independent. The source comparison can copy either description into the editable
Final description / note, which stays visible below the merchant for routine
edits; this resets acknowledgments and leaves originals intact.
A readable current merchant also offers an optional note suggestion; selecting
it updates the draft note while preserving the original sources.
A separately retained full Citytouch code is not copied into the ledger note.
The agreed amount is prominent above the type choice and remains read-only until
a source is corrected. The optional bank-printed value date has a hint explaining
that it assists matching while the final transaction Date stays the ledger date.
If a statement has
no time, the aligned SMS received time is suggested with a visible source label;
reviewers can clear it. A date mismatch leaves time empty, and moving the date
away from the SMS date clears that suggestion.
Verified code mappings prefill an active category only when it fits the current
type. A mapping for another type waits for that type to be chosen. The saved
category takes precedence on initial load, and reviewers can edit the result.
Combined review lists each ledger suggestion with its match reasons. A reviewer
sees its saved account path, time, reference, note, counterparty and source-side
balance, and can open the attached original SMS only when needed. A missing
statement-account observation is labeled to avoid confusing sender evidence with
the receiving account. Equal date and amount alone do not establish identity. A reviewer
can link a compatible entry and retain its balance, or mark each suggestion as
a different movement and explicitly confirm one new transaction for the SMS
and statement. Unlinkable candidates remain visible with the reason linking is
unavailable. No navigation to statement review is needed for a verified
separate movement.
Balance/source discrepancies need review; nothing posts automatically. Combined
review uses the higher reported balance automatically for sub-Tk-1 BDT
differences, without an extra balance choice or checkbox;
exact values remain in both sources. Larger differences and selected existing-ledger
conflicts continue to require acknowledgment. Unmatched
and ambiguous one-to-many sources remain in their individual review pages rather
than appearing twice or implying a safe pair. The disabled confirmation action
lists every step still required. The statement editor opens in
save-only mode inside this workflow,
returning to a freshly loaded comparison after saving or going back. The comparison
shows extraction, statement-check and draft discrepancies before requesting an
acknowledgment. Queue counts describe matched review items, not source observations.
Saved ledger suggestions stay visible after an inline result edit; the server
revalidates them and the source match atomically before recording anything. If
an edit clears a selected existing ledger transaction, a notice explains why it
must be chosen again. The footer is scroll-bounded on small screens so the form
and confirmation controls remain reachable.
SMS correction includes a return link to matched review. Stable cursor navigation
avoids skipping pairs after earlier rows are resolved. SMS dates are received dates;
statement dates are transaction/value dates. Both evidence sets are available from
Transactions.

### What happens when a statement match has a different category?

The comparison highlights both categories and asks which single category the
linked ledger entry should use. No option is preselected. Reviewers can keep the
ledger value, use a compatible active statement category, or choose another
compatible active category (including Uncategorized). The action states the
chosen outcome and stays disabled until the choice is complete. A stale choice
must be reviewed again after reloading; both sources and the previous ledger
category remain in audit history.

## Bounded review and dashboard loading

**Why does SMS review say a filter applies to loaded messages?** The web client
loads 100 pending candidates initially and allows another 100 per request.
Filtering is local for fast interaction, so it explicitly distinguishes the
loaded subset from the exact server pending count until all pages are loaded.
The dashboard and sidebar use exact counts without downloading the whole queue.

### What happens when a deep link points to an older pending SMS?

The inbox loads its first bounded page, then fetches the requested candidate by
ID if it is not on that page. It selects that exact candidate; an unavailable
or foreign candidate now shows a notice and the current inbox, while other
request failures still show an error. The pair dialog disables a missing balance
choice when the other source has a report, and the statement list distinguishes
an unavailable match count from zero.

### How can a user identify recurring Citytouch codes without a saved account?

The Statement codes page lists codes found in saved City Bank statement rows,
with counts and recent masked examples. A user can save an external recipient
name without creating a tracked account, or link a different owned account.
Debit and credit mappings are separate. Optional type/category choices become
editable suggestions in pending statement review; applying a suggestion still
requires saving the draft and confirming the movement. Editing or forgetting a
mapping does not alter confirmed transactions.
# Citytouch counterparty display

The statement code directory shows the visible digits of the second Citytouch
segment alongside its reporting account. A four-digit suffix may still be
shared by different parties, so mappings remain review-only. Statement review
rows display a recovered full second code when available; their original masked
extraction and any user-edited draft fields stay unchanged.
When a pending statement is reviewed together with matching SMS, a saved code
mapping prefills the result merchant only if the statement merchant is still
the raw bank reference. The reviewer may edit it or choose either source's
wording. Saving the mapping alone does not alter stored statement drafts or
existing ledger transactions.

### How does the web app show bKash recurring statement identifiers?

The directory shows bKash recipient, recharge, merchant, and biller clues
alongside Citytouch codes. The user can verify a label, owned account, type, or
category; these remain suggestions on pending drafts. bKash `TRX ID` values
are excluded because they identify one movement. Older bKash imports can
recover full recurring identifiers from a saved PDF, while existing draft
edits stay. The directory's explicit recovery action scans available archived
bKash PDFs, then shows any import that needs its password or an identical
reupload. It switches to a bKash-only view so recovered codes are easy to see.
The Statements page's "Reload import list" only fetches history. A verified
mapping presents its name
beside Counterparty and in a suggested note. Combined review prefills both
when the current values are still untouched source text; edited values win.
The phone number itself cannot identify a person's name until the user saves
a verified label or it matches one owned account exactly.

### How does the web app review bKash card-funded statement credits?

For a bKash `Card to bKash` or `Bank to bKash` credit, the statement row form shows a transfer
explanation beside Type and possible City/EBL funding accounts beside Other
owned account. The bank label does not select a specific account. Choosing a
suggestion changes only the draft and resets the reviewed-type confirmation;
the user must verify ownership, save, then make the ledger decision. Existing
pending imports gain these hints when opened, with no re-upload required.
Q: What does the saved-statement refresh button change?
A: For a bKash import with an archived PDF, it fills missing recurring
identifiers only and reports the count. A locked PDF needs its password again.
The review screens offer verified category and note suggestions without
overwriting the user's edits or posting a movement.

### How do compact filters and the Review inbox work?

Search, account, sorting and compact period controls remain visible in
Transactions; secondary filters/export and display preferences expand on demand.
Applied filters remain summarized and unapplied edits are marked. Collapsing does
not reset values, while URLs preserve reloadable filters and date basis. The
sidebar groups the three existing review routes under Review inbox with Matched
sources, SMS and Statements links. Planning/Settings expand for active routes;
old deep links, phone navigation and full SMS focus mode remain supported. The
review badge is explicitly a pending SMS count, not a combined source count.


### How does the web prioritize review without hiding financial conflicts?

Dashboard totals and current BDT ledger position come first, with pending SMS
amounts beside them. Internal transfers have a neutral amount and both accounts;
reported bank balances remain separate from the ledger total. Quick Add stays
reachable through the header, with favorite presets below recent activity.

Selecting a statement collapses its upload/history library, shows the review
rows first and moves source/reconciliation details below the table. Failure,
warning and unavailable-check counts stay visible, and View checks & PDF opens
the details. Secondary filters and bulk operations are disclosures; selection,
filtering and server-side approval checks still apply.

### Do compact editor sections change what is saved?

No. Add/edit and SMS review use a consistent field order and keep optional
payment-method controls mounted when collapsed. The selected method is named in
the summary. Error focus expands the first invalid field's disclosure; focus mode
does not remount the SMS form. Transfer paths and reporting accounts remain
explicit, and reported balances stay with their accounts. Combined-source review
shows the exact balance delta and calendar-day date gap, while the existing
sub-taka acknowledgement and source-preservation rules remain unchanged.

### How are dates, money and selection states shared with mobile?

Core transaction/account/report displays import pure presentation helpers from
finance-contracts. Decimal API values retain exact cents and currency codes;
missing values are not invented as zero. Date-only values cannot shift through
UTC conversion, while timestamps and SMS input fields use the viewer's local
timezone. Date/month/time inputs declare a dark color scheme. Quick Add uses
soft mint/check marks for selections, reserving filled mint for Save; clock tabs
also expose a visibly selected state. Browser-native input rendering may still
use the browser's locale. See [interface conventions](../docs/interface-conventions.md).

### Why does combined linking sometimes show a missing-balance source choice?

A genuinely missing transfer-account report can be enriched from the linked SMS
and statement. Agreeing/sole reports are preselected; differing reports require
an explicit radio choice except for sub-taka BDT differences, which use the higher value automatically. Known and protected
blank reports retain their existing selection, with correction available in
Transactions. The link confirmation sends the selected source and existing ledger
ID without creating another movement. This first fix does not yet implement the
larger intent-specific form or historical-revalidation workflow.


### Why did a temporary backend failure sometimes become a logout?

Refresh rotates/blacklists the previous token. If the subsequent profile lookup
or proxied request failed before the response set replacement cookies, the
browser retained the now-invalid old refresh token. Cookie routes now preserve a
successful rotation even when the following operation fails. Replacement tokens
stay server-side and never appear in an error body. Pending refreshes share a
promise for their whole lifetime; the five-second reuse window begins after
success, not before a potentially slow backend call. Rejections remain retryable.

Automatic failures no longer clear browser cookies because a slow response can
refer to an older cookie generation. The shared guard revalidates current cookies
before redirecting or clearing drafts; current-user reads are single-flight and
retry a 401 once after 250 ms. Cross-tab expiry messages also revalidate without
rebroadcasting; explicit sign-out remains immediate. Temporary upstream failures
preserve a verified workspace. Explicit logout still revokes/clears credentials, while genuinely
invalid or revoked sessions still require login. Backend token lifetimes and
blacklisting remain unchanged. Deduplication is per server process, not a new
distributed session store; live multi-instance failures require separate diagnosis.

### How is document unlock separated from saved login autofill?

A PDF password is an optional transient document secret, not an account password.
The input is absent until requested, uses a dedicated document name and
`new-password` autocomplete hint, and is isolated from the statement row search.
Search has a distinct search form/name, autocomplete off and a focus guard, so a
background username injection cannot become a debounced search. Reload starts
with no search filter. Actual login fields retain username/current-password
semantics, and document passwords still clear on submission or hiding. Extensions
can override browser hints; synthetic browser tests reproduce background
injection and verify normal typing remains usable without accessing saved real
credentials.

### How does the statement editor stay compact without losing review details?

The standalone draft uses a dialog-width-responsive grid: three columns when
there is enough room, two at intermediate widths and one on phones. Date and
time share a grid slot and stack when needed. Key money/account/category fields
stay visible. Source evidence, funding candidates and optional reference, value
date fields expand on demand without remounting or resetting the draft. Note and
its saved-note suggestion stay in the open main form for every statement row,
including when the draft editor opens from combined review. Amount and Note are
first in the draft, before date and classification, so they are discoverable
without scrolling through the rest of the fields.
Required discrepancy warnings and review acknowledgements are not collapsed.
Funding guidance is available through an info control that supports focus and tap.
The fixed footer explains every condition disabling Add transaction. The
transfer-wording issue directs the reviewer to check Reviewed transaction
type, then save to refresh matches. It also names unsaved edits, posting
issues, unavailable pending-source checks and missing discrepancy
acknowledgement. Submission errors are repeated next to the action buttons,
so they remain visible even when the review body has been scrolled away.

A missing transfer category can be proposed from the only active transfer
category, but ambiguous category lists still need a user choice. Opening preserves
saved categories; clearing a category remains possible. Type changes clear
incompatible categories. These changes require saving the draft and refreshing
matches before a posting/link decision; neither the source evidence nor existing
ledger transactions is rewritten automatically.

### Does opening combined source evidence reveal the full original text?

Combined review also opens each original SMS/PDF-row text automatically when
**Compare original sources and parsed values** is expanded. An explicit inner
collapse remains possible. Toggling sources does not change the form, balance
choice, confirmation checkboxes or outgoing draft, and cannot save a record.
Redaction status/date takes precedence over any retained nonempty SMS body.

### Is the compact layout shared by combined review and manual add/edit?

Yes. A named CSS container measures the actual editor width, so the combined
review's decision panel does not force three cramped columns into the form.
Date/time share a grid slot, additional columns appear when there is room, and
phone layouts stack. Add and edit use the same widened transaction dialog and
fixed action footer. Optional notes/references and original evidence expand on
demand; transfer accounts appear only for transfers. Conflicts and required
linked-correction/review confirmations remain visible.

The change only reorganizes the existing controlled inputs. Disclosure controls
stay mounted and CSS resizing does not reinitialize the draft. Both account
balances, optional fields and checked review decisions survive collapse/expand
and resizing. Server validation of a collapsed field opens its disclosure and
focuses it while retaining other edits. Existing account-bound balance rules,
combined-source conflict decisions and save/undo APIs remain unchanged.

### Does compact SMS review preserve edits and keep corrections discoverable?

Yes. It shares the editor-width container grid with combined review and add/edit,
so hiding the Focus queue can add columns without remounting the form. Date/time
share a slot and stack on phones. Reference, note and payment method live under
More details; the main account, money, classification and date fields stay visible.
Masked identifiers retain their separate automatic disclosure for a missing
reporting account or low confidence. Source evidence, account suggestions and
transfer/balance warnings retain their existing visibility rules.

Closing details, entering/exiting Focus and resizing keep the same controls.
Moving between messages restores each candidate's native text/date/time and
checkbox drafts alongside its controlled selections, amount and account-bound
balance. Nothing is persisted across reloads. A server field error expands its
containing disclosure and focuses that field without discarding the other edits.
The layout changes no confirmation/matching APIs, duplicate protection or learning
rules. Local synthetic browser checks cover the retained drafts and submitted
transfer details at desktop, tablet and phone widths.

### Does a small source difference need another confirmation?

No. SMS/PDF review and standalone statement matching display both exact amounts
and balances and automatically use the higher value for BDT differences strictly
below Tk 1.00. The normal Record/Link action remains; no extra rounding modal,
checkbox or lower-value choice is shown. Larger differences retain their review
controls. Unsaved fields, category decisions, account paths and source evidence
are preserved. The UI uses exact decimal cents and checks the complete range
across all selected sources. Ambiguous pairs stay unresolved and a stale request
cannot partially save. API deployment must precede the web update; no APK is
needed for this web/API feature.

### How does the Account Lanes timeline stay responsive and handle hidden accounts?

The `/timeline` view starts with three weeks and loads complete seven-day
activity pages in either date direction. Once the displayed range is ready,
it preloads the next two weeks on each side. Reaching an edge appends or
prepends a ready week without removing already displayed days or resetting
the native scroll position. A single compact edge loader appears if the
entering week is still loading. Long quiet stretches use one dated band per
week, so the scroll position advances visibly. Explicit date jumps may recenter
the displayed range; fetched weeks stay cached for the session. The date field follows
the day near the top of the viewport. Account selection controls visible lanes, while a
transfer links both visible cards, or offers a “Show lane” endpoint when an
account is hidden. The same transfer remains one ledger transaction. A
chronological List layout shows each movement once and has ordinary keyboard
buttons; opening a card from the keyboard focuses a nonmodal details drawer and
closing it returns focus to the card if it is still loaded. The lanes retain
their width while the drawer overlays the right edge on desktop or rises as a
bottom sheet on phones. Escape closes the drawer before leaving full screen;
another visible card can be chosen without closing it first. Cards can show
amount, reported balance, or both; entries without a trustworthy time remain
in a separate day disclosure in Lanes and appear as “Time unknown” in List.

The first position waits for its week rather than anchoring to loading
placeholders. A centered loader reports received movement counts during
multi-page fetches. Subsequent loading has one compact spinner and edge status;
days and cards appear only after their full week is loaded, even if later weeks
finish first. Retry controls remain available for failed weeks. Short runs of
collapsed quiet days may leave no scroll range; wheel and touch gestures at the
edge still advance a week, and
explicit edge controls remain available. Keyboard and scrollbar movement also
advance at a true edge. A continuous trackpad gesture advances
at most once, only at a true edge; horizontal swipes do not change weeks.
Loading and near-edge scrolling cannot shift the date window. The visible-date
label waits until scrolling settles before
updating, which avoids repainting every card during a gesture. The lane header
keeps a fixed height as historical report text changes, and manual scroll
anchoring avoids competing with the browser's automatic anchoring when weeks load.

The lane header labels the last saved report on or before the visible date and
its actual report date. When that cannot be established from loaded data, it
shows “No reported balance,” “Loading report context,” or “Report order unclear”
instead of projecting a running balance. Loaded runs without selected-account
activity collapse into dated bands. Next movement and Next gap jump among
loaded dates; Earlier dates and Later dates load another window if there is too
little content to scroll. Unloaded dates never count as verified quiet days.

Gap markers compare consecutive reports only when all intervening days were
loaded, every movement has a known order, and each relevant amount is valid.
Unknown times, differently dated transfer observations and unloaded dates
suppress a numeric gap; missing reported balances stay labeled “not reported.”
Opening a marker explains the previous report, included movements, expected
balance, current report, and signed difference, with links to the underlying
entries. The timeline is read-only and uses the existing activity and
source-evidence APIs.

### How does the user safely revalidate an already confirmed transaction?

Choose Revalidate on the Transactions row or an Evidence checks finding. The
dialog groups evidence by reporting account and compares each source's date,
direction, amount and balance with the current ledger. Incompatible evidence has
a specific reason; eligible current → proposed corrections have unchecked
checkboxes. If none is safe, Review ledger entry opens the editor on the same
page and the Apply action is absent. Applying selected changes performs one
reviewed update; closing and refreshing the comparison do not write. On errors
or stale evidence, approval clears and a
fresh preview is required. Success refreshes the list, shows a toast and records
History; latest-action Undo is available. Original SMS/PDF values stay intact.
Revalidation uses already attached sources, so there is no re-import/resync, and
it does not silently discover/merge unrelated transactions.

For a transfer, a Saved SMS card also offers Correct this SMS link. The panel
shows the precise source and can fetch its original text on demand. The user
chooses either a direction-compatible destination account or unlink to Review
inbox, then confirms. The comparison reloads after success; stale previews
must be refreshed. Other evidence and the ledger movement remain in place.
The current parser card is a fresh read-only interpretation, so its mismatch can
remain after a saved SMS link moves. It now has an explicit inspection action
rather than a button-like status label. Inspection compares the two interpretations,
can reveal the original SMS on demand, and opens SMS settings in a new tab for
future rule changes without discarding the transaction review.
An unidentified parser account is labeled as such instead of being described as
a known account outside the transfer path.

### Where do source-versus-ledger checks live?

The separate `/checks` Evidence health page first offers a bounded refresh of
missing historical SMS source directions and verifies stored statement direction
coverage. It shows recovered, known, and unresolved counts with a single loader
and progress bar; it never silently edits the ledger. A second action scans all
saved ledger entries, shows progress, and filters highlighted direction conflicts
from other findings. It reveals long finding lists 25 entries at a time. Either
operation can be paused and continued. The check
groups source-direction disagreements ahead of other findings and links each
entry to the shared editor or its revalidation preview in a modal on that page.
Closing the modal keeps the scan results and scroll position. Account Lanes uses
the same local editor for cards and gap details, retaining its visible date,
selected accounts, and full-screen setting. The latest-action Edit control also
opens the overlay. Direct `?edit=<UUID>` links to Transactions still work. The Transactions page
links to it; pending SMS and statement decisions remain in Review inbox. Bulk
revalidation is under Advanced tools. Running a check is read-only, and the page
marks its results stale after a ledger change instead of silently applying a fix.

### Can the user review and select many confirmed-transaction corrections together?

Yes. Bulk revalidate scans all saved transactions in pages and gathers corrections
in one dialog, with progress and Pause/Continue. Per-field checkboxes start clear;
result pagination and finding filters preserve choices across pages. Current/proposed
values, source observations, reasons and manual-review warnings remain inspectable.
Apply selected uses atomic groups of up to 25 entries, with confirmed progress.
After an error/uncertain result or external ledger change, approval clears and a
fresh scan is required. Rescan also clears selections. Source values stay unchanged,
History records corrections and Undo last group reverses only the latest successful
group. All scans are temporary/read-only until apply; visible ledger filters do not
limit their scope. Existing single-entry review and mobile apps keep working.

### How can users fit more timeline movements on screen without losing the day and time context?

Full screen expands `/timeline` over the navigation until the user exits or presses
Escape. A− and A+ change timeline text in 0.5 px increments within a readable
range and reduce row height when text gets smaller. The account header, day
labels, and left time rail use CSS sticky positioning in the same two-axis
scroll container, avoiding per-scroll JavaScript transforms that can lag and
visually wobble. These are presentation-only controls.

### What does statement review show for an EBL transaction posted late?

Direct statement matches, pending SMS pairs and unified review explain the
posting date, printed value date and SMS time. Their running balances stay
source-specific, so no cross-time balance radio appears. The user still reviews
the candidate and confirms that both sources describe one movement. Linking
keeps the earlier SMS ledger report; account summaries can show the later EBL
statement report without presenting it as a proven ledger mismatch.

### What should a user do when an old bKash row has the wrong debit or credit?

Open the saved bKash import in Statements, expand Statement details, and run **Recheck saved directions**. If its PDF is missing, re-upload the identical PDF to the same account first. Compare the exact row and Out/In column with the archived PDF; the parser's suggestion alone is not proof. Explicitly save the verified source direction, optionally align the saved draft if the ledger already agrees, and use **Compare linked ledger entry** if a confirmed transaction still differs. The page states that recheck and source review do not change confirmed ledger entries.
An unresolved bKash row cannot be added while its saved draft direction disagrees with the original or reviewed PDF direction. The review displays the exact blocker and asks for PDF verification.
