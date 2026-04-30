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
```

For early development, run PostgreSQL in Docker and run API/web/mobile dev
servers natively. This keeps feedback fast.

## Suggested Local Environment

```txt
POSTGRES_DB=finance
POSTGRES_USER=finance
POSTGRES_PASSWORD=finance
DATABASE_URL=postgres://finance:finance@localhost:5432/finance
DJANGO_SECRET_KEY=local-dev-secret
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
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

