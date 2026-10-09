# Backend API Q&A

## What is the backend responsible for?

The backend owns authentication, user-scoped data, accounts, categories,
transactions, reports, SMS ingestion, parsing rules, debt records,
reconciliation, audit logs, and API contracts. It is the source of truth for
all financial data.

## Why Django REST Framework?

Django REST Framework fits the project because it works naturally with Django
models, serializers, permissions, routers, authentication, and OpenAPI tooling.
It is a practical choice for CRUD-heavy financial workflows.

## Why use JWT authentication?

JWT works well for separate web and mobile clients. The API provides login and
refresh endpoints, and clients send the access token with protected requests.
This avoids coupling the clients to browser-only session behavior.

Access tokens last 15 minutes. Refresh tokens use a rolling 30-day lifetime,
rotate on use, and blacklist the previous token. Each login has its own refresh
token, so users can stay signed in on multiple devices and revoke one session
without ending the others. See `docs/auth-token-storage-plan.md`.

## What auth endpoints exist?

Current auth endpoints:

```txt
POST /api/auth/login/
POST /api/auth/refresh/
POST /api/auth/logout/
POST /api/auth/logout-all/
GET  /api/auth/me/
```

Login is throttled by source IP and normalized username. Single-session logout
blacklists the supplied refresh token; authenticated logout-all blacklists all
outstanding refresh tokens for that user. Short-lived access tokens may remain
valid until their normal expiry.

## Why use Django's default user model right now?

The first version is personal-use focused. Django's default user model is enough
for the current scope and avoids premature migration complexity. If product
needs require richer user profiles later, the project can add profile models or
move carefully to a custom user model before production.

## How do you protect user data?

Every finance queryset is scoped by `request.user`. The API uses authenticated
permissions on finance endpoints, and serializers validate that related objects
like accounts and categories belong to the current user.

Sender rule creation is also user-scoped. The serializer rejects duplicate
case-insensitive sender plus match-type combinations, which prevents mobile and
web clients from accidentally creating overlapping exact rules for the same
inbox sender.

## Why do new users receive default categories?

A blank category list makes both manual entry and SMS review unnecessarily hard,
so every newly created user receives a small, editable starter taxonomy covering
common expenses, income, transfers, and debt. The categories are ordinary
user-owned records: users can rename, deactivate, delete, or extend them. The
creation helper is idempotent, and saving an existing user does not recreate a
category they intentionally removed. The data migration backfills only existing
users with zero categories, avoiding changes to users who already customized
their taxonomy.

## What are the core backend apps?

Implemented:

- `health`
- `users`
- `accounts`
- `categories`
- `payment_methods`
- `messages` for sender rule management
- `transactions`
- `reports`
- `debts`
- `reconciliation`
- `audit_logs`

## Why separate apps by domain?

Separate apps keep ownership clear. Accounts, categories, transactions, reports,
messages, debts, reconciliation, and audit logs each have different rules and
can grow without one large tangled module.

## Why use UUID primary keys for finance models?

UUIDs are safer for client-facing APIs because they are harder to enumerate than
sequential IDs. They also work well if mobile offline sync or distributed data
creation is added later.

## How are transactions modeled?

A transaction has a positive amount, date, optional local time, type, account, optional transfer
account, optional category, source, note, and review flag. The type determines
whether it is income, expense, transfer, lend, borrow, refund, fee, or repayment.
The transaction row also stores ledger direction, so the primary account can be
shown as debit or credit without clients guessing from display signs.

## Why not use double-entry accounting immediately?

Double-entry accounting is more rigorous, but it adds complexity. For the first
personal version, a simpler transaction model is faster to build and easier to
use. The current design still leaves room to evolve toward transaction lines
later if needed.

## How are transfers handled?

A transfer uses a source account and a destination `transfer_account`. The API
validates that transfer transactions include a destination account and that
non-transfer transactions do not.

## What finance evidence is kept after SMS confirmation?

