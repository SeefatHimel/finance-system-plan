# Infrastructure Q&A

## What is the infrastructure project responsible for?

The infrastructure project owns local services, Docker Compose, database setup,
environment templates, deployment notes, and future backup/restore scripts.

## Why start with Docker Compose?

Docker Compose makes local PostgreSQL setup repeatable. It avoids manual
database installation differences between machines.

## Why run app servers natively instead of in Docker at first?

Running Django, Next.js, and mobile tooling natively usually gives faster
feedback during early development. PostgreSQL is the main service that benefits
immediately from Docker.

## What services are planned locally?

Current and planned local services:

```txt
PostgreSQL: 5432
Django API: 8000
Next.js web: 3000
React Native Metro: 8081
```

## What is implemented now?

`finance-infra` includes a Docker Compose file for PostgreSQL and an environment
example for local database credentials.

## Why not decide production hosting now?

The product workflows are still evolving. It is better to build the local
system first, then choose deployment based on real needs: VPS, managed
PostgreSQL, app hosting, or separate services.

## How would you deploy this later?

A practical first deployment could use a VPS with Docker Compose or a managed
PostgreSQL database plus hosted backend/frontend services. The mobile app would
point to the deployed API.

## What needs to be added before production?

Production needs HTTPS, secure secret management, database backups, monitoring,
logging, deployment automation, CORS hardening, allowed hosts, and a proper
static/media file strategy.

## How should backups work?

Backups should include PostgreSQL dumps, uploaded files if attachments are
added, and a tested restore procedure. A backup is only useful if restore has
been verified.

## How do you protect secrets?

Secrets belong in environment variables or secret managers, never in git. The
repo commits `.env.example` files but ignores real `.env` files.

