# Infrastructure Q&A

## What is the infrastructure project responsible for?

The infrastructure project owns local services, Docker Compose, database setup,
environment templates, deployment notes, and local backup/restore scripts.

## Why start with Docker Compose?

Docker Compose makes local setup repeatable and now supports the full runtime
stack: PostgreSQL, Django API, Next.js web, and an optional mobile container.

## Why run app servers natively instead of in Docker at first?

Running Django, Next.js, and mobile tooling natively can still give faster
iteration in some workflows, especially for React Native device/emulator loops.
Docker support now exists for all runtime projects, but native mode remains a
valid option when preferred.

## What services are planned locally?

Current and planned local services:

```txt
PostgreSQL: 5432
Django API: 8000
Next.js web: 3000
React Native Metro: 8081
```

## What is implemented now?

`finance-infra` now includes:

- Docker Compose services for `postgres`, `finance-api`, and `finance-web`
- Optional `finance-mobile` service under the `mobile` profile
- Shared `.env.example` values for stack ports and runtime URLs
- Local PostgreSQL backup and restore scripts under
  `projects/finance-infra/scripts/`

## Why not decide production hosting now?

The product workflows are still evolving. It is better to build the local
system first, then choose deployment based on real needs: VPS, managed
PostgreSQL, app hosting, or separate services.

## How would you deploy this later?

A practical first deployment could use a VPS with Docker Compose or a managed
PostgreSQL database plus hosted backend/frontend services. The mobile app would
point to the deployed API. The current deployment runbook is documented in
`docs/production-deployment-plan.md`.

## What needs to be added before production?

Production needs HTTPS, secure secret management, database backups, monitoring,
logging, deployment automation, CORS hardening, allowed hosts, and a proper
static/media file strategy. The deployment plan now lists concrete gates for
debug mode, allowed hosts, CORS origins, PostgreSQL, auth storage, backups,
restore drills, and rollback. The Django settings module now refuses
`DJANGO_DEBUG=false` when the backend still has local-dev secrets, SQLite,
localhost-only hosts, or localhost CORS origins.

## How should backups work?

Backups should include PostgreSQL dumps, uploaded files if attachments are
added, and a tested restore procedure. A backup is only useful if restore has
been verified.

Current implementation status: the infra project includes local Compose-based
PostgreSQL dump and guarded restore scripts. The restore helper requires
`CONFIRM_RESTORE=finance` so accidental restores are harder to trigger. The
backup output directory is ignored by git because dumps can contain financial
data. Production still needs encrypted off-machine storage, retention policy,
monitoring, and a scheduled restore drill.

## How do you protect secrets?

Secrets belong in environment variables or secret managers, never in git. The
repo commits `.env.example` files but ignores real `.env` files.
