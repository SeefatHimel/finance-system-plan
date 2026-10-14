# API Contracts Q&A

## What is the contracts project for?

The contracts project documents the API boundary shared by backend, web, and
mobile. It should eventually contain OpenAPI files, examples, generated client
notes, and contract changelogs.

## Why keep contracts separate?

The API is the agreement between projects. Keeping it separate makes it easier
for web and mobile work to proceed without reading backend internals.

## What should be in the OpenAPI schema?

The schema should include auth endpoints, account endpoints, category endpoints,
transaction endpoints, report endpoints, message endpoints, debt endpoints,
reconciliation endpoints, and audit log endpoints. The current API also
includes credit-card bill and recurring-bill endpoints, so those shapes belong
in the shared contract too.

## How does the web proxy classify session errors?

The web-only Next.js auth/proxy layer distinguishes authentication failure from
availability: current-user/refresh return 401 and clear cookies for confirmed
invalid sessions; upstream failures return 502 and preserve cookies. Login
retains a 429 retry-later response for throttling. The shared Django request and
response schemas are unchanged. Financial API 403 responses remain permission
errors, not automatic logout signals.

## Why generate clients later?

Generated clients reduce repeated request/response typing in web and mobile.
The project now has a first generated TypeScript client workflow in
`projects/finance-contracts/generated/`, produced from `openapi.yaml` by
`scripts/generate_ts_client.py`. Web and mobile still use their local API
helpers today, but this gives the migration target.

## How do you avoid breaking clients?

Avoid renaming fields casually, version breaking changes, add new fields in a
backward-compatible way, and keep changelogs for contract changes.

Validation behavior is part of the contract too. Sender-rule creation returns a
field error when the authenticated user already has the same case-insensitive
sender and match type, so every client can prevent or explain duplicate rules.

## What is the current contract state?

The contracts project now includes `projects/finance-contracts/openapi.yaml`
covering current phase-1 backend endpoints:

- Health
- Auth (`login`, rotated `refresh`, per-session `logout`, authenticated
  `logout-all`, `me`)
- Accounts CRUD
- Categories CRUD
- Payment methods CRUD
- SMS sender rules CRUD
- Raw SMS import with duplicate response shape
- SMS capture-preference read/update endpoints
- Mobile SMS device-health read/heartbeat endpoint
- Parsed SMS review candidate list, confirm, reject/legacy-ignore, and raw SMS redaction endpoints
- Pending SMS candidate bulk reprocess endpoint
- Transactions CRUD and month/account/category/type/direction/source/search list filters
- Transaction CSV export with the same month/account/category/type/direction/source/search filters
- Debt CRUD and repayment endpoint
- Credit card bill CRUD and payment endpoint
- Recurring bill CRUD and payment endpoint
- Monthly report
- Balance snapshot and account reconciliation endpoints
- Read-only audit log endpoints for transaction mutation history

Transaction `search` covers ledger fields, related names and linked observations
for both list and export. Matching is case-insensitive, AND across whitespace
terms (which may match different fields), with quoted phrases and comma-formatted
amounts supported. Activity timestamps use Asia/Dhaka. Queries over 256 characters
or 12 terms return a `search` field error; whitespace-only input adds no restriction.
UUID fragments require at least eight hexadecimal characters.
Raw SMS bodies are excluded and response shapes remain unchanged.

Phase 3 contract work now includes parser fields for provider, message kind,
reference, balance, fee, and possible internal transfer/source-destination
hints. Parsed candidates can also expose a `possible_related_candidate` and
`related_match_reason` when another SMS may be the other side of the same
internal transfer.

Transaction contracts now include strict ledger evidence fields: `direction`,
optional `time`, `balance_after`, `reference`, `counterparty_text`, `payment_method`,
`raw_message`, `external_key`, and separate masked sender/receiver account/card
identifiers. Parsed candidates and SMS confirmation expose the same identifier
fields so corrected evidence survives into the ledger and CSV export.

Account responses now distinguish calculated and reported balances.
`ledger_balance` is the derived opening-balance-plus-transactions value, while
nullable `latest_reported_balance` and `latest_reported_balance_date` identify
the newest provider-reported balance evidence. These fields are read-only and
additive, so existing account create and update requests remain compatible.

