# finance-api

Django backend and source of truth for the finance system.

## Current Status

The API project is scaffolded with:

- Django settings
- Django REST Framework dependency
- OpenAPI documentation dependency
- CORS configuration
- `/api/health/` endpoint
- Health endpoint test
- Account, category, and transaction models
- Authenticated CRUD APIs for accounts, categories, and transactions
- Editable starter expense, income, transfer, and debt categories for new users,
  with a migration that backfills only users whose category list is empty
- Authenticated CRUD APIs for payment methods and SMS sender rules
- Duplicate sender/match combinations rejected per authenticated user
- Raw SMS import endpoint with duplicate detection and opt-in reparsing of
  pending duplicates
- Per-user SMS capture policy for provider and non-transaction message-type
  exclusions and confirmed raw-text retention; excluded bodies are replaced by
  hash-only tombstones before save
- Mobile device heartbeat endpoint with permission, queue, error, scan, sync,
  and derived health status
- Parsed SMS review inbox with confirm/reject actions, structured rejection
  reasons, optional raw-body redaction, and sender/provider exclusion shortcuts
- Opt-in review learning that saves corrected account, payment method, category,
  and transaction type back to the sender rule
- Basic monthly report endpoint
- Debt and repayment workflow endpoints
- Credit card bill and payment workflow endpoints
- Recurring bill schedule and payment workflow endpoints
- Balance snapshot and reconciliation endpoints
- Derived account ledger balances plus latest provider-reported transaction
  balance evidence on account responses
- Read-only audit log endpoint for transaction creates, updates, and deletes
- JWT login, refresh, per-session logout, all-session logout, and current-user
  endpoints
- JWT refresh-token rotation and blacklist-after-rotation settings
- Per-IP and per-username login throttles, 15-minute access tokens, and rolling
  30-day refresh sessions
- Production settings guard that refuses unsafe `DJANGO_DEBUG=false`
  configurations

## Responsibilities

- User authentication
- Accounts and payment methods
- Categories
- Transactions
- SMS sender rules
- Raw message ingestion
- Rule-based parsing
- Duplicate detection
- Debt and repayment tracking
- Credit card bill tracking
- Recurring bill tracking
- Balance snapshots and reconciliation
- Transaction audit trail
- Reports for web and mobile

## Suggested Stack

- Python
- Django
- Django REST Framework
- PostgreSQL
- pytest
- django-filter
- drf-spectacular for OpenAPI generation

## Local Setup

The repository pins Python 3.13 in `.python-version`. Django 5.1 does not
support Python 3.14, so hosted Python runtimes must honor this pin.

Create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
python -m pip install -r requirements-dev.txt
```

Create local environment file:

```bash
cp .env.example .env
```

The default `.env.example` is for local development. When `DJANGO_DEBUG=false`,
settings validation requires a strong non-default `DJANGO_SECRET_KEY`,
PostgreSQL `DATABASE_URL`, deployed `DJANGO_ALLOWED_HOSTS`, and deployed CORS
and CSRF origins. Use full origins including the scheme for
`DJANGO_CSRF_TRUSTED_ORIGINS`, for example `https://api.example.com`. Render's
`RENDER_EXTERNAL_URL` is trusted automatically.

PostgreSQL transaction poolers cannot preserve Django's server-side cursors
between fetches. Neon `-pooler` hosts automatically set
`DISABLE_SERVER_SIDE_CURSORS`; for another transaction pooler, set
`DJANGO_DB_DISABLE_SERVER_SIDE_CURSORS=true`. Direct PostgreSQL connections
retain streaming cursors. Set `DJANGO_DEBUG=false` on Render so exceptions do
not expose detailed tracebacks and environment settings to visitors.

To use hosted PostgreSQL from your laptop instead, set `DATABASE_URL` in
`.env` to the provider **external** URL (Render includes
`singapore-postgres.render.com`). Do not commit that file.

Start PostgreSQL from `../finance-infra`:

```bash
docker compose up -d postgres
```

Run migrations:

```bash
python manage.py migrate
```

Start the API:

```bash
python manage.py runserver 0.0.0.0:8000
```

Health check:

```bash
curl http://localhost:8000/api/health/
```

Expected response:

```json
{"status": "ok"}
```

API docs will be available at:

```txt
http://localhost:8000/api/docs/
```

## Docker

`Dockerfile` is for local development. `Dockerfile.prod` uses Python 3.13,
Gunicorn, and collected WhiteNoise static assets; deploy it with the separate
production Compose file and migration step in `docs/production-deployment-plan.md`.

The SMS review endpoint accepts `limit=1..200` and `offset>=0` and then returns
`{count, results}`. Older mobile clients can still omit `limit` and receive the
original array. The dashboard calls `GET /api/reports/dashboard-summary/` for
exact pending/automated counts and at most three candidates and four recent
transactions, avoiding full activity lists. The summary accepts the same
custom period bounds as the monthly report; pending messages remain live.

Custom sender regular expressions use a restricted, linear-time subset:
128 characters maximum, with no groups, quantifiers, alternatives or
backreferences. Existing unsafe saved patterns are ignored until corrected.
Use exact or contains matching for ordinary sender IDs.

From `projects/finance-infra`:

```bash
cp .env.example .env
docker compose up --build -d postgres finance-api
```

The API service runs migrations on startup and then serves on port `8000`.

## Verification

```bash
python manage.py test apps.health apps.users apps.accounts apps.categories apps.payment_methods apps.messages apps.transactions apps.reports apps.reconciliation apps.debts apps.credit_cards apps.recurring_bills apps.audit_logs apps.statements
```

## Django Apps

```txt
config/
users/
accounts/
categories/
transactions/
payment_methods/
messages/
debts/
credit_cards/
recurring_bills/
reports/
reconciliation/
audit_logs/
```

## Important API Groups

```txt
/api/auth/
/api/accounts/
/api/categories/
/api/payment-methods/
/api/transactions/
/api/messages/
/api/messages/sender-rules/
/api/debts/
/api/credit-card-bills/
/api/recurring-bills/
/api/reports/
/api/reconciliation/
/api/audit-logs/
```

## Implemented Endpoints

