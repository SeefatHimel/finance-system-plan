# finance-api

Django backend and source of truth for the finance system.

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
- Balance snapshots and reconciliation
- Reports for web and mobile

## Suggested Stack

- Python
- Django
- Django REST Framework
- PostgreSQL
- pytest
- django-filter
- drf-spectacular for OpenAPI generation

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
reports/
reconciliation/
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
/api/reports/
/api/reconciliation/
```

## Parser Design

Use provider-specific parser classes:

```txt
BaseMessageParser
BkashMessageParser
CityBankMessageParser
NagadMessageParser
RocketMessageParser
CustomRegexMessageParser
```

Each parser returns a parsed candidate, not a final transaction. The backend
should create transactions only when confidence is high enough or the user
confirms the candidate.

## Balance Rules

- Store transaction amounts as positive numeric values.
- Use transaction type to determine direction.
- Calculate expected balances from confirmed transactions.
- Store actual real-life balance checks as snapshots.
- Show the difference between expected and actual balances.
- Create adjustment transactions only when the user chooses to reconcile.

## Phase 1 Backend Milestones

1. Health endpoint.
2. Auth.
3. Account CRUD.
4. Category CRUD.
5. Transaction CRUD.
6. Monthly report endpoint.
7. Balance snapshot endpoint.
8. Reconciliation difference endpoint.

