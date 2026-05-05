# Web App Q&A

## What is the web app responsible for?

The web app is the command center for managing transactions, accounts,
categories, reports, SMS review, debts, payment methods, and reconciliation.

## Why Next.js App Router?

The App Router gives a modern React structure with server components, layouts,
routing, and flexible data loading. It is a good foundation for a dashboard that
will combine server-rendered status, authenticated pages, and interactive forms.

## What is implemented in the web app right now?

The web app has a Next.js scaffold, TypeScript setup, environment-based API URL,
global styles, a dashboard shell, a server-rendered backend health check, a
local JWT login flow, and a first transactions page for listing and creating
manual transactions. It also has an accounts page for creating and listing
accounts and categories.

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
- SMS Review
- Monthly Reports
- Debts
- Reconciliation
- Settings

## How should the transaction table work?

It should feel close to the spreadsheet workflow: filter by month, account,
category, type, and source; add/edit rows quickly; and support display modes
like spreadsheet sign mode, ledger mode, and money-in/money-out mode.

## What does the current transactions page do?

The current transactions page uses the saved local JWT access token to load
accounts, categories, and transactions from the Django API. It provides a manual
transaction form and a recent transactions table.

## What does the current accounts page do?

The current accounts page uses the saved local JWT access token to create and
list accounts and categories. This completes the minimum setup loop needed
before adding manual transactions.

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
stage but should be hardened before deployment.

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
