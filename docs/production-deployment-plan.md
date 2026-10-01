# Production Deployment Plan

Last updated: 2026-05-31

## Goal

Prepare a conservative first production deployment path for the finance system
without committing to a hosting provider too early.

The recommended first target is either:

- VPS with Docker Compose for API, web, and PostgreSQL.
- Managed PostgreSQL plus separately hosted API and web services.

The mobile app should point to the deployed HTTPS API URL after backend and web
deployment are stable.

## Required Gates Before Real Financial Use

- `DJANGO_DEBUG=false`.
- The backend runtime uses the repository's Python 3.13 pin; Django 5.1 is not
  compatible with Python 3.14.
- Strong `DJANGO_SECRET_KEY` stored outside git.
- `DATABASE_URL` points to PostgreSQL, not SQLite.
- `DJANGO_ALLOWED_HOSTS` is limited to deployed API hostnames.
- `DJANGO_CORS_ALLOWED_ORIGINS` is limited to deployed web origins.
- `DJANGO_CSRF_TRUSTED_ORIGINS` contains the deployed HTTPS API/admin origins.
- HTTPS is enforced at the proxy, load balancer, or hosting platform.
- Web production auth no longer stores refresh tokens in browser
  `localStorage`.
- The temporary web `localStorage` auth path is development-only and cannot be
  enabled by a production environment variable.
- Web login/session/logout and authenticated workspace API calls can use
  same-origin Next.js routes with HTTP-only cookies.
- Mobile refresh tokens use OS-backed secure storage.
- Backend JWT refresh-token rotation and blacklist-after-rotation are enabled.
- PostgreSQL backups run on a schedule and at least one restore drill has
  passed.
- Raw SMS export/support flows do not expose real message bodies unnecessarily.
- Monitoring/logging exists for API errors, failed background jobs, and backup
  failures.

The Django settings module enforces the backend configuration gates for
`DJANGO_SECRET_KEY`, PostgreSQL, allowed hosts, and CORS when
`DJANGO_DEBUG=false`.

## Environment Checklist

Backend:

```txt
DJANGO_SECRET_KEY=<secret manager value>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=api.example.com
DJANGO_CORS_ALLOWED_ORIGINS=https://app.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://api.example.com
DATABASE_URL=postgres://...
```

On Render, Django also adds the platform-provided `RENDER_EXTERNAL_URL` to the
trusted CSRF origins automatically. Add custom domains explicitly through
`DJANGO_CSRF_TRUSTED_ORIGINS`. The settings trust Render's
`X-Forwarded-Proto` header so Django recognizes proxied HTTPS requests, and
production session and CSRF cookies are marked secure.

Web:

```txt
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
NEXT_SERVER_API_BASE_URL=https://api.example.com
```

Mobile:

```txt
EXPO_PUBLIC_API_BASE_URL=https://api.example.com
```

Do not commit real values. Keep only examples in git.

## Deployment Steps

1. Provision PostgreSQL and create a non-superuser database role for the app.
2. Configure backend environment variables and run migrations.
3. Deploy the Django API behind HTTPS.
4. Verify `GET /api/health/` over HTTPS.
5. Configure and deploy the Next.js web app.
6. Verify web login, transaction list, SMS review, reconciliation, CSV export,
   and audit log pages against the deployed API.
7. Configure mobile builds with the deployed API URL.
8. Run a small end-to-end financial workflow with test data only.
9. Create a database backup.
10. Restore that backup into a separate test database and verify the app can
    read the restored records.

## Backup And Restore

The local Compose scripts in `projects/finance-infra/scripts/` are a first
backup path, not a full production backup system. See
`docs/backup-automation.md` for the current schedule, manifest, retention, and
restore-drill guidance.

The current repository support includes:

- Custom-format PostgreSQL dumps through Docker Compose.
- Sidecar backup manifests with timestamp, byte count, and checksum.
- Guarded restore command requiring `CONFIRM_RESTORE=finance`.
- Dry-run-first retention pruning requiring `CONFIRM_PRUNE=finance` before
  deletion.

Production backup work must still add:

- Encrypted off-machine backup storage.
- Backup and upload failure alerts.
- Restore drills against a separate database.
- Attachment/media backup if uploads are added.
- Documentation for who can access backups and how recovery is approved.

## Rollback Plan

- Keep the previous deployed API and web image/build available.
- For schema migrations, review whether each migration is reversible before
  deploy.
- Take a database backup before risky migrations.
- If deploy fails before migration, roll back app build only.
- If deploy fails after migration, decide whether to roll forward with a hotfix
  or restore from backup into a new database.

## Current Blockers

- Docker CLI is not available in the current verification environment, so
  Compose validation and stack smoke tests must run on a machine with Docker.
- Real anonymized SMS fixtures are still needed before trusting parser coverage
  for live provider messages.
- Production auth hardening is planned but not implemented in web/mobile yet.