Confirmed transactions copy normalized evidence into the ledger row:
debit/credit direction, provider reference or TrxID, balance after,
counterparty text, payment method, raw message id, and an external duplicate
key. The transaction note is a safe summary rather than a copy of the full SMS.
SMS confirmation defaults the transaction time to the timezone-localized mobile
message receipt time, while clients may correct it before confirmation.
The original text follows the user's retention choice: redact immediately,
retain for 7 or 30 days, or keep until manual redaction. Reports and exports use
the structured fields and never need to reparse the SMS body.

## How does the API represent an account's current balance?

It deliberately exposes two different concepts. `ledger_balance` is read-only
and is derived from the account's starting balance plus all posted transactions,
including both sides of transfers and debit/credit adjustments.
`latest_reported_balance` and `latest_reported_balance_date` come from the most
recent transaction or linked transfer observation that carried a
provider-reported `balance_after` value for that account.
Keeping the reported value as transaction evidence avoids a mutable account
balance becoming stale after a backdated create, edit, delete, or offline sync.
Reconciliation snapshots remain the explicit actual-balance check.

## How are transaction changes audited?

Transaction creates, updates, and deletes write user-scoped audit entries. Each
entry records the action, entity type, entity id, normalized before snapshot,
normalized after snapshot, metadata, and creation timestamp. The API exposes the
audit trail as read-only data, filterable by `action`, `entity_type`, and
`entity_id`.

## How are monthly reports calculated?

The monthly report endpoint filters transactions by user and month, then
summarizes income, expenses, category totals, and account money-in/money-out
values.

## Why is report logic in the backend?

Reports must match across web and mobile. Backend-owned reports reduce duplicate
logic and make financial behavior easier to test.

## What endpoints are currently implemented?

Current backend surface:

```txt
GET    /api/health/
POST   /api/auth/login/
POST   /api/auth/refresh/
POST   /api/auth/logout/
POST   /api/auth/logout-all/
GET    /api/auth/me/
GET    /api/accounts/
POST   /api/accounts/
GET    /api/categories/
POST   /api/categories/
GET    /api/payment-methods/
POST   /api/payment-methods/
GET    /api/messages/sender-rules/
POST   /api/messages/sender-rules/
POST   /api/messages/import/
POST   /api/messages/dev/reset/  # DEBUG only
GET    /api/messages/review/
POST   /api/messages/review/reprocess/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/ignore/
GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/export/?month=YYYY-MM
GET    /api/debts/
POST   /api/debts/
POST   /api/debts/{id}/payments/
GET    /api/credit-card-bills/
POST   /api/credit-card-bills/
POST   /api/credit-card-bills/{id}/payments/
GET    /api/recurring-bills/
POST   /api/recurring-bills/
POST   /api/recurring-bills/{id}/payments/
GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/accounts/{account_id}/
GET    /api/audit-logs/
GET    /api/audit-logs/{id}/
```

The DRF routers also provide detail, update, and delete endpoints for accounts,
categories, payment methods, sender rules, transactions, debts, credit card
bills, recurring bills, and balance snapshots.

The settings module also validates production-critical configuration when
`DJANGO_DEBUG=false`, refusing local-dev secrets, SQLite, localhost-only hosts,
localhost CORS origins, and missing or non-HTTPS CSRF trusted origins. It trusts
the proxy's forwarded HTTPS scheme and uses secure session and CSRF cookies in
production; Render's external service URL is included automatically.
JWT refresh tokens rotate on use and old refresh tokens are blacklisted after
rotation, which makes refresh-token reuse fail instead of silently extending a
stolen token.

Transaction list and CSV export endpoints support the same user-scoped filters:
month, account, category, type, debit/credit direction, source, and `search`
across reference, counterparty text, note, and external duplicate key. Source
filtering separates web, mobile, SMS, import, and system-generated ledger rows.

## How do you validate cross-user object access?

Serializers check that selected accounts, transfer accounts, categories, and
parent categories belong to the current authenticated user.

## How would you add payment methods?

The `payment_methods` app now stores user-scoped methods with a provider,
identifier, linked account, active status, and display order. Sender rules and
future SMS parsers can reference payment methods to map messages to accounts.

## How would you add SMS parsing?