```txt
GET    /api/health/
POST   /api/auth/login/
POST   /api/auth/refresh/
POST   /api/auth/logout/
POST   /api/auth/logout-all/
GET    /api/auth/me/

GET    /api/accounts/
POST   /api/accounts/
GET    /api/accounts/{id}/
PATCH  /api/accounts/{id}/
DELETE /api/accounts/{id}/

GET    /api/categories/
POST   /api/categories/
GET    /api/categories/{id}/
PATCH  /api/categories/{id}/
DELETE /api/categories/{id}/

GET    /api/payment-methods/
POST   /api/payment-methods/
GET    /api/payment-methods/{id}/
PATCH  /api/payment-methods/{id}/
DELETE /api/payment-methods/{id}/

GET    /api/messages/sender-rules/
POST   /api/messages/sender-rules/
GET    /api/messages/sender-rules/{id}/
PATCH  /api/messages/sender-rules/{id}/
DELETE /api/messages/sender-rules/{id}/
GET    /api/messages/capture-preferences/
PATCH  /api/messages/capture-preferences/
GET    /api/messages/device-status/
POST   /api/messages/device-status/
POST   /api/messages/import/
POST   /api/messages/dev/reset/  # local DEBUG only
POST   /api/messages/raw/{id}/redact/
GET    /api/messages/review/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/ignore/
POST   /api/messages/review/{id}/reject/

GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/{id}/
PATCH  /api/transactions/{id}/
DELETE /api/transactions/{id}/
GET    /api/transactions/export/?month=YYYY-MM

GET    /api/debts/
POST   /api/debts/
GET    /api/debts/{id}/
PATCH  /api/debts/{id}/
DELETE /api/debts/{id}/
POST   /api/debts/{id}/payments/

GET    /api/credit-card-bills/
POST   /api/credit-card-bills/
GET    /api/credit-card-bills/{id}/
PATCH  /api/credit-card-bills/{id}/
DELETE /api/credit-card-bills/{id}/
POST   /api/credit-card-bills/{id}/payments/

GET    /api/recurring-bills/
POST   /api/recurring-bills/
GET    /api/recurring-bills/{id}/
PATCH  /api/recurring-bills/{id}/
DELETE /api/recurring-bills/{id}/
POST   /api/recurring-bills/{id}/payments/

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/snapshots/{id}/
PATCH  /api/reconciliation/snapshots/{id}/
DELETE /api/reconciliation/snapshots/{id}/
GET    /api/reconciliation/accounts/{account_id}/
GET    /api/audit-logs/
GET    /api/audit-logs/{id}/
GET    /api/schema/
GET    /api/docs/
```

Transaction create, update, and delete actions write user-scoped audit entries
with before/after snapshots of normalized ledger fields. Audit log entries are
read-only through the API and can be filtered by `action`, `entity_type`, and
`entity_id`.

Transaction list and CSV export endpoints share filters for `month`, paired `start_date`/`end_date`,
`date_field`, `account`,
`category`, `type`, `direction`, `source`, and `search`. Source separates web,
mobile, SMS, import, and system-created ledger rows. Search covers ledger text,
both account names/types/currency, category and payment-method names, type,
direction, source, amount, reported balance, ISO dates/times, local activity
timestamps, review status, identifiers, IDs and external keys. Linked transfer
observations add their account, provider, source, direction, date/time, balance,
fee, reference and note. Raw SMS bodies are outside ledger search.
CSV text cells that begin with spreadsheet formula characters are escaped on
export, while numeric zero remains `0.00` rather than an empty cell.

Search uses case-insensitive partial matching. Each space-separated term must
match somewhere on the transaction or its linked evidence; quoted phrases stay
together. Display labels such as "City Bank" match their enum values. Numeric
terms accept thousands separators, and exact decimal comparisons preserve cents
across supported databases. UUID searches require at least eight hexadecimal
characters, avoiding short amount queries matching random ID fragments. Activity timestamps search in Asia/Dhaka, matching
the activity date filters. Empty/whitespace queries do not restrict results.
Queries are limited to 256 characters and 12 terms; excess input returns field
validation errors. The same search applies to CSV export and combines with all
existing filters. Correlated EXISTS on user-owned transfer evidence avoids
duplicate ledger rows and one-to-many join multiplication. Account/transaction
ownership checks remain enforced. Verify with `apps.transactions.test_search`.

All finance endpoints except `/api/health/` require authentication.

Use the access token as a Bearer token:

```txt
Authorization: Bearer <access-token>
```

## Parser Design

Use provider-specific parser classes:

```txt
BaseMessageParser
BkashMessageParser (initial transfer-aware implementation)
EblMessageParser (initial card purchase, card payment, fee, and bank-to-wallet transfer implementation)
CityBankMessageParser (initial card purchase, refund, reversal, and own-account transfer implementation)
PathaoPayMessageParser (initial top-up, payment, send-money, and withdraw implementation)
CustomRegexMessageParser
```

Each parser returns a parsed candidate, not a final transaction. The backend
should create transactions only when the user confirms the candidate. Parsed
candidates preserve provider, message kind, reference, fee, balance, and
possible internal-transfer hints so bank-to-wallet movement does not become a
fake expense or income. When two review candidates have the same user, amount,
close timestamps, and different providers, the backend links them as possible
related messages for review instead of auto-merging them. The transfer matching
API additionally handles same-provider messages and already-posted transfers.
Bank transfer parser coverage also matches known payment-method identifiers in
the message text so source and destination account hints can be prefilled for
review when both sides belong to the user.

## Balance Rules

- Store transaction amounts as positive numeric values.
- Use transaction type to determine direction.
- Calculate expected balances from confirmed transactions.
- Store actual real-life balance checks as snapshots.
- Show the difference between expected and actual balances.
- Create adjustment transactions only when the user chooses to reconcile.

## Phase 1 Backend Milestones

1. Health endpoint. Done.
2. Auth. Done.
3. Account CRUD. Done.
4. Category CRUD. Done.
5. Transaction CRUD. Done.
6. Monthly report endpoint. Done.
7. Balance snapshot endpoint.
8. Reconciliation difference endpoint.

## Suggested Transfer Matching

- `POST /api/transactions/transfer-matches/`: manual draft or candidate plus
  corrected fields; returns posted transfers/opposite pending SMS suggestions.
- `POST /api/transactions/link-transfer/`: explicit match acceptance; attaches
  account-specific evidence or confirms both pending messages as one movement.
- `POST /api/transactions/{id}/merge-transfer/`: explicit audited merge of two
  posted matching transfers.

