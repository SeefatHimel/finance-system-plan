# finance-infra

Infrastructure, local development, and deployment support.

## Responsibilities

- Local Docker Compose.
- PostgreSQL container.
- Environment templates.
- Backend/web/mobile local setup docs.
- Deployment documentation later.
- Backup and restore scripts later.

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

## Backup Requirements

Future backup scripts should cover:

- PostgreSQL dump.
- Uploaded attachments, if added.
- OpenAPI contract version.
- Restore procedure verification.
