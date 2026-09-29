# Interview Pitch

## Short Pitch

This is a personal finance system that turns my spreadsheet-based finance
tracking into a real full-stack product. It uses a Django REST API with
PostgreSQL as the source of truth, a Next.js web dashboard for management and
reports, and an Expo React Native Android app for quick entry and SMS-based
transaction workflows.

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
dashboard and management UI. The mobile app is Expo React Native because the key
automation feature is Android-first SMS transaction capture from user-approved
senders.

Right now the repo has the architecture docs, local PostgreSQL setup, JWT auth,
account/category/transaction APIs, payment method and SMS sender rule APIs, raw
SMS import with duplicate detection, a parsed SMS review inbox, monthly
reports, debt/repayment, credit card bill, recurring bill, and reconciliation
endpoints, a Next.js dashboard, web management, SMS review, debt, credit-card,
recurring-bill, and reconciliation screens, and an Expo mobile scaffold with
local raw-message queuing, retry metadata, duplicate checks, sync, SMS review,
historical date-range rescans, pending-candidate reparsing, searchable inbox
sender discovery, and mobile sender-rule creation backed by a local Android
native SMS capture module for custom dev client or personal APK builds. The
transactions page can also download filtered CSV
exports for spreadsheet backup, and transaction changes are captured in a
read-only audit trail. Local PostgreSQL dump, guarded restore, backup manifest,
and retention scripts provide the first database backup path, and the deployment
runbook captures production readiness gates and rollback expectations. Next I
would validate native SMS capture on a real device, collect real anonymized SMS
fixtures, expand additional bank transfer variants, and continue mobile finance
workflow polish.

## Strong Technical Points To Mention

- Backend is the source of truth.
- Data is scoped per authenticated user.
- Amounts are stored as positive values; transaction type controls direction.
- SMS capture is sender-rule based for privacy, and sender discovery exposes
  identifiers/counts without revealing message bodies.
- Rule-based parsing comes before AI for explainability.
- Reconciliation exists because real-life balances can drift.
- CSV export keeps a spreadsheet/backup path available while the app matures.
- Transaction audit logs make edits and deletions inspectable.
- The OpenAPI contract can generate shared TypeScript types and a fetch client.
- Projects are separate to preserve clean ownership.
- OpenAPI/contracts keep web and mobile aligned.

## If Asked "What Was The Hardest Part?"

The hardest design part is modeling real-life finance behavior without making
the first version too complex. A pure accounting system could use double-entry
from day one, but that would slow down the personal workflow. I chose a simpler
transaction model now, while keeping clear transaction types, transfer accounts,
and report logic in the backend so the system can evolve.

## If Asked "What Would You Build Next?"

I would collect more anonymized SMS fixtures for bKash, EBL, City Bank, and
Pathao Pay, then use them to deepen additional bank transfer and
internal-transfer matching variants. I would also expand physical-device test
coverage for sender discovery, history rescans, and background capture,
continue mobile finance workflow polish, harden local sync, and add
deployment-specific encrypted backup uploads and alerts.

## If Asked "How Is This Different From A Simple Expense Tracker?"

It tracks more than expenses. It models accounts, balances, debts, lending,
repayments, credit card bills, monthly summaries, reconciliation differences,
and SMS transaction capture. The goal is to track money movement across real
payment methods, not just tag expenses.

## If Asked "What Would You Do Differently In Production?"

For production, I would harden auth token storage, add secure deployment
configuration, set up database backups and restore testing, add monitoring,
improve audit logs, and review Android SMS permission policy carefully before
public distribution. The repo includes a production auth/token storage plan for
web cookies, mobile secure storage, and refresh-token rotation.
