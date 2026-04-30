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

- Web app displays backend health.
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
python manage.py test apps.health apps.accounts apps.categories apps.transactions apps.reports
```
