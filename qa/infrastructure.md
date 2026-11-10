# Infrastructure Q&A

### What must be preserved to recover encrypted original sources?

Back up the database together with the active `DJANGO_SECRET_KEY`. The API
encrypts imported PDF bytes, transaction SMS bodies, and full user-entered
account/card identifiers before database persistence. On key rotation, keep the
old key in `DJANGO_SECRET_KEY_FALLBACKS` until those records are re-encrypted.
Deploy the code and run all migrations before using the original-source
endpoints; a database restore without the matching key cannot decrypt them.

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
- Backup manifests, retention pruning, and a backup automation runbook in
  `docs/backup-automation.md`
- A GitHub Actions workflow for API, web, mobile, contract generation, and
  migration/schema checks on pull requests and pushes to `main`

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
localhost-only hosts, localhost CORS origins, or missing/non-HTTPS CSRF trusted
origins. It also recognizes HTTPS behind Render's proxy and marks production
session and CSRF cookies secure.

## Why is Python pinned to 3.13?

The backend uses Django 5.2 LTS and keeps Python 3.13 as the tested deployment
target. The repository-level `.python-version` prevents hosting defaults from
silently selecting another major runtime. Dependency constraints lock the tested
Python package set and should be regenerated deliberately with verification.

## What does CI check before a change reaches main?

Pull requests and main-branch pushes run the API test suite, migration drift
check and OpenAPI generation with zero errors. They also typecheck, lint, test
and build the web app, regenerate and typecheck the shared contract, and run
mobile typechecks and unit tests. This catches integration drift before a
deployment; it does not replace staging smoke tests or backup restore drills.
The API CI job installs `requirements-dev.txt` because the synthetic PDF tests
generate fixtures with ReportLab, which is intentionally a test-only dependency.

## How should backups work?

Backups should include PostgreSQL dumps, uploaded files if attachments are
added, and a tested restore procedure. A backup is only useful if restore has
been verified.

Current implementation status: the infra project includes local Compose-based
PostgreSQL dump and guarded restore scripts. The restore helper requires
`CONFIRM_RESTORE=finance` so accidental restores are harder to trigger. The
backup helper writes a sidecar manifest with timestamp, byte count, and
checksum, and the retention helper dry-runs by default before old dump files
can be pruned with `CONFIRM_PRUNE=finance`. The backup output directory is
ignored by git because dumps can contain financial data.

Production still needs encrypted off-machine storage, upload/failure alerts,
access approval rules, media backup if uploads are added, and scheduled restore
drills against a separate database.

## How do you protect secrets?

Secrets belong in environment variables or secret managers, never in git. The
repo commits `.env.example` files but ignores real `.env` files.

## How does Android background SMS sync run safely?

The native receiver queues only messages matching locally enabled active rules.
WorkManager runs a network-constrained upload job, retries transient failures,
and can rotate an expired access token. Tokens and SMS payloads are encrypted
with an Android Keystore key, Android application backup is disabled, and an
explicit logout revokes the refresh token and clears the native session and
local SMS state. Public Play Store distribution still requires a separate
SMS-permission policy review.

## Does the browser health heartbeat guarantee backend uptime?

No. An open online web app checks the configured backend through an uncached
same-origin health proxy every ten minutes, with bounded timeouts and no auth.
This can keep an active session warm. Browser suspension, closure or offline
state prevents reliable scheduling; production availability requires hosting
that meets the desired uptime rather than relying on client activity.

## What deployment steps does Quick Add need?

Deploy the API with `quick_add.0001_initial` applied before either client starts
using presets or posting entries. Its receipt concurrency test requires
PostgreSQL; SQLite skips row-lock tests. Web has no new runtime dependency. Mobile
adds the Expo SDK-compatible native datetime picker and config plugin, so the
next requested signed build must include that module. Source checks and Expo
config validation do not build or publish an APK.
# Production runtime and CI

**Is development Compose suitable for production?** No. The separate
`docker-compose.prod.yml` and production Dockerfiles run Gunicorn and `next
start`, require explicit secrets and HTTPS origins, keep PostgreSQL internal,
and bind API/web ports to loopback for a TLS proxy. Migrations are a deliberate
release command, not an application boot side effect. CI's API job uses a real
PostgreSQL service so concurrency tests run instead of being skipped on SQLite.

The unified transfer-balance fix adds
`transactions.0008_transferevidence_effective_balance`. Run migrations before
deploying the API; it adds a selection flag and per-account uniqueness constraint
without changing existing observations.

**How is the temporary Citytouch recovery run safely?** Migrate the API through
`statements.0007`, then run `refresh_citytouch_codes` from its documented
environment with `ALLOW_STATEMENT_CODE_REFRESH=1` on that command only. Dry-run
first and pass its digest to `--apply`. The flag is unset afterward, so the
maintenance command is disabled by default. Keep the PDF unlock password in a
temporary environment variable if needed, not in shell arguments or Git.

## Which new settings and health checks are required by the review fixes?

Apply `users.0001_initial` before API traffic and use the same private random
32+ character `FINANCE_PROXY_AUTH_SECRET` on API/web. Outside Vercel, configure a
trusted ingress-overwritten client-IP header and block direct web-origin bypass.
Production sign-in fails closed if identity is unconfigured. Readiness checks DB
connectivity and pending migrations at `/api/health/ready/`; liveness stays at
`/api/health/`. DATABASE_URL TLS/timeout options are preserved rather than discarded.
Python constraints pin the tested dependency set; native build/tests and high-risk
npm audits run in CI. See the remediation document for remaining low Expo warnings.

## What can the backup restore test prove?

Backup safety tests cover failed dumps, private files, overwrite refusal, tamper
rejection and atomic restore flags. A native-PG drill restores into a new
synthetic-only database and compares all public-table counts/fingerprints. Local
verification included encrypted SMS/PDF bytes across 46 tables. This proves
preservation under that environment, not production key availability or RPO/RTO.
Dumps still require encrypted off-machine storage, access control, failure alerts
and periodic application/decryption recovery exercises.

## How can operations diagnose errors without logging financial input?

Each API response has a generated request ID and app duration, forwarded by the
web proxy. The dedicated production logger records resolver route patterns,
method, status and duration only; it excludes raw paths, query/body values,
headers, user/account IDs and IPs. Hosting must configure alert delivery and log
retention. Readiness, latency and backup alerts are operational gates, not
services automatically configured by the source-code change.

## Why did a hosted DATABASE_URL fail before migrations ran?

The former fixed query-option allowlist rejected valid libpq options such as
Neon's `channel_binding=require`, raising `ImproperlyConfigured` while importing
settings. No database connection or migration had started at that point. Option
names now use the installed psycopg/libpq parser; supported values are preserved,
while duplicate keys and invalid SSL/channel-binding modes or timeout ranges
remain explicit errors. URI identity cannot be overridden through query options,
so transaction-pooler detection uses the actual configured host. Driver exceptions
are suppressed rather than echoed with potentially private connection values.
The regression tests parse synthetic direct/pooled URLs without connecting, test
encoded credentials and quoted option values, and verify redacted failures. Keep
the provider's TLS requirements and redeploy the fixed API; no new migration is
needed for this compatibility correction.
