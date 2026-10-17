# Backend API Q&A

### How are exact statement, SMS, and account/card sources retained?

The statement importer encrypts exact PDF bytes, keeps masked review rows, and
serves the PDF only to its owner through a no-store endpoint. A same-file,
same-account retry can attach the PDF to a legacy import. The unlock password is
not retained. Transaction SMS remains in `RawMessage.body` encrypted by default;
OTP/security and promotions are excluded. A history rescan restores a redacted
body only for the same hash and a Keep preference. Retention-policy redaction can
restore automatically on refresh; manual and older unknown redactions require the
explicit restore option. Full account/card identifiers
entered after this change are encrypted in the payment-method record; normal
responses remain masked. Legacy digits already discarded require source re-entry.
If an incoming SMS or statement actually contains the complete account/card
number, the resolver can compare it with encrypted saved originals to
disambiguate equal suffixes. A masked source still provides only suffix evidence.

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
- `quick_add` for shared presets and retry receipts
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

**Why are server-side cursors disabled with pooled PostgreSQL?** Django's
`QuerySet.iterator()` streams through a cursor tied to a server connection.
Transaction pooling may assign the next fetch to another connection, raising
`InvalidCursorName`. Neon `-pooler` hosts disable these cursors automatically;
other poolers use `DJANGO_DB_DISABLE_SERVER_SIDE_CURSORS=true`. Direct database
connections keep streaming cursors.

Transaction list and CSV export endpoints support the same user-scoped filters:
month, account, category, type, debit/credit direction, source, and `search`
across ledger fields, related names, numbers, dates/times, identifiers, review
status and linked transfer observations. Space-separated terms must each match
somewhere; quoted phrases stay together and formatted decimal amounts work.
Queries are case-insensitive, bounded to 256 characters/12 terms, and activity
timestamps use Asia/Dhaka. Correlated EXISTS queries on owned transfer evidence
keep one transaction row instead of multiplying joins. Raw SMS bodies are
excluded. UUID fragments require eight hexadecimal characters, so short amount
terms do not match random internal IDs. Source
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
without raw SMS bodies. User-controlled CSV text is escaped when it could be
interpreted as a spreadsheet formula; a reported balance of zero exports as
`0.00`.

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

Account corrections leave captured SMS/PDF observations attached with their
original account, direction, date, reported balance and fee. Reports, statement
matching and coverage ignore captured observations outside the current transfer
path or with the wrong direction for an endpoint. Manual reports can follow a
corrected endpoint; obsolete effective selections are cleared. Editing primary
metadata updates manual evidence without a raw-message ID. Reclassification
retains the original SMS links and retry keys as historical provenance.
When endpoints reverse, an old captured report with the wrong direction cannot
be assigned to the new From account. The scalar is cleared unless a new reviewed
report is supplied. Reads also suppress an unattributed scalar left by an older
correction, and a later edit clears it; captured evidence remains available for
inspection.

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
`statements.0001_initial`. New imports encrypt and retain exact PDF bytes while
discarding unlock passwords; older imports can regain the PDF by re-uploading the
same file to the same account. Masked extraction and audit history remain.
Synthetic fixtures and PostgreSQL concurrency tests cover
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

bKash `Card to bKash` credits begin as unconfirmed transfer drafts on new
imports. The source `provider_type` and masked details stay in the saved
extraction, while the original uploaded PDF is archived encrypted. Previously
imported pending rows receive read-only transfer suggestions without changing
their drafts. A trailing City/EBL bank label supplies possible active owned
accounts, never an automatic account selection; the reviewer must verify card
ownership and may choose a non-transfer type for an externally funded top-up.

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

## Which date does an API history filter use?

