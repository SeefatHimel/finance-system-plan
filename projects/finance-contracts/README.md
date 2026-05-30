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
  category.create.json
  credit-card-bill.create.json
  credit-card-bill.payment.create.json
  debt.create.json
  debt.payment.create.json
  payment-method.create.json
  message-review.confirm.json
  message-review.list.response.json
  message-review.redact.response.json
  raw-message.import.json
  raw-message.import.response.json
  sender-rule.create.json
  transaction.create.json
  transaction.list.response.json
  report.monthly.response.json
  reconciliation.snapshot.create.json
  reconciliation.snapshot.response.json
  recurring-bill.create.json
  recurring-bill.payment.create.json
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
- SMS-confirmed transactions should preserve normalized evidence fields such as
  provider reference, balance after, counterparty text, payment method, raw
  message id, and duplicate key.
- Display sign preference belongs to clients.

## Initial Endpoint Sketch

```txt
GET    /api/health/

POST   /api/auth/login/
POST   /api/auth/refresh/
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

POST   /api/messages/import/
POST   /api/messages/raw/{id}/redact/
GET    /api/messages/review/
POST   /api/messages/review/{id}/confirm/
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
```
