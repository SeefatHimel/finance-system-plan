# Next Steps Checklist

Last updated: 2026-05-31

## Current Snapshot

- Sprint 1 implementation scope is complete.
- Docker support is added for API, web, and optional mobile profile.
- Phase 2 kickoff is complete: payment methods, sender rules, raw SMS import,
  review candidates, web/mobile management, and local mobile queue are in place.
- Phase 3 backend foundations are in place: provider parser starters,
  transfer-aware review, reconciliation endpoints, debt/lend APIs, and
  production auth/token planning.
- Transactions now preserve stricter ledger evidence from SMS confirmations:
  debit/credit direction, provider reference, balance after, counterparty text,
  payment method, raw SMS link, and duplicate key.
- Transaction creates, updates, and deletes now write user-scoped audit logs
  with normalized before/after snapshots.
- Next milestone is validating the workflow with real anonymized SMS fixtures,
  expanding parser coverage from real-world variants, continuing mobile polish,
  and preparing production deployment.

## Done (Checked)

### Sprint 1 Foundations

- [x] Workspace structure created (`finance-api`, `finance-web`, `finance-mobile`, `finance-infra`, `finance-contracts`)
- [x] PostgreSQL local setup with Docker Compose
- [x] Django API scaffold and health endpoint
- [x] JWT auth endpoints (`login`, `refresh`, `me`)
- [x] Accounts, categories, transactions CRUD APIs
- [x] Monthly reports endpoint
- [x] Backend API tests for health/users/accounts/categories/transactions/reports

### Web App

- [x] Login flow + session panel
- [x] Cookie-backed web login/session/logout route handlers
- [x] Transactions create/list/filter
- [x] Transactions debit/credit direction filter
- [x] Transactions source filter
- [x] Transactions search filter
- [x] Transactions update/delete
- [x] Transactions CSV export button
- [x] Transaction audit log viewer
- [x] Per-transaction history links to filtered audit logs
- [x] Accounts create/list/update/delete
- [x] Categories create/list/update/delete
- [x] Payment method and sender rule management screen
- [x] Monthly report screen

### Mobile App

- [x] Expo + TypeScript scaffold
- [x] Health check flow
- [x] Login and token validation flow
- [x] Account/category fetch flow
- [x] Local account/category cache hydration for mobile forms
- [x] Quick transaction create flow
- [x] Local manual transaction queue and sync flow
- [x] Transaction list flow
- [x] Local recent transaction cache hydration for offline mobile review
- [x] SMS sender selection UI + permission gate scaffold
- [x] Local raw message cache and sync queue
- [x] Native Android SMS capture scaffold for custom dev client/personal APK builds

### Contracts

- [x] Initial `openapi.yaml` added
- [x] Account/category/transaction/report examples added
- [x] Payment method and sender rule contract fields added
- [x] Raw message import and review inbox contract fields/examples added
- [x] Credit-card bill and recurring-bill contract fields/examples added
- [x] Generated TypeScript API client and schema types added
- [x] Contract Q&A updated
- [x] Auth, transfer transaction, validation error, and audit log examples added
- [x] Reconciliation response, audit detail, and CSV export examples added

### Phase 2 Kickoff

- [x] Define payment method model + API contract fields
- [x] Define SMS sender rule model + API contract fields
- [x] Add backend migrations and CRUD endpoints for payment methods
- [x] Add backend migrations and CRUD endpoints for sender rules
- [x] Add raw message import endpoint and duplicate-detection baseline
- [x] Add web management screens for payment methods and sender rules
- [x] Align web SMS settings provider options with contract provider enums
- [x] Add mobile sender selection UI + permission gate scaffold

### Docker Runtime Support

- [x] API Dockerfile + `.dockerignore`
- [x] Web Dockerfile + `.dockerignore`
- [x] Mobile Dockerfile + `.dockerignore`
- [x] Compose stack updated for `postgres`, `finance-api`, `finance-web`
- [x] Optional compose profile for `finance-mobile`
- [x] Docker setup docs updated across infra + local setup + project READMEs
- [x] Local PostgreSQL backup and guarded restore scripts
- [x] Backup manifest, retention helper, and automation runbook
- [x] Production deployment readiness runbook

## Pending (Unchecked)

### Sprint 1 Closure (Operational)

