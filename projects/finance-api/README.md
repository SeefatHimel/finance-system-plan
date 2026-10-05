# finance-api

Django backend and source of truth for the finance system.

## Current Status

The API project is scaffolded with:

- Django settings
- Django REST Framework dependency
- OpenAPI documentation dependency
- CORS configuration
- `/api/health/` endpoint
- Health endpoint test
- Account, category, and transaction models
- Authenticated CRUD APIs for accounts, categories, and transactions
- Editable starter expense, income, transfer, and debt categories for new users,
  with a migration that backfills only users whose category list is empty
- Authenticated CRUD APIs for payment methods and SMS sender rules
- Duplicate sender/match combinations rejected per authenticated user
- Raw SMS import endpoint with duplicate detection and opt-in reparsing of
  pending duplicates
- Per-user SMS capture policy for provider and non-transaction message-type
  exclusions and confirmed raw-text retention; excluded bodies are replaced by
  hash-only tombstones before save
- Mobile device heartbeat endpoint with permission, queue, error, scan, sync,
  and derived health status
- Parsed SMS review inbox with confirm/reject actions, structured rejection
  reasons, optional raw-body redaction, and sender/provider exclusion shortcuts
- Opt-in review learning that saves corrected account, payment method, category,
  and transaction type back to the sender rule
- Basic monthly report endpoint
- Debt and repayment workflow endpoints
- Credit card bill and payment workflow endpoints
- Recurring bill schedule and payment workflow endpoints
- Balance snapshot and reconciliation endpoints
- Derived account ledger balances plus latest provider-reported transaction
  balance evidence on account responses
- Read-only audit log endpoint for transaction creates, updates, and deletes
- JWT login, refresh, per-session logout, all-session logout, and current-user
  endpoints
- JWT refresh-token rotation and blacklist-after-rotation settings
- Per-IP and per-username login throttles, 15-minute access tokens, and rolling
  30-day refresh sessions
- Production settings guard that refuses unsafe `DJANGO_DEBUG=false`
  configurations

## Responsibilities

- User authentication
- Accounts and payment methods
- Categories
- Transactions
- SMS sender rules
- Raw message ingestion
- Rule-based parsing
- Duplicate detection
- Debt and repayment tracking
- Credit card bill tracking
- Recurring bill tracking
- Balance snapshots and reconciliation
- Transaction audit trail
- Reports for web and mobile

## Suggested Stack

- Python
- Django
- Django REST Framework
- PostgreSQL
- pytest
- django-filter
- drf-spectacular for OpenAPI generation

## Local Setup

The repository pins Python 3.13 in `.python-version`. Django 5.1 does not
support Python 3.14, so hosted Python runtimes must honor this pin.

Create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
python -m pip install -r requirements-dev.txt
```

Create local environment file:

```bash
cp .env.example .env
```

The default `.env.example` is for local development. When `DJANGO_DEBUG=false`,
settings validation requires a strong non-default `DJANGO_SECRET_KEY`,
PostgreSQL `DATABASE_URL`, deployed `DJANGO_ALLOWED_HOSTS`, and deployed CORS
and CSRF origins. Use full origins including the scheme for
`DJANGO_CSRF_TRUSTED_ORIGINS`, for example `https://api.example.com`. Render's
`RENDER_EXTERNAL_URL` is trusted automatically.

To use hosted PostgreSQL from your laptop instead, set `DATABASE_URL` in
`.env` to the provider **external** URL (Render includes
`singapore-postgres.render.com`). Do not commit that file.

Start PostgreSQL from `../finance-infra`:

```bash
docker compose up -d postgres
```

Run migrations:

```bash
python manage.py migrate
```

Start the API:

```bash
python manage.py runserver 0.0.0.0:8000
```

Health check:

```bash
curl http://localhost:8000/api/health/
```

Expected response:

```json
{"status": "ok"}
```

API docs will be available at:

```txt
http://localhost:8000/api/docs/
```

## Docker

From `projects/finance-infra`:

```bash
cp .env.example .env
docker compose up --build -d postgres finance-api
```

The API service runs migrations on startup and then serves on port `8000`.

## Verification

```bash
python manage.py test apps.health apps.users apps.accounts apps.categories apps.payment_methods apps.messages apps.transactions apps.reports apps.reconciliation apps.debts apps.credit_cards apps.recurring_bills apps.audit_logs
```

## Django Apps

```txt
config/
users/
accounts/
categories/
transactions/
payment_methods/
messages/
debts/
credit_cards/
recurring_bills/
reports/
reconciliation/
audit_logs/
```

## Important API Groups

```txt
/api/auth/
/api/accounts/
/api/categories/
/api/payment-methods/
/api/transactions/
/api/messages/
/api/messages/sender-rules/
/api/debts/
/api/credit-card-bills/
/api/recurring-bills/
/api/reports/
/api/reconciliation/
/api/audit-logs/
```

## Implemented Endpoints

