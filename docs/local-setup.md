# Local Setup

This document describes the local development setup for the scaffolded API,
web, mobile, infra, and contracts projects.

Execution tracker: see `docs/next-steps-checklist.md` for current done/pending status.

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
- Mobile app displays backend health. Done with initial scaffold.

## Docker Setup (All Runtime Projects)

Run from infrastructure directory:

```bash
cd projects/finance-infra
cp .env.example .env
docker compose up --build -d postgres finance-api finance-web
```

Open:

```txt
API: http://localhost:8000/api/health/
Web: http://localhost:3000
```

Optional mobile container:

```bash
docker compose --profile mobile up --build finance-mobile
```

Stop:

```bash
docker compose down
```

Remove database data intentionally:

```bash
docker compose down -v
```

## Local PostgreSQL Backup And Restore

From `projects/finance-infra`, create a custom-format PostgreSQL dump from the
Compose database service:

```bash
./scripts/backup-postgres.sh
```

Backups are written to `projects/finance-infra/backups/` by default and are
ignored by git because they can contain financial data. Each backup also gets a
sidecar `.manifest` file with timestamp, byte count, and checksum.

Dry-run old-backup pruning before deleting anything:

```bash
RETENTION_DAYS=30 ./scripts/prune-backups.sh
```

Delete old dumps only after confirming:

```bash
RETENTION_DAYS=30 CONFIRM_PRUNE=finance ./scripts/prune-backups.sh
```

Restore requires an explicit confirmation environment variable:

```bash
CONFIRM_RESTORE=finance ./scripts/restore-postgres.sh backups/finance-YYYYMMDDTHHMMSSZ.dump
```

Use restore only against a local/dev database unless the target environment has
a separate production runbook. See `docs/backup-automation.md` for the
production-oriented schedule and restore-drill checklist.

## Current Backend Setup (Native)

Start PostgreSQL:

```bash
cd projects/finance-infra
cp .env.example .env
docker compose up -d postgres
```

To run the API against a hosted database (for example Render) from your laptop,
put the **external** `DATABASE_URL` in `projects/finance-api/.env`. Non-local
hosts use SSL (`sslmode=require`) automatically. Keep using `DJANGO_DEBUG=true`
for this laptop path. Do not commit `.env`.

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
python manage.py test apps.health apps.users apps.accounts apps.categories apps.payment_methods apps.messages apps.transactions apps.reports apps.reconciliation apps.debts apps.credit_cards apps.recurring_bills apps.audit_logs
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

## Current Web Setup (Native)

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
http://localhost:3000/audit-logs
```

Accounts and categories:

```txt
http://localhost:3000/accounts
```

Create at least one account before using the transaction form. Categories are
optional but recommended for useful monthly reports.

Payment methods and SMS sender rules:

```txt
http://localhost:3000/sms-settings
```

SMS review inbox:

```txt
http://localhost:3000/messages/review
```

Monthly reports:

```txt
http://localhost:3000/reports
```

Run web checks:

```bash
npm run typecheck
npm run lint
npm run test:auth
```

## Current Mobile Setup (Native)

Start the mobile app:

```bash
cd ../finance-mobile
cp .env.example .env
npm install
npm run start
```

From the Expo terminal, press `a` to launch Android emulator.

The app starts with a health-check screen and calls:

```txt
GET /api/health/
```

It also includes a login test flow:

```txt
POST /api/auth/login/
GET /api/auth/me/
GET /api/accounts/
GET /api/categories/
POST /api/transactions/
GET /api/transactions/
GET /api/transactions/export/?month=YYYY-MM
GET /api/audit-logs/
GET /api/payment-methods/
GET /api/messages/sender-rules/
POST /api/messages/import/
GET /api/messages/review/
POST /api/messages/review/{id}/reprocess/
POST /api/messages/review/{id}/confirm/
POST /api/messages/review/{id}/ignore/
```

The SMS tracking section can queue raw messages locally on the device and sync
them to `POST /api/messages/import/` when an access token is available. Failed
sync attempts stay queued with attempt count, last attempt time, and the latest
error message. The local queue also blocks obvious duplicate entries and lets
you remove invalid queued messages before retrying.

Use a Django user created from the backend project:

```bash
cd ../finance-api
python manage.py createsuperuser
```

Environment variable:

```txt
EXPO_PUBLIC_API_BASE_URL
```

Default value for Android emulator:

```txt
http://10.0.2.2:8000
```

For physical Android devices, set this value to your machine LAN IP.

## Transfer Evidence Migration

After pulling transfer matching changes, apply the API migrations before using
the updated clients:

```bash
cd projects/finance-api
source .venv/bin/activate
python manage.py migrate
python manage.py test apps.transactions.test_transfers
```

Migrations add account-specific transfer evidence and backfill existing transfer
rows without changing their balance effects or automatically merging them.
The concurrency test runs on PostgreSQL and is skipped on SQLite because SQLite
does not implement the row locks used by transfer confirmation/linking.