Transaction list/export whitelist `date_field` as `date`, `created_at` or
`updated_at` (default transaction date). Statement import lists whitelist
`created_at`/`updated_at` (default updated). Both accept a valid month or paired
inclusive start/end dates, limited to 366 days, and reject invalid/conflicting
parameters. Timestamp date lookups use Asia/Dhaka. Filtering preserves ownership
and happens before pagination/export. Statement detail/actions ignore list-only
period selection. Comparison ranges narrow only ledger-only results, before
pagination; filtered `count` differs deliberately from whole-statement `counts`.
Matching coverage and financial records remain unchanged. No migration is needed.

Statement row `ordering` sorts the filtered import before pagination: `source`
(default), `date_desc`, `date_asc`, `amount_desc`, or `amount_asc`. Missing dates
or amounts sort last, and ties retain statement row order. Invalid values return
400.

## How are account/card numbers attached to accounts and recognized?

Accounts accept optional nested identity metadata and manage one shared payment
method, rather than a second independent identifier store. Ownership is supplied
by the parent account. Validation masks unmasked numbers to last four digits,
checks typed additional identifiers and aliases, and rejects empty enabled
profiles. Atomic writes and an account row lock protect concurrent creation.
Omitting metadata preserves it; null disables that profile without rewriting
historical amounts, reported balances, or references. Other payment methods remain
available. Managed methods cannot be moved to a different account. Protected
account deletion rolls back profile removal and returns a readable validation error.

The read-only statement identify endpoint uses the bounded preview worker without
requiring a selected account. It returns only masked header evidence and an owned,
active, compatible BDT account suggestion. Ambiguous suffixes require selection.
Import and posting remain separate explicit actions; credit-card SMS identifiers
are supported but credit-card PDF layouts still need separate extraction support.

Masked identifiers exposing more than ten digits also reduce to a last-four
suffix, so adding a mask character cannot preserve a nearly complete card number.

## How does Quick Add prevent duplicate cash entries during retry?

A Save supplies a client UUID and immutable values. The API creates a normal
transaction, audit event and receipt atomically under a per-user row lock, with
a unique user/request constraint. An identical replay returns the original ID;
changed values or a deleted original return 409. Receipts preserve retry identity
after edits or deletion, without reverting corrections. Reference ownership is
checked for new writes; a replay remains recognizable after defaults change.
Distinct UUIDs allow two genuinely separate equal purchases. Presets are owned
CRUD records with active compatible defaults and shared ordering/favorite state.

## How does one transfer retain both account balances?

Optional account-bound `reported_balances` are stored as transfer observations,
not additional ledger transactions. The serializer validates at most two owned
endpoint accounts and rejects duplicate/unrelated accounts. Responses include
`balance_reporting_account` identifying the primary report owner. Positive amounts
and independent debit/credit account histories remain unchanged; negative reported
balances are allowed. Missing secondary manual observations use stable keys.

On reversal, account identity is preserved while evidence direction changes. When
an endpoint is replaced, its old report/fee is cleared before reassignment; the
unchanged account keeps its balance. Incoming SMS reclassification retains the
receiving bank's balance. Original SMS/PDF evidence is unchanged, while corrections
are captured in existing audit snapshots and user-locked atomic writes. Legacy
single-balance inputs remain supported. No database migration is necessary.

### How do transfer merges handle disagreeing reported balances?

Balances are compared by account, not sender against receiver. Every pair of
unequal non-null balances for the same account requires an explicit existing
or incoming choice with the reviewed values. The API rechecks those values
under the transaction lock and rolls back missing, extra, duplicate or stale
choices. Unknown never overwrites known. Original evidence remains available;
account summaries and the editor use the same effective reported balance.

### Can a three-digit card suffix automatically select an account?

No. The shared resolver accepts three ending digits but treats their overlap as
weak, even for a unique account or matching prefix. Longer independent evidence
may corroborate it. Provider/kind/ownership/active-account filters and visible
digit conflicts still apply. SMS returns sender/receiver choices and clears weak
defaults; confirmation/matching require explicit account choices. Learned mappings
cannot override unresolved weak numeric evidence. Longer saved identifiers remain
unchanged; no migration or extra ledger movement is involved. Statement weak
headers return choices with a null suggested account and retain verification.