Raw message import stores the sender, body, received time, optional device
message ID, and a deterministic body hash. The backend creates a parsed message
candidate with matched sender rule metadata, amount extraction, confidence, and
parser notes. Candidates can be reviewed, confirmed into an SMS-sourced
transaction, or rejected with a structured reason.

Before a raw body is saved, the import endpoint resolves its trusted sender
rule, provider, and supported non-transaction kind. Per-user capture preferences
can exclude providers, OTP/security messages, or balance notices. An excluded
message creates only an ignored deduplication tombstone containing its hash and
metadata; no candidate or original body is stored. OTP/security is excluded by
default. A trusted-sender message containing no digits is also automatically
discarded through the same tombstone path with `no_numeric_content` as its
exclusion reason, so non-transactional notices do not clutter the review inbox.
Reprocessing applies the same rule to older pending candidates and removes them
from review while replacing the previously retained body with the tombstone.

Duplicate imports can opt into `reprocess_existing`. The backend then updates
the existing candidate with current sender rules and parser logic only while it
still needs review. Confirmed and ignored candidates are returned unchanged, so
a history rescan cannot silently rewrite ledger decisions. A development-only
reset can clear one authenticated user's SMS imports and SMS-created test
transactions, but the endpoint returns `404` whenever `DJANGO_DEBUG=false`.

Phase 3 now has transfer-aware candidate fields, an initial bKash parser,
starter EBL/City Bank parsing for purchases, ATM withdrawals, card payments,
fees, refunds, and reversals, starter bank transfer source/destination hinting for EBL
bank-to-wallet and City Bank own-account transfer messages, and starter Pathao
Pay parsing for top-up, payment, send-money, and withdraw confirmations. The
parsers detect message kind, amount, reference, balance, fee,
merchant/counterparty text, and possible internal transfers for cash-in/cash-out
and bank/card transfer-style messages. Counterparty extraction strips common
confirmation noise such as trailing `successful`, and bKash payment parser
notes surface detected till/counter and provider timestamp text when present.
bKash
transfer-like messages also try to match masked account or wallet identifiers
against the user's configured payment methods so known source/destination
accounts can be prefilled. Bank account transfer messages now use the same
known payment-method hints when an anonymized account or wallet identifier is
present in the message. Candidates and confirmed transactions preserve four
separate masked evidence fields for sender/receiver account and card
identifiers. Parser matching compares those values with the safe masked suffix
stored on payment methods, so a label such as “My EBL card” can override a
coarse sender-rule account without storing a full PAN. Parser, review,
payment-method, and transaction API inputs reduce an unmasked identifier to its
last four digits before persistence. Taka amounts accept both `Tk 1,000` and the common
`Tk. 1,000` spelling used by City Bank messages. City Bank deposit parsing
also distinguishes a date year from the following transaction amount and
supports balances written after the value, such as `Tk. 2,33,319 Balance`.
Balance extraction gives explicit `Balance BDT ...` or `... Balance` labels
priority and excludes masked account/card suffixes, preventing `A/C 123**4567`
from becoming a balance of `159`.

For internal transfers, the backend now links possible related candidates when
two review items belong to the same user, have the same amount, close received
timestamps, and different providers. That legacy link remains a parser hint.
The transfer matching endpoint also considers same-provider messages, account
ownership, known source/destination, opposite account observations, and dates
within three days. It includes existing posted/manual transfers and requires
explicit user acceptance before linking or merging.

## How would you prevent duplicate SMS transactions?

The raw import endpoint checks duplicates by device message ID when available
and by a deterministic hash of sender, body, and received time. Duplicate
checks happen before parsing or transaction creation. On confirmation, the API
also creates a transaction `external_key` from provider/reference data when
available, or from the raw message id as a fallback, and rejects another
transaction with the same key.

## How do you handle raw SMS privacy after parsing?

The backend now exposes a raw SMS redaction endpoint. It replaces the raw body
with `[redacted]`, clears the device message id, marks the raw message as
`redacted`, and records `redacted_at`. Parsed candidate fields, transaction
reference, balance, counterparty, amount, raw message link, and duplicate hash
remain, so reports and duplicate checks still work without keeping the original
SMS text. New confirmation notes contain only normalized message kind and
counterparty data, so removing the original body does not change ledger notes.