A manual credit transfer uses `account` as receiver and `transfer_account` as
sender. Stored transactions always use source/destination order with debit as
canonical direction. Updated SMS clients submit `account_perspective: true`
with the selected account, its debit/credit direction, and the other account.
Credit review entries are normalized to the same source/destination order;
reported balances remain evidence of the selected account. Legacy SMS requests
without this flag retain canonical source/destination semantics.
Account filtering includes both sides and exposes contextual `account_direction`.
`transfer_evidence` retains each account's reference/date/balance and contributes
no additional ledger movement. Matching uses exact principal and compatible
accounts within three days; a real reverse transfer is excluded. Multiple
suggestions require user selection. Keep separate always remains available.

Apply migrations with `python manage.py migrate`; old transfers are backfilled
without automatic merging. Confirmation/link/create/update/delete share a
per-user row lock; SMS/manual observation keys prevent replay. Test this with
`python manage.py test apps.transactions.test_transfers`. PostgreSQL is required
for the concurrency test. Fees remain separate expenses; observed fee metadata
alone does not post a fee. Actual delayed settlement is not modeled by this
change.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.

## Transfer Account Suggestions

Transfer review resolves the other account using saved masked endpoints first,
then an explicitly remembered path, a unique previously confirmed path, and a
unique account/payment-method name or provider alias. `PathaoPay` and
`Pathao Pay` can identify a saved Pathao wallet without using a name as a masked
identifier. Multiple matching accounts or conflicting confirmed paths require
manual selection. Inactive accounts and other users' records are excluded.

With “Use these choices for similar messages” enabled, adding or linking a
transfer remembers the reporting account, counterparty key, detected message
kind, chosen debit/credit direction, other account, and category. Transfer paths
are stored separately from broad sender/message-kind defaults so unrelated
bank transfers do not inherit a destination. Matching pending items update
immediately; stronger explicit endpoint evidence remains intact. Provider
location suffixes are normalized only for known aliases, not arbitrary names.

Historical suggestions inspect at most 200 recent confirmed candidates for the
same sender rule/message kind and reporting account. They are suggestions even
when the original confirmation did not opt into remembering. No remembered
rule is created without explicit confirmation, and no transaction is posted or
linked automatically. Incoming suggestions retain the selected reporting
account as the receiver. Counterparty wording alone does not reverse direction.

Apply migration `finance_messages.0011_transfer_counterparty_suggestions` with
`python manage.py migrate` before deploying the updated API/web clients. Existing
records remain unchanged; reprocess pending messages to obtain new suggestions.
Run `python manage.py test apps.messages.test_transfer_suggestions apps.messages.tests apps.transactions.test_transfers`.

Regression coverage includes bank messages with “from PathaoPay” and masked
card/account evidence, plus previously confirmed paths across `PathaoPay DHAKA BD`
and `Pathao Pay` variations. Counterparty wording identifies a possible other
account; it does not independently reverse the reporting account's direction.

## Transaction List Ordering

`GET /api/transactions/?ordering=-created_at` lists newest ledger additions first,
including backdated records when month is omitted. Default `ordering=-date`
retains transaction-date/time order. `ordering=-updated_at` lists latest saved
changes first, including new records, edits, new transfer evidence and merges.
Reads and idempotent transfer retries do not advance `updated_at`. These three
values are accepted; other values return 400. User ownership and existing
filters apply before sorting,
with an ID tie-breaker for stable results. Period filters use the selected
`date_field`, defaulting to transaction date. Edits and linked observations do not change `created_at`. CSV exports
remain chronological. No migration is required for update ordering: it uses the
existing timestamp, without backfilling past evidence links. Verify with
`python manage.py test apps.transactions.tests apps.transactions.test_transfers`.

## Original SMS While Editing

`GET /api/transactions/{id}/source-messages/` returns the transaction's original
SMS and messages attached through transfer evidence, deduplicated and ordered
by received time then ID. Both transaction and message ownership are checked.
Only ID, sender, body, received time, status and redaction time are returned;
device identifiers and body hashes are omitted. Manual entries without linked
SMS return an empty array. Redacted or excluded text returns `body: null` with
remaining metadata. Responses are private and not cacheable. This read does
not change ledger timestamps, audit history or retention; the transaction list
continues to omit original bodies. No migration is required. Verify with
`python manage.py test apps.transactions.test_source_messages`.

## Promotional SMS Skips

English and Bangla offer/anniversary messages are classified as `promotional`
when no transaction or card activity is present. Bengali anniversary digits do
not turn an offer into a financial transaction. OTP classification takes
priority, and balance notices retain their own category. Payments, purchases,
transfers, refunds, cashback credits and messages with masked card/amount evidence
remain eligible for transaction review even when they contain promotional words.

Promotional messages are excluded by default before storing the original body.
Migration `0012_alter_parsedmessagecandidate_message_kind` adds the kind and
enables this exclusion on existing capture preferences without dropping other
choices. Users can allow it again through capture preferences. Reprocess old
pending messages to remove newly classified offers; confirmed transactions stay
unchanged. Rejecting with `exclude_message_kind=true` remembers a recognized
promotional, OTP/security or balance-notice exclusion and removes matching pending
notices. Unknown/financial types return 400 without changing the candidate or
disabling a sender. This learns a message-type preference, not arbitrary text
templates; ambiguous formats remain for review. Verify with
`python manage.py test apps.messages.test_promotional_skips apps.messages.tests`.

## Audited Transaction Corrections

Ledger edits support date/time, type/direction, accounts, category, amount,
reported balance, reference, counterparty, note, payment method, source,
`needs_review`, and four masked sender/receiver identifiers. Numeric identifiers
are sanitized to a safe suffix; ownership and payment-method/account validation
still apply. System IDs/timestamps and original SMS remain evidence, not editor
fields.

Changing a matched transfer's type, accounts or principal requires
`allow_linked_correction=true` on PATCH when more than one observation is linked.
Without that explicit acknowledgement the API returns 400. Transfers stay
canonical: `account` is From, `transfer_account` is To, and stored direction is
Debit. Reverse direction by swapping those accounts. The update remains one
ledger entry and is audited with before/after snapshots and acknowledgement
metadata.

Account corrections remap manual observations by debit/credit side and clear
obsolete manual reported balances and fees. Captured SMS/PDF observations keep
their original account, direction and source values. An unchanged old primary
balance is cleared only when its reporting account changes, not merely when its
type changes. An explicit new balance is accepted; date/time/reference/note/balance
edits update only primary manual evidence, not captured messages. Reclassification keeps
observations as historical provenance and preserves source-message access and
retry keys. Same-account reclassification preserves the primary reported balance
(including a primary-evidence fallback when the root balance is null); the other
observations remain historical. Only current transfers consume those observations
in balance reporting. Ordinary updates and type/category changes preserve zero
and other reported values. An omitted balance preserves it on the same account;
explicit null clears it. Account remapping clears an omitted or unchanged carried
value; an explicit replacement is accepted. SMS confirmation and transfer
matching/linking use the same reporting-account rule for parsed balances.
No database migration is required.

