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
global styles, a dashboard shell, and a server-rendered backend health check.

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

## Why not copy the spreadsheet exactly?

The spreadsheet is a useful mental model, but the app should improve structure,
validation, filtering, reports, and review workflows. Copying every spreadsheet
layout detail would preserve old limitations.

## How will login work?

The web app will submit username/password to `/api/auth/login/`, store the
access token carefully, use it for API calls, and refresh it through
`/api/auth/refresh/`.

## Where should auth tokens be stored?

For a production product, secure HTTP-only cookies are usually preferable. For
early local development, token storage can be simpler, but the architecture
should move toward safer storage before deployment.

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