Each user can choose raw-text retention of zero, 7, or 30 days, or no automatic
expiry. Zero redacts immediately at confirmation; the scheduled
`redact_expired_sms` command removes expired bodies for the other finite values.

The capture policy also prevents selected content from being retained at all.
During review, rejection records a reason and can atomically redact the raw SMS,
deactivate the matched sender rule, or add the candidate provider to the user's
excluded-provider list. The legacy ignore route remains compatible but now
records `not_transaction` as its default rejection reason.

## How does review correction improve future imports?

When the reviewer enables “use choices next time,” confirmation stores the
corrected account, payment method, category, and transaction type for the
matched sender rule *and detected message kind*. A bank can therefore remember
different choices for purchases, transfers, fees, and refunds. The choice is
also applied immediately to matching pending candidates; future messages of the
same kind start with those defaults, while amount, balance, date, reference,
identifiers, and counterparty still come from each message. The learning is
explicit and user-controlled rather than automatic. Transfers with a counterparty
use the more specific reporting-account/counterparty path described below.

## How is mobile SMS sync health represented?

The mobile app posts a user-scoped heartbeat containing permission, background
sync state, queue counts, errors, last scan, and last successful sync. The API
derives a small health state such as `healthy`, `offline`, `error`, or
`permission_required`. Web clients use that endpoint instead of inferring
mobile health from candidate timestamps.

## Why do internal transfers need special handling?

Bank-to-bKash, bKash-to-bank, card bill payments, and transfers between the
user's own accounts are not expenses or income. If the parser only extracts an
amount and direction from one SMS, it can create misleading reports. Internal
transfer candidates preserve source/destination hints and possible related SMS
links so the review flow can confirm the movement without double-counting it.

## Can you run the API locally against hosted PostgreSQL?

Yes. Point `DATABASE_URL` in `projects/finance-api/.env` at the provider's
external hostname. Local Docker Postgres stays on `localhost`. Hosted hosts
outside `localhost`/`127.0.0.1`/`postgres` use SSL by default. Create a
superuser on that database with `python manage.py createsuperuser` after
migrate.

## How would you handle migrations safely?

Use small migrations, avoid destructive schema changes, backfill data with data
migrations when needed, and keep API compatibility during frontend/mobile
rollouts.

## How would you test this backend?

I would test serializers, permissions, model constraints, API endpoints,
monthly report calculations, SMS parser cases, duplicate detection, and
reconciliation math. Export endpoints should be tested for user scoping,
filters, CSV headers, and ledger evidence fields. Audit endpoints should be
tested for user scoping, read-only behavior, filters, and before/after
snapshots on transaction mutations.

## What is a limitation of the current backend?

It has the first manual finance loop, SMS import/review, debt records, and
reconciliation endpoints, but the provider parsers are still early. It still
needs real anonymized SMS fixture coverage, deeper provider-specific bank
transfer variants, production deployment execution, and UI polish around debt
and reconciliation workflows. Audit logging currently covers transaction
mutations first; other finance domains can be added as the product hardens.

## How does the API prevent an untrusted sender from being uploaded?

`POST /api/messages/import/` performs its own active sender-rule lookup before
storing a raw body. A mobile toggle is therefore only a device-side preference,
not the security boundary. An unmatched or inactive sender receives `400` and
no `RawMessage` row is created. Exact, contains, and regex behavior is shared
with mobile; invalid regex rules are rejected during rule validation, and a
case-insensitive database constraint prevents duplicate sender/match-type rules
for one user.

## How can a stored review candidate use newer parser logic?

A pending, non-redacted candidate can be reprocessed explicitly from its review
endpoint. Reprocessing never rewrites confirmed ledger decisions or a message
whose source text has already been redacted.

The bulk review reprocess endpoint applies current parser logic and learned
mappings to every pending, non-redacted candidate for the authenticated user.
It returns requested/reprocessed/remaining counts. It deliberately leaves
confirmed transactions untouched so a rule change cannot silently rewrite the
ledger; changed candidates return to the normal confirmation workflow.

## How are transfer evidence and concurrent confirmation handled?

