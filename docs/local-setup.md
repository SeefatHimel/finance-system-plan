# Local Setup

## Original-source storage update

After pulling this change, install the updated API requirements and run
`python manage.py migrate` in `projects/finance-api` before starting the API.
Migrations add encrypted PDF and account/card identifier storage and set existing
SMS capture retention preferences to **Keep**. Existing redacted SMS bodies and
previously truncated identifiers cannot be reconstructed from the database.

Keep `DJANGO_SECRET_KEY` stable for encrypted-source recovery. If rotating it,
set `DJANGO_SECRET_KEY_FALLBACKS` to the previous key while old archives exist;
the fallback setting is a comma-separated list and must stay private.

This document describes the local development setup for the scaffolded API,
web, mobile, infra, and contracts projects.

Execution tracker: see `docs/next-steps-checklist.md` for current done/pending status.

## Project checks

The same baseline runs in `.github/workflows/checks.yml` for pull requests and
pushes to `main`. From the repository root, after installing each project's
documented dependencies, run:

```bash
(cd projects/finance-api && python manage.py test && python manage.py makemigrations --check --dry-run && python manage.py spectacular --validate --file /tmp/finance-schema.yaml)
(cd projects/finance-contracts && python scripts/check_backend_schema.py /tmp/finance-schema.yaml)
(cd projects/finance-web && npm run typecheck && npm run lint && node --test tests/*.test.cjs && npm run build)
(cd projects/finance-contracts && python scripts/generate_ts_client.py && git diff --exit-code -- generated/types.ts generated/client.ts && ../finance-web/node_modules/.bin/tsc -p tsconfig.generated.json)
(cd projects/finance-mobile && npm run typecheck && node --test tests/*.test.cjs)
```

Schema generation may report known warnings; it must finish without errors and
produce a nonempty file. CI runs the API tests with PostgreSQL so database
locking/concurrency tests execute; local SQLite skips those tests. When an API
shape intentionally changes, inspect its generated schema, update the published
contract, regenerate TypeScript types, then update the structural snapshot with
`python projects/finance-contracts/scripts/check_backend_schema.py /tmp/finance-schema.yaml --update`.
Use only synthetic data for these checks. Database
dumps (`*.dump`) are ignored by Git; store backups outside the repository.

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

This section uses the development Compose file. For production images,
Gunicorn/Next start commands, required HTTPS proxy settings and the explicit
migration step, see `docs/production-deployment-plan.md`. Do not use the
development Compose defaults for financial data.

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
npm run test:workflows
npm run test:review-feedback
npm run test:dates
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

Run mobile checks from `projects/finance-mobile`:

```bash
npm run typecheck
npm run test:gestures
```

The gesture suite checks that dragging over capture-policy choices does not
activate them. Check the wrapped layout and scrolling on a physical phone too.

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

## Transfer Counterparty Suggestion Migration

After pulling the transfer-suggestion changes, migrate the API before starting
the updated clients:

```bash
cd projects/finance-api
source .venv/bin/activate
python manage.py migrate
python manage.py test apps.messages.test_transfer_suggestions apps.messages.tests apps.transactions.test_transfers
```

`finance_messages.0011_transfer_counterparty_suggestions` adds scoped remembered
paths and candidate suggestion metadata. It does not modify existing financial
transactions or infer remembered rules from broad mappings. Use Re-run parser
or Reapply rules to pending in SMS review for old review entries.

## Promotional Message Policy Migration

After pulling, run `python manage.py migrate` from `projects/finance-api` before
starting updated clients. Migration `0012_alter_parsedmessagecandidate_message_kind`
enables promotional exclusion on existing capture preferences while preserving
other choices. Use Reapply rules to pending in SMS review to remove older offers.
Promotional can be allowed again in SMS settings. Run
`python manage.py test apps.messages.test_promotional_skips apps.messages.tests`
for classification, learned policy, transaction protection and reprocessing checks.

