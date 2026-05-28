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
- Basic monthly report endpoint
- JWT login, refresh, and current-user endpoints

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

## Local Setup

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
python manage.py test apps.health apps.users apps.accounts apps.categories apps.transactions apps.reports
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

## Implemented Endpoints

```txt
GET    /api/health/
POST   /api/auth/login/
POST   /api/auth/refresh/
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

GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/{id}/
PATCH  /api/transactions/{id}/
DELETE /api/transactions/{id}/

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/schema/
GET    /api/docs/
```

All finance endpoints except `/api/health/` require authentication.

Use the access token as a Bearer token:

```txt
Authorization: Bearer <access-token>
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

1. Health endpoint. Done.
2. Auth. Done.
3. Account CRUD. Done.
4. Category CRUD. Done.
5. Transaction CRUD. Done.
6. Monthly report endpoint. Done.
7. Balance snapshot endpoint.
8. Reconciliation difference endpoint.