### Why is Undo a server action instead of another DELETE request?

An action records private before/after deltas under the user transaction lock.
Undo rechecks the latest action, ownership, expiry and current transaction/linked
state before reversing it atomically. This restores edits and SMS review, unlinks
only new evidence, or restores merged entries. A blind delete could remove an
existing transfer or destroy later corrections. Redacted SMS is never restored;
superseded snapshot payloads are cleared and Quick Add retry receipts remain.

### How is a reported balance mismatch calculated without false alerts from later activity?

The batched summary retains cumulative ledger history and compares the latest
effective account report at its date/time cutoff using Decimal. Later movements
are excluded. Transfer observations identify the reporting account and cutoff,
while the canonical movement counts once. Credit-card reference balances and
ambiguous same-day timing return null comparisons with a reason. The result is a
read-only review hint; opening-balance or earlier ledger edits recompute it, and
no automatic adjustment or new query per account is introduced.

### Can accepting a statement match replace the reported balance?

Yes, through an explicit versioned balance choice. The API locks the existing
transaction, recomputes matches, requires a choice for conflicts, and verifies both
reviewed values. Stale choices return 409 without ledger or evidence changes.
Transfers use the statement account's effective report, preserving the opposite
account. Original SMS and statement observations keep their captured balances;
an explicit statement choice uses separate reviewed ledger evidence. Transaction
before/after snapshots and decision metadata preserve the previous values; the
PDF extraction stays immutable. Linking counts once, and unlinking or rescanning
confirmed SMS does not undo an explicit reviewed balance choice.

### What happens to captured transfer reports when the ledger is edited?

Editing a ledger date, time, reference, note, or account-bound reported balance
does not rewrite captured SMS or statement observations. A changed balance is
stored as separate reviewed evidence and selected as the effective account
report; repeating the same edit reuses it. If unlinking a statement removes a
transfer observation or restores its prior effective balance, the transaction
history records before/after snapshots in addition to the statement-row event.


### How does statement metadata enrichment avoid overwriting user corrections?

Suggestions never write on reads. Link decisions accept a bounded whitelist of
metadata fields with exact existing-value snapshots. The locked transaction is
checked for stale details and invalid selections, and writes/ linking/ audit logs
share one atomic operation. Ledger before/after values are retained, SMS evidence
is unchanged, and confirmed-message rescans cannot replay parser defaults.
Identifier roles are suggested only from explicit labels or the reporting-account
header; ambiguous counterpart numbers are not guessed.

### Can older pending statement rows use the newer merchant cleanup?

Yes. Migration `statements.0003_reapply_pending_merchants` updates the draft
Counterparty only when it still exactly matches the saved extracted description
and a recognized card-purchase prefix can be removed. It bumps the row version
to reject stale editor saves. User corrections, resolved rows, original evidence,
notes, balances, and ledger records are unchanged; no PDF re-upload is needed.

**How do we recover more printed Citytouch digits for an older import?** After
`statements.0007`, run the disabled-by-default `refresh_citytouch_codes`
maintenance command first as a dry-run, then with its digest and `--apply`. It
decrypts and verifies the archived PDF, re-extracts it in the bounded worker,
compares source-row identities, and only upgrades agreeing second-code suffixes.
The separate code field is encrypted; saved extraction, corrected drafts,
linked/posted transactions, and audit history remain intact. A same-file
re-upload only attaches the original PDF and does not reparse it.
Saved row responses expose the recovered code separately for authenticated
review and code search; the original masked description stays immutable.

### Can two pending sources be approved as one movement?

