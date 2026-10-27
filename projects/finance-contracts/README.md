# finance-contracts

`GET /api/transactions/issues/?limit=50&offset=0` returns a read-only,
user-scoped issue page. The response reports inspected count, total count,
next offset, and findings with stable issue codes and advisory severity; it
never includes SMS bodies or changes ledger entries. Clients must treat current
rule differences as suggestions for human review.
`POST /api/transactions/refresh-evidence-directions/` accepts bounded
`limit`/`offset` pages and fills only blank SMS source directions when saved
message evidence is unambiguous. Its response reports SMS recovery and stored
statement direction coverage. It never copies an editable draft or ledger
direction into source evidence; unknowns remain for manual review.

Batch SMS sync uses `POST /api/messages/import/batch/`, a 1–25-item envelope of
single-import payloads plus distinct `client_id` correlation keys. HTTP 200 is
an envelope acknowledgement, not success for every message: clients must inspect
each result's `status`. Only a matching 200/201 item receipt with a `message_id`
confirms durable acceptance. Preserve original device IDs, timestamps and bodies
when retrying an uncertain response. Per-item 400 errors need correction; 5xx,
408 and 429 results stay queued for backoff. Authentication failures apply to the
request, not message validity. The endpoint does not create ledger transactions.
`RawMessageBatchImportRequest` and `RawMessageBatchImportResponse` are published
in OpenAPI and generated TypeScript. The backend snapshot is regenerated with
PostgreSQL integer ranges to match CI, rather than SQLite's int64 defaults.

Original-source additions: statement import responses report `has_original_file`;
an authenticated `GET /api/statements/imports/{id}/original/` returns the exact
PDF as a no-store attachment. `GET /api/payment-methods/{id}/original-identifiers/`
reveals encrypted user-entered account/card values on demand. Ordinary account
and payment-method responses continue to expose masked values only. Repeated
SMS imports with `reprocess_existing: true` may restore a matching policy-redacted
transaction SMS when its retention preference is Keep. Manual and legacy redactions
also require `restore_redacted: true`; `was_restored` reports the result. Duplicates do not post
another transaction.

Shared API contract and integration documentation.

Pending SMS/PDF pair results can include contested choices marked
`needs_decision`. Pair detail returns `competing_sources` and revision tokens;
confirming a contested pair requires the exact current tokens plus
`acknowledge_competing_sources`. A changed alternative returns 409 so clients
refresh the comparison before recording one transaction.

Statement match suggestions expose the ledger `category_id` alongside its name.
Link decisions with a different saved statement category submit an explicit
`category_choice`: keep the ledger category, use the statement draft category,
or choose another active category. Reviewed IDs protect against stale decisions;
the selected category and original observations are captured in audit history.

Statement preview rows may contain `citytouch_printed_code`, the second
component exactly as printed in a City Bank Citytouch reference. It is nullable
and does not authorize an automatic counterparty mapping. General descriptions
remain masked; retained source codes are encrypted on the API side.
Saved row responses expose the retained code as read-only
`citytouch_printed_code` so review screens can show it without rewriting
historical extraction or corrected draft text.

## Responsibilities

- OpenAPI schema.
- API examples.
- Data shape documentation.
- Generated TypeScript client and schema types.
- Contract changelog.

## Current Files