`TransferEvidence` records an account's debit/credit observation, reference,
reported balance, provider, fee evidence, date/time, and optional raw SMS link.
It contributes no ledger amount. Multiple candidates can point to one canonical
transfer. Reported balances use each evidence record's account, fixing incoming
SMS attribution to the source account. Explicit merging moves evidence and
candidate links to the retained transfer and audits removal of the duplicate.

Atomic confirmation/link/create/update/delete operations lock the user row so
concurrent web and mobile requests cannot both create a transfer while accepting
the same match. Raw SMS evidence links and nonblank observation keys have database
uniqueness constraints. SMS observation identity follows the raw capture,
so distinct same-bank debit/credit messages can share a reference. Manual transfer
retry keys make retrying one submitted draft safe. Linked transfers with multiple
observations require explicit correction acknowledgement to change their
principal/accounts/type; those corrections without it return 400.

Matching uses exact principal amounts; fee differences are not silently merged.
Fees are preserved as evidence and require a separate fee ledger entry. A
missing SMS does not imply unsettled funds. The current canonical transfer still
applies both balance effects on one posting date; actual delayed settlement
needs a future posting/in-transit model.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.

## How does SMS review interpret a credit on the selected account?

Updated clients submit `account_perspective: true`, account, direction, and the
other transfer account. Credit means the selected account received money, so
the other account becomes the canonical source; Debit means the selected
account sent money. The same normalization runs before matching, linking, and
standalone confirmation. Explicit direction overrides the detected message
kind for evidence attribution. A payment method must belong to the selected
account; a receiving method is not assigned to the canonical source. Legacy
callers without the flag keep source/destination semantics.

Learned canonical source mappings do not overwrite a receiving account identified
from masked SMS evidence. Remembering a credit review also preserves the receiver
on one-sided pending candidates instead of copying the canonical source there.

## How does SMS review suggest the other transfer account?

Saved endpoint identifiers take precedence over remembered paths, unique
confirmed history, and account/payment-method names or known provider aliases.
Aliases such as PathaoPay/Pathao Pay can resolve a wallet without a numeric
identifier. Each match stays user-scoped and excludes inactive accounts.
Ambiguous name/provider matches or conflicting history require manual choice.

An explicitly remembered transfer path is keyed by sender rule, detected
message kind, reporting account, and normalized counterparty. It retains the
chosen account-relative direction, other account, and category. Both ordinary
confirmation and linking to an existing transfer can remember it and update
matching pending candidates without overriding explicit endpoint evidence.
Transfer paths with a counterparty do not overwrite broad sender mappings.

Older confirmed candidates can offer suggestions without silently creating
remembered rules; lookup is bounded to 200 recent matching reporting-account
candidates. No amount-only inference, automatic posting, or automatic merging
occurs. Conflicting history stays unresolved. Existing broad mappings are not
backfilled into transfer paths because they did not retain the other account.

## How do recently added and updated transaction ordering differ?

The authenticated transaction list whitelists `ordering=-date` (default),
`ordering=-created_at` and `ordering=-updated_at`. Creation and update order are
independent of the financial date; filtered querysets still enforce user
ownership and use ID tie-breakers. Month
filters financial date, not added time. Edits and linked transfer evidence do
not update creation time. Latest saved changes include new records, edits,
newly linked transfer evidence and merges; reads and idempotent retries leave
the update timestamp unchanged. No evidence-history backfill is performed.
Invalid ordering returns 400; CSV stays chronological.

## How are bank advertisements kept out of the ledger?

A conservative English/Bangla classifier identifies promotional offers before
transaction parsing. Anniversary digits are not transaction evidence. Financial
activity and card/amount evidence prevent promotional skipping; OTP and balance
notices keep their own types. Promotional capture is off by default, including
existing users after migration, and excluded bodies are replaced before storage.
Reprocessing applies the current type policy only to pending candidates.
Remembered rejection can exclude promotional, OTP/security or balance-notice
types and clean matching pending items without disabling the bank sender.
Unknown and financial types cannot be broadly learned as skips.

## How can the editor safely read a transaction's original SMS?