Raw message contracts now include `redacted_at` and the `redacted` status so
clients can show when original SMS text has been removed while parsed evidence
is retained.

Raw messages also expose resolved `provider`, `message_kind`, and
`exclusion_reason`. Capture preferences contain excluded providers and message
kinds plus nullable raw-text retention days. Sender rules can store fallback
category and transaction type, and confirmation can opt into `remember_mapping`.
Learned mappings are scoped to both sender rule and detected message kind,
avoiding one global choice for every SMS from a bank.
Rejected candidates expose reason, note, and timestamp; the reject
request can additionally redact the body, disable its sender rule, or exclude
the provider.

Raw message import also accepts optional `reprocess_existing`. Duplicate
responses include `was_reprocessed`, allowing clients to distinguish a new
import, an unchanged duplicate, and a pending candidate refreshed with the
latest parser. Confirmed candidates are never reparsed through this flag.

`GET/POST /api/messages/device-status/` is the shared contract for mobile
permission, background state, pending/failed counts, errors, scan timestamps,
and the API-derived health label shown by web clients.

Audit log contracts expose action, entity type, entity id, metadata, timestamp,
and nullable before/after snapshots. They are read-only and user-scoped.

The contracts project now generates `generated/types.ts` and
`generated/client.ts` from the shared OpenAPI schema. The generated client is a
small fetch wrapper with typed request bodies, path parameters, query objects,
JSON responses, and CSV `Blob` downloads.

The backend also exposes generated OpenAPI docs through `drf-spectacular` at
`/api/schema/` and `/api/docs/`.

## Why is contract-first thinking useful here?

There are three clients or consumers: web, mobile, and possibly scripts/imports.
A clear contract prevents backend implementation details from leaking into the
clients.

## What examples should be added?

Current examples are available in `projects/finance-contracts/examples/`:

- `account.create.json`
- `audit-log.detail.response.json`
- `audit-log.list.response.json`
- `auth.login.request.json`
- `auth.login.response.json`
- `auth.me.response.json`
- `category.create.json`
- `credit-card-bill.create.json`
- `credit-card-bill.payment.create.json`
- `debt.create.json`
- `debt.payment.create.json`
- `payment-method.create.json`
- `raw-message.import.json`
- `raw-message.import.response.json`
- `message-review.confirm.json`
- `message-review.bulk-reprocess.response.json`
- `message-review.list.response.json`
- `message-review.redact.response.json`
- `reconciliation.account.response.json`
- `reconciliation.snapshot.create.json`
- `reconciliation.snapshot.response.json`
- `recurring-bill.create.json`
- `recurring-bill.payment.create.json`
- `sender-rule.create.json`
- `transaction.create.json`
- `transaction.export.csv`
- `transaction.list.response.json`
- `transaction.transfer.create.json`
- `validation-error.response.json`
- `report.monthly.response.json`

Next useful additions:

- Pagination envelope examples if list endpoints add pagination
- Production error examples for rate limits or token expiry

## What trust requirement applies to raw SMS import?

Raw message import requires the sender to match one of the authenticated user's
active rules. An unmatched sender is a validation-style `400`, not an accepted
low-confidence candidate. Sender-rule responses include `pattern` and
`is_active`, which clients must honor for exact, contains, and regex matching.
After trust matching, the API enforces the user's capture preferences before
body persistence. Policy-excluded input returns `201` with no candidate and an
ignored hash-only raw-message tombstone. The same response shape applies to
messages containing no digits; their tombstone uses the
`no_numeric_content` exclusion reason.
Pending, non-redacted review candidates can also be refreshed directly with
`POST /api/messages/review/{candidate_id}/reprocess/`. This is the recovery path
for candidates stored before a parser improvement; confirmed or redacted
candidates are intentionally immutable.
`POST /api/messages/review/reprocess/` performs the same safe refresh for the
authenticated user's complete pending queue and returns processing counts.

## What is the contract for suggested transfer matching?

