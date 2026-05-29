# Interview Pitch

## Short Pitch

This is a personal finance system that turns my spreadsheet-based finance
tracking into a real full-stack product. It uses a Django REST API with
PostgreSQL as the source of truth, a Next.js web dashboard for management and
reports, and a planned React Native Android app for quick entry and SMS-based
transaction capture.

## Longer Pitch

I built this project because I was already tracking expenses, balances, debts,
and monthly summaries manually in a spreadsheet. The spreadsheet worked, but it
was manual, hard to automate, and easy to forget. So I designed a system where
the backend owns the financial data, the web app gives me a dashboard and
management UI, and the mobile app can eventually read transaction SMS messages
from selected senders on Android.

The project is intentionally split into separate projects: backend, web, mobile,
infra, and contracts. That keeps the architecture clean while still allowing
fast early development in one workspace.

## Best 60-Second Answer

This project is a finance tracker designed around my real workflow. I used to
track expenses, balances, debts, and monthly summaries in a spreadsheet, so I
designed a system to make that workflow structured and eventually automated.

The backend is Django REST Framework with PostgreSQL because the financial data
needs to be consistent, relational, and secure. The web app is Next.js for the
dashboard and management UI. The mobile app is planned in React Native Android
because the key automation feature is reading transaction SMS messages from
user-approved senders.

Right now the repo has the architecture docs, local PostgreSQL setup, JWT auth,
account/category/transaction APIs, payment method and SMS sender rule APIs, raw
SMS import with duplicate detection, monthly reports, a Next.js dashboard, a
web login flow, account/category setup screens, and an initial manual
transaction page with filters and a monthly report page. Next I would build the
Phase 2 web/mobile management flows and add parser-backed review inboxes.

## Strong Technical Points To Mention

- Backend is the source of truth.
- Data is scoped per authenticated user.
- Amounts are stored as positive values; transaction type controls direction.
- SMS capture is sender-rule based for privacy.
- Rule-based parsing comes before AI for explainability.
- Reconciliation is planned because real-life balances can drift.
- Projects are separate to preserve clean ownership.
- OpenAPI/contracts keep web and mobile aligned.

## If Asked "What Was The Hardest Part?"

The hardest design part is modeling real-life finance behavior without making
the first version too complex. A pure accounting system could use double-entry
from day one, but that would slow down the personal workflow. I chose a simpler
transaction model now, while keeping clear transaction types, transfer accounts,
and report logic in the backend so the system can evolve.

## If Asked "What Would You Build Next?"

I would build the review inbox and parser layer, then connect web/mobile
management screens for payment methods and sender rules. After that I would add
reconciliation and debt workflows.

## If Asked "How Is This Different From A Simple Expense Tracker?"

It tracks more than expenses. It models accounts, balances, debts, lending,
repayments, monthly summaries, reconciliation differences, and SMS transaction
capture. The goal is to track money movement across real payment methods, not
just tag expenses.

## If Asked "What Would You Do Differently In Production?"

For production, I would harden auth token storage, add secure deployment
configuration, set up database backups and restore testing, add monitoring,
improve audit logs, and review Android SMS permission policy carefully before
public distribution.
