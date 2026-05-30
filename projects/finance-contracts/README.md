# finance-contracts

Shared API contract and integration documentation.

## Responsibilities

- OpenAPI schema.
- API examples.
- Data shape documentation.
- Generated clients later.
- Contract changelog.

## Current Files

```txt
openapi.yaml
examples/
  account.create.json
  category.create.json
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
CHANGELOG.md
```

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

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reports/categories/?from=YYYY-MM-DD&to=YYYY-MM-DD
GET    /api/reports/accounts/?month=YYYY-MM

GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/accounts/{account_id}/
```