Statement list responses include `review.unified_pending_sms_pair_id` when the
same type-independent, reciprocal matcher used by Unified review finds one
pending SMS. `unified_pending_sms_status` distinguishes no match, a unique pair,
ambiguous sources, and an unavailable bounded check. The older same-type
`pending_sms_match_count` can be zero while a pair ID is present. A bounded
lookup checks uniqueness across other imports; bulk statement approval leaves
unique, ambiguous, and unavailable rows unresolved. Individual posting with
an identified or ambiguous pair requires explicit separate-movement confirmation.
The row search examines saved draft fields and extracted row values within one
import before pagination; it does not search the original PDF or other users'
data.

Yes. A statement row detail response offers eligible pending SMS candidates with
the same owner, reporting account, type, direction, amount and a date within the
three-day match window. `combine_sms` is an explicit, versioned decision. Under
the user lock and one database transaction it rechecks both pending states,
duplicate SMS identity, existing ledger suggestions and source discrepancies,
then creates an SMS-dated entry and links the statement using the existing link
engine. The row list computes pending-SMS counts in one bounded query. Existing
ledger suggestions require an explicit acknowledgement of their exact current IDs
as distinct movements; a changed list returns 409. Differing non-null reported balances require
an exact-value choice; source evidence and the audit trail retain both values.
Inline-fee principal rows are excluded because their printed final balance
belongs to the separate fee row. Independent SMS and statement decisions remain
available. This combined decision does not create an ordinary SMS undo action;
unlink statement evidence and correct the ledger through Transactions instead.

### How does combined pending review avoid two ledger entries?

The pair decision holds the same user lock as SMS/statement writers, then locks
and rechecks both pending sources and their version/timestamp. It reuses statement
validation and records one entry or links a current ledger suggestion. The SMS
candidate and PDF row point to the same transaction, with account-bound transfer
observations when needed. Exceptions roll back all writes, and completed-pair
retries are idempotent. Conflicting balances require acknowledgment and an explicit
balance choice for new entries; existing ledger balances stay intact. Raw SMS text
follows retention settings while parsed fields and links remain. Ownership scopes
apply to both sources and any existing ledger target. No migration/backfill occurs.
The confirmation request may include an edited statement draft, which is saved in
the same transaction before posting. A parsed type disagreement requires an
explicit statement/SMS/custom choice consistent with the result. Financial
identity edits must preserve unique pairing, while merchant/note/category/balance
corrections keep the original evidence that established the match. Invalid or
stale edits roll back without partially resolving either source.
The server requires explicit review acknowledgment for an edited result and
balance-conflict acknowledgment if the edit creates a new reported-balance difference.

The unified queue emits only reciprocal one-to-one matches and represents each
pair once. An SMS or statement with zero candidates stays in its source workflow;
any source with multiple overlapping candidates is also withheld until the
ambiguity is resolved. Pair filtering and pagination therefore operate on review
pairs rather than duplicated source observations. The optional `condition` filter
selects match strength, balance difference, type disagreement, or correction need
before cursor pagination. Overview totals still use the selected account and dates
before condition and search filtering. Exact account, direction, amount
and date are necessary but insufficient: matching reference, balance, normalized
counterparty or known transfer counterpart must independently corroborate the pair.
For BDT, a reported-balance difference below Tk 1 also corroborates matching,
and still counts as a reported difference in matching metadata. Both source
reports keep their exact values, and posting requires the usual explicit choice
of effective balance. Unified confirmation waives only the additional balance
acknowledgment for a sub-Tk-1 statement/SMS difference; a Tk-1-or-greater
original or edited difference still requires it. Existing-ledger conflicts
retain their separate acknowledgment.
For an existing-ledger suggestion that represents a different movement, unified
confirmation requires every current suggestion UUID plus an explicit
distinct-movement acknowledgment. It recomputes suggestions under the user lock
and rejects stale selections before reusing the statement create safeguard.
The resulting SMS and statement share one new ledger entry.
The queue, pair detail and confirmation endpoint all repeat reciprocal uniqueness
checks. This prevents a stale or hand-crafted detail request from bypassing an
ambiguity discovered after the queue loaded. Opaque cursors keep pagination stable
as earlier pairs leave the queue; overview counts expose unmatched and ambiguous
source work without mixing it into the matched queue.

