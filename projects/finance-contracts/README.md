# finance-contracts

Shared API contract and integration documentation.

## Responsibilities

- OpenAPI schema.
- API examples.
- Data shape documentation.
- Generated TypeScript client and schema types.
- Contract changelog.

## Current Files

```txt
openapi.yaml
generated/
  client.ts
  types.ts
scripts/
  generate_ts_client.py
requirements.txt
tsconfig.generated.json
examples/
  account.create.json
  audit-log.detail.response.json
  audit-log.list.response.json
  auth.login.request.json
  auth.login.response.json
  auth.me.response.json
  category.create.json
  credit-card-bill.create.json
  credit-card-bill.payment.create.json
  debt.create.json
  debt.payment.create.json
  payment-method.create.json
  message-review.bulk-reprocess.response.json
  message-review.confirm.json
  message-review.list.response.json
  message-review.redact.response.json
  raw-message.import.json
  raw-message.import.response.json
  reconciliation.account.response.json
  reconciliation.snapshot.create.json
  reconciliation.snapshot.response.json
  recurring-bill.create.json
  recurring-bill.payment.create.json
  sender-rule.create.json
  transaction.create.json
  transaction.export.csv
  transaction.list.response.json
  transaction.transfer.create.json
  validation-error.response.json
  report.monthly.response.json
CHANGELOG.md
```

## Generated TypeScript Client

The generated files in `generated/` are produced from `openapi.yaml`:

```bash
python3 scripts/generate_ts_client.py
```

The generator uses Python and PyYAML. If PyYAML is not already installed:

```bash
python3 -m pip install -r requirements.txt
```

To typecheck the generated client with the web project's TypeScript install:

```bash
../finance-web/node_modules/.bin/tsc -p tsconfig.generated.json
```

`generated/types.ts` exports OpenAPI component schema types. `generated/client.ts`
exports `FinanceApiClient`, a lightweight fetch-based client with typed request
bodies, query objects, path parameters, JSON responses, and CSV `Blob` exports.

## Contract Principles

- Backend owns the canonical schema.
- Web and mobile consume the same API.
- Breaking changes must be versioned or coordinated.
- Transaction amount is stored as a positive value with explicit business type
  and ledger direction (`debit` or `credit`).
- Account responses expose a derived `ledger_balance` plus nullable
  `latest_reported_balance` and `latest_reported_balance_date`. The derived
  value is recalculated from posted activity; the reported value is evidence
  captured from a bank or wallet message and may be older.
- SMS-confirmed transactions should preserve normalized evidence fields such as
  provider reference, local transaction time, balance after, counterparty text,
  payment method, masked sender/receiver account and card identifiers, raw
  message id, and duplicate key. Clients should submit masked identifiers or a
  safe suffix; the API reduces an unmasked value to its last four digits.
- Capture preferences are user-scoped. Excluded providers and message kinds
  preserve only a deduplication tombstone; their original SMS body is not kept
  by the API. Trusted-sender messages containing no digits are also discarded
  through this tombstone path because they cannot supply transaction evidence.
  Confirmed raw-text retention is explicit and defaults to 30 days.
- Mobile clients report device sync health through a user-scoped heartbeat;
  dashboards must use this status rather than infer health from review records.
- Review confirmation can explicitly remember corrected account, payment
  method, category, and transaction type for the sender rule and detected
  message kind. The mapping is applied to similar pending items as well as
  future imports.
- Candidate rejection records a reason and may atomically redact the raw body,
  disable the matched sender rule, or add the provider to capture exclusions.
- Transaction create, update, and delete actions expose read-only audit log
  entries with normalized before/after snapshots.
- Display sign preference belongs to clients.

## Initial Endpoint Sketch

```txt
GET    /api/health/

POST   /api/auth/login/
POST   /api/auth/refresh/   # returns rotated access and refresh tokens
POST   /api/auth/logout/    # revokes one refresh-token session
POST   /api/auth/logout-all/ # revokes every refresh-token session for the user
GET    /api/auth/me/

GET    /api/accounts/
POST   /api/accounts/
PATCH  /api/accounts/{id}/

GET    /api/categories/
POST   /api/categories/
PATCH  /api/categories/{id}/

GET    /api/payment-methods/
POST   /api/payment-methods/
GET    /api/payment-methods/{id}/
PATCH  /api/payment-methods/{id}/
DELETE /api/payment-methods/{id}/

GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/{id}/
PATCH  /api/transactions/{id}/
DELETE /api/transactions/{id}/
GET    /api/transactions/export/?month=YYYY-MM

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
POST   /api/messages/raw/{id}/redact/
GET    /api/messages/review/
POST   /api/messages/review/reprocess/
POST   /api/messages/review/{id}/reprocess/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/reject/
POST   /api/messages/review/{id}/ignore/

GET    /api/debts/
POST   /api/debts/
POST   /api/debts/{id}/payments/

GET    /api/credit-card-bills/
POST   /api/credit-card-bills/
PATCH  /api/credit-card-bills/{id}/
POST   /api/credit-card-bills/{id}/payments/

GET    /api/recurring-bills/
POST   /api/recurring-bills/
PATCH  /api/recurring-bills/{id}/
POST   /api/recurring-bills/{id}/payments/

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reports/categories/?from=YYYY-MM-DD&to=YYYY-MM-DD
GET    /api/reports/accounts/?month=YYYY-MM

GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/accounts/{account_id}/

GET    /api/audit-logs/
GET    /api/audit-logs/{id}/
```