- [ ] Run `docker compose config` validation in an environment where Docker CLI is available
- [ ] Smoke run full Docker stack locally (`postgres + finance-api + finance-web`)
- [ ] Confirm optional mobile profile startup in Docker (`--profile mobile`)
- [x] Group and commit checkpoints in clean commit sequence

### Phase 2 Follow-up

- [x] Add parser-backed SMS review inbox
- [x] Add native Android SMS permission/module decision
- [x] Add local raw message cache and sync queue
- [x] Add native Android SMS capture scaffold

### Phase 3 Candidates

- [ ] Collect anonymized SMS fixtures for bKash, EBL, City Bank, and Pathao Pay
- [x] Add starter anonymized-style SMS fixture files for bKash, EBL, City Bank, and Pathao Pay
- [x] Add transfer-aware parsed candidate fields
- [x] Add provider-specific bKash SMS parser
- [x] Add provider-specific parser for bank/card purchase messages
- [x] Add internal transfer matching hints for bank-to-wallet and own-account transfers
- [x] Add bank transfer source/destination prefill from known payment-method identifiers
- [x] Add web SMS review inbox UI
- [x] Add mobile SMS review inbox UI
- [x] Add balance snapshot and reconciliation endpoints
- [x] Add debt/lend workflow models and APIs
- [x] Add production-ready auth/token storage plan
- [x] Add strict transaction ledger fields for SMS evidence and duplicate keys

### Phase 3 Follow-up

- [x] Add richer source/destination extraction for bKash sender/receiver account numbers
- [x] Add Pathao Pay parser coverage for make payment, top-up, send money, and withdraw confirmations
- [x] Add source/destination account controls to mobile SMS review
- [x] Add parser confidence/duplicate reason display in review inbox
- [x] Add raw SMS deletion/redaction workflow
- [x] Add bank/card parser coverage for card payments, fees, refunds, and reversals
- [x] Harden mobile raw SMS queue with retry metadata, local duplicate checks, and removal controls
- [x] Add capped retry backoff and next retry display for mobile raw SMS queue
- [x] Add offline manual transaction queue with retry backoff and removal controls

### Phase 4 Follow-up

- [x] Add first web debt/lending dashboard
- [x] Add reconciliation web screen
- [x] Polish reconciliation account check with difference, reason, and synced snapshot account
- [x] Add credit card bill tracking
- [x] Add recurring bills
- [x] Add compact mobile summaries for debt, card bill, recurring bill, and reconciliation workflows

### Phase 5 Follow-up

- [x] Add authenticated filtered transaction CSV export endpoint
- [x] Add web transaction CSV export action
- [x] Add local PostgreSQL backup/restore scripts for first backup path
- [x] Add backup manifest, retention helper, and automation runbook
- [x] Add production deployment readiness checklist and rollback plan
- [x] Add production guard around temporary web localStorage token flow
- [x] Add cookie-backed web auth route layer for login/session/logout
- [x] Migrate authenticated web workspace API calls behind cookie-backed
      same-origin proxy routes
- [x] Add local-development web token refresh and single retry on 401
- [x] Add backend production settings guard for unsafe debug-off configuration
- [x] Enable backend JWT refresh-token rotation and blacklist-after-rotation
- [x] Add OpenAPI-generated TypeScript client workflow
- [x] Reuse generated transaction enum types in the web transaction API wrapper
- [x] Reuse generated OpenAPI request/enum types across web API inputs
- [x] Add transaction audit log API and contract coverage
- [x] Add missing auth, transfer, validation, and audit log contract examples
- [x] Align auth refresh contract with rotated refresh-token response
- [x] Add web transaction audit log viewer
- [x] Add transaction row history links into audit logs
- [x] Add web debit/credit transaction filter
- [x] Add backend-backed transaction search filter
- [x] Add backend-backed transaction source filter

## Verification Matrix

- [x] Backend tests:
  - Command: `python manage.py test apps.health apps.users apps.accounts apps.categories apps.payment_methods apps.messages apps.transactions apps.reports apps.reconciliation apps.debts apps.credit_cards apps.recurring_bills apps.audit_logs`
  - Result: pass
- [x] Web typecheck:
  - Command: `npm run typecheck`
  - Result: pass
- [x] Web lint:
  - Command: `npm run lint`
  - Result: pass
- [x] Web build:
  - Command: `npm run build`
  - Result: pass
- [x] Mobile typecheck:
  - Command: `npm run typecheck`
  - Result: pass