## Statement PDF Import Setup

After pulling the statement-import changes, update the API virtual environment:

```bash
cd projects/finance-api
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python manage.py migrate
python manage.py test apps.statements apps.transactions
```

Production installs use `requirements.txt`, which includes `pdfplumber`.
`reportlab` is a development dependency for generating synthetic test PDFs.
Migration `statements.0001_initial` adds saved imports and row evidence. Restart
the API and web app, then open Statements to upload, review and approve a supported
digital PDF. Run concurrency tests against PostgreSQL, not SQLite.
The preview endpoint uses a separate Python process from the same virtual
environment; the deployment must permit starting that process. It creates no
ledger entries on upload; masked rows and drafts are saved for review.

Statement review assistance requires the latest API migrations, including
`statements.0003_reapply_pending_merchants`. Run `python manage.py migrate` from
`projects/finance-api` before restarting API/web. The remembered-choice table stores
scoped classifications. Migration 0003 cleans untouched Counterparty drafts on
pending statement rows; it preserves saved corrections, original extraction,
notes, resolved rows, and ledger entries. Since `statements.0006`, the original
PDF is stored encrypted; its unlock password is never saved.

For original-source retention, deploy API code and run `python manage.py migrate`
before using the new endpoints. This applies `statements.0006` (encrypted PDF
archive), `payment_methods.0004` (encrypted full account/card entries), and
`finance_messages.0013`–`0014` (Keep preference, encrypted existing SMS bodies,
and redaction provenance). Keep the existing `DJANGO_SECRET_KEY` available with
database backups. During rotation, put the previous key in
`DJANGO_SECRET_KEY_FALLBACKS` until all old archives have been re-encrypted.
Previously discarded PDF bytes and account/card digits cannot be reconstructed
from masked rows; re-upload the same PDF or re-enter the complete identifier.
For an archived City Bank statement whose code was shortened by an older
parser, deploy and migrate the API, then use the dry-run/apply
`refresh_citytouch_codes` commands in `projects/finance-api/README.md` for that
import. The command is disabled by default, never replaces rows, and cannot
recover digits the PDF itself hides. Re-uploading the same PDF only archives it;
it does not redo extraction.
For redacted transaction SMS still on the phone, use a history scan and the
explicit restore option when the earlier redaction was manual or its cause is
unknown.

The payment-method identity metadata update adds one migration. Run the existing
API `python manage.py migrate` command before testing identifiers and aliases.
Existing methods default to an unspecified identifier kind; no historical ledger
fields or money values are backfilled. Configure optional mappings in SMS settings
→ Payment methods, then test Numbers / Labels / Both on Transactions.

### Account recognition migration and checks

After pulling account recognition support, run `python manage.py migrate` from
`projects/finance-api` with the normal virtual environment activated. Migration
`accounts.0002_account_identity_method` adds a nullable link to the shared
payment-method registry; it does not copy identifiers or alter financial records.
Start the updated API before using Accounts recognition fields or PDF account
suggestions in the web app.

For isolated checks, from `projects/finance-api` run:

```sh
DATABASE_URL= .venv/bin/python manage.py test apps.accounts apps.payment_methods apps.statements apps.messages --noinput
```

From `projects/finance-web` run `npm run test:identities`, `npm run typecheck`,
`npm run lint`, and `npm run build`. PDF account recognition is authenticated,
read-only and has a separate 10/hour recognition throttle; it does not require
production financial data for testing. Use synthetic statements and identifiers.

## Quick Add rollout and checks

Deploy the API migration before releasing the clients. From
`projects/finance-api`, using your intended development database:

```bash
.venv/bin/python manage.py migrate
.venv/bin/python manage.py test apps.quick_add apps.transactions
.venv/bin/python manage.py makemigrations --check --dry-run
```

