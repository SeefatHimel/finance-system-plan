# Backend API Q&A

## What is the backend responsible for?

The backend owns authentication, user-scoped data, accounts, categories,
transactions, reports, SMS ingestion, parsing rules, debt records,
reconciliation, audit logs, and API contracts. It is the source of truth for
all financial data.

## Why Django REST Framework?

Django REST Framework fits the project because it works naturally with Django
models, serializers, permissions, routers, authentication, and OpenAPI tooling.
It is a practical choice for CRUD-heavy financial workflows.

## Why use JWT authentication?

JWT works well for separate web and mobile clients. The API provides login and
refresh endpoints, and clients send the access token with protected requests.
This avoids coupling the clients to browser-only session behavior.

Access tokens last 15 minutes. Refresh tokens use a rolling 30-day lifetime,
rotate on use, and blacklist the previous token. Each login has its own refresh
token, so users can stay signed in on multiple devices and revoke one session
without ending the others. See `docs/auth-token-storage-plan.md`.

## What auth endpoints exist?

Current auth endpoints:

```txt
POST /api/auth/login/
POST /api/auth/refresh/
POST /api/auth/logout/
POST /api/auth/logout-all/
GET  /api/auth/me/
```

Login is throttled by source IP and normalized username. Single-session logout
blacklists the supplied refresh token; authenticated logout-all blacklists all
outstanding refresh tokens for that user. Short-lived access tokens may remain
valid until their normal expiry.

## Why use Django's default user model right now?

The first version is personal-use focused. Django's default user model is enough
for the current scope and avoids premature migration complexity. If product
needs require richer user profiles later, the project can add profile models or
move carefully to a custom user model before production.

## How do you protect user data?

Every finance queryset is scoped by `request.user`. The API uses authenticated
permissions on finance endpoints, and serializers validate that related objects
like accounts and categories belong to the current user.

Sender rule creation is also user-scoped. The serializer rejects duplicate
case-insensitive sender plus match-type combinations, which prevents mobile and
web clients from accidentally creating overlapping exact rules for the same
inbox sender.

## Why do new users receive default categories?

A blank category list makes both manual entry and SMS review unnecessarily hard,
so every newly created user receives a small, editable starter taxonomy covering
common expenses, income, transfers, and debt. The categories are ordinary
user-owned records: users can rename, deactivate, delete, or extend them. The
creation helper is idempotent, and saving an existing user does not recreate a
category they intentionally removed. The data migration backfills only existing
users with zero categories, avoiding changes to users who already customized
their taxonomy.

## What are the core backend apps?

Implemented:

- `health`
- `users`
- `accounts`
- `categories`
- `payment_methods`
- `messages` for sender rule management
- `transactions`
- `reports`
- `debts`
- `reconciliation`
- `audit_logs`

## Why separate apps by domain?

Separate apps keep ownership clear. Accounts, categories, transactions, reports,
messages, debts, reconciliation, and audit logs each have different rules and
can grow without one large tangled module.

## Why use UUID primary keys for finance models?

UUIDs are safer for client-facing APIs because they are harder to enumerate than
sequential IDs. They also work well if mobile offline sync or distributed data
creation is added later.

## How are transactions modeled?

A transaction has a positive amount, date, type, account, optional transfer
account, optional category, source, note, and review flag. The type determines
whether it is income, expense, transfer, lend, borrow, refund, fee, or repayment.
The transaction row also stores ledger direction, so the primary account can be
shown as debit or credit without clients guessing from display signs.

## Why not use double-entry accounting immediately?

Double-entry accounting is more rigorous, but it adds complexity. For the first
personal version, a simpler transaction model is faster to build and easier to
use. The current design still leaves room to evolve toward transaction lines
later if needed.

## How are transfers handled?

A transfer uses a source account and a destination `transfer_account`. The API
validates that transfer transactions include a destination account and that
non-transfer transactions do not.

## What finance evidence is kept after SMS confirmation?

Confirmed transactions copy normalized evidence into the ledger row:
debit/credit direction, provider reference or TrxID, balance after,
counterparty text, payment method, raw message id, and an external duplicate
key. The transaction note is a safe summary rather than a copy of the full SMS.
The original text follows the user's retention choice: redact immediately,
retain for 7 or 30 days, or keep until manual redaction. Reports and exports use
the structured fields and never need to reparse the SMS body.

## How does the API represent an account's current balance?

It deliberately exposes two different concepts. `ledger_balance` is read-only
and is derived from the account's starting balance plus all posted transactions,
including both sides of transfers and debit/credit adjustments.
`latest_reported_balance` and `latest_reported_balance_date` come from the most
recent transaction that carried a provider-reported `balance_after` value.
Keeping the reported value as transaction evidence avoids a mutable account
balance becoming stale after a backdated create, edit, delete, or offline sync.
Reconciliation snapshots remain the explicit actual-balance check.

