# Web App Q&A

## What is the web app responsible for?

The web app is the command center for managing transactions, accounts,
categories, reports, SMS review, debts, credit cards, recurring bills, payment
methods, and reconciliation.

## Why Next.js App Router?

The App Router gives a modern React structure with server components, layouts,
routing, and flexible data loading. It is a good foundation for a dashboard that
will combine server-rendered status, authenticated pages, and interactive forms.

## What is implemented in the web app right now?

The web app has a Next.js scaffold, TypeScript setup, environment-based API URL,
global styles, a dashboard shell, a server-rendered backend health check, a
local JWT login flow, and a first transactions page for listing and creating
manual transactions. It also has an accounts page for managing accounts and
categories, an SMS settings page for managing payment methods and sender rules,
an SMS review inbox for parsed message candidates, a monthly reports page, and
a debt/lending dashboard for creating debt records and repayments, a credit
card bills page for statement balances, due dates, minimum dues, and payments,
and a recurring bills page for repeating payment schedules. It also has a
reconciliation page for expected-vs-actual account balance checks and balance
snapshot history.

## Why start with a health-check dashboard?

It proves the web project can run and communicate with the backend. It is a
small but useful integration milestone before building login, tables, and forms.

## How does the web app know the backend URL?

It uses `NEXT_PUBLIC_API_BASE_URL`, defaulting to `http://localhost:8000` during
local development.

## Why use TypeScript?

TypeScript reduces mistakes in data-heavy UI work. It becomes more valuable as
forms, filters, reports, and generated API clients are added.

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
- Settings

## How should the transaction table work?

It should feel close to the spreadsheet workflow: filter by month, account,
category, type, and source; add/edit rows quickly; and support display modes
like spreadsheet sign mode, ledger mode, and money-in/money-out mode.

## What does the current transactions page do?

The current transactions page uses the saved local JWT access token to load
accounts, categories, and transactions from the Django API. It provides a manual
transaction form and a transaction table with filters for month, type, account,
and category. It supports updating and deleting transaction rows, and can
download a CSV export using the same active filters.

## Why add transaction filters early?

Filtering is essential for a finance workflow because transaction lists grow
quickly. Month, account, category, and type filters make the web app useful for
checking entries and comparing the transaction table with monthly reports.

## What does the current accounts page do?

The current accounts page uses the saved local JWT access token to create and
list accounts and categories. It now supports full CRUD for accounts and
categories, with backend constraints still preventing deletion when records are
referenced by transactions.

## What does the current SMS settings page do?

The SMS settings page uses the saved local JWT access token to load accounts,
payment methods, and sender rules. It supports creating, listing, updating, and
deleting payment methods and sender rules so SMS import can map trusted senders
back to real accounts.

## What does the current SMS review page do?

The SMS review page uses the saved local JWT access token to load pending parsed
message candidates, accounts, and categories. It shows raw SMS evidence, parser
notes, parser confidence, review or duplicate reason, detected
provider/message kind, amount, reference, balance, fee, counterparty text, and
possible internal-transfer/related-message hints. The user can confirm a
candidate into an SMS-sourced transaction or ignore it. The confirmation flow
now supports debit/credit direction and transfer destination selection, and the
resulting transaction preserves reference, balance, and counterparty evidence.
The page can also redact the raw SMS body after review while keeping parsed
ledger evidence available.

## What does the current reports page do?

The current reports page calls the Django monthly report endpoint and shows
income, expense, net total, category totals, and account movement for a selected
month. This is the first web version of the spreadsheet's monthly summary view.

## What does the current reconciliation page do?

The reconciliation page loads accounts, balance snapshots, and per-account
expected balances from the Django API. The user can select an account, compare
the expected ledger balance with the latest real-life snapshot, save a new
actual balance snapshot, and review warning reasons such as missing expenses,
missing income, or duplicate transactions.

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

The transaction table shows date, type, debit/credit direction, account,
category, amount, balance after, provider transaction id/reference,
sent-to/received-from text, note, and delete actions. The page can export the
filtered rows as CSV for spreadsheet backup or external review. This makes
SMS-confirmed transactions inspectable without opening the raw message every
time.

## Why not copy the spreadsheet exactly?

The spreadsheet is a useful mental model, but the app should improve structure,
validation, filtering, reports, and review workflows. Copying every spreadsheet
layout detail would preserve old limitations.

## How does login work?

The current web app submits username/password to `/api/auth/login/`, stores the
returned JWT tokens for local development, and calls `/api/auth/me/` to show the
signed-in user on the dashboard.

## Where should auth tokens be stored?

For production, secure HTTP-only cookies are usually preferable. The current
local-development version uses browser `localStorage`, which is simple for this
stage but should be hardened before deployment. The production direction is
documented in `docs/auth-token-storage-plan.md`.

## How will the web app fetch data?

The likely choice is TanStack Query for client-side authenticated data fetching,
caching, retries, and mutation flows. Server-rendered pages can still be used
where they make sense.

## How would you handle loading, empty, and error states?

Each main screen should show explicit loading states, empty states, and error
messages. Finance users need confidence that missing data means "nothing found,"
not "the app silently failed."

## How would you handle responsive design?

Dashboards and forms should remain usable on small screens. Dense transaction
tables may need column hiding, horizontal scroll, or mobile-friendly list views.

## What is the biggest web UI challenge?

The transaction table. It needs to be dense like a spreadsheet but safer and
more ergonomic than a spreadsheet, with validation, filters, quick edits, and no
layout breakage on smaller screens.