A read-only transaction detail action returns only source messages linked to an
owned ledger entry, including transfer evidence. Messages are individually
checked for user ownership and deduplicated. The minimal response excludes
device IDs and body hashes; redacted or excluded text is null. Missing SMS
returns an empty list, foreign transactions return 404, and authentication is
required. Private/no-store responses and on-demand access keep bodies out of
the ledger list. Reading leaves timestamps, audit history and retention unchanged.

## How can users correct a matched transfer without losing evidence?

PATCH accepts write-only `allow_linked_correction=true` after the user reviews
the linked messages. Multiple-observation entries need that acknowledgement for
changes to type/accounts/principal. Ordinary detail edits remain available;
ownership and validity checks are never bypassed. One audited ledger update
changes balances once, with before/after evidence snapshots and acknowledgement
metadata. Canonical transfers store From/To accounts and debit direction.

Remapping an observation clears its previous reported balance and fee. Editing
primary metadata updates only that observation, including manual observations
without a raw-message ID. Reclassification retains the original SMS links and
retry keys as historical provenance, while balance summaries only consume
transfer evidence for entries whose current type is transfer. This avoids both
lost history and stale balances attributed to unrelated accounts.

## Why can references repeat without allowing repeated SMS confirmation?

Reference is editable evidence, not event identity. New confirmation and transfer
observation keys use the raw-message ID. The importer deduplicates sender/body/
received-time hashes; ledger checks inspect both raw links and retry keys,
including legacy transactions still carrying provider/reference keys. Reference
edits cannot let one capture produce another transaction. Distinct captures may
legitimately share a reference, including on the same account and day.

Transfer suggestions/linking compare accounts, equal currency and amount, and a
three-day date window; times are exposed for review. Matching primary or linked
references strengthen the explanation but neither create nor merge a movement
automatically. Manual draft retry keys retain their existing semantics. No
migration or rewriting of old transaction keys is needed.

## Does SMS confirmation respect fields cleared during reclassification?

Yes. Omitted destination/payment-method fields retain parser defaults; explicit
`null` clears them. Changing a reviewed transfer to income/expense can therefore
remove its destination instead of the API restoring it. A transfer without another
account is still rejected, and source SMS remains attached as audit evidence.

## How can the editor identify a transfer's original balance report?

Transfer evidence exposes read-only `is_primary`. It shares the same original
SMS/manual-entry-key selection used by transaction updates, so displaying a balance
and saving its correction target the same observation. Prefetching avoids additional
queries. This is response metadata and requires no migration.

## Does changing a transaction type erase its reported balance?

No. A reported balance belongs to its reporting account, independently of the
ledger type. PATCH preserves omitted or unchanged values, including zero, when
that account stays the same. Transfers use their primary observation's account;
changing only the opposite side preserves that report. A same-account transfer
reclassification can retain the primary observation's balance even when the main
transaction field was empty, while other linked reports remain historical.
Explicit null clears the report and later updates do not restore it.

When the reporting account changes, an omitted or unchanged carried balance is
cleared; an explicitly different replacement is accepted. SMS approval and draft
transfer matching/linking follow the same rule for parsed balances. This prevents
both classification-driven loss and attribution to an unrelated account. Ledger
balances still recalculate using type, amount and accounts, independently of the
provider's reported balance. No schema or migration change is needed.

## How do statement imports protect ledger correctness?

Bounded authenticated extraction runs outside database locks. Saved imports are
unique per user/account/file digest. Immutable masked source rows and editable
versioned drafts are separate. Decisions acquire the same user lock as ledger
writers, then lock the row and target. Stable row retry keys prevent duplicate
posting; identical completed retries return the same transaction. Bulk decisions
refresh matches and skip stale/ambiguous rows, rolling back unexpected failures.

Matching uses equal currency/amount/direction and account perspective, with
posting/value dates within three days. References/balances corroborate. Previously
linked source fingerprints surface corrected ledger entries outside that window,
but are not unique identities. Links preserve existing ledger/SMS details.
Separate source rows within one batch cannot share a transaction. Transfer merges
retain statement observations or reject a same-batch collision. Unlink keeps the
ledger record; deletion returns evidence to review. Financial ledger corrections
require acknowledgement and preserve original extraction. Source discrepancies
require review, and principal/fee components are independently posted.

