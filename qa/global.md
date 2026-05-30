# Global Product And Architecture Q&A

## What is this project?

This is a personal finance system for tracking daily expenses, income, account
balances, debts, credit card activity, and SMS-based transaction reports. The
goal is to replace a spreadsheet workflow with a web app, Android app, Django
backend, and PostgreSQL database.

## Why did you build this project?

I already tracked finances manually in a spreadsheet, but the process was slow,
easy to forget, and hard to automate. This project turns that existing workflow
into a structured system that can support manual entry, automatic SMS capture,
monthly reports, reconciliation, and eventually product-level features.

## What problem does it solve?

It solves three related problems:

- Daily transaction tracking is tedious when done manually.
- Real account balances can drift from expected balances when transactions are
  missed.
- SMS transaction messages contain useful financial data but are not organized
  into reports.

## Who is the first user?

The first user is myself. The architecture still keeps user ownership and
authentication so the system can become a multi-user product later.

## What is the high-level architecture?

The architecture has separate projects:

- `finance-api`: Django REST backend and source of truth.
- `finance-web`: Next.js dashboard.
- `finance-mobile`: React Native Android app.
- `finance-infra`: PostgreSQL and deployment setup.
- `finance-contracts`: API contract documentation.

The web and mobile apps call the Django API. The API persists data in
PostgreSQL and owns all business rules.

## Why keep the projects separate?

Each part has a different runtime, dependency set, and deployment concern. The
backend, web app, mobile app, infrastructure, and contracts should be able to
evolve independently. Keeping them separate makes the system easier to explain,
test, and eventually deploy.

## Why start as a monorepo-style workspace instead of many repositories?

At the beginning, the API contract and product behavior will change often. A
single workspace makes cross-project development faster while still preserving
separate project boundaries. If the project becomes a product or gains multiple
contributors, the projects can be split into separate repositories later.

## Why Next.js for the web app?

Next.js is a strong choice for a dashboard because it supports React, routing,
server rendering, API integration, and a good developer experience. It also
makes it easier to build a polished web UI while keeping future deployment
options open.

## Why Django for the backend?

Django is reliable for data-heavy applications. It provides ORM, migrations,
admin, authentication foundations, security defaults, and a mature ecosystem.
For a finance app, boring and dependable backend technology is a strength.

## Why PostgreSQL?

PostgreSQL is well-suited for financial records because it supports strong
relational modeling, constraints, indexes, transactions, and reliable
persistence. It is also production-proven and works well with Django.

## Why React Native for mobile?

The mobile app needs Android access for SMS-based tracking. React Native allows
building a native mobile experience while using TypeScript and React patterns
that are familiar from the web app.

## Why Android first?

Android allows SMS access with user permission. iOS does not generally allow
apps to automatically read SMS messages, so Android is the practical first
platform for automatic transaction capture.

## What is the source of truth?

The Django backend is the source of truth. Web and mobile clients can display
data and submit changes, but persisted financial records, reports, and balance
logic belong to the backend.

## Why not calculate everything in the frontend?

Finance calculations must be consistent across web and mobile. If each client
calculates balances differently, reports can drift. Centralizing logic in the
backend makes behavior easier to test, audit, and maintain.

## How does SMS tracking work conceptually?

The Android app lets the user choose trusted sender numbers. When matching SMS
messages arrive, the app stores the raw message locally and sends it to the
backend. The backend parses it into a transaction candidate, checks duplicate
risk, and either marks it for review or creates a confirmed transaction.

## Why require sender rules for SMS?

SMS content is sensitive. The app should only process messages from senders the
user explicitly enabled. This improves privacy and reduces noisy parsing from
irrelevant messages.

## Why not use AI for parsing from day one?

The first version should be deterministic, testable, and explainable. SMS
formats from providers usually follow patterns, so rule-based parsing is a
better foundation. AI can be added later for categorization or ambiguous cases.

## How are balances handled?

Expected balances are calculated from confirmed transactions. Real-life balance
checks are stored as snapshots with expected balance, actual balance,
difference, and status. If actual and expected balances differ, the system shows
the missing or extra amount and can later create an adjustment.

## Why support manual reconciliation?

People forget transactions, enter wrong amounts, or pay cash without recording
it. A reconciliation workflow accepts that real life is messy while keeping the
ledger honest.

## How are debts handled?

Debt and lend records are tracked separately from normal expenses, but money
movement still affects account balances. If I lend money, the source account
decreases and a receivable debt is created. If I get repaid, the account
increases and the debt balance decreases. The backend now stores debt records
with direction, principal, current balance, status, and repayment entries.

## Why store transaction amounts as positive values?

The amount is a magnitude. The transaction type determines direction. This
avoids confusion when switching between views like spreadsheet mode, ledger
mode, and money-in/money-out mode.

## How does this map to the original spreadsheet?

The spreadsheet had daily rows, categories, account sections, monthly summaries,
debt/lend sections, and credit card bill checks. The system maps those into
normalized database entities: transactions, categories, accounts, reports,
debts, credit card bills, and balance snapshots.

## What is implemented right now?

The repository currently has planning docs, local PostgreSQL infrastructure,
Django API foundations, JWT auth, account/category/transaction APIs, payment
method and SMS sender rule management APIs, raw SMS import duplicate detection,
a parsed SMS review inbox, provider-specific starter SMS parsers, internal
transfer matching hints, debt and repayment APIs, credit card bill APIs,
reconciliation APIs, a monthly report endpoint, a Next.js dashboard workflow,
web SMS review UI, web debt/lending and credit-card bill dashboards, and an
Expo Android-oriented mobile scaffold with local
raw-message queueing and SMS review including source/destination transfer
account selection. The web app also exposes balance reconciliation so expected
ledger balances can be compared with real account snapshots.
Confirmed SMS transactions preserve normalized ledger evidence such as
debit/credit direction, reference or TrxID, balance after, counterparty text,
payment method, raw message link, and duplicate key. Raw SMS bodies can now be
redacted after parsing while keeping duplicate hashes and parsed ledger fields.

## What is not implemented yet?

Real anonymized SMS fixture collection for bKash, EBL, City Bank, and Pathao
Pay; deeper provider-specific parser coverage for bank transfers, card
payments, fees, refunds, and reversals; mobile UI polish for debt and
credit-card and reconciliation workflows; native Android SMS capture
implementation; production-grade local sync hardening; and production
deployment setup are still planned future work.

## What is the biggest technical risk?

The SMS capture/parsing workflow is the biggest risk because Android
permissions, provider message formats, duplicates, and privacy constraints all
matter. That is why the design stores raw messages, tracks sender rules, and
uses a review inbox.

## What is the biggest product risk?

Trust. A finance tracker is only useful if the user believes the numbers. The
project handles this by keeping audit-friendly records, allowing reconciliation,
showing missing amounts, preserving raw SMS evidence for parsed entries, and
copying important SMS facts into final transaction fields so reports do not rely
on reparsing message text.

## How would this become a product later?

It would need stronger onboarding, multi-user support, subscription or account
management if commercialized, robust privacy controls, backup/restore, mobile
store policy compliance, monitoring, and deployment automation.

## What would you improve with more time?

I would collect real anonymized SMS fixtures, deepen provider-specific parsing,
build mobile debt, credit-card, and reconciliation screens, harden local sync,
add a generated API client, and prepare the Docker/deployment path for
production.