## How are transaction changes audited?

Transaction creates, updates, and deletes write user-scoped audit entries. Each
entry records the action, entity type, entity id, normalized before snapshot,
normalized after snapshot, metadata, and creation timestamp. The API exposes the
audit trail as read-only data, filterable by `action`, `entity_type`, and
`entity_id`.

## How are monthly reports calculated?

The monthly report endpoint filters transactions by user and month, then
summarizes income, expenses, category totals, and account money-in/money-out
values.

## Why is report logic in the backend?

Reports must match across web and mobile. Backend-owned reports reduce duplicate
logic and make financial behavior easier to test.

## What endpoints are currently implemented?

Current backend surface:

```txt
GET    /api/health/
POST   /api/auth/login/
POST   /api/auth/refresh/
POST   /api/auth/logout/
POST   /api/auth/logout-all/
GET    /api/auth/me/
GET    /api/accounts/
POST   /api/accounts/
GET    /api/categories/
POST   /api/categories/
GET    /api/payment-methods/
POST   /api/payment-methods/
GET    /api/messages/sender-rules/
POST   /api/messages/sender-rules/
POST   /api/messages/import/
POST   /api/messages/dev/reset/  # DEBUG only
GET    /api/messages/review/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/ignore/
GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/export/?month=YYYY-MM
GET    /api/debts/
POST   /api/debts/
POST   /api/debts/{id}/payments/
GET    /api/credit-card-bills/
POST   /api/credit-card-bills/
POST   /api/credit-card-bills/{id}/payments/
GET    /api/recurring-bills/
POST   /api/recurring-bills/
POST   /api/recurring-bills/{id}/payments/
GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/accounts/{account_id}/
GET    /api/audit-logs/
GET    /api/audit-logs/{id}/
```

The DRF routers also provide detail, update, and delete endpoints for accounts,
categories, payment methods, sender rules, transactions, debts, credit card
bills, recurring bills, and balance snapshots.

The settings module also validates production-critical configuration when
`DJANGO_DEBUG=false`, refusing local-dev secrets, SQLite, localhost-only hosts,
localhost CORS origins, and missing or non-HTTPS CSRF trusted origins. It trusts
the proxy's forwarded HTTPS scheme and uses secure session and CSRF cookies in
production; Render's external service URL is included automatically.
JWT refresh tokens rotate on use and old refresh tokens are blacklisted after
rotation, which makes refresh-token reuse fail instead of silently extending a
stolen token.

Transaction list and CSV export endpoints support the same user-scoped filters:
month, account, category, type, debit/credit direction, source, and `search`
across reference, counterparty text, note, and external duplicate key. Source
filtering separates web, mobile, SMS, import, and system-generated ledger rows.

## How do you validate cross-user object access?

Serializers check that selected accounts, transfer accounts, categories, and
parent categories belong to the current authenticated user.

## How would you add payment methods?

The `payment_methods` app now stores user-scoped methods with a provider,
identifier, linked account, active status, and display order. Sender rules and
future SMS parsers can reference payment methods to map messages to accounts.

## How would you add SMS parsing?

Raw message import stores the sender, body, received time, optional device
message ID, and a deterministic body hash. The backend creates a parsed message
candidate with matched sender rule metadata, amount extraction, confidence, and
parser notes. Candidates can be reviewed, confirmed into an SMS-sourced
transaction, or rejected with a structured reason.

Before a raw body is saved, the import endpoint resolves its trusted sender
rule, provider, and supported non-transaction kind. Per-user capture preferences
can exclude providers, OTP/security messages, or balance notices. An excluded
message creates only an ignored deduplication tombstone containing its hash and
metadata; no candidate or original body is stored. OTP/security is excluded by
default.

Duplicate imports can opt into `reprocess_existing`. The backend then updates
the existing candidate with current sender rules and parser logic only while it
still needs review. Confirmed and ignored candidates are returned unchanged, so
a history rescan cannot silently rewrite ledger decisions. A development-only
reset can clear one authenticated user's SMS imports and SMS-created test
transactions, but the endpoint returns `404` whenever `DJANGO_DEBUG=false`.

Phase 3 now has transfer-aware candidate fields, an initial bKash parser,
starter EBL/City Bank parsing for purchases, ATM withdrawals, card payments,
fees, refunds, and reversals, starter bank transfer source/destination hinting for EBL
bank-to-wallet and City Bank own-account transfer messages, and starter Pathao
Pay parsing for top-up, payment, send-money, and withdraw confirmations. The
parsers detect message kind, amount, reference, balance, fee,
merchant/counterparty text, and possible internal transfers for cash-in/cash-out
and bank/card transfer-style messages. Counterparty extraction strips common
confirmation noise such as trailing `successful`, and bKash payment parser
notes surface detected till/counter and provider timestamp text when present.
bKash
transfer-like messages also try to match masked account or wallet identifiers
against the user's configured payment methods so known source/destination
accounts can be prefilled. Bank account transfer messages now use the same
known payment-method hints when an anonymized account or wallet identifier is
present in the message. Taka amounts accept both `Tk 1,000` and the common
`Tk. 1,000` spelling used by City Bank messages. City Bank deposit parsing
also distinguishes a date year from the following transaction amount and
supports balances written after the value, such as `Tk. 2,33,319 Balance`.