```txt
openapi.yaml
backend-schema-snapshot.json
generated/
  client.ts
  types.ts
scripts/
  generate_ts_client.py
  check_backend_schema.py
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

The category usage contract documents `GET /api/categories/usage/`, which
returns owner-scoped ledger transaction counts for the Categories screen.

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

CI also generates Django's schema and compares its structural operation and
component snapshot with `backend-schema-snapshot.json`. After a reviewed API
change, update `openapi.yaml` as appropriate, regenerate TypeScript, and run
`python scripts/check_backend_schema.py /tmp/finance-schema.yaml --update`.
This check also rejects contract routes that no longer exist on the backend.
Generate the snapshot with `DATABASE_URL` pointing to PostgreSQL, as in CI and
production. SQLite gives Django integer fields a different maximum and `int64`
format, causing a false schema-drift failure against PostgreSQL.

## Contract Principles

- Backend owns the canonical schema.
- Web and mobile consume the same API.
- Breaking changes must be versioned or coordinated.
- Transaction amount is stored as a positive value with explicit business type
  and ledger direction (`debit` or `credit`).
- `ParsedMessageCandidate.source_direction` is a read-only SMS parser observation
  (`debit`, `credit`, or blank when ambiguous), separate from the chosen ledger
  direction. Statement rows retain immutable PDF direction in `extracted.direction`
  and a separately editable draft direction. Neither source direction follows a
  later ledger edit automatically.
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
GET    /api/categories/usage/
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
Account remapping preserves captured SMS/PDF observations as source evidence,
including their original balances and fees, but excludes obsolete account or
direction reports from current balances and statement matching. Manual reports
can be reassigned; an unmatched legacy scalar is returned as null. A type change preserves
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
Linking preserves existing ledger details except explicitly selected reported
balance and metadata choices; source fingerprints/references are not unique keys.
`StatementMatch` returns the effective reported balance for the statement account,
separately from the matched historical observation. Conflicts require a reviewed
`balance_choice`; optional `detail_choices` carry selected metadata values and
their current ledger snapshots. `SavedStatementRow` separates immutable extraction from draft edits
and review metadata. Stale edits/decisions return 409. Bulk approval accepts 50
IDs/versions and returns added/unchanged/unresolved counts.
The `ledger_*` fields expose the saved candidate's own side of a movement for
comparison. `reporting_observation_is_fallback` flags a date-only search hint when
the statement account has no attached observation. Neither changes match or link
eligibility; clients must keep source-side details distinct from statement-account
evidence.
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

## Transaction search boundary

Transaction list and export `search` parameters share the same expanded ledger
scope: related account/category/payment-method names, textual metadata,
amount/balance, ISO dates/times, review status, identifiers/IDs and linked transfer
observations. All space-separated terms must match somewhere; quotes preserve
phrases and amounts may contain thousands separators. Case-insensitive search
combines with existing filters and keeps each transfer once. Activity timestamps
use Asia/Dhaka. UUID fragments require eight hexadecimal characters; shorter
number terms do not search internal IDs. Limits are 256 characters and 12 terms; validation returns 400.
Raw SMS bodies are excluded. Response shapes and TypeScript query types are
unchanged; OpenAPI parameter descriptions document the behavior.

## Quick Add boundary

`/api/quick-add/presets/` is authenticated user-owned CRUD. Preset defaults,
enabled/favorite flags and `display_order` are shared by both clients. Read-only
`available` reports whether linked defaults are active and compatible. Reorder
accepts `{ "ids": [...] }` containing the complete owned set, including disabled
presets, and returns the ordered list.

`POST /api/quick-add/entries/` accepts `QuickEntry` with a client UUID, account,
positive decimal amount, local calendar date, expense/income and web/mobile
source. Optional category and time use null; merchant and note use empty strings.
The response is `{ "transaction": UUID, "replayed": boolean }`: 201 for a new
record, 200 for an identical replay, 409 for changed payload or a deleted original.
Retries retain the UUID and all values, including the first Save's timestamp.
A new UUID means a distinct purchase even when all financial values are equal.
A replay never reverts a later ledger edit. Reference ownership and compatibility
are enforced by the backend for new entries.

`quick-add.ts` contains portable draft/default/validation helpers shared by
React and React Native. These are client conveniences, not the backend's source
of truth. Date helpers use the device's local calendar; no UTC slicing or minute
rounding is used. Generated types/client remain sourced from `openapi.yaml`.

`transfer-comparison.ts` is a portable client presentation helper for reviewed
transfer drafts. It resolves account names and displays credit drafts in the
same sender-to-receiver order as API match summaries, preserving edited amount,
date/time, reference and descriptive fields. It does not change payloads, match
eligibility or ledger behavior; no API schema change is required.

### Account-specific transfer balance reports

`Transaction`, `TransactionCreateRequest` and `TransactionPatchRequest` add
`reported_balances` with at most two `AccountReportedBalance` objects. Every object
requires an owned From/To account and a nullable decimal balance; duplicates,
unrelated/foreign accounts and use on non-transfers return 400. Omitted accounts
preserve their report, null clears the selected report, and negative reported
balances are allowed. Transfer amounts still must be positive.

Responses add read-only `balance_reporting_account` for the primary legacy scalar
balance. Transfer endpoints are canonical From/To, independently of which account
reported the SMS. Reversal preserves applicable manual report ownership, while
an incompatible captured report stays historical until a new reviewed balance
is supplied. Adding/editing a second report never creates a second transaction.
Existing fields and manual Credit-create
normalization remain compatible. No database migration is required. Regenerate
TypeScript interfaces with `python scripts/generate_ts_client.py`.

### Explicit transfer balance conflict choices

`TransferMatch.reported_balances` returns account-bound balances for both
endpoints. `TransferLinkRequest` and `TransferMergeRequest` accept up to two
`TransferBalanceChoice` items: `account`, `keep` (`existing` or `incoming`),
`existing_balance_after`, `incoming_balance_after`. Include exactly the
same-account disagreements, with the values shown during review. Missing,
extra, duplicate and stale choices fail with a readable 400 and no mutation.
Null does not conflict with or overwrite a known balance; values for different
accounts are not compared. Original evidence stays attached while the chosen
balance becomes the effective account report. Deploy API changes before new
clients; no model migration is needed. Regenerate via the existing generator.

### Three-digit identity suggestions

Identifiers require at least three ending digits. Full-number masking remains
last-four; longer saved masked numbers are preserved. Three-digit overlap is a
review-only hint, never an automatic account selection. SMS responses optionally
add `identity_suggestions`: sender/receiver role, masked observations, explanation,
and owned account/payment-method choices. Clients default missing suggestions to
`[]`, clear weak initial account/method defaults, and let the user choose. Confirm
and transfer-match drafts must explicitly supply the affected account; transfers
use `account_perspective: true` and debit/credit for the reporting account.

Statement suggestions optionally add `requires_review` and `choices`. A weak or
colliding header keeps `account: null`; preview remains `verify` until the user
checks it. Existing identifiers, ownership rules and ledger counts are unchanged.
Deploy API before clients; no database migration or APK rebuild is needed for API
behavior. Regenerate the checked-in TypeScript interfaces using the existing
`python scripts/generate_ts_client.py` command.

### Transaction action recovery

Mutation responses may include `undo_action: TransactionAction | null` for manual
and Quick Add saves, edits, SMS approvals and transfer resolutions. Public
descriptors contain an opaque action UUID, kind/label, saved transaction UUID,
timestamps, `can_undo` and `undone`; private restoration payloads are never sent.
`GET /api/transactions/recent-action/` returns the latest descriptor or null.
`POST /api/transactions/undo/` accepts an action UUID and returns its undone
state. 409 means expired, superseded or changed state; 404 protects ownership.
Completed undo retries are idempotent. Original SMS redaction is irreversible.
Only the latest unchanged action is recoverable for 24 hours. Migration
`transactions.0007_transaction_action_recovery` must precede clients. Existing
clients can ignore these additive response fields.

### Account report comparison

`Account` optionally adds read-only `ledger_balance_at_latest_report` and
`latest_reported_balance_difference` (nullable decimal strings), plus
`reported_balance_comparison`. The difference is report minus ledger at the
report's cutoff, excluding later activity. `matched`/`mismatch` are comparable;
`unavailable`, `credit_card_reference`, `timing_unknown` and
`report_precedes_movement` explain why no numeric comparison is returned.
Clients default missing fields to null/unavailable and never infer a historical
mismatch by subtracting today's ledger. Existing fields and mobile clients stay
compatible. Deploy the updated API before expecting comparison hints; no database
migration is needed.

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

## Combined pending SMS and statement review

Statement row detail adds `review.pending_sms_matches`: bounded pending SMS
suggestions with date/time, account-side evidence, optional retained SMS text,
reported balance and editable metadata proposals. Paginated row lists expose
`pending_sms_match_count` through a bounded batched lookup; null means the list
could not check the full candidate window, rather than zero matches. Detail fetches return
the actual candidate list.
Statement row list and detail responses also expose
`review.unified_pending_sms_status` (`none`, `unique`, `ambiguous`, or
`unavailable`) and a nullable `review.unified_pending_sms_pair_id` for a unique
type-independent Unified review match. The stricter same-type SMS count can be
zero while this pair ID is present. Row search covers saved drafts and original
extracted values within the selected import before pagination.

`StatementDecision.action=combine_sms`
requires row `version` and a pending `candidate` UUID. Differing non-null balances
require an exact-value `balance_choice`; optional `detail_choices` use the same
reviewed-value contract as linking. The API locks and revalidates both sources,
creates one SMS-sourced ledger entry and links the statement atomically. When
ledger suggestions exist, the decision must include their exact current UUIDs in
`dismissed_ledger_matches` and set `acknowledge_distinct_ledger_matches=true` after
review. A changed list returns 409. The original independent decision routes remain
available. The unified transfer-balance choice below requires a migration.

New statement drafts strip anchored labels such as “CARD PURCHASE” and “PURCHASE
CARD” from the merchant field while retaining the original masked description.
Merchant case/punctuation and manually saved draft corrections are preserved.
References and explicitly labelled identifier metadata are excluded from merchant
suggestions. The statement header identifies only the reporting account; transfer
counterpart identifiers need explicit sender/receiver evidence. Ambiguous values
remain empty. Payment methods, accounts, classifications, amount, date and time
are not changed by this metadata shortcut. No new database migration is required;
deploy web and API together.

### Unified matched-pair review

- `GET /api/review/pending/`: account UUID, combined-source search, inclusive
  `start_date/end_date` (maximum 366 days), review `condition` (`all`, `strong`,
  `possible`, `balance_differs`, `type_differs`, `needs_correction`), opaque `cursor`, legacy offset and
  limit (1–100, default 50). Returns
  `{count, offset, limit, next_cursor, overview, results}`; `overview` contains
  matched, ambiguous, statement-only and SMS-only source counts for the selected
  account/date scope before search/condition filtering. Each result contains one reciprocal one-to-one
  `{statement, sms, match}` pair. Count is the number of review pairs. Unmatched
  and ambiguous sources are excluded.
- `GET /api/review/pair/?statement=<uuid>&sms=<uuid>`: owned, still-pending pair
  details with the saved statement draft, batch, parsed SMS/original text,
  normalized `sms_summary` account perspective and reasons.
- `POST /api/review/pair/`: `statement`, `sms`, `statement_version`, `sms_updated_at`,
  `balance_source` (`sms/statement/existing`), `acknowledge_match`,
  `acknowledge_conflict`, `acknowledge_issues`, optional `transaction` and
  `remember_choices`. Optional `draft` contains reviewed statement-row fields
  with the same version; `type_choice` is required for a parsed type disagreement
  and must agree with the resulting type. Returns
  `{transaction, statement, sms, unchanged}`.

New pairs use one reviewed statement-draft movement and the chosen balance; both source
reports remain. A missing report cannot replace an available one. Transfer
Inline draft edits and pair confirmation share one transaction. Date, direction
and amount corrections must preserve a unique source match; metadata and balance
corrections retain the original source evidence that established the pair.
evidence marks the reviewed effective balance per account without changing the
original source reports. Existing ledger suggestions can be selected explicitly, with
`balance_source=existing`, to retain known/reviewed reports or fill a genuinely
missing transfer report from agreeing/sole incoming evidence (see below). A separate pair
requires `dismissed_ledger_matches` containing every current suggestion ID and
`acknowledge_distinct_ledger_matches=true`; the server checks those IDs again
before creating one transaction with both sources. HTTP 409 reports
stale/resolved/nonmatching sources. HTTP 400 reports missing acknowledgments or
invalid drafts. Ownership failures return 404. Retries for the same resolved pair
are idempotent, and every failure rolls back all decisions. All responses are
private/no-store. Statement fees remain separate. The pending queue applies date
and source filters before its safety cap; broad queues are still bounded.
The optional `source` filter bounds the comparison work; the response still
contains one item per matched SMS/statement pair.
`GET /api/messages/review/{id}/` reads a single owned pending SMS candidate for
deep links. Apply `transactions.0008_transferevidence_effective_balance` and
deploy API before web.
Queue, detail and confirmation all enforce reciprocal uniqueness. A pair also
requires matching reference, reported balance, normalized counterparty, or known
transfer counterpart in addition to account/currency/direction/amount/date.
Amount/date alone is deliberately insufficient.

Transaction source-message responses optionally add `parsed` (nullable): saved
SMS amount, balance_after, reference and type. These fields remain available after
raw-text redaction, only for confirmed candidates attached to that owned ledger
entry. Existing clients can ignore the optional field.

## Citytouch statement code directory

The authenticated statement-code GET/POST and DELETE endpoints expose the
visible digits (four to 24) of recurring second codes from saved City Bank
`CT-FT` rows. Existing four-digit codes remain valid. A longer visible code is
kept distinct even when its last four digits match another code. Masked digits
cannot be recovered, so an otherwise identical four-digit suffix remains
ambiguous. GET also returns `printed_code`, the complete printed second segment
from a saved row (or null when none remains), for display without changing the
matching key. The
variable first segment is not party identity. Mappings are scoped to the
reporting account and debit/credit direction, and may name an external party
or link a different owned account. Optional type/category choices are
review-only suggestions for pending statement drafts. Responses include masked
recent examples, never the original PDF. The contract adds no automatic ledger
mutation or confirmation operation.

## Paginated transaction activity

`GET /api/transactions/activity/` accepts the transaction list's existing search,
account/category/type/direction/source/date/ordering filters plus `limit` (1–100,
default 25) and `offset` (nonnegative, default 0). It returns required `count`,
nullable `next_offset`, and a `results` array of `Transaction` records. Count is
the filtered owned total; `next_offset=null` ends pagination. Responses are
private/no-store. Malformed paging/UUID/date inputs return 400; missing auth
returns 401. Existing `GET /api/transactions/` remains an array. Offset pagination
is not a historical snapshot: refresh after concurrent ledger changes and
deduplicate IDs when appending. Deploy the API before the new mobile client.

## Shared client presentation

`presentation.ts` provides pure formatting and movement-presentation helpers for
web and mobile: Finance branding, selection colors, exact decimal currency text,
validated `dd/mm/yyyy` read-only dates, local timestamps with the same numeric
date order, ISO input/API values and readable labels.
It contains no React, storage, network or ledger mutation code and does not change
the generated HTTP contract. See [interface conventions](../../docs/interface-conventions.md).
Regression coverage lives in web `tests/presentation.test.cjs` and
`tests/movement-presentation.test.cjs`; both clients typecheck their imports.

## Missing transfer reports in combined linking

`StatementMatch.can_fill_missing_balance` is an additive boolean. It is true only
when the reporting account has no report or only unselected, unreported captured
evidence. Known values (including zero), effective null selections and ambiguous
manual nulls are protected. Clients default the field to false on older servers.
Eligibility is recomputed under the existing user lock; the client flag is not
write authorization.

When linking an existing transfer, `PairDecision.balance_source=existing` fills an
eligible missing account report from agreeing or sole available evidence. If the
incoming SMS and statement differ by Tk 1 or more (or use another currency),
the request must explicitly choose `sms` or `statement`; sub-taka BDT differences
automatically use the higher report; acknowledgement alone is insufficient. Those choices are rejected
for existing known/protected reports. An unavailable source or fee-inclusive
statement report cannot be selected. Existing link conflict, source-version,
ownership, transaction-match and retry protections remain in force. No request
shape or database migration changes; OpenAPI, generated types and the backend
schema snapshot include the new response boolean.


## Evidence proposal/apply boundary

`EvidenceProposalInput`, `EvidenceProposal`, `EvidenceApply` and `EvidenceReceipt`
now publish an attachment-only decision lifecycle. Sources are typed kind/UUID/
component references; nested target, match-signal, balance, field-change, impact
and per-account coverage types are generated. Requests never edit the ledger
amount/type/path. Preview expires after 15 minutes. Apply needs its fingerprint,
a stable user-scoped UUID idempotency key and required acknowledgments; expired
or changed state returns 409 without partial writes. An unchanged accepted retry
returns the receipt and refreshed latest-action Undo availability.

Deploy `reconciliation.0002_evidenceproposal` before clients adopt these routes.
Existing clients keep their current endpoints. See
[the evidence API guide](../../docs/evidence-reconciliation-api.md) for limits,
coverage semantics, retention and synthetic examples. Historical revalidation
and automatic linking remain unavailable.

Synthetic request examples are in `examples/evidence-proposal.create.json` and
`examples/evidence-proposal.apply.json`; replace their illustrative UUIDs and
fingerprint with the actual preview. Contradiction reasons remain explicit even
when another report/reference corroborates a match.

## Sub-taka reconciliation policy

Request/response shapes stay compatible. For BDT differences strictly below
Tk 1.00, SMS-to-statement and statement-to-ledger matching use the higher exact
amount/effective same-account balance during the normal reviewed link action.
No extra rounding acknowledgment is required; Tk 1.00+, non-BDT and unknown
values keep their existing handling. Full multi-source spans are checked rather
than chaining pairwise tolerances. Independent evidence, reciprocal uniqueness,
source versions, ownership, fee exclusions and retry protections still apply.

`StatementMatch.rounding_correction` remains optional nullable comparison
metadata. Eligible suggestions now have `can_link=true`; dependencies blocking
an amount increase retain a readable reason. Optional `amount_correction` still
echoes reviewed amounts/timestamp for stale-write protection, but is no longer
required solely because amounts differ. Supplied balance snapshots must also
remain current; an under-Tk-1 choice automatically uses the higher value even
if an older client requests the lower one. Original SMS/PDF amounts and balances
remain attached; the selected ledger value is audited. No migrations; deploy
API before clients. Evidence proposal/apply remains attachment-only and does
not gain automatic financial mutation through this policy.

### Confirmed transaction revalidation

`GET /api/transactions/{id}/revalidate/` is a private, read-only preview against
attached confirmed evidence/current SMS rules. It returns `suggestions` with stable
selection keys, exact current/proposed text, `sources`, `warnings`, policy/fingerprint,
`token` and `expires_in: 900`. The `ledger` snapshot contains date, type, amount
and account-specific direction and balance. Each source includes reporting
account, currency, direction, date and `issues` explaining unusable evidence.
No SMS body is returned. All suggestions require explicit selection;
opening/refreshing never applies corrections.

Saved SMS sources also return nullable `time` and `raw_message` ID for identifying
an individual message. `POST /api/transactions/{id}/correct-sms-evidence/` accepts
`token`, confirmed SMS `candidate`, `action: move|unlink`, and `account` for a
move. It returns the updated Transaction. It corrects one transfer source under
the same 15-minute stale-preview and ownership checks, without editing the
movement or the original SMS. A move requires the saved direction to match the
target transfer side; unlink returns the candidate to review. Invalid choices
are 400, foreign records 404, and stale previews 409. Latest-action Undo applies.

`POST /api/transactions/{id}/apply-revalidation/` accepts only a preview `token` and
`selected` keys (1–4). It returns the updated Transaction. Invalid selections are
400; other users' records are 404; invalid/expired/stale or previously consumed
successful previews are 409. Source/ledger state is recomputed under locks before
applying an atomic, audited update with latest-action Undo. No client-authored money
values, account changes, automatic posting or new evidence links are accepted.
Eligible financial repairs use the higher BDT value for a full span < Tk 1, or
explicitly restore a missing reported balance. Compatible current-rule category
suggestions are optional. Larger conflicts, fees, unsafe source identity and
business dependencies stay manual. Sources remain unchanged. No migration required;
API deployment must precede the web client. Generated TypeScript/schema snapshot
include both additive actions; older clients continue to work.

### Bulk revalidation API boundary

`GET /api/transactions/revalidation/` accepts `limit` (1–25, default 20) and an
optional opaque signed `cursor` (max 4096 characters). It returns initial `total`,
cumulative `scanned`, `started_at`, nullable `next_cursor`, and `results` containing
context plus a standard RevalidationPreview. Entries with neither corrections nor
warnings are omitted. `next_cursor: null` marks completion even if deletions made
the checked count lower than the original total. Cursor scope is all owned saved
transactions, not list filters. It binds user/policy, a creation cutoff and keyset
position for one hour; new entries require a fresh scan. Each preview separately
expires after 900 seconds and must be rechecked when applying.

`POST /api/transactions/apply-revalidation/` accepts `items` (1–25), each with a
unique `transaction`, signed `token`, and nonempty selected offered keys. It returns
`applied` IDs, a server `batch` UUID and nullable `undo_action`. Every preview is
validated before writes; the complete group commits or rolls back together.
Invalid envelopes/selections are 400, unavailable/foreign records 404, and
expired/changed/replayed previews 409. Both routes require auth and use private
no-store. They never accept client-authored corrected money or reassign sources.

TransactionAction additionally supports `kind: bulk_revalidate`; labels drive the
existing recovery UI, and Undo covers all entries in that latest group. Multiple
groups are independent. On an uncertain response, refresh and review instead of
blindly retrying. No schema migration is required. Deploy API first, regenerate
TypeScript and check the backend structural snapshot with the documented commands.

### EBL delayed-posting review flag

`StatementMatch`, `PendingSmsStatementMatch` and `UnifiedPendingMatch` include
`late_posting`. It is true only when SMS time aligns with the EBL printed value
date but precedes posting by at least two days. Clients label the two reported
balances by source time and omit a cross-time balance choice. The API keeps the
SMS-time transaction report and statement posting report separately; source IDs,
ownership, stale-review and uniqueness checks remain mandatory.

# Archived bKash direction review

`POST /api/statements/imports/{id}/recheck-directions/` is a read-only, owner-scoped comparison of an archived PDF with saved principal rows and linked entries. It returns only rows needing attention and withholds a fresh direction when row identity does not match. `POST /api/statements/rows/{id}/review-source-direction/` stores a user's verified Out/In direction separately from immutable extraction; optional draft alignment requires any linked ledger entry to agree. Neither endpoint modifies a ledger transaction. Both are versioned in OpenAPI and the generated client.

`POST /api/review/pair/preview/` accepts an optional reviewed `sms_account`
without saving. `sms_account_changed` tells clients to request explicit
account-correction acknowledgment. Confirming with `sms_account` requires
`acknowledge_sms_account_override` when it changes the saved parsed account;
original SMS text and direction remain unchanged.
The same read-only preview accepts an optional versioned statement `draft` and
returns `ledger_matches` and `ledger_matching_truncated` evaluated against it.
Clients should review those suggestions before sending exact dismissed IDs at
confirmation; the server checks them again under the user lock.

## Account logo field

`Account`, `AccountCreateRequest` and `AccountPatchRequest` support optional
`logo`: a PNG/JPEG/WebP base64 data URL, up to 1 MiB decoded (maximum encoded
length 1398136), or an empty string to remove it. Omitted updates preserve the
current image. Responses use a normalized 128px WebP data URL or an empty
string. External URLs and SVG are not accepted. Logos use existing account
ownership permissions and require the account-logo API migration before the
new web client. Older clients may omit or ignore this additive field.

### EBL statement-code profile

`StatementCodeMappingInput.profile` and `StatementCounterpartyCode.profile` also
accept `ebl_bank`. The observed code is `npsb:code:<6–24 full printed digits>`;
it is a clue requiring user verification, never a `//` movement reference or
masked reporting card. Existing validation/ownership, per-account direction
scope and no-store responses apply. EBL bank/savings mappings suggest pending
row metadata only. Possible companion charges remain separate review hints and
do not inherit transfer identity mappings or count as independent observations.

The existing `POST /api/statements/imports/{id}/refresh-identifiers/` additionally
supports EBL bank archives with the same optional password, digest/fingerprint
checks and `updated_rows` response. Only missing encrypted code evidence and its
version change; no financial values, source snapshots, links or ledger entries
are rewritten. API deployment must precede the web client. No new route or model
migration is required.
