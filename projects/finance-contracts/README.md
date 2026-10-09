# finance-contracts

Shared API contract and integration documentation.

## Responsibilities

- OpenAPI schema.
- API examples.
- Data shape documentation.
- Generated TypeScript client and schema types.
- Contract changelog.

## Current Files

```txt
openapi.yaml
generated/
  client.ts
  types.ts
scripts/
  generate_ts_client.py
requirements.txt
tsconfig.generated.json
examples/
  account.create.json
  audit-log.detail.response.json
  audit-log.list.response.json
  auth.login.request.json
  auth.login.response.json
  auth.me.response.json
  category.create.json
  credit-card-bill.create.json
  credit-card-bill.payment.create.json
  debt.create.json
  debt.payment.create.json
  payment-method.create.json
  message-review.bulk-reprocess.response.json
  message-review.confirm.json
  message-review.list.response.json
  message-review.redact.response.json
  raw-message.import.json
  raw-message.import.response.json
  reconciliation.account.response.json
  reconciliation.snapshot.create.json
  reconciliation.snapshot.response.json
  recurring-bill.create.json
  recurring-bill.payment.create.json
  sender-rule.create.json
  transaction.create.json
  transaction.export.csv
  transaction.list.response.json
  transaction.transfer.create.json
  validation-error.response.json
  report.monthly.response.json
CHANGELOG.md
```

## Generated TypeScript Client

The generated files in `generated/` are produced from `openapi.yaml`:

```bash
python3 scripts/generate_ts_client.py
```

The generator uses Python and PyYAML. If PyYAML is not already installed:

```bash
python3 -m pip install -r requirements.txt
```

To typecheck the generated client with the web project's TypeScript install:

```bash
../finance-web/node_modules/.bin/tsc -p tsconfig.generated.json
```

`generated/types.ts` exports OpenAPI component schema types. `generated/client.ts`
exports `FinanceApiClient`, a lightweight fetch-based client with typed request
bodies, query objects, path parameters, JSON responses, and CSV `Blob` exports.

## Contract Principles

- Backend owns the canonical schema.
- Web and mobile consume the same API.
- Breaking changes must be versioned or coordinated.
- Transaction amount is stored as a positive value with explicit business type
  and ledger direction (`debit` or `credit`).
- Account responses expose a derived `ledger_balance` plus nullable
  `latest_reported_balance` and `latest_reported_balance_date`. The derived
  value is recalculated from posted activity; the reported value is evidence
  captured from a bank or wallet message and may be older.
- SMS-confirmed transactions should preserve normalized evidence fields such as
  provider reference, local transaction time, balance after, counterparty text,
  payment method, masked sender/receiver account and card identifiers, raw
  message id, and duplicate key. Clients should submit masked identifiers or a
  safe suffix; the API reduces an unmasked value to its last four digits.
- Capture preferences are user-scoped. Excluded providers and message kinds
  preserve only a deduplication tombstone; their original SMS body is not kept
  by the API. Trusted-sender messages containing no digits are also discarded
  through this tombstone path because they cannot supply transaction evidence.
  Confirmed raw-text retention is explicit and defaults to 30 days.
- Mobile clients report device sync health through a user-scoped heartbeat;
  dashboards must use this status rather than infer health from review records.
- Review confirmation can explicitly remember corrected account, payment
  method, category, and transaction type for the sender rule and detected
  message kind. The mapping is applied to similar pending items as well as
  future imports. Transfers with a counterparty use reporting-account/counterparty
  paths and preserve the selected debit/credit direction.
- Candidate rejection records a reason and may atomically redact the raw body,
  disable the matched sender rule, or add the provider to capture exclusions.
- Transaction create, update, and delete actions expose read-only audit log
  entries with normalized before/after snapshots.
- Display sign preference belongs to clients.

## Initial Endpoint Sketch