- [ ] Native Android SMS device build:
  - Command: `npx expo prebuild --platform android && npx expo run:android --device`
  - Result: not run in this environment; requires Android device/emulator and
    generated native build
- [ ] Cookie-backed web runtime smoke:
  - Command: run production web with `NEXT_PUBLIC_ALLOW_LOCAL_TOKEN_STORAGE=false`,
    sign in, and exercise authenticated workspaces
  - Result: not run in this environment; requires running API/web servers
- [ ] Compose config validation:
  - Command: `docker compose config`
  - Result: still blocked on 2026-05-31 in current environment (`docker` command not found)
- [x] Backup/restore script syntax:
  - Command: `sh -n projects/finance-infra/scripts/backup-postgres.sh`
  - Command: `sh -n projects/finance-infra/scripts/restore-postgres.sh`
  - Command: `sh -n projects/finance-infra/scripts/prune-backups.sh`
  - Result: pass
- [x] Restore guard check:
  - Command: `projects/finance-infra/scripts/restore-postgres.sh missing.dump`
  - Result: refuses without `CONFIRM_RESTORE=finance`
- [x] Backend production settings guard:
  - Command: `DJANGO_DEBUG=false python3 -c 'import config.settings'`
  - Result: refuses unsafe local defaults
  - Command: `DJANGO_DEBUG=false DJANGO_SECRET_KEY=production-secret-key-with-enough-length DATABASE_URL=postgres://finance:finance@db.example.com:5432/finance DJANGO_ALLOWED_HOSTS=api.example.com DJANGO_CORS_ALLOWED_ORIGINS=https://app.example.com python3 -c 'import config.settings; print("settings ok")'`
  - Result: pass

## Checkpoint Commit Messages

- `contracts: add initial OpenAPI spec and phase-1 API examples`
- `mobile: scaffold expo app and add backend health check flow`
- `mobile: add jwt login placeholder and token validation flow`
- `mobile: add authenticated account and category fetch flow`
- `mobile: add quick transaction create flow with authenticated api submit`
- `mobile: add authenticated transaction list flow`
- `web: add delete actions for accounts categories and transactions`
- `web: add account category and transaction update flows`
- `web: resolve remaining hook lint warnings and complete sprint-1 verification`
- `infra: add docker support for api web and optional mobile with full setup docs`
- `api: add payment methods and sms sender rule management`
- `web: add sms settings management screen`
- `mobile: add sms sender selection scaffold`
- `api: add parser-backed sms review inbox`
- `docs: decide mobile sms permission path`
- `mobile: add local raw message sync queue`
- `docs: plan phase 3 provider sms parsing`
- `api: add transfer-aware bkash sms parser`
- `api: add bank card sms purchase parsing`
- `api: add internal transfer sms matching hints`
- `web: add sms review inbox`
- `mobile: add sms review inbox`
- `api: add balance snapshot reconciliation endpoints`
- `api: add debt and repayment workflow endpoints`
- `docs: add production auth token storage plan`
- `api: preserve sms ledger evidence on transactions`
- `api: add pathao pay sms parser coverage`
- `api: match bkash transfer account hints`
- `mobile: add sms transfer review controls`
- `web: surface sms review confidence reasons`
- `api: add raw sms redaction workflow`
- `web: add debt and lending dashboard`
- `api: add credit card bill tracking`
- `api: add recurring bill tracking`
- `mobile: add debt repayment workflow`
- `mobile: add credit card bill workflow`
- `mobile: add recurring bill workflow`
- `mobile: add reconciliation workflow`
- `api: harden bank card sms parser`
- `mobile: harden raw sms sync queue`
- `contracts: add card and recurring bill APIs`
- `api: add transaction csv export`
- `web: add transaction csv export`
- `contracts: generate typescript api client`
- `api: add transaction audit logs`
- `contracts: add missing api examples`
- `web: add transaction audit log viewer`
- `web: link transactions to audit history`
- `web: add transaction direction filter`
- `api: add transaction search filter`
- `api: add transaction source filter`
- `contracts: add reconciliation and export examples`
- `web: reuse generated transaction enum types`
- `web: reuse generated api input types`
- `docs: refresh docker validation blocker`
- `web: polish reconciliation account check`
- `mobile: add raw sms retry backoff`
- `mobile: add manual transaction offline queue`
- `mobile: cache reference data for offline forms`
- `mobile: cache recent transactions for offline view`