Regression coverage: `apps.transactions.test_reported_balances` and
`apps.transactions.test_corrections`, together with the
transaction, transfer, source-message and message suites. SQLite skips the
existing PostgreSQL concurrency case.

## References and SMS Duplicate Protection

`reference` is optional, editable evidence such as a provider Ref/TrxID. It is
not unique and is separate from the internal transaction UUID. Distinct SMS
captures may reuse a reference, including the same provider/account/date/amount;
confirming each as separate creates separate movements. Accept a transfer match
when two captures describe the same movement, so both observations count once.

New SMS confirmation/observation keys use the captured raw-message ID. Same SMS
imports still reuse their sender/body/received-time hash; confirmation and link
checks also inspect existing transaction/raw-message and evidence links. Changing
a reference cannot bypass duplicate protection. Existing provider/reference keys
are retained, with raw links protecting legacy records; no migration is needed.
Manual transfer retry keys remain independent of the display reference.

Transfer suggestions and explicit linking require compatible accounts, equal
principal amount, equal account currencies and a date within three days.
Transaction times remain visible for review. An agreeing primary or linked
reference is explained as supporting evidence; a reference alone never merges
or rejects an entry. No automatic acceptance or FX matching is introduced.
Synthetic reference examples: `DEMO-TRF-1042`, `DEMO-PAY-7Q2M`, `DEMO-ATM-0091`.
Use the provider's actual code if available, or leave this field blank.

Verify with `python manage.py test apps.transactions.test_references
apps.transactions.test_transfers apps.messages.tests` against the configured
test database.

## SMS Confirmation Overrides

SMS confirmation distinguishes omitted fields from explicit `null` for
`transfer_account` and `payment_method`: omission retains parsed defaults, while
`null` clears them. This allows a reviewed transfer to be reclassified as another
type without restoring its parsed destination. A transfer still requires another
account; ownership and payment-method/account validation remain enforced.

## Primary Transfer Reports

Transfer evidence responses include read-only `is_primary`, using the same original
SMS/manual-entry-key selection as transaction corrections. Clients can load that
observation's balance when the main transfer balance is empty without choosing an
unrelated account. Serialization uses prefetched observations without extra queries;
no database migration is required.

## Statement PDF Imports

The Statements workflow now saves drafts, suggests existing transactions, and
supports explicit create/link/skip decisions. BDT EBL bank, City Bank savings,
and bKash digital layouts are supported. Scans and credit-card billing layouts
remain unsupported pending separate extraction and accounting validation.

- `POST /api/statements/preview/`: stateless extraction; `can_post=false`.
- `POST /api/statements/imports/`: multipart account/file/optional password; saves
  masked extraction and editable drafts, without ledger writes. The same exact
  file for the same user/account returns its existing review, preserving edits.
- `GET /api/statements/imports/` and `/{id}/`: paginated history and counts.
- `GET /api/statements/imports/{id}/rows/`: global state/search/direction/type/
  category/date filters before pagination (default 50, maximum 100).
- `GET/PATCH /api/statements/rows/{id}/`: review or correct a pending draft;
  PATCH requires its current `version` and preserves original extraction.
- `POST /api/statements/rows/{id}/decide/`: create/link/skip/unlink/reopen.
- `POST /api/statements/imports/{id}/approve_new/`: explicitly approve up to 50
  IDs/versions; fresh matches, stale rows and discrepancies remain unresolved.
- `GET /api/transactions/{id}/statement-evidence/`: on-demand masked sources.
- `GET/POST /api/statements/counterparty-codes/`: list recurring Citytouch
  statement codes and save an explicitly verified party/classification mapping.
- `DELETE /api/statements/counterparty-codes/{id}/`: forget a mapping while
  retaining the observed masked source rows.

For City Bank `CT-FT-***1234-***5678` descriptions, the first part varies by
movement and is never used as party identity. Only the second four-digit code
is grouped, separately for each reporting account and debit/credit direction.
This code is a clue, not proof that it is an account number. The directory
shows recent masked examples and permits either an external party label or a
different owned account, plus an optional compatible type/category suggestion.
Fund transfer wording does not force an internal ledger transfer: a payment can
remain an expense, or an incoming movement can be income. Citytouch rows require
explicit classification review before posting. Verified mappings only appear as
editable suggestions on pending drafts; they do not rewrite posted transactions
or original statement evidence. Apply migration
`statements.0004_statementcounterpartycode` before deploying this API and web UI.

Matching uses reporting-account perspective, equal currency/amount/direction,
and posting/value dates within three days. Reference and reported balance are
supporting evidence; no suggestion is automatically accepted. Known linked
source fingerprints also surface user-corrected ledger records outside that
window. A fingerprint is not unique: genuine repeats remain distinct rows.
Linking preserves ledger type/category/source/amount and existing SMS. A conflict
in the effective reported balance requires an explicit choice between the current
ledger report and the statement report. Optional reviewed metadata selections
can fill or replace merchant, reference, note, and masked identifiers. Owned
transfers keep canonical From → To and add reporting-side evidence. Both source
observations retain their original reported balances. A reviewed ledger balance
choice is stored separately, so unlinking the PDF row preserves an explicit
choice without rewriting SMS or statement evidence.

Opening/closing/summary rows are excluded. Wallet inline charges become separate
fee/refund review rows. For newly posted principal-plus-fee events, the final
reported balance belongs to the fee entry, not the intermediate principal.
Original row and summary discrepancies require explicit acknowledgement.

User-level locks shared with transaction writers, row versions, stable retry
keys and source constraints protect decisions. Identical resolved retries are
idempotent; stale or conflicting decisions return readable 409 errors. Unlinking
keeps the ledger entry. Deleted targets return their source rows to review.
Financial corrections to statement-linked ledger entries require
`allow_linked_correction`; immutable source values survive. Transfer merges move
statement links and reject merging separate observations from one batch.
Unlinking transfer statement evidence also records a transaction audit snapshot
when it removes an observation or restores a prior effective balance.