```txt
GET    /api/health/

POST   /api/auth/login/
POST   /api/auth/refresh/   # returns rotated access and refresh tokens
POST   /api/auth/logout/    # revokes one refresh-token session
POST   /api/auth/logout-all/ # revokes every refresh-token session for the user
GET    /api/auth/me/

GET    /api/accounts/
POST   /api/accounts/
PATCH  /api/accounts/{id}/

GET    /api/categories/
POST   /api/categories/
PATCH  /api/categories/{id}/

GET    /api/payment-methods/
POST   /api/payment-methods/
GET    /api/payment-methods/{id}/
PATCH  /api/payment-methods/{id}/
DELETE /api/payment-methods/{id}/

GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/{id}/
PATCH  /api/transactions/{id}/
DELETE /api/transactions/{id}/
GET    /api/transactions/export/?month=YYYY-MM

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
POST   /api/messages/raw/{id}/redact/
GET    /api/messages/review/
POST   /api/messages/review/reprocess/
POST   /api/messages/review/{id}/reprocess/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/reject/
POST   /api/messages/review/{id}/ignore/

GET    /api/debts/
POST   /api/debts/
POST   /api/debts/{id}/payments/

GET    /api/credit-card-bills/
POST   /api/credit-card-bills/
PATCH  /api/credit-card-bills/{id}/
POST   /api/credit-card-bills/{id}/payments/

GET    /api/recurring-bills/
POST   /api/recurring-bills/
PATCH  /api/recurring-bills/{id}/
POST   /api/recurring-bills/{id}/payments/

GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/reports/categories/?from=YYYY-MM-DD&to=YYYY-MM-DD
GET    /api/reports/accounts/?month=YYYY-MM

GET    /api/reconciliation/snapshots/
POST   /api/reconciliation/snapshots/
GET    /api/reconciliation/accounts/{account_id}/

GET    /api/audit-logs/
GET    /api/audit-logs/{id}/
```

## Transfer Matching Boundary

The shared contract includes transfer-matches, link-transfer, and merge-transfer
operations. Suggestions never mutate the ledger. Accepted links return one
canonical transaction with `transfer_evidence[]`; `account_direction` reflects
the selected account filter. Manual incoming credit drafts use receiving-account
order and are normalized by the API. SMS clients set `account_perspective: true`
to use the selected account's debit/credit side and the other transfer account.
Legacy SMS drafts without the flag retain canonical source/destination order.
Generated TypeScript types/client are regenerated with the existing generator.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.

## Transfer Suggestion Metadata

Candidate responses include optional `suggested_transfer_direction` and
`transfer_suggestion_reason`. A nonempty suggested direction describes the
reporting account while `account`/`destination_account` remain canonical source
and receiver hints. The reason explains identifiers, remembered choices,
confirmed history, a name/provider match, or unresolved ambiguity. Clients must
keep review/confirmation explicit. Missing metadata can default to empty strings.

Transaction listing accepts optional `ordering` (`-date` by default, or
`-created_at` for recently added ledger records, or `-updated_at` for latest saved
changes). Creation, edits, new transfer evidence and merges advance `updated_at`;
reads and idempotent retries do not. Both timestamps remain read-only. Ordering
is independent of transaction month filtering; omit month to find backdated
additions or edits. The generated client
exposes the same enum. CSV export keeps chronological order.

SMS message kinds include `promotional`, excluded with OTP/security by default.
Reject requests accept optional `exclude_message_kind` to remember a recognized
non-transaction type and remove matching pending notices. Financial/unknown
formats return 400; capture preferences reverse exclusions. No new endpoint or
financial transaction schema is introduced.

`GET /api/transactions/{id}/source-messages/` exposes on-demand original SMS for
an owned transaction, including linked transfer evidence. The minimal
`TransactionSourceMessage` response contains ID, sender, nullable body, received
time, status and redaction time. Messages are deduplicated; no SMS returns an
empty array. Redacted/excluded bodies are null. Responses use private/no-store
caching; source-message access does not expand the ledger list or require SMS
text in edit payloads. Other users'
transactions return 404 and unauthenticated access returns 401.

## Linked Transaction Correction Acknowledgement

`TransactionPatchRequest.allow_linked_correction` is an optional write-only
boolean, false when omitted. It acknowledges a correction to the type, accounts
or amount of an entry with multiple linked transfer observations; without it,
those changes return 400. Ownership, distinct-account and payment-method checks
remain enforced. Transfers retain From=`account`, To=`transfer_account` and
canonical debit direction; reversal swaps accounts.