```txt
GET    /api/health/
POST   /api/auth/login/
POST   /api/auth/refresh/
POST   /api/auth/logout/
POST   /api/auth/logout-all/
GET    /api/auth/me/

GET    /api/accounts/
POST   /api/accounts/
GET    /api/accounts/{id}/
PATCH  /api/accounts/{id}/
DELETE /api/accounts/{id}/

GET    /api/categories/
POST   /api/categories/
GET    /api/categories/{id}/
PATCH  /api/categories/{id}/
DELETE /api/categories/{id}/

GET    /api/payment-methods/
POST   /api/payment-methods/
GET    /api/payment-methods/{id}/
PATCH  /api/payment-methods/{id}/
DELETE /api/payment-methods/{id}/

GET    /api/messages/sender-rules/
POST   /api/messages/sender-rules/
GET    /api/messages/sender-rules/{id}/
PATCH  /api/messages/sender-rules/{id}/
DELETE /api/messages/sender-rules/{id}/
GET    /api/messages/capture-preferences/
PATCH  /api/messages/capture-preferences/
GET    /api/messages/device-status/
POST   /api/messages/device-status/
POST   /api/messages/import/
POST   /api/messages/dev/reset/  # local DEBUG only
POST   /api/messages/raw/{id}/redact/
GET    /api/messages/review/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/ignore/
POST   /api/messages/review/{id}/reject/

GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/{id}/
PATCH  /api/transactions/{id}/
DELETE /api/transactions/{id}/
GET    /api/transactions/export/?month=YYYY-MM

GET    /api/debts/
POST   /api/debts/
GET    /api/debts/{id}/
PATCH  /api/debts/{id}/
DELETE /api/debts/{id}/
POST   /api/debts/{id}/payments/

GET    /api/credit-card-bills/
POST   /api/credit-card-bills/
GET    /api/credit-card-bills/{id}/
PATCH  /api/credit-card-bills/{id}/
DELETE /api/credit-card-bills/{id}/
POST   /api/credit-card-bills/{id}/payments/

GET    /api/recurring-bills/
POST   /api/recurring-bills/
GET    /api/recurring-bills/{id}/
PATCH  /api/recurring-bills/{id}/
DELETE /api/recurring-bills/{id}/
POST   /api/recurring-bills/{id}/payments/

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/snapshots/{id}/
PATCH  /api/reconciliation/snapshots/{id}/
DELETE /api/reconciliation/snapshots/{id}/
GET    /api/reconciliation/accounts/{account_id}/
GET    /api/audit-logs/
GET    /api/audit-logs/{id}/
GET    /api/schema/
GET    /api/docs/
```

Transaction create, update, and delete actions write user-scoped audit entries
with before/after snapshots of normalized ledger fields. Audit log entries are
read-only through the API and can be filtered by `action`, `entity_type`, and
`entity_id`.

Transaction list and CSV export endpoints share filters for `month`, `account`,
`category`, `type`, `direction`, `source`, and `search`. Source separates web,
mobile, SMS, import, and system-created ledger rows. Search matches normalized
text evidence: reference or TrxID, counterparty text, note, and external
duplicate key.

All finance endpoints except `/api/health/` require authentication.

Use the access token as a Bearer token:

```txt
Authorization: Bearer <access-token>
```

## Parser Design

Use provider-specific parser classes:

```txt
BaseMessageParser
BkashMessageParser (initial transfer-aware implementation)
EblMessageParser (initial card purchase, card payment, fee, and bank-to-wallet transfer implementation)
CityBankMessageParser (initial card purchase, refund, reversal, and own-account transfer implementation)
PathaoPayMessageParser (initial top-up, payment, send-money, and withdraw implementation)
CustomRegexMessageParser
```

Each parser returns a parsed candidate, not a final transaction. The backend
should create transactions only when the user confirms the candidate. Parsed
candidates preserve provider, message kind, reference, fee, balance, and
possible internal-transfer hints so bank-to-wallet movement does not become a
fake expense or income. When two review candidates have the same user, amount,
close timestamps, and different providers, the backend links them as possible
related messages for review instead of auto-merging them. The transfer matching
API additionally handles same-provider messages and already-posted transfers.
Bank transfer parser coverage also matches known payment-method identifiers in
the message text so source and destination account hints can be prefilled for
review when both sides belong to the user.

## Balance Rules

- Store transaction amounts as positive numeric values.
- Use transaction type to determine direction.
- Calculate expected balances from confirmed transactions.
- Store actual real-life balance checks as snapshots.
- Show the difference between expected and actual balances.
- Create adjustment transactions only when the user chooses to reconcile.

## Phase 1 Backend Milestones

1. Health endpoint. Done.
2. Auth. Done.
3. Account CRUD. Done.
4. Category CRUD. Done.
5. Transaction CRUD. Done.
6. Monthly report endpoint. Done.
7. Balance snapshot endpoint.
8. Reconciliation difference endpoint.

## Suggested Transfer Matching

- `POST /api/transactions/transfer-matches/`: manual draft or candidate plus
  corrected fields; returns posted transfers/opposite pending SMS suggestions.
- `POST /api/transactions/link-transfer/`: explicit match acceptance; attaches
  account-specific evidence or confirms both pending messages as one movement.
- `POST /api/transactions/{id}/merge-transfer/`: explicit audited merge of two
  posted matching transfers.

A manual credit transfer uses `account` as receiver and `transfer_account` as
sender. Stored transactions always use source/destination order with debit as
canonical direction. SMS review already uses canonical source/destination.
Account filtering includes both sides and exposes contextual `account_direction`.
`transfer_evidence` retains each account's reference/date/balance and contributes
no additional ledger movement. Matching uses exact principal and compatible
accounts within three days; a real reverse transfer is excluded. Multiple
suggestions require user selection. Keep separate always remains available.

Apply migrations with `python manage.py migrate`; old transfers are backfilled
without automatic merging. Confirmation/link/create/update/delete share a
per-user row lock; SMS/manual observation keys prevent replay. Test this with
`python manage.py test apps.transactions.test_transfers`. PostgreSQL is required
for the concurrency test. Fees remain separate expenses; observed fee metadata
alone does not post a fee. Actual delayed settlement is not modeled by this
change.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.