`POST /api/transactions/transfer-matches/` accepts a manual `draft`, or a SMS
`candidate` plus optional corrected draft fields, and returns `TransferMatch[]`.
Targets can be posted transactions or opposite pending candidates.
`POST /api/transactions/link-transfer/` accepts exactly one `match_transaction`
or `match_candidate` and explicitly links evidence to one transfer.
`POST /api/transactions/{id}/merge-transfer/` accepts the duplicate transaction
id for an audited merge. The response is the retained canonical `Transaction`,
with `transfer_evidence[]` and `account_direction` for the selected account
filter. Manual credit drafts use receiving-account order. Updated SMS clients
set `account_perspective: true`: account is the observed account, direction is
its debit/credit side, and transfer_account is the other account. Credit SMS
drafts normalize to other-account → selected-account, with reported balances
attached to the selected account. Legacy SMS callers omitting the flag retain
canonical source/destination semantics. References need not match across providers.
The three-day matching window is a suggestion rule, never a uniqueness key.

Linked account references remain searchable without returning duplicate rows.
CSV exports append contextual `account_direction` and structured
`transfer_evidence` JSON. Audit snapshots include the normalized evidence
without raw SMS bodies.

## How are transfer account suggestions represented?

Review candidates add optional `suggested_transfer_direction` (blank, debit, or
credit) and `transfer_suggestion_reason` fields. Account/destination hints stay
canonical source/receiver fields. The suggested direction tells clients which
endpoint is the reporting account, including an explicitly remembered direction
correction. Web decoding defaults absent fields to empty strings for older API
responses. These fields explain suggestions; clients still submit the ordinary
review draft and confirmation/link request. No new write endpoint is introduced.

## How are recently added and updated ordering exposed?

Transaction listing accepts `ordering` with enum values `-date` and
`-created_at` and `-updated_at`, defaulting to `-date`. The generated client mirrors
the whitelist. `created_at` and `updated_at` are read-only in transaction responses.
Update time includes new entries, edits, new transfer evidence and merges;
reads and idempotent retries leave it unchanged. To include old transactions
newly added or edited, omit date bounds or choose `date_field=created_at` /
`updated_at` with the desired activity period. CSV
export keeps its existing chronological order and does not accept this option.

## What does learning a skipped message type change in the API?

`ParsedMessageKind` adds `promotional`; default excluded kinds become
`otp_or_security` and `promotional`. `exclude_message_kind=true` on rejection
remembers a recognized promotional, OTP/security or balance-notice exclusion.
Unknown/financial formats return 400 before rejection. Existing preference PATCH
reverses it, and existing review responses reflect ignored pending notices.

## How are original messages exposed for editing without expanding the ledger list?

`GET /api/transactions/{id}/source-messages/` returns a deduplicated array of
`TransactionSourceMessage`: ID, sender, nullable full body, received time, status
and redaction time. It includes the primary SMS and linked transfer messages.
No message gives an empty array; redacted/excluded text gives null. Transaction
and message ownership are checked, with 401/404 for unauthenticated/foreign
access. Responses use private/no-store caching; reading does not update ledger
timestamps. Source-message access does not expand the ledger list or require
SMS text in edit payloads.

## How are corrections to matched transfers represented?

`TransactionPatchRequest` adds optional write-only `allow_linked_correction`.
False/omitted rejects type/account/principal changes for entries with multiple
linked observations. True acknowledges review, while ownership and other
validation still apply. Transfers stay canonical From=`account`,
To=`transfer_account`, direction=debit; reversing swaps the two accounts.

Account corrections remap debit/credit observations and clear obsolete reported
balances/fees. Reclassification preserves `transfer_evidence` as history and
source-message access. Clients must gate active evidence balance display on
`type=transfer`. The API audits the correction and does not change original SMS.
Generated types expose the request flag; existing response timestamps stay
read-only.

## Is a reference the unique transaction ID?

No. `id` is the generated UUID. `reference` is optional and may repeat, including
across both sides of a transfer. Clients must not validate it as unique.
`external_key` remains an opaque retry key: SMS keys now identify a raw capture,
while legacy keys and manual draft keys remain supported. Original response
shapes are unchanged. Reference edits do not bypass same-SMS duplicate guards.

Match suggestions require accounts, equal currency/principal and nearby dates;
time is returned for inspection and reference agreement appears only as
supporting evidence in `reason`. Acceptance remains explicit.

