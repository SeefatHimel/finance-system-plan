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
- Next milestone is validating the workflow with real anonymized SMS fixtures,
  polishing reconciliation UI, hardening mobile sync, and preparing production
  deployment.

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
- [x] Transactions create/list/filter
- [x] Transactions update/delete
- [x] Accounts create/list/update/delete
- [x] Categories create/list/update/delete
- [x] Payment method and sender rule management screen
- [x] Monthly report screen

### Mobile App

- [x] Expo + TypeScript scaffold
- [x] Health check flow
- [x] Login and token validation flow
- [x] Account/category fetch flow
- [x] Quick transaction create flow
- [x] Transaction list flow
- [x] SMS sender selection UI + permission gate scaffold
- [x] Local raw message cache and sync queue

### Contracts

- [x] Initial `openapi.yaml` added
- [x] Account/category/transaction/report examples added
- [x] Payment method and sender rule contract fields added
- [x] Raw message import and review inbox contract fields/examples added
- [x] Contract Q&A updated

### Phase 2 Kickoff

- [x] Define payment method model + API contract fields
- [x] Define SMS sender rule model + API contract fields
- [x] Add backend migrations and CRUD endpoints for payment methods
- [x] Add backend migrations and CRUD endpoints for sender rules
- [x] Add raw message import endpoint and duplicate-detection baseline
- [x] Add web management screens for payment methods and sender rules
- [x] Add mobile sender selection UI + permission gate scaffold

### Docker Runtime Support

- [x] API Dockerfile + `.dockerignore`
- [x] Web Dockerfile + `.dockerignore`
- [x] Mobile Dockerfile + `.dockerignore`
- [x] Compose stack updated for `postgres`, `finance-api`, `finance-web`
- [x] Optional compose profile for `finance-mobile`
- [x] Docker setup docs updated across infra + local setup + project READMEs

## Pending (Unchecked)

### Sprint 1 Closure (Operational)

- [ ] Run `docker compose config` validation in an environment where Docker CLI is available
- [ ] Smoke run full Docker stack locally (`postgres + finance-api + finance-web`)
- [ ] Confirm optional mobile profile startup in Docker (`--profile mobile`)
- [ ] Group and commit checkpoints in clean commit sequence

### Phase 2 Follow-up

- [x] Add parser-backed SMS review inbox
- [x] Add native Android SMS permission/module decision
- [x] Add local raw message cache and sync queue

### Phase 3 Candidates

- [ ] Collect anonymized SMS fixtures for bKash, EBL, City Bank, and Pathao Pay
- [x] Add starter anonymized-style SMS fixture files for bKash, EBL, City Bank, and Pathao Pay
- [x] Add transfer-aware parsed candidate fields
- [x] Add provider-specific bKash SMS parser
- [x] Add provider-specific parser for bank/card purchase messages
- [x] Add internal transfer matching hints for bank-to-wallet and own-account transfers
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

### Phase 4 Follow-up

- [x] Add first web debt/lending dashboard
- [x] Add reconciliation web screen
- [ ] Add credit card bill tracking
- [ ] Add recurring bills

## Verification Matrix

- [x] Backend tests:
  - Command: `python manage.py test apps.health apps.users apps.accounts apps.categories apps.payment_methods apps.messages apps.transactions apps.reports apps.reconciliation apps.debts`
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
- [ ] Compose config validation:
  - Command: `docker compose config`
  - Result: blocked on 2026-05-30 in current environment (`docker` command not found)

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