The new migration is `quick_add.0001_initial` (presets and durable retry receipts).
Do not point disposable QA at a production database. Backend presets are shared
across authenticated web/mobile sessions; there is no environment data seed.

From `projects/finance-web`:

```bash
npm run test:quick-add
npm run test:auth
npm run test:workflows
npm run test:review-feedback
npm run test:dates
npm run typecheck
npm run build
```

From `projects/finance-mobile`:

```bash
npm install
npm run typecheck
npm run test:quick-add
npm run test:network
npm run test:gestures
```

The locked native time picker is `@react-native-community/datetimepicker` 8.4.1
for Expo SDK 53. The Expo config plugin is committed. When a native release is
requested, follow the existing signed-release guide to include the new native
module; this feature's implementation/checks do not build or distribute an APK.

Mobile release 0.1.5 uses Android version code 6. Keep the committed
`projects/finance-mobile/metro.config.js`: its contracts watch folder is required
for bundling the shared runtime helpers in a native release. The signed build
includes the autolinked datetime picker without a clean Expo prebuild.

SMS recovery release 0.1.6 uses Android code 7. Run `npm run test:sms-sync`, mobile
TypeScript checks, and the native unit/compile commands in the SMS capture guide.
Network monitoring uses the normal `ACCESS_NETWORK_STATE` permission already
provided by WorkManager; no new runtime permission prompt is needed. Rebuild the
signed APK to install the native scheduling fix.

SMS investigation release 0.1.7 uses Android code 8. Native tests now include
MockWebServer fault tests against the production upload engine and transport;
Gradle resolves the pinned OkHttp/MockWebServer 4.9.2 libraries already aligned
with React Native's HTTP stack. Run the native unit and Kotlin compile checks,
mobile typecheck and `test:sms-sync` before signed assembly. Phone-specific
root-cause evidence comes from Show sync diagnostics in Capture; its operational
metadata can be shared without SMS bodies or credentials.

Mobile release 0.1.14 uses Android code 15 and adds compact native review, full-entry,
Quick Add and saved-edit forms that retain drafts across layout changes. It retains
native review editing, latest-action recovery, sync/account summaries and batch SMS sync. Deploy the
API with `/api/messages/import/batch/` for batches of up to 25; older servers
remain usable through single-upload fallback. It includes session-scoped caches,
paged review and explicit restoration of redacted SMS. It retains the
Quick Add keyboard and native session bridge fixes; 0.1.8 is superseded.
From `projects/finance-mobile`, run `npm run typecheck` and
`node --test tests/*.test.cjs`, then from `android` run
`NODE_ENV=production ./gradlew :finance-sms-capture:testReleaseUnitTest assembleRelease`.
Keep the existing private signing key and upgrade in place to retain local SMS.
The versioned output is `projects/finance-mobile/dist/releases/finance-mobile-0.1.14.apk`;
release binaries remain ignored. Native tests, assembly and signature were
verified; physical-device keyboard, sign-in and SMS checks remain separate.

Mobile release 0.1.15 uses Android code 16. It changes Home balances, Activity
row presentation and debt browsing without a backend migration. Run mobile
`npm run typecheck` and `npm test`, then follow the signed-release guide with
the existing private key. Keep `app.json`, native Gradle, package metadata and
SMS device-status version aligned. The ignored APK copy is
`projects/finance-mobile/dist/releases/finance-mobile-0.1.15.apk`.

### Transaction recovery migration

Before running web or mobile clients with Edit/Undo, run `python manage.py migrate` from
`projects/finance-api` using the configured environment. This applies
`transactions.0007_transaction_action_recovery`; no production data backfill or
SMS/PDF re-import is required.
For bKash imports saved before recurring identifiers were retained, open the
saved import in Statements and select **Refresh identifiers from saved PDF**.
Supply the PDF password when needed. If that import has no saved original,
reupload the identical PDF to attach it. Run migrations before testing the new
Electricity, Internet, Mobile Recharge, and merchant-note fields.