## How should clients clear parsed SMS fields during review?

SMS confirmation uses omission for parsed defaults and explicit `null` to clear
nullable `transfer_account`/`payment_method` fields. Clients reclassifying a transfer
must clear its destination; keeping type `transfer` still requires another account.
API detail and validation-field responses are decoded into readable web feedback;
server failures use safe retry messages without displaying response bodies.

## Which reported balance should clients load for a matched transfer?

Use the transaction balance when present, otherwise the observation marked
`is_primary`. This read-only boolean identifies the report that transaction updates
correct. Keep other account balances separate, preserve zero and leave genuinely
missing balances blank; historical transfer evidence must not supply a balance
after reclassification to another type.

## How do reported balances behave during correction and SMS confirmation?

Type/category/detail corrections preserve a reported balance, including zero,
while its reporting account stays the same. For transfers that is the primary
observation's account, so editing the opposite side does not invalidate it.
Omitted balance retains the report on that account, including primary evidence
when reclassifying a transfer whose main balance was empty. Explicit null clears
it and is not restored by later updates. Account remapping clears omitted or
unchanged carried values; explicitly different replacements are accepted.
SMS confirmation and transfer drafts apply the same rule to parsed balances.
Clients should preserve same-account values and explain clearing on account
changes. Existing request/response fields suffice; no schema change is needed.

## How is statement PDF preview represented in the contract?

The request is multipart `account` + binary `file` + optional write-only
`password`. The response contains rows and summary checks rather than transaction
UUIDs; page/row IDs identify positions within this preview only. Decimal amounts
are strings, absent time/balances are nullable, and `can_post` is false. A matching
identifier suffix is only a hint.

Generated clients send FormData without a JSON Content-Type, and shared schema
types map binary values to Blob. A preview does not establish duplicate identity
or authorize posting; saved review/decision contracts are separate.

## What contracts enable saved statement review?

Imports use multipart creation and paginated history. Saved row responses contain
immutable extraction, editable draft fields, version, state, transaction link and
fresh review suggestions. PATCH requires version; decide supports create/link/
skip/unlink/reopen with explicit separate/discrepancy/conflict acknowledgements.
Stale/conflicting decisions return 409, scoped validation 400 and foreign IDs 404.
Bulk approval accepts at most 50 IDs/versions and reports added/unchanged/unresolved.
Rows support global state/type/category/direction/search/date filters. Transactions
expose a read-only statement evidence count and on-demand evidence endpoint.
Decimal values are strings and unknown time/balance is null. The generated client
supports both multipart uploads and JSON review operations. All source responses
are authenticated and no-store; raw PDFs/passwords never enter saved contracts.

### What are the statement review assistance boundaries?

Match strength is an explanation heuristic, not permission to merge. Review payloads
carry draft issues and optional remembered classification suggestions. Learning is
opt-in via `remember_choices` on individual create/link. Summary is user-scoped,
no-store and uses draft observation amounts (linked ledger amounts may differ after
correction). Selected actions accept create/skip and max 50 IDs/versions; stale,
matched or discrepant create rows return unresolved reasons. Skip retains ledger data.

### What does the statement comparison endpoint guarantee?

The authenticated no-store GET returns component-level comparison counts and
bounded, paginated ledger-only account observations. It excludes confirmed and
suggested matches, exposes incomplete coverage through `complete` and `warnings`,
and has no financial side effects. It does not guarantee absence outside the
statement period or when extraction/matching coverage is incomplete.

Statement suggestions expose the selected reporting-account observation's fields,
not a mixture of canonical and account-side evidence. Clients should show those
fields together; a transfer's canonical ledger date may differ. Fallback search
hints are explained in `reasons` and contain no borrowed sender balance/time/reference.

For statement comparison, `complete=false` also reports edited source/draft
matching values or failed saved-draft reconciliation. Availability and completeness
are distinct: ledger-only results can be available but provisional. Original PDF
coverage and corrected-draft candidates both prevent a false ledger-only label.

Single-row statement responses use the same statement-wide shared-candidate
confidence as the table. `strength=possible` does not forbid explicit individual
acceptance; `can_link` and fresh decision validation still enforce eligibility.
Opening one row cannot bypass the statement-wide matching history limit.