Corrections retain one ledger entry, audit snapshots and unchanged original SMS.
Account remapping clears obsolete reported balances/fees. A type change preserves
the primary balance when its reporting account stays the same. If reclassified,
`transfer_evidence` remains in the response as historical provenance and the
source-message endpoint still returns its messages. Consumers must only use
that evidence for transfer balance display/reporting when `type=transfer`.
IDs and created/updated timestamps remain read-only. Existing editable source,
review status, payment method and masked-identifier fields are exposed by the
web editor; no additional response fields or migration are needed.

## Reference Semantics

`reference` is an optional provider/user reference, not the UUID `id` and not a
unique key. Both observations of a transfer and unrelated records may share it.
Clients must not enforce uniqueness or manufacture a different reference to
confirm a separate capture. `external_key` is opaque: new SMS keys bind to raw
capture identity, legacy keys remain valid, and manual transfer retries retain
a stable key per submitted draft. Response/request shapes are unchanged.

Duplicate confirmation/link errors identify an already recorded SMS or retry
key. Transfer matches require accounts, equal currency/principal and dates
within three days; time is included for inspection, and reference agreement is
supporting evidence in `reason`. Shared references never auto-link records.

## Clearing SMS Review Fields

SMS confirmation: omitted `transfer_account`/`payment_method` retains the parsed
value; explicit `null` clears it. A reviewed transfer reclassified to another type
must have no destination. Confirming as a transfer still requires another account.
This clarifies existing nullable fields without a schema change.

## Primary Transfer Reports

Transfer evidence includes read-only boolean `is_primary` to identify the observation
edited through the transaction balance field. When the main balance is null, clients
may show that report's balance; another account's balance must remain separate.

## Reported Balance Corrections

`balance_after` represents the provider's report for one account, separately from
the calculated ledger balance. Type/category/detail edits preserve it, including
zero, while that reporting account stays the same. PATCH with omitted balance
retains the report; explicit null clears it. A same-account transfer
reclassification can preserve the primary evidence balance when the main field
was null. Changing the non-reporting side preserves the primary report. When its
account changes, omitted/unchanged carried balances clear; an explicit different
replacement is accepted. SMS confirmation and transfer draft matching/linking
apply the same rules to parsed values. No generated schema changes are required.

## Statement Preview Boundary

`POST /api/statements/preview/` is an authenticated multipart upload containing
`account`, `file`, and optional transient `password`. `StatementPreview` returns
normalized rows, masked descriptions, page/row bounds, account suffix hints, and
validation checks; unknown check results are null and `can_post` is always false.
It is a stateless preview, not a ledger import or deduplication endpoint.

Supported first layouts: BDT EBL bank, City Bank savings, and bKash digital PDFs.
Limits: 4 MiB, 30 pages, 2000 rows, 10 requests/hour/user, 20-second worker limit.
Errors distinguish invalid/account/locked/unsupported input (400), worker timeout
(422), throttling (429), and worker unavailability (503). Responses are no-store.

The generated TypeScript client accepts `FormData` for multipart operations and
lets fetch generate its boundary. Binary schema fields map to `Blob`, boolean
enums retain boolean literals. JSON operations retain JSON encoding.

## Saved Statement Review Boundary

Saved imports add multipart create, paginated history/detail, globally filtered
rows, versioned draft PATCH, explicit decide, and bulk approve_new operations.
Linking preserves existing ledger details; source fingerprints/references are not
unique keys. `SavedStatementRow` separates immutable extraction from draft edits
and review metadata. Stale edits/decisions return 409. Bulk approval accepts 50
IDs/versions and returns added/unchanged/unresolved counts.
`Transaction.statement_evidence_count` is read-only; full masked observations load
through `GET /api/transactions/{id}/statement-evidence/`. Financial corrections to
statement-linked entries also require `allow_linked_correction`. No original PDF
or password is retained. Same-file retries return 200 with preserved review;
new saved imports return 201 without ledger writes. All these endpoints are
user-scoped and no-store. Generated client/types include every operation.

Statement review assistance adds `StatementMatch.strength`, merchant/time evidence,
`StatementReview.draft_issues` and nullable `suggestion`. Explicit decision input
`remember_choices` defaults false. `GET /api/statements/imports/{id}/summary/`
returns full-import saved-draft arithmetic and observation decision totals, separately
from original extraction checks. `POST .../review_selected/` accepts create/skip
and at most 50 IDs/versions; its response includes `skipped` and unresolved reasons.
All new endpoints retain owned-resource scoping and `Cache-Control: no-store`.