Limits: 4 MiB, 30 pages, 2000 extracted rows (up to 4000 principal/fee review
components), 10 uploads/hour/user, 20-second isolated extraction worker. History
matching is bounded and blocks posting if its search is truncated. PDFs/passwords
are discarded; saved rows contain masked extracted values, corrections and audit
history. Responses use no-store. Account suffix hints do not prove ownership.

Install requirements, run `python manage.py migrate` (adds
`statements.0001_initial`), and restart API/web. Verify with
`python manage.py test apps.statements apps.transactions`; concurrency checks
require PostgreSQL. Fixtures contain synthetic data only.
See [the import plan](../../docs/statement-pdf-import-plan.md).

### Review assistance and reconciliation

Matches now include `strength` (`strong` or `possible`), merchant similarity,
reported time difference, and supporting reasons. Amount, currency, reporting
account and direction remain required. Posting/value dates and transfer-side
observation dates are considered; equally corroborated candidates remain possible
matches. Strength is a heuristic, not a probability or permission to auto-link.

Set `remember_choices=true` on an explicit create/link decision to remember the
saved draft's type, category and other owned account. Suggestions are scoped to
user, reporting account, provider profile, source direction, component and
normalized merchant wording. Generic transfer descriptions are excluded.
Suggestions do not modify amounts, balances, dates or existing transactions;
inactive categories/accounts suppress suggestions. Unchecking the option prevents
new learning; it does not remove a previously remembered choice.

`GET /api/statements/imports/{id}/summary/` recalculates all saved draft rows in
source order, including skipped rows. It returns principal/fee debit-credit totals,
posted/linked/skipped/unresolved observation totals and balance/net checks.
Linked totals use draft observation amounts, not subsequently corrected ledger
amounts. Derived opening balances are labelled; unavailable data never passes a
check. Immutable extraction checks remain separate. Draft discrepancies require
individual acknowledgement before creating or linking and are excluded from bulk
approval.

`POST /api/statements/imports/{id}/review_selected/` accepts `action=create|skip`
and up to 50 explicit row IDs/versions, returning added/skipped/unchanged counts
and unresolved reasons. Create only approves freshly validated new rows; skip
never deletes a ledger transaction. Stale rows remain unresolved. Both actions
use the existing user/row lock order and atomic transaction protections.

Apply migration `statements.0002_statementmapping` before using remembered
choices (`python manage.py migrate`). No original PDF or password is retained.

Statement/ledger comparison (`GET /api/statements/imports/{id}/comparison/`)
returns confirmed, review, statement-only and skipped component counts, plus
paginated ledger-only entries (default 50, maximum 100). Coverage uses the printed
period and selected account; transfers use that account's observations for dates
and balances. Possible matches are excluded from ledger-only results. Missing
periods, extraction discrepancies, incomplete rows and bounded-history limits
make absence provisional (`complete=false`). Comparison never posts or deletes.
Equal amount and reported balance on the same day can produce a strong suggestion;
shared claims across source rows remain ambiguous. Confirming a link saves the
masked PDF row as evidence without overwriting ledger/SMS fields or counting twice.

Statement transfer suggestions evaluate reporting-account observations separately.
Date proximity, time, reference, balance, and observation note must come from one
observation; the displayed suggestion uses that same observation. If receiving-
account evidence exists, the sender's canonical date cannot replace its date.
Without receiving evidence, the sender date is only a fallback search hint; sender
time, reference, and balance do not corroborate the receiving statement. Legacy
source-account reports can still use the canonical source fields when no account
observation exists. Confirming a suggestion preserves canonical ledger fields.

Reverse statement coverage uses read-only copies of the original extracted PDF
fields, separately from corrected-draft suggestions. Inline fee copies use the
printed signed fee's absolute amount and sign, not the principal amount. A ledger
candidate found through either view is excluded from ledger-only results. Source
rows still participate after skip/link decisions. Edited matching values, missing
original financial fields, or failed draft reconciliation make comparison
provisional and produce warnings; they never change extraction evidence or drafts.

Match confidence is statement-wide even for a single-row read, edit or decision.
The matcher checks unresolved siblings from the same saved statement and returns
only the requested suggestions. Supplied row/source copies take precedence over
persisted siblings. Shared candidates stay possible in the table and editor;
explicit individual acceptance remains allowed, with fresh one-to-one checks.
History limits apply to the statement-wide check and block unsafe decisions.

Accepted statement links are revalidated on row review, summary and comparison
reads against the current ledger amount, account perspective, currency and owned
transfer counterpart. Incompatible links remain attached for audit but show
`needs_correction`, count as unresolved/needs review, and make coverage provisional.
Unlink the evidence to review again; this preserves the ledger entry. Repeating
an old acceptance cannot acknowledge an invalid link. Notes and categories do
not change financial identity; explicitly acknowledged balance differences remain
valid evidence from separate observations.

Dashboard reporting supports inclusive `start_date` / `end_date` on
`GET /api/reports/monthly/` and `GET /api/transactions/`. Supply both instead
of `month`, with a maximum span of 366 days. Equal dates select one day; missing,
invalid, reversed or oversized ranges return field-specific 400 errors. Monthly
requests retain their existing behavior and add explicit period metadata.
Reports return BDT-only daily income/expense totals (including zero-activity days)
and expense-only `spending_categories`; own-account transfers are excluded from
income/spending but remain in account movement. Daily chart totals come from the
full server-side period, independently of transaction-list pagination.

Payment methods support `identifier_kind` (`account`, `card`, legacy `any`), up to
20 additional typed masked identifiers with optional labels, and up to 20 text
aliases. Full unmasked values are reduced to safe suffixes by API validation;
labels and numeric identifiers are separate fields. Apply the payment-method
migration with the normal `python manage.py migrate` command before deploying.
SMS endpoint matching and PDF account hints share a read-only identity resolver:
visible prefixes can distinguish otherwise identical suffixes, independent card
and account observations must agree, and shared suffixes remain ambiguous. User
and active-account/method scope always apply. PDF transfer hints require transfer
wording and preserve masked extraction. Alias changes do not reparse pending SMS,
rewrite transaction fields, alter balances, accept matches, or backfill evidence.
Future parsing and explicit re-runs can use the updated mappings.

## Date filters for transaction and statement history

