# finance-infra

Infrastructure, local development, and deployment support.

## Responsibilities

- Local Docker Compose.
- PostgreSQL container.
- Environment templates.
- Backend/web/mobile local setup docs.
- Production deployment planning.
- Local PostgreSQL backup, restore, manifest, and retention scripts.

## Local Development Services

```txt
postgres
finance-api
finance-web
finance-mobile (optional profile)
```

You can now run all runtime projects through Docker Compose from this directory.
Mobile is optional and provided through a dedicated Compose profile.

## Start Core Stack (Postgres + API + Web)

From this directory:

```bash
cp .env.example .env
docker compose up --build -d postgres finance-api finance-web
```

Or equivalently:

```bash
docker compose up --build -d
```

Health checks:

```bash
curl http://localhost:8000/api/health/
open http://localhost:3000
```

## Start Mobile Container (Optional)

The mobile service is profile-gated because Expo workflows are often easier
directly on the host machine.

```bash
docker compose --profile mobile up --build finance-mobile
```

Default exposed ports:

```txt
Metro: 8081
Expo: 19000
Expo DevTools: 19001
```

Stop it with:

```bash
docker compose down
```

Remove the local database volume only when you intentionally want to delete
local data:

```bash
docker compose down -v
```

## Suggested Local Environment

```txt
POSTGRES_DB=finance
POSTGRES_USER=finance
POSTGRES_PASSWORD=finance
DATABASE_URL=postgres://finance:finance@localhost:5432/finance
DJANGO_SECRET_KEY=local-dev-secret
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_SERVER_API_BASE_URL=http://finance-api:8000
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Deployment Later

Options:

- VPS with Docker Compose.
- Managed PostgreSQL plus app hosting.
- Separate backend and frontend hosting.

Do not decide final deployment until phase 1 and phase 2 prove the workflows.
See `../../docs/production-deployment-plan.md` for the current production
readiness checklist, environment gates, backup requirements, and rollback plan.
See `../../docs/backup-automation.md` for the backup automation path.

## Backup Requirements

Local PostgreSQL backup and restore helpers are available in `scripts/`.

Create a local custom-format dump from the Compose `postgres` service:

```bash
./scripts/backup-postgres.sh
```

By default, dumps and sidecar manifest files are written to
`projects/finance-infra/backups/`, which is ignored by git because backups can
contain financial data. Override the output location when needed:

```bash
OUTPUT_FILE=/secure/path/finance.dump ./scripts/backup-postgres.sh
```

The backup helper refuses outputs smaller than `MIN_BACKUP_BYTES` and writes a
manifest next to the dump with timestamp, byte count, and checksum.

Prune old local dumps with a dry run first:

```bash
RETENTION_DAYS=30 ./scripts/prune-backups.sh
```

Delete matching old dumps only after confirming:

```bash
RETENTION_DAYS=30 CONFIRM_PRUNE=finance ./scripts/prune-backups.sh
```

Restore is intentionally guarded because it can overwrite local database
objects:

```bash
CONFIRM_RESTORE=finance ./scripts/restore-postgres.sh backups/finance-YYYYMMDDTHHMMSSZ.dump
```

The first backup scope covers PostgreSQL only. Production backup work should
also cover uploaded attachments if added, encrypted off-machine storage,
monitoring, and regular restore verification.