`GET /api/statements/imports/{id}/comparison/?offset=0&limit=50` returns account-
scoped statement/ledger coverage counts and paginated ledger-only observations.
`complete=false` means absence is provisional; inspect `warnings`. Suggestions
are excluded from ledger-only counts, and this read-only endpoint never changes
ledger entries. It requires authentication and returns `Cache-Control: no-store`.

Statement match `date`, `time`, `reference`, `balance_after`, `note`, and `source`
refer to the selected reporting-account observation. They may differ from canonical
transaction fields for a transfer. A receiving-side fallback with no observation
has unknown time/balance and an empty reference, explained in `reasons`. Existing
response shapes are unchanged.

Statement comparison coverage considers immutable PDF rows separately from draft
suggestions. Candidates from either view are excluded from ledger-only results.
Changed matching values and failed draft reconciliation set `complete=false` with
warnings; `ledger_only_available=true` can still expose provisional results.
Missing original financial fields remain incomplete after draft correction.

Statement match strength uses unresolved siblings from the same import, including
single-row retrieve/PATCH/decision requests. Opening a candidate alone never
bypasses shared-row ambiguity. Responses retain their existing shapes and return
requested rows only; explicit individual acceptance still rechecks one-to-one
link eligibility. Statement-wide search limits remain visible in review warnings.

Accepted statement evidence is validated against current ledger financial identity.
A linked/posted row can retain its transaction ID and persisted state while its
`review.review_state` becomes `needs_correction`; `review.issues` explains why.
Comparison counts it as `needs_review`, summary counts it as unresolved, and
coverage is provisional. Clients must use review state to label confirmation.
The existing unlink action preserves the ledger entry and returns it to review.

Reports and transaction lists accept paired inclusive `start_date` / `end_date`
instead of `month` (same date for a daily view; at most 366 days). The report
returns `month: null` for a custom range, explicit start/end dates, zero-filled
`daily` totals and expense-only `spending_categories`. All report amounts are BDT;
transfers affect account movement but do not count as income/spending. Invalid
ranges return 400. Transaction lists retain their normal pagination and ordering.

`PaymentMethod` adds `identifier_kind`, `additional_identifiers` and `aliases`.
Each additional identifier has an account/card kind, safe value and optional input
label (returned as a string). Lists are capped at 20 entries; duplicate typed
identifiers and invalid/numeric-only text aliases return field-specific errors.
Existing primary identifiers retain legacy `any` compatibility. Statement preview
and saved imports add nullable `account_suggestion`, with account ID/name, reason
and an ambiguity flag. A suggested account is advisory and does not replace the
user-selected account or authorize posting. Transaction financial contracts and
raw identifier fields are unchanged.

Transaction list and CSV export add optional `date_field` (`date`, `created_at`,
`updated_at`; default `date`) with the same month/paired-range parameters.
Statement import lists add `date_field` (`created_at`, `updated_at`; default
`updated_at`) and month/paired-range filters before pagination. Timestamp calendar
days use Asia/Dhaka. Invalid date fields/months and incomplete/conflicting ranges
return 400. Statement comparison adds paired inclusive start/end dates for
ledger-only rows: `count` and page links use filtered results, while `counts` keeps
whole-statement coverage. Ranges are capped at 366 days; schemas do not change.
Regenerate clients with `python scripts/generate_ts_client.py` from this project.

### Account-owned identity metadata and pre-import recognition

`Account` adds nullable optional `identity`; create/patch accept
`AccountIdentityInput`. The server assigns ownership and the shared payment-method
ID. Omitted identity preserves existing mappings, null disables that account's
profile, and a non-null profile activates it. Primary and additional identifiers
are masked or last-four suffixes; masked inputs exposing more than ten digits also
reduce to last four. Aliases cannot be numeric-only. Account-managed
payment methods cannot be reassigned to another account.

Multipart `POST /api/statements/identify/` requires only file and optional password.
`StatementIdentification` returns parser profile, masked account hint and nullable
account suggestion, including explicit ambiguity. It is read-only, no-store, and
shares preview extraction bounds and has a separate 10/hour throttle. Existing preview/import still require the user's
selected eligible account; recognition does not authorize ledger posting. The
additive account migration must precede API deployment; regenerate clients with
`python scripts/generate_ts_client.py`.