Transaction list and CSV export accept `date_field=date|created_at|updated_at`
(default `date`), with either `month=YYYY-MM` or paired inclusive
`start_date`/`end_date`. Timestamp days use the API's Asia/Dhaka timezone.
Invalid fields/months, mixed month/range, reversed or incomplete ranges return
field-specific 400 errors; ranges allow at most 366 inclusive days. Ownership
filters still apply. No migration is needed.

Statement import lists accept the same period parameters with
`date_field=created_at|updated_at` (default `updated_at`), before pagination.
Detail and decision endpoints remain accessible independently of list filters.
Statement comparison accepts paired `start_date`/`end_date` to filter ledger-only
rows within the printed statement period before pagination. Its `count` refers to
filtered ledger-only rows; `counts` continues to cover the whole statement.
Filtering does not change matching scope, evidence or financial records.

Verify with `python manage.py test apps.reports apps.transactions.tests
apps.statements.test_imports`.

Schema verification note: automatic schema generation now handles an anonymous
introspection request without user-scoped queryset errors or omitted endpoints.
CI runs `manage.py spectacular --validate` and fails on schema errors. The
checked-in shared OpenAPI and generated TypeScript client remain the integration
contract; legacy schema warnings are tracked separately.

## Account recognition profiles

Account create/update accepts optional `identity` metadata: provider, masked primary
identifier and its account/card kind, up to 20 additional typed identifiers with
labels, and up to 20 text aliases. Numbers with no mask are reduced to the last four
digits before storage; numbers are not valid text aliases. A profile needs at least
one identifier or alias. Ownership comes from the account and authenticated user,
not client-supplied payment-method IDs.

`Account.identity_method` points to one shared `PaymentMethod`, so SMS and PDF
resolution and SMS-settings edits use the same values. Apply migration
`accounts.0002_account_identity_method` before deploying the API. Existing accounts
and payment methods are unchanged by this additive migration. Omitting `identity`
preserves a profile; `identity: null` disables it without deleting saved evidence.
Sending a non-null profile re-enables it. Other separately saved payment methods
remain available. Profile creation/update is atomic and account updates lock the
account row. A managed profile cannot be moved to another account through the
payment-method API. Deleting an unused account removes its managed profile; linked
ledger records still protect account deletion, with a readable 400 response and
transaction rollback.

Authenticated `POST /api/statements/identify/` accepts multipart `file` and optional
transient `password`, without requiring an account. It returns only `profile`,
masked `account_hint`, and nullable `account_suggestion`. It writes no import or
ledger data and uses the preview upload/worker limits, no-store response, and
separate 10/hour recognition throttle. Suggestions include only owned, active BDT
accounts compatible with the parser profile. Duplicate suffixes remain ambiguous.
Import still requires an explicit selected account and separate row confirmation.
Card identifiers improve SMS recognition; this does not add card-statement or OCR
parser support. Profile edits never rewrite transaction amounts or balances.

Verify with:

```sh
DATABASE_URL= .venv/bin/python manage.py test apps.accounts apps.payment_methods apps.statements apps.messages --noinput
```

Masked identifiers exposing more than ten digits also reduce to a last-four
suffix, so adding a mask character cannot preserve a nearly complete card number.

## Quick Add presets and manual entries

The `quick_add` app stores user-owned named presets shared by web and mobile.
Presets support expense/income, optional account/category/amount/merchant/note,
favorite visibility, enable/disable, and ordering. Defaults must belong to the
caller and be active; category kind must match the entry type or be system.
Missing defaults are allowed so users can choose them while recording an entry.
Inactive defaults produce `available: false` instead of silently selecting a
replacement. Preset changes never modify existing transactions.

- `GET/POST /api/quick-add/presets/` and normal detail GET/PUT/PATCH/DELETE.
- `POST /api/quick-add/presets/reorder/` takes every owned ID exactly once,
  including disabled presets. Membership changes and ordering share a user lock.
- `POST /api/quick-add/entries/` creates an ordinary audited ledger transaction.
  Account is required; category and time may be null. Expense maps to debit and
  income to credit. Source is `web` or `mobile`; amount remains a positive decimal.

A client generates one `client_request_id` per Save and retains the original
payload until acknowledged. An identical retry returns 200 and the original
transaction ID; a new Save returns 201. Reusing an ID with different values, or
retrying a transaction later deleted, returns 409. Receipts survive ledger edits
and deletion. Replay is checked before reference ownership resolution so a
later removed category cannot make a committed request appear unsaved. New
entries still require owned active references. A per-user database row lock,
unique request constraint and atomic transaction protect simultaneous retries.
Equal purchases with different request IDs remain separate entries.

Apply `quick_add.0001_initial` before deploying either client:

```bash
python manage.py migrate
python manage.py test apps.quick_add apps.transactions
python manage.py makemigrations --check --dry-run
```

Use a disposable test database. SQLite checks the request behavior; PostgreSQL
is required to exercise row-lock concurrency. Quick Add is a manual-entry
shortcut, not a recurring bill or an automatic posting rule.

## Account-bound reported balances for transfers

Transaction create/patch accepts `reported_balances`, a list of up to two
`{account, balance_after}` entries for the transfer's owned From/To accounts.
Omitted accounts preserve saved reports; explicit null clears the selected report.
Amounts stay positive. Reported balances can be negative (for example an overdraft)
and remain provider/manual observations, separate from the calculated ledger.
Responses include both account balances and `balance_reporting_account`, identifying
the owner of the primary legacy `balance_after` value.

The implementation reuses `TransferEvidence`; no migration or second ledger entry
is needed. Missing secondary manual reports get stable per-transaction/account
keys, so repeated saves cannot create duplicate observations. Primary and secondary
report edits are included in the existing transaction audit snapshots. Original SMS
bodies, PDF extraction snapshots, and captured transfer observations remain unchanged
when editing ledger dates, notes, references, or reported balances. Changed
provider reports use separate reviewed evidence, including an explicit clear;
retrying the same edit does not add another observation. Incoming non-transfer SMS
converted to a transfer retains its report on the receiving account. Restoring a
previously reclassified transfer restores its original reporting-account context.

Correcting transfer endpoints never rewrites captured SMS or PDF observations:
their original account, direction, date, balance and fee remain available as
source evidence. Captured observations outside the current From/To path, or with
the wrong direction for a current endpoint, are excluded from effective balances,
statement matching and statement coverage. A reviewed manual report may be
reassigned to the corrected endpoint; obsolete effective selections are cleared.
The unchanged account retains an applicable report, if one exists.
Reversing an SMS/PDF-backed transfer without new reviewed balances clears the
legacy scalar report rather than attributing the old account's balance to the
new From account. Older reversed entries with only obsolete captured evidence
also serialize that scalar as unknown and exclude it from statement matching.
The next edit clears that obsolete stored scalar.
Entering a reviewed balance creates current account-bound evidence and restores
the legacy scalar from that selected report.
Existing linked-correction acknowledgement, user-level locks, ownership validation,
matching and explicit posting/linking rules still apply. Legacy single-balance
clients remain supported. Transfers remain excluded from income and expense totals.