The preview endpoint remains stateless. Saved imports require migration
`statements.0001_initial`. PDFs/passwords are discarded; masked extraction and
audit history remain. Synthetic fixtures and PostgreSQL concurrency tests cover
same-file retries, overlaps, corrected values, repeats, fees and transfer merges.

### How does statement review learn and validate corrections?

An explicitly accepted create/link can remember type/category/other-owned-account
choices scoped by user, reporting account, provider, source direction, component
and normalized merchant pattern. Later rows receive a suggestion, never an automatic
financial edit. Generic transfers and inactive mappings are excluded. Independent
draft checks recompute balances and net movement without rewriting source extraction
checks; discrepancies block bulk creation and need individual acknowledgement.
Match strength uses merchant/time/reference/balance corroboration; ties remain possible.
Selected create/skip actions preserve locks, version checks, ownership and atomicity.

### How do statement imports identify ledger-only entries?

A read-only comparison scopes ledger history to the authenticated owner, selected
account and printed statement period. Account-specific transfer observations define
coverage and balance. Confirmed links and pending suggestions are excluded from
ledger-only results. Missing/incomplete extraction or matching limits are reported
as provisional coverage; comparison never deletes or posts transactions.

Skipping a PDF row is a posting decision, not evidence of absence: skipped source
rows still participate in reverse coverage, so their ledger candidates are not
incorrectly labelled ledger-only.

### How do statement matches avoid mixing transfer observations?

Each reporting-account observation is scored independently. Its date/time,
reference and balance stay together, and the best eligible observation supplies
the displayed suggestion. A nearby sender date cannot corroborate a receiving
balance observed much later. Without receiving-account evidence, sender date is
only a search hint; sender time/reference/balance do not supply corroboration.
Linking requires explicit confirmation and preserves the existing ledger fields.

### Can correcting a PDF draft falsely make a printed transaction ledger-only?

Original extracted rows and corrected drafts are matched independently for reverse
coverage. Candidates found through either view are excluded from ledger-only
results. Original inline fee amounts are reconstructed from signed fees; draft
transfer classification/path changes do not erase source coverage. Financial
corrections, missing original fields and failed draft reconciliation make absence
provisional and show warnings. Comparison writes neither ledger nor draft evidence.

### Why does opening one statement row no longer strengthen a shared match?

All matcher calls include unresolved siblings from that same saved statement.
The list, detail response, edited-draft response and explicit decision therefore
use the same ambiguity rules. Only requested suggestions are returned. After a
competing row is skipped or corrected, fresh results can become strong. Explicit
individual acceptance is still allowed, and the existing one-to-one constraint
prevents another row from linking the same movement.

### What happens when a ledger edit invalidates accepted PDF evidence?

Row review, comparison and reconciliation summary revalidate financial identity.
Amount, direction, currency and account-path mismatches show correction issues,
count as unresolved and make comparison provisional. Historical fingerprints do
not hide financially incompatible ledger entries. Reads never remove evidence;
explicit unlink preserves the ledger transaction and returns the row to review.
Idempotent acceptance rejects a stale financial link instead of confirming it.

### How are daily and custom dashboard periods calculated?

Reports and transaction lists share inclusive date-range validation. Both dates
are required, month cannot be combined with a range, and the maximum span is
366 days. Reports aggregate the user's BDT ledger for the whole selected period,
return daily totals including zero days, and exclude owned transfers from income
and spending. The full daily series does not depend on list pagination.

### How do aliases improve matching without changing ledger values?

Payment methods carry typed numeric identifiers and separate text aliases. One
resolver provides user-scoped, active account/method hints for SMS and statements.
Prefixes can disambiguate suffixes, but independent account/card evidence must
agree. Collision cases return ambiguity. PDF transfer suggestions require transfer
wording; arbitrary references and amounts are not identity evidence. Saving these
metadata fields never writes transactions, balances, source evidence or accepted
links. Updated mappings apply to future parsing and explicit parser re-runs.
