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

The Android app can discover distinct inbox sender identifiers without showing
message bodies, then lets the user search, map a sender to an account/provider,
and create an exact trusted rule. When matching SMS messages arrive, the app
stores the raw message locally and sends it to the backend. The backend parses
it into a transaction candidate, checks duplicate risk, and marks it for
review. Users can also scan a date range and explicitly reparse pending prior
imports with newer parser rules.

The user can exclude a provider or non-transaction message kind from capture.
OTP/security messages are excluded by default. The backend classifies these
before persistence and keeps only a hash/metadata tombstone for deduplication.
Rejected review items record why they were rejected and can redact the body,
disable the sender, or exclude the provider in the same action.

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
debt/lend sections, credit card bill checks, and repeating bills. The system
maps those into normalized database entities: transactions, categories,
accounts, reports, debts, credit card bills, recurring bills, and balance
snapshots.

## What is implemented right now?

The repository currently has planning docs, local PostgreSQL infrastructure,
Django API foundations, JWT auth, account/category/transaction APIs, payment
method and SMS sender rule management APIs, raw SMS import duplicate detection,
a parsed SMS review inbox, provider-specific starter SMS parsers, internal
transfer matching hints, debt and repayment APIs, credit card bill APIs,
recurring bill APIs, reconciliation APIs, a monthly report endpoint, a Next.js
dashboard workflow, web SMS review UI, web debt/lending, credit-card bill, and
recurring-bill dashboards, and an Expo Android-oriented mobile scaffold with
local raw-message queueing, SMS review including source/destination transfer
account selection, compact debt/lending workflow, and compact credit-card bill
and recurring-bill workflows, mobile balance reconciliation checks, and compact
mobile summary metrics for due-soon balances and reconciliation differences.
The mobile app also has a local Android native SMS capture scaffold for custom
dev client or personal APK builds, with sender-rule filtering before captured
messages enter the raw-message queue.
The web app also exposes balance reconciliation so expected ledger balances can
be compared with real account snapshots, and it has a read-only audit log page
for transaction change history that can be opened from individual transaction
rows.
Confirmed SMS transactions preserve normalized ledger evidence such as
debit/credit direction, reference or TrxID, balance after, counterparty text,
payment method, masked sender/receiver account and card identifiers, raw message
link, and duplicate key. Learned review choices are scoped by sender and message
kind, and the pending queue can be safely reparsed after a rule/parser update
without mutating confirmed ledger entries. bKash parser notes now
also surface detected till/counter and provider timestamp text for review. Raw
SMS bodies can now be
redacted after parsing while keeping duplicate hashes and parsed ledger fields.
The mobile raw-message queue also records sync attempts and failure reasons,
blocks obvious local duplicates, and lets invalid queued messages be removed
before retry.
The backend can export filtered transactions as CSV for spreadsheet backup or
external review, and the web transactions page exposes that export through the
active filters.
The infrastructure project also has local PostgreSQL dump and guarded restore
scripts, sidecar backup manifests, a dry-run-first retention helper, and a
backup automation runbook.
Production deployment readiness is documented with environment gates, backup
and restore expectations, and a rollback plan.
The web app permanently disables the temporary browser `localStorage` JWT path
in production. Same-origin Next.js auth routes use strict HTTP-only cookies,
reject cross-origin mutations, deduplicate concurrent refresh attempts, revoke
the refresh token on logout, and proxy authenticated workspace API calls.
For local development, the web API wrapper can rotate stored refresh tokens and
retry authenticated requests once after an expired access token response.
The backend settings also fail closed for unsafe debug-off configurations, such
as default secrets, SQLite, localhost-only hosts, or localhost CORS origins.
Backend JWT refresh tokens have a rolling 30-day lifetime, rotate on use, and
blacklist old tokens. Concurrent logins remain independent; users can revoke
one refresh session or all sessions. Login attempts are throttled by source IP
and normalized username.
Transaction creates, updates, and deletes are also recorded in a read-only,
user-scoped audit log with normalized before/after snapshots.
The contracts project now generates TypeScript schema types and a lightweight
fetch client from the OpenAPI file so the web and mobile clients have a shared
typing migration path.
The mobile app now hydrates account/category choices and the latest transaction
list from local cache on startup, and it can queue manual transaction drafts
with retry metadata for later sync.

## What is not implemented yet?

Real anonymized SMS fixture collection for bKash, EBL, City Bank, and Pathao
Pay; deeper provider-specific parser coverage for additional bank account
transfer and real-world provider variants; deeper mobile UI polish beyond the
first compact finance-summary pass; real-device validation of the native SMS
capture scaffold; additional production-grade local sync hardening; production
deployment execution; and deployment-specific encrypted backup storage with
monitoring are still planned future work.

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

I would collect real anonymized SMS fixtures, deepen additional
provider-specific bank transfer parsing, keep polishing mobile finance
workflows beyond the first compact summary pass, harden local sync, automate
deployment-specific encrypted backup uploads and alerts, and prepare the
Docker/deployment path for production.

The release path now adds defense in depth: mobile and native matching share
exact/contains/regex semantics, the server independently enforces active trusted
senders, local SMS bodies are encrypted, and Android WorkManager bridges live
capture to authenticated background upload with observable status.

## What happens when both accounts record the same internal transfer?

One canonical transfer moves money from A to B once. Each account can contribute
separate SMS/manual evidence with its own reference, date, direction, and
reported balance. Web and mobile suggest matching posted transfers or opposite
pending SMS; the user chooses “Link to existing transfer,” “Confirm as one
transfer,” or “Keep separate.” Incoming account history shows the same transfer
as a credit, while the source shows a debit. Real B-to-A return transfers remain
separate. Matching is review-assisted, not automatic financial posting.