The queue builds that reciprocal graph across the full pending account scope before
applying its display date range. A competing row immediately outside the selected
dates therefore still keeps the visible source ambiguous. Exact counterparty text
alone is labelled possible; strong requires same-day reference, balance, or a known
counterpart account.

Attached confirmed SMS sources expose their saved parsed amount/balance separately
from ledger values, including after raw text redaction. User and transaction scopes
are rechecked before returning that optional parsed observation.

## Review and parser safety updates

**How do large SMS queues reach clients?** Clients can request `limit` (1–200)
and `offset`; the API returns an exact `count` and a bounded `results` array.
The old array response remains only for older mobile builds that omit `limit`.
The dashboard summary uses count queries and at most three pending candidates
and four recent transactions.

**Can a busy unrelated account hide a pending SMS/statement match?** No. Detail
matching narrows to the statement account perspective before evaluating a
candidate, so unrelated same-amount messages cannot exhaust its suggestion
window. Decisions still revalidate the candidate under a transaction lock.
If the same-account check exceeds its safety bound, detail reports an unknown
match count and individual or bulk statement posting stays unresolved, even
with `allow_separate`, instead of treating unchecked SMS as absent.

**What prevents a sender regex from stalling parsing?** Saved regex sender
rules support a short subset without repeats, groups, alternatives or
backreferences. Validation rejects unsafe new patterns, and matching skips
unsafe old patterns as well.

### How is the chosen balance applied to a unified transfer?

SMS and statement observations keep their original reported values. The pair
decision marks one account-bound transfer observation as the effective report,
so account balance views use the reviewed choice. Linking to an existing
transfer keeps its prior effective report. Merging transfers carries the chosen
account reports forward while preserving each source's original value. Choosing a source with no balance
when the other reports one returns 400. Migration
`transactions.0008_transferevidence_effective_balance` adds this selection flag
without rewriting existing reports.

### How do large unified queues remain reviewable?

Date and source filters narrow pending source queries before the 2,000-per-side
safety cap. Selected pair detail checks nearby same-amount competitors directly,
independent of the global backlog. Broad queues may still need an account or
date filter. An inconclusive batched pending-SMS count is returned as null and
requires individual review rather than being labelled zero.

### Why does a Citytouch fund transfer not always become an internal transfer?

`CT-FT` describes the bank operation. The ledger type depends on purpose:
movement between two tracked accounts is a transfer, while an outgoing payment
can be an expense. The first masked reference segment varies per movement;
the second recurring visible segment is a candidate party code. The API keeps
all visible digits, so longer codes sharing a four-digit suffix stay distinct;
masked-out digits remain unknown and a four-digit-only code can still collide.
It
groups it by reporting account and debit/credit direction and requires a
user-verified mapping before suggesting a party or type. It explicitly blocks
generic description learning for these rows so unrelated recipients cannot
inherit the same classification. Suggestions do not mutate drafts, posted
transactions or source evidence. Migration `statements.0004_statementcounterpartycode`
stores the user-scoped mapping.

### How are bKash statement identifiers and bills classified?

The importer keeps the original masked extraction and an encrypted recurring
identifier for supported bKash `Send Money`, `Mobile Recharge`, `Payment`, and
`Pay Bill` rows. It derives the identifier from a recipient/recharge number or
merchant/biller label before `TRX ID`; that per-movement ID is never a mapping
key. Verified mappings stay scoped to the reporting wallet and debit/credit
direction and only suggest editable review details. Debit `Pay Bill` and
`Mobile Recharge` principal drafts start with an active `Utilities & Bills`
expense category; fee rows do not inherit it. Migration
`statements.0008_bkash_statement_identifiers` updates only uncategorized,
pending legacy bill/recharge drafts. Identical-PDF reupload can restore missing
identifiers on older rows after exact fingerprint checks without overwriting
reviews or posted transactions.
`Bank to bKash` and `Card to bKash` wallet credits start as unconfirmed
transfer drafts; a trailing City/EBL label suggests possible owned funding
accounts without selecting one.