### Transaction activity and navigation checks

For the compact web filters/review navigation and mobile Activity changes:

```bash
cd projects/finance-web
npm run typecheck
node --test tests/*.test.cjs
cd ../finance-mobile
npm run typecheck
npm run test:activity
npm run test:navigation
# Full mobile JS regression suite:
node --test tests/*.test.cjs
cd ../finance-api
python manage.py test apps.transactions
```

Run API tests against a disposable test database, never a production dump.
Deploy the API exposing `GET /api/transactions/activity/` before distributing a
mobile build containing the new Activity UI. No migration is added. The default
page is 25 and the legacy transaction-list array contract remains unchanged.
For retained mobile navigation, run `npm ci` after pulling to install React
Navigation and TanStack Query. The custom workspace navigator uses existing
native views and adds no native module or API migration. Run
`npm run test:navigation`; optionally check the Android bundle with
`CI=1 npx expo export --platform android --output-dir dist/navigation-check`.
This export is not an APK. Build/install a signed app for native Back, scroll and
draft checks using the [navigation guide](../projects/finance-mobile/docs/navigation-state.md).
Verify web at desktop and phone widths: secondary filters retain values when
collapsed, URLs reload correctly, review routes share navigation, Planning and
Settings reveal their active item, and SMS focus mode preserves edits.
On a physical Android device check Activity pagination/search/filter cancellation,
transaction details/back, More/drawer destinations, candidate-specific review,
keyboard behavior, offline recovery and account switching.

### Shared client presentation checks

Use `npm run typecheck` and `node --test tests/*.test.cjs` from each of
`projects/finance-web` and `projects/finance-mobile`. Focused checks are web
`node --test tests/presentation.test.cjs tests/movement-presentation.test.cjs` and
mobile `node --test tests/native-fields.test.cjs tests/quick-add-focus.test.cjs`.
See [interface conventions](interface-conventions.md) for browser/device checks.
No migrations or new environment variables are required. Mobile branding and
controls are included only after distributing a rebuilt APK.

### Native review and recovery checks

From `projects/finance-mobile`, run `npm run typecheck` and `npm test` for all
mobile JavaScript regressions; `npm run test:review` targets native editor,
selection, balance, recovery and sync-status interaction tests. Then run the
Android unit/assembly commands above with JDK 17 and the existing external
signing configuration. The 0.1.14 APK consumes existing transaction PATCH,
source-messages, statement-evidence, recent-action and undo endpoints. There is no
new database migration in this mobile pass. Recovery reads refresh on foreground
and after accepted saves; status reads refresh after upload completion, rather
than issuing a server request for every individual SMS.

Review the physical-device checklist in the signed-release guide before calling
keyboard, layout, TalkBack or real background SMS behavior verified. Install over
the existing app to retain encrypted pending work.

Immediate mobile SMS review updates use existing candidate-detail GET,
confirm/reject and transfer-link endpoints. `npm run test:review` includes full-App
optimistic removal, draft rollback, uncertain receipts and explicit retry tests;
`npm test` also checks status-response validation. Run
`CI=1 npx expo export --platform android --output-dir dist/review-update-check`
for a bundle check. No new migration/native dependency is added; follow the
[save/retry phone checklist](../projects/finance-mobile/docs/review-save-recovery.md#verification)
before distributing a newly built APK.


### Evidence proposal metadata

After pulling the evidence proposal API, run the usual API `manage.py migrate`
before enabling a client using it (`reconciliation.0002_evidenceproposal`). There
is no financial data backfill. For optional metadata maintenance,
`manage.py purge_evidence_proposals` previews one bounded page;
`manage.py purge_evidence_proposals --apply --limit 1000` prunes only proposal
metadata expired more than 30 days ago. Canonical source links stay intact.
See [the evidence API guide](evidence-reconciliation-api.md) for synthetic tests
and deployment/retention details.
