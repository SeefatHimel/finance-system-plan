# finance-contracts

Shared API contract and integration documentation.

## Responsibilities

- OpenAPI schema.
- API examples.
- Data shape documentation.
- Generated clients later.
- Contract changelog.

## Files To Add Later

```txt
openapi.yaml
examples/
  transaction.create.json
  message.import.json
  report.monthly.json
CHANGELOG.md
```

## Contract Principles

- Backend owns the canonical schema.
- Web and mobile consume the same API.
- Breaking changes must be versioned or coordinated.
- Transaction amount is stored as a positive value with an explicit type.
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
PATCH  /api/payment-methods/{id}/

GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/{id}/
PATCH  /api/transactions/{id}/
DELETE /api/transactions/{id}/

GET    /api/messages/sender-rules/
POST   /api/messages/sender-rules/
PATCH  /api/messages/sender-rules/{id}/

POST   /api/messages/import/
GET    /api/messages/review/
POST   /api/messages/{id}/confirm/
POST   /api/messages/{id}/ignore/

GET    /api/debts/
POST   /api/debts/
POST   /api/debts/{id}/payments/

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reports/categories/?from=YYYY-MM-DD&to=YYYY-MM-DD
GET    /api/reports/accounts/?month=YYYY-MM

POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/differences/
```