Targeted checks (from this project):

```sh
DATABASE_URL= .venv/bin/python manage.py test apps.transactions.test_account_reports apps.transactions.test_reported_balances apps.transactions.test_corrections apps.transactions.test_transfers --noinput
```

### Reported-balance conflicts when linking transfers

Transfer suggestions include `reported_balances` for both endpoint accounts.
Different accounts naturally have different balances; only two non-null,
unequal balances for the same account require a decision. Linking or merging
requires a `balance_choices` item for every disagreement, with `account`,
`keep` (`existing` or `incoming`), and the reviewed `existing_balance_after`
and `incoming_balance_after`. Missing, extra, duplicate or stale choices return
400 with a readable field error and roll back the whole operation. Unknown
incoming balances never erase known balances.

Both SMS link and posted-transfer merge paths enforce this under the existing
user transaction lock. Original SMS/PDF evidence remains available; the chosen
value becomes the effective account report. Account balance summaries use the
same effective reports as the editor and matching API. No additional ledger
movement or database migration is introduced.

### Short account/card suffixes

Recognition accepts masked identifiers or suffixes with at least three ending
digits. Keep longer saved identifiers: a three-digit SMS ending can suggest a
compatible saved four-digit or masked number without creating another mapping.
Unmasked full numbers still reduce to four digits; one/two-digit values and masks
with fewer than three ending digits are rejected.

Three-digit overlap always remains weak, including a unique match or a matching
visible prefix. Provider, identifier kind, ownership and active-account scope
limit suggestions; contradictory visible prefixes/four-digit endings do not match.
Independent longer evidence can corroborate the same account. Otherwise SMS
parsing clears inferred account/method choices, caps confidence at 60%, and returns
read-only `identity_suggestions` grouped by sender/receiver with owned account and
payment-method choices. Sender defaults and learned transfer rules cannot bypass
this review. Confirmation and transfer matching require explicit account choices
and `account_perspective: true` for weak transfer identities. Choosing an account
is still required when no saved candidate matches; suggestions never add a ledger
entry or change a saved identifier/balance.

Statement header suggestions return `account: null`, `requires_review: true` and
`choices` for weak/colliding evidence. Preview stays `account_identity: verify`,
even if the user selected a suggested account. Statement-row weak numeric hints
cannot silently select a transfer account through a learned mapping. Existing
rows/SMS bodies are unchanged. Pending SMS parsed before this release may need
**Re-run parser** if their short identifiers were previously discarded. No database
migration is needed.

Targeted checks:

```sh
DATABASE_URL= .venv/bin/python manage.py test apps.payment_methods apps.messages apps.statements apps.transactions.test_transfers apps.transactions.test_corrections --noinput
```

Numeric suffixes containing separators remain compatible with earlier saved
recognition mappings. Only ending digits after a mask count as suffix evidence;
a visible prefix never turns two ending digits into a supported suffix.

### Latest transaction action recovery

Manual/Quick Add saves, transaction edits, SMS approvals and transfer link/merge
responses include an optional `undo_action` descriptor. `GET
/api/transactions/recent-action/` returns the latest descriptor for the signed-in
user; `POST /api/transactions/undo/` accepts only `{ "action": "<action UUID>" }`.
Recovery is limited to the latest action, within 24 hours, while its transaction,
related observations, review candidates and affected learned mappings remain
unchanged. Foreign actions return 404; stale, expired or superseded actions return
409 without mutation. Retrying an already-completed undo is harmless.

Server-owned before/after deltas restore account-bound balances and edit fields.
SMS undo reopens review and rolls back affected learned choices; link undo removes
only the new observation; merge undo restores both original entries and statement
links. Statement row versions increase on restoration. Raw SMS text is never
copied into recovery snapshots or restored after redaction. New evidence also
blocks undo, even when the parent timestamp did not change. Payment and receipt
relations are fingerprinted too, so Undo cannot unlink newer financial activity. Recovery writes use
the existing user lock plus row locks and one atomic database transaction, with
an audit entry. Superseded recovery payloads are cleared; action metadata remains.
Quick Add receipts remain after undo, preventing a retry/resync from recreating
an undone entry. Full-form requests use a stable key and non-transfer retries are
idempotent as well. Deletion and bulk statement posting are not undoable here.

Deploy migration `transactions.0007_transaction_action_recovery` before the new
clients (`python manage.py migrate`). Undo does not accept client snapshots.

### Ledger comparison at the latest report

Account responses add read-only `ledger_balance_at_latest_report`,
`latest_reported_balance_difference`, and `reported_balance_comparison`. The
difference is the provider-reported balance minus the ledger at the report's
cutoff, rounded to cents using Decimal. Transactions after that cutoff do not
create false differences. Linked transfer evidence uses the reporting account's
observation time and the effective retained report; the ledger movement still
counts once for each endpoint. The existing current ledger balance is unchanged.

Comparison values are null when no report exists, a credit-card balance may
represent available credit, a report precedes its linked movement, or same-day
ordering is ambiguous (missing/equal times). A date-only report is comparable
when it has a single movement that day. Reasons are `unavailable`, `matched`,
`mismatch`, `credit_card_reference`, `timing_unknown`, and
`report_precedes_movement`. Differences are review hints, never automatic balance
adjustments. Opening-balance and earlier transaction edits recompute the result.
All accounts are processed in the existing batched summary, with no per-account
query additions. No model migration is required.

## Reviewed statement detail enrichment

Possible matches expose `detail_suggestions` for merchant/counterparty, reference,
note, and masked sender/receiver account/card identifiers. “Fill missing details
from statement” selects only empty fields with a nonempty suggestion. Existing
values stay untouched unless the user explicitly selects a replacement; proposed
values can be edited before accepting the match. No field is selected by default.
Selections apply atomically with linking via `StatementDecision.detail_choices`,
which includes each field's exact reviewed `existing_value` and desired `value`.
Changed ledger values return 409 without partial updates; unsupported financial
fields and duplicate selections are rejected. Identifier edits are masked before
transmission and again before persistence. Choices and before/after values are
audited. Unlinking or rescanning confirmed SMS does not undo these corrections.

