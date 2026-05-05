# Local Setup

This document describes the intended local development setup. The actual
projects will be scaffolded in later steps.

## Required Tools

- Git
- Docker or a compatible container runtime
- Python for Django
- Node.js for Next.js and React Native tooling
- Android Studio for Android emulator/device testing
- PostgreSQL client tools, optional but useful

## Planned Local Ports

```txt
PostgreSQL: 5432
Django API: 8000
Next.js web: 3000
React Native Metro: 8081
```

## Planned Environment Files

Each project should keep an `.env.example` file committed and a real `.env`
file ignored.

```txt
finance-api/.env.example
finance-web/.env.example
finance-mobile/.env.example
finance-infra/.env.example
```

## First Local Run Target

The first runnable milestone should support:

```txt
GET http://localhost:8000/api/health/
```

Expected response:

```json
{
  "status": "ok"
}
```

Then:

- Web app displays backend health. Done.
- Mobile app displays backend health.

## Current Backend Setup

Start PostgreSQL:

```bash
cd projects/finance-infra
cp .env.example .env
docker compose up -d postgres
```

Start the Django API:

```bash
cd ../finance-api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

Check:

```bash
curl http://localhost:8000/api/health/
```

OpenAPI docs:

```txt
http://localhost:8000/api/docs/
```

Run backend tests:

```bash
python manage.py test apps.health apps.users apps.accounts apps.categories apps.transactions apps.reports
```

Create a local admin/user for testing:

```bash
python manage.py createsuperuser
```

Log in through the API:

```bash
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'
```

Use the returned access token on protected endpoints:

```bash
curl http://localhost:8000/api/auth/me/ \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Current Web Setup

Start the web app:

```bash
cd projects/finance-web
npm install
cp .env.example .env.local
npm run dev
```

Open:

```txt
http://localhost:3000
```

Sign in:

```txt
http://localhost:3000/login
```

Use a Django user created with:

```bash
cd ../finance-api
python manage.py createsuperuser
```

Manual transaction workflow:

```txt
http://localhost:3000/transactions
```

Accounts and categories:

```txt
http://localhost:3000/accounts
```

Create at least one account before using the transaction form. Categories are
optional but recommended for useful monthly reports.

Monthly reports:

```txt
http://localhost:3000/reports
```

Run web checks:

```bash
npm run typecheck
npm run lint
```