## How does batch SMS import avoid partial-failure and duplicate problems?

The batch endpoint accepts at most 25 messages and returns an individual result
for each client correlation ID. Each item has its own atomic transaction; a bad
item cannot undo successful siblings. Both single and batch import share parsing,
capture policy, redaction rules and existing duplicate keys. A per-user writer
lock also serializes concurrent device-ID checks. Retry after a lost response
returns the already-saved candidate instead of posting another ledger entry.
Compact receipts omit original SMS bodies and identity-suggestion serialization;
sender rules and capture preferences are loaded once per batch request.
Q: How are older bKash recurring identifiers and bill categories improved?
A: An authenticated, throttled import action decrypts the retained PDF, verifies
its digest and saved row fingerprints, and fills only missing encrypted codes.
A password is supplied per request for locked PDFs. Clear Pay Bill and Mobile
Recharge wording selects specific expense categories for new rows; a migration
refines untouched pending generic bill rows. An exact full Send Money recipient
match to one owned active bKash wallet suggests, but never posts, a transfer.
Verified phone-code mappings suggest the saved name as counterparty and in a
fallback note; an explicit note template overrides that fallback. An exact
owned-wallet match likewise suggests its account name in both fields. These
suggestions do not rewrite source evidence or saved drafts.

### Does pagination break existing transaction-list clients?

No. The new authenticated read-only `/api/transactions/activity/` route returns
filtered count, next_offset and up to 100 results (25 by default). The existing
list remains an array. Both use the same owned queryset, search, date filters,
transfer account perspective and stable ordering. Bad paging/UUID inputs return
400, unauthenticated requests return 401, and activity responses are private and
non-cacheable. No new model or migration is required.

### Can combined linking fill a transfer's missing receiving-account balance?

Yes. The API selects the sole available or exactly agreeing source report for an
eligible missing account balance; it preserves zero, protected null choices and
original observations. Differing incoming reports require an explicit SMS or
statement choice. The public eligibility boolean is advisory and recomputed under
the writer lock. Primary-report fallback uses evidence creation order so attaching
an earlier-timestamped receiver report cannot move the sender's balance ownership.
This changes account report selection, not ledger movement totals. No migration
or historical bulk repair is included; broader revalidation remains planned.


### How can a late SMS attach to a transaction originally recorded from PDF?

The reconciliation proposal/apply service normalizes owned source components and
suggests existing expense/income/fee/refund/transfer movements. Source order does
not determine whether a second posting is needed. An explicit target produces a
15-minute fingerprinted preview; apply rechecks sources, target/related state,
accounts, matching candidates and policy under the shared user writer lock and
row locks. Accepted attachments preserve financial identity and canonical links.
A same-account balance/reference from one retained observation can corroborate a
later source even after ledger details were reviewed. No amount/date auto-linking
is enabled. Combined balance selection, statement identity checks and SMS link/
retention share backend helpers; legacy routes are retained as incremental adapters.

### What is saved for a decision and how can it be recovered?

`EvidenceProposal` stores structured previews/hashes and accepted idempotent
receipts, not raw source text or another authoritative link table. UUID target
references avoid changing ledger Undo dependencies merely by previewing. Receipt
replay cannot resurrect an undone/changed link. New attachments use the existing
24-hour latest unchanged-action Undo; pending statement rows are captured before
linking so Undo restores them rather than deleting them. Purge expired proposal
metadata with the bounded dry-run-first management command after at least 30 days;
canonical source links remain. Historical repair/compensation is still planned.