### Can a saved statement link become invalid without being deleted?

Yes. Ledger edits can change the financial identity. The row retains its state
and transaction ID for audit, but review returns `needs_correction` and an issue.
Comparison counts it as needing review; summary counts it as unresolved. Repeated
acceptance returns 409 until the evidence is unlinked and reviewed again.

### Does a daily view need a separate reporting endpoint?

No. The existing report and transaction endpoints accept inclusive start/end dates;
equal dates select one day. Monthly queries remain supported. Reports add period
metadata, nullable month for ranges, daily totals and expense-only category totals.
Paired dates are validated consistently, with a maximum of 366 days.

### Are identifier labels replacements for stored transaction identifiers?

No. They are payment-method metadata, separate from text matching aliases.
Payment-method contracts add bounded typed identifier/alias lists and a primary
identifier kind; the migration defaults existing methods to `any`. Statements
expose advisory account mapping information. Transaction identifiers, amounts,
balances and linked evidence keep their existing contracts.

## Are creation/update date filters independent from transaction dates?

Yes. Transaction list/export accept an explicit `date_field` with the existing
month or paired inclusive range. Import history has its own created/updated
whitelist. Server timestamp days use Asia/Dhaka. The generated TypeScript query
types describe these parameters; invalid/mixed/incomplete ranges return 400.
Comparison ranges filter ledger-only rows before pagination: `count` is filtered,
while `counts` remains whole-statement coverage. Clients must label that distinction
and must not interpret date filtering as a change to matching or ledger evidence.

## What is the account recognition API boundary?

Account create/update adds optional nullable `identity` with provider, primary
identifier/kind, typed additional identifiers and aliases. Ownership and the
shared payment-method ID are server-managed. Omission preserves an existing
profile; null disables it. Values are masked or last-four suffixes, and existing
ledger fields are unchanged. The additive migration precedes deployment.

`POST /api/statements/identify/` accepts multipart file/password without an account,
returns only masked hint/profile and nullable account suggestion, and saves
nothing. It shares preview extraction limits and no-store behavior, with a
separate 10/hour throttle that preserves the import allowance. Only owned,
active compatible BDT accounts can be suggested. Preview/import still require the
chosen account, and suggestions never authorize posting or linking.

## What is the Quick Add contract shared by web and mobile?

Presets live at `/api/quick-add/presets/`; reorder takes the complete owned ID
list. `/api/quick-add/entries/` accepts a UUID, account, positive decimal amount,
local date, nullable time/category, expense/income and web/mobile source. It
returns a transaction ID and replay flag (201 new, 200 replay, 409 conflict).
Clients freeze retries rather than recomputing Now or assigning a new ID after
an uncertain response. Generated types describe the API; portable `quick-add.ts`
helpers share client validation and preset-copy behavior. The API remains the
validation and ledger authority.

## How are transfer balances separated from transfer direction?

`reported_balances` is a bounded list of owned endpoint account IDs and nullable
balances. `balance_reporting_account` identifies the primary legacy report owner.
From/To determine debit/credit and the positive amount, rather than reporting-account
position. Swapping endpoints preserves account-bound balances. A second report is
an observation of the same transfer, not another ledger record. Unknown values are
null, and negative reported balances are valid. Non-transfer/unrelated/duplicate
account reports return validation errors; legacy scalar inputs remain supported.

### What must clients send when transfer balances disagree?

Match responses carry `reported_balances`. Link and merge requests send
`balance_choices` for each same-account disagreement, naming the account,
which entry to keep, and both reviewed balances. A readable 400 means choices
are missing, invalid or stale; no merge is performed. Do not compare balances
between different accounts or treat null as zero. Deploy the API first.

### How do clients handle shorter account/card suffixes?

Three ending digits are the minimum; three-digit overlap is review-only. Optional
SMS `identity_suggestions` contains role, masked observations, reason and owned
account/method choices; older responses default to `[]`. Clients clear weak
defaults, preserve other draft edits and require explicit confirmation. Transfer
drafts use the selected account's `account_perspective` and direction. Statement
suggestions add optional `requires_review`/`choices` while keeping weak/colliding
`account` null and preview identity `verify`. Full-number last-four privacy and
existing ownership checks are unchanged.