New statement drafts strip anchored labels such as “CARD PURCHASE” and “PURCHASE
CARD” from the merchant field while retaining the original masked description.
Merchant case/punctuation and manually saved draft corrections are preserved.
References and explicitly labelled identifier metadata are excluded from merchant
suggestions. The statement header identifies only the reporting account; transfer
counterpart identifiers need explicit sender/receiver evidence. Ambiguous values
remain empty. Payment methods, accounts, classifications, amount, date and time
are not changed by this metadata shortcut. Deploy web and API together.

Suggestions are computed for existing pending rows at review time from their saved
masked extraction and draft fields; no re-import is needed. Read requests do not
mutate them. Rows already resolved are not rewritten.

Run `python manage.py migrate` before restarting the API. Migration
`statements.0003_reapply_pending_merchants` updates only still-pending statement
drafts whose Counterparty exactly equals their saved extracted description. It
removes a recognized card-purchase prefix from that draft field and increments the
row version so an open stale editor must reload. Manually corrected, skipped,
linked, and added rows are left alone. The extracted description, note, balances,
matches, and ledger transactions are not changed; existing PDFs need no re-upload.

### Combined pending SMS and statement review

`review.pending_sms_matches` on a statement row detail response suggests still
pending SMS observations for the same account perspective, type, amount and date
window. `POST /api/statements/rows/{id}/decide/` with `action=combine_sms`, row
`version`, and `candidate` confirms one SMS and links that row atomically. Row
lists show a batched `pending_sms_match_count`, so pending pairs appear in the
possible-match filter. A null count means the bounded list check was inconclusive,
not that there are zero matches. If the detail check is also inconclusive,
individual and bulk statement posting stay blocked until the SMS queue is
narrowed or reviewed; `allow_separate` cannot bypass an unchecked match. A conflicting
reported balance requires an exact-value `balance_choice`. If ledger suggestions exist, the request must acknowledge
their exact current IDs as different movements; stale suggestions return 409.
The SMS source and date/time are kept. Independent review routes remain supported.
That earlier combine decision uses existing tables; the unified transfer-balance
selection described below requires the new transactions migration.

### Unified matched-pair review

Authenticated, private/no-store `/api/review/pending/` returns one queue item for
each unique one-to-one pending SMS and statement match, with account/date/search
filters and stable cursor pagination; `condition` optionally selects `strong`,
`possible`, `balance_differs`, `type_differs`, or `needs_correction` before
pagination. The overview still counts all pairs and unmatched sources in the
selected account/date scope, before search and condition filtering. Legacy offset remains accepted for clients
that have not migrated. The response also reports matched, ambiguous,
statement-only and SMS-only source counts for the selected account/date scope.
Matching first requires reporting-account perspective, amount, currency, direction
and a date within three days. It then requires an independent corroborator:
matching reference, reported balance, normalized counterparty, or a known transfer
counterpart account. Amount and date alone never produce a unified-review pair.
For matching only, reported balances less than BDT 1 apart count as corroborating
evidence. Their original values remain distinct: the pair stays a possible match
with a balance conflict, and confirmation still requires an explicit balance choice.
Conflicting nonempty references are rejected, and differing counterparty wording
is exposed as negative evidence rather than presented as a strong match. Exact
counterparty wording by itself produces a possible match; a strong label requires
same-day reference, exact reported-balance, or known counterpart-account evidence.
Unmatched sources and overlapping one-to-many candidates are excluded from this
queue and remain in their individual review workflows. Balance conflicts can still
form a unique review pair. The read-only
`GET /api/review/pair/?statement=<uuid>&sms=<uuid>` returns original sources,
statement draft validation and current ledger suggestions.
Date filters narrow the source query before its safety cap; source-only views
query counterpart candidates by relevant amount and date. Pair detail checks
the selected pair's nearby competitors without loading the full backlog. Broad
unfiltered queues are still capped at 2,000 sources per side; use account or date
filters when that limit is reached. `GET /api/messages/review/{id}/` reads one
owned pending candidate directly, so links to older SMS do not depend on the
first paginated inbox page.

`POST /api/review/pair/` requires both IDs, statement version, SMS `updated_at`,
explicit same-movement confirmation, balance source and applicable acknowledgments.
It optionally accepts a full edited statement `draft` with the same version and a
`type_choice` (`statement`, `sms`, or `custom`). When the two parsed types differ,
the type choice is required and must agree with the edited type. The server
validates ownership, financial values and transfer account path, then saves the
draft and confirms the pair in one database transaction. Date, direction and
amount corrections must still support a unique match; metadata and balance
corrections retain the original evidence that established the pair.
An edited draft requires explicit source-review acknowledgment. A BDT
statement/SMS balance difference strictly below Tk 1 still requires the user
to choose which report the ledger uses, but does not require a second conflict
acknowledgment. Differences of Tk 1 or more and non-BDT differences retain the
acknowledgment requirement. Both original reports remain exact.
It serializes writers through the shared user lock, locks both sources, rechecks
pending state and matches, and reuses statement posting/link validation. Any failure
rolls back the new ledger entry and both source decisions. Completed-pair retries
are idempotent; changed ledger financial identity is rejected. Existing suggestions
must be linked rather than bypassed with another entry in this workflow.
The detail and confirmation endpoints repeat the reciprocal one-to-one check, so a
stale or hand-crafted pair URL cannot bypass ambiguity protection.
Reciprocal uniqueness is calculated across the complete pending account scope
before the display date range is applied, so filtering cannot hide a competing
source and make an ambiguous relationship appear confirmable.

A new pair uses the reviewed draft classification/date/time, the selected scalar
balance, masked SMS identifiers and one raw-message link. A source with no reported
balance cannot replace the other source's available report. Transfer evidence
marks the reviewed effective report per account without overwriting either
original observation; linking an existing transfer keeps its effective report.
An incoming transfer keeps reports on the receiving account through separate
transfer observations. Candidate
and statement relations retain their distinct dates/times/balances; the original
PDF extraction remains immutable. Source-message retrieval includes all attached
confirmed candidates, preserving additional SMS sources on existing entries. SMS
raw-text retention is honored. Unified review does not learn SMS mappings implicitly,
and never runs a data backfill. Apply `transactions.0008_transferevidence_effective_balance`
before deploying the updated API.