For internal transfers, the backend now links possible related candidates when
two review items belong to the same user, have the same amount, close received
timestamps, and different providers. The link is only a review hint; it does
not auto-confirm or merge transactions.

## How would you prevent duplicate SMS transactions?

The raw import endpoint checks duplicates by device message ID when available
and by a deterministic hash of sender, body, and received time. Duplicate
checks happen before parsing or transaction creation. On confirmation, the API
also creates a transaction `external_key` from provider/reference data when
available, or from the raw message id as a fallback, and rejects another
transaction with the same key.

## How do you handle raw SMS privacy after parsing?

The backend now exposes a raw SMS redaction endpoint. It replaces the raw body
with `[redacted]`, clears the device message id, marks the raw message as
`redacted`, and records `redacted_at`. Parsed candidate fields, transaction
reference, balance, counterparty, amount, raw message link, and duplicate hash
remain, so reports and duplicate checks still work without keeping the original
SMS text. New confirmation notes contain only normalized message kind and
counterparty data, so removing the original body does not change ledger notes.

Each user can choose raw-text retention of zero, 7, or 30 days, or no automatic
expiry. Zero redacts immediately at confirmation; the scheduled
`redact_expired_sms` command removes expired bodies for the other finite values.

The capture policy also prevents selected content from being retained at all.
During review, rejection records a reason and can atomically redact the raw SMS,
deactivate the matched sender rule, or add the candidate provider to the user's
excluded-provider list. The legacy ignore route remains compatible but now
records `not_transaction` as its default rejection reason.

## How does review correction improve future imports?

When the reviewer enables “use choices next time,” confirmation writes the
corrected account, payment method, category, and transaction type back to the
matched sender rule. Future messages from that sender start with those defaults,
while amount, balance, date, reference, and counterparty still come from each
message. The learning is explicit and user-controlled rather than automatic.

## How is mobile SMS sync health represented?

The mobile app posts a user-scoped heartbeat containing permission, background
sync state, queue counts, errors, last scan, and last successful sync. The API
derives a small health state such as `healthy`, `offline`, `error`, or
`permission_required`. Web clients use that endpoint instead of inferring
mobile health from candidate timestamps.

## Why do internal transfers need special handling?

Bank-to-bKash, bKash-to-bank, card bill payments, and transfers between the
user's own accounts are not expenses or income. If the parser only extracts an
amount and direction from one SMS, it can create misleading reports. Internal
transfer candidates preserve source/destination hints and possible related SMS
links so the review flow can confirm the movement without double-counting it.

## Can you run the API locally against hosted PostgreSQL?

Yes. Point `DATABASE_URL` in `projects/finance-api/.env` at the provider's
external hostname. Local Docker Postgres stays on `localhost`. Hosted hosts
outside `localhost`/`127.0.0.1`/`postgres` use SSL by default. Create a
superuser on that database with `python manage.py createsuperuser` after
migrate.

## How would you handle migrations safely?

Use small migrations, avoid destructive schema changes, backfill data with data
migrations when needed, and keep API compatibility during frontend/mobile
rollouts.

## How would you test this backend?

I would test serializers, permissions, model constraints, API endpoints,
monthly report calculations, SMS parser cases, duplicate detection, and
reconciliation math. Export endpoints should be tested for user scoping,
filters, CSV headers, and ledger evidence fields. Audit endpoints should be
tested for user scoping, read-only behavior, filters, and before/after
snapshots on transaction mutations.

## What is a limitation of the current backend?

It has the first manual finance loop, SMS import/review, debt records, and
reconciliation endpoints, but the provider parsers are still early. It still
needs real anonymized SMS fixture coverage, deeper provider-specific bank
transfer variants, production deployment execution, and UI polish around debt
and reconciliation workflows. Audit logging currently covers transaction
mutations first; other finance domains can be added as the product hardens.

## How does the API prevent an untrusted sender from being uploaded?

`POST /api/messages/import/` performs its own active sender-rule lookup before
storing a raw body. A mobile toggle is therefore only a device-side preference,
not the security boundary. An unmatched or inactive sender receives `400` and
no `RawMessage` row is created. Exact, contains, and regex behavior is shared
with mobile; invalid regex rules are rejected during rule validation, and a
case-insensitive database constraint prevents duplicate sender/match-type rules
for one user.