### What is the Edit/Undo API contract?

Optional `undo_action` metadata accompanies supported mutations. Clients fetch
`/api/transactions/recent-action/` for durable latest-action controls and POST an
opaque action UUID to `/api/transactions/undo/`. Never send restoration snapshots.
Ownership violations return 404; superseded, expired or changed state returns 409.
A retry of completed undo has no additional effect. Deploy the recovery migration
before clients. Unknown additive fields do not break older mobile/web clients.

### What do account report comparison fields mean?

The optional decimal strings `ledger_balance_at_latest_report` and
`latest_reported_balance_difference` represent the ledger at the report's cutoff
and report minus that ledger. `reported_balance_comparison` distinguishes
matched/mismatch from unavailable, card references, unknown timing and reports
preceding a movement. Missing fields default to null/unavailable in web; clients
must not manufacture a mismatch using today's balance. The additive response
needs an API deployment but no database migration.

### What must clients submit for a statement balance conflict?

`StatementDecision.balance_choice` contains `keep` (`existing` or `statement`),
`existing_balance_after`, and `statement_balance_after` as decimal strings or null.
Clients display the current `StatementMatch.effective_balance_after`, rather than
assuming an historical observation is the effective report. Conflict links require
a choice even if `acknowledge_conflict=true`; changed reviewed values return 409.
Deploy the web and API changes together. No model or migration changes are needed.


### What is the contract for filling missing statement details?

`StatementMatch.detail_suggestions` returns field, label, existing_value and
suggested_value. `StatementDecision.detail_choices` optionally submits selected
field/existing_value/value triples for a link, up to seven unique metadata fields.
Stale snapshots return 409; unsupported fields, invalid masks, blank selected
values and duplicate selections return readable 400 errors. No date/time, money,
classification or account-path changes are accepted through this list.

### How does combined pending SMS and statement review work at the API boundary?

Statement row detail `review.pending_sms_matches` is a bounded advisory list;
paginated row lists expose `review.pending_sms_match_count` from a bounded batch
lookup while keeping the detailed candidate array empty. A `combine_sms`
decision requires the pending candidate UUID and statement row version. A reported
balance conflict requires `balance_choice` with exact reviewed SMS and statement
values. If ledger suggestions coexist, submit their exact UUIDs in
`dismissed_ledger_matches` with `acknowledge_distinct_ledger_matches=true`; the
server returns 409 if the current suggestion IDs differ. The API revalidates both sources atomically and returns 409 for stale
review. SMS-only and statement-only endpoints keep their existing behavior.

### What is the unified pending-review contract?

`/api/review/pending/` returns paginated source observations and review-only
opposite-source suggestions, with filters applied before pagination.
`GET /api/review/pair/` returns owned pending-source evidence and ledger suggestions.
The POST takes both IDs, statement version, SMS updated timestamp, balance choice
and explicit acknowledgments; it returns one transaction ID shared by both sources.
400 means invalid values/missing review, 409 means stale/resolved/nonmatching
sources, and 404 covers unavailable/foreign sources. Pair retries return unchanged
without another movement. Existing ledger suggestions cannot be silently bypassed.
Source-message retrieval includes attached confirmed candidates as well as primary
and transfer raw-message links. Deploy the API and run the transfer-evidence
migration described below before rolling out the updated web review.

## Schema drift gate

**How does CI catch API contract drift?** It generates the Django OpenAPI
schema, compares a structural snapshot of operations and component schemas,
and checks that every published contract operation (apart from the simple
health endpoint) still exists. A backend API change requires reviewing and
updating the snapshot and, when relevant, `openapi.yaml` and generated TypeScript
types. The bounded SMS review response and dashboard summary are documented
in the shared contract.

`GET /api/messages/review/{id}/` returns one owned, still-pending SMS candidate
for direct inbox navigation. `review.pending_sms_match_count` is nullable: null
means the bounded list check was inconclusive, while zero means a completed
check found no match. The pair endpoint rejects selecting a missing balance
when the other source reports one; the chosen transfer balance becomes the
effective account report. Apply the new transfer-evidence migration before API
rollout.
