# API Contracts Q&A

### What does an ATM cash-withdrawal candidate return?

The existing parsed-candidate fields report `message_kind=cash_out`,
`source_direction=debit`, `transaction_type=transfer`, and
`suggested_transfer_direction=debit`. `destination_account` is suggested only
when exactly one active, same-currency cash account is eligible; otherwise it
is null and `transfer_suggestion_reason` explains the choice. The confirmation
API still requires a destination for a transfer and accepts an explicit Expense
choice. The response shape is unchanged.

### What does the transaction issue-scan response contain?

`GET /api/transactions/issues/?limit=50&offset=0` returns `scanned`, `total`,
`next_offset`, and `results` with transaction ID, date, account, amount, and
issue `code`, `level`, and `text`. It is authenticated, user-scoped, read-only,
and omits original SMS bodies. `limit` is at most 100.
Direction disagreements use `sms_source_direction_mismatch`,
`statement_source_direction_mismatch`, or `statement_draft_direction_mismatch`.
`ParsedMessageCandidate.source_direction` is read-only and may be blank when the
SMS does not determine debit versus credit.

### How does the profile editor cross the API boundary?

`PATCH /api/auth/me/` accepts optional `first_name`, `last_name`, and `email`
fields and returns the normal `User` response. It requires the current user's
token; it cannot rename another user or change username/password. Web theme
preference is local to the browser and is not part of the API contract.

### Which endpoints reveal original sources?

Authenticated statement owners can GET `/api/statements/imports/{id}/original/`
for a no-store PDF, and payment-method owners can GET
`/api/payment-methods/{id}/original-identifiers/` for exact entered identifiers.
Normal list/detail responses remain masked; `has_original_file` reports archive
availability. Existing SMS import with `reprocess_existing` can restore a
hash-matching redacted body without duplicating a transaction.

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
- Owner-scoped category usage counts from posted ledger transactions, including unused categories
- Category deletion returns 204 on success or a 400 validation error when linked records protect it
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
`ParsedMessageKind` includes `bill_payment` for confirmed bKash bill receipts;
their active category and biller are suggestions returned on the candidate,
and ordinary purchase mappings do not apply to that kind.
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
Pending candidates without a reporting account are omitted from suggestions;
requesting a match for such a candidate returns HTTP 400 with an `account`
field error. An incomplete neighboring SMS does not fail another draft's lookup.

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
and redaction time. A confirmed SMS attached to this transaction also has a
parsed summary with `candidate_id` and `can_remember_cash_route`; only a verified
debit transfer into an active same-currency cash account sets the latter true.
The client may use that ID with the separate optional remember endpoint.
It includes the primary SMS and linked transfer messages.
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

Account corrections remap manual observations and clear obsolete manual reported
balances/fees. Captured SMS/PDF observations keep their original account,
direction and source values but no longer supply reports if outside the current
transfer path. Reclassification preserves `transfer_evidence` as history and
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
Changing a captured SMS or PDF balance through a transfer update selects a
separate reviewed report; the captured observation keeps its original value.
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

For EBL electronic credit-card PDFs, each row additionally carries optional
`statement_date`, `source_currency`, `source_amount`, `settlement_currency`, and
`printed_direction_marker` (`D` or `C`). The `amount` is the BDT settlement
amount; `balance_after` remains null because monthly outstanding is not a
reported balance after that row. The selected account must be a BDT credit-card
account. All other profiles keep their existing row contract.

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
are authenticated and no-store. Original PDFs are archived encrypted and served
only to their owner through the binary download endpoint; unlock passwords are
never saved.

### What are the statement review assistance boundaries?

Match strength is an explanation heuristic, not permission to merge. Review payloads
carry draft issues and optional remembered classification suggestions. Learning is
opt-in via `remember_choices` on individual create/link. Summary is user-scoped,
no-store and uses draft observation amounts (linked ledger amounts may differ after
correction). Selected actions accept create/skip and max 50 IDs/versions; stale,
matched or discrepant create rows return unresolved reasons. Skip retains ledger data.
For bKash card-funded credits, `review.suggestion` may include optional
`account_candidates` (`account` UUID and `name`) derived from a trailing City/EBL
bank label. These are choices, not an assigned `other_account`; source extraction,
draft fields and ledger decisions remain separate.

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
After an endpoint correction, `transfer_evidence` still includes original SMS/PDF
observations, even if their account or direction no longer matches the ledger
transfer. `reported_balances` and statement reconciliation use only observations
applicable to the current path; clients should show historical source evidence
separately from current effective reports. CSV text cells are escaped against
spreadsheet formulas, and a zero reported balance is exported as `0.00`.
Reversing a captured transfer without reviewed replacement balances returns a
null legacy `balance_after`; the original captured values remain in
`transfer_evidence`. Older unmatched scalar values are suppressed in responses
and statement reconciliation until a current account-bound report is provided.

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
For equal-amount suggestions, `ledger_date`, `ledger_time`, `ledger_source`,
`ledger_reference`, `ledger_note`, `ledger_counterparty_text` and
`ledger_source_balance_after` describe the saved candidate's own account side.
`reporting_observation_is_fallback` says the statement-account observation is
missing; its date is then only a search hint, not corroborating evidence.

`StatementMatch.category_id` carries the ledger category ID, including null.
When a saved statement draft is linked directly with a different nonempty category, `link` requires
`category_choice` with `keep` (`existing`, `statement`, or `custom`) and the
reviewed `existing_category` and `statement_category` IDs (or null). `custom`
also requires `category`, an active owned category ID or null for Uncategorized.
Choices for another action return 400; stale reviewed IDs return 409. The selected
category updates the one ledger entry atomically with the statement link. Clients
must not assume a balance choice also decides the category.


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
When detailed pending-SMS matching is inconclusive, the row detail exposes a
null match count and an empty advisory array; individual posting rejects even
`allow_separate`, and bulk posting leaves the row unresolved. Zero still means
a completed check found no eligible pending SMS.

### What is the unified pending-review contract?

`/api/review/pending/` returns paginated possible review pairs as
`{statement, sms, match, needs_decision}` records, with account, statement-date and combined-source
search filters applied before pair pagination. The optional `condition` query
parameter accepts `all`, `strong`, `possible`, `balance_differs`, `type_differs`,
`needs_correction`, or `needs_decision` and also filters before pagination. It accepts an opaque cursor and
returns `next_cursor` plus matched/ambiguous/statement-only/SMS-only overview
counts, which stay scoped to account and date but are independent of search and
condition. Unmatched sources remain in their individual workflows; one-to-many
options appear as contested pairs. Legacy offset remains accepted.
Each pending source summary includes a nullable `value_date`: statement rows
expose their saved printed value date, while SMS summaries return `null`. This
allows clients to distinguish a late statement posting from an SMS date mismatch
without changing the original statement date or either reported balance.
Reported balances less than BDT 1 apart may corroborate a pending pair and
automatically use the higher exact report, without an extra balance choice. The unified confirm endpoint does
not require `acknowledge_conflict` solely for that sub-Tk-1 source difference;
Tk 1 or more and separate ledger conflicts still require it. Neither source
report is rounded.
`GET /api/review/pair/` returns owned pending-source evidence, normalized SMS
account perspective, ledger suggestions, and `competing_sources` with source
summaries, retained text, and revision tokens.
`POST /api/review/pair/preview/` accepts the same source IDs and an optional
owned `sms_account` chosen in the SMS form. It applies that account perspective
to match and competitor checks without saving it, and returns
`sms_account_changed` when the selected account differs from the saved parsed
candidate. The pair decision must send the same account and
`acknowledge_sms_account_override=true` after explicit source review. Confirmation
then corrects the parsed reporting account atomically with the pair; original SMS
text and captured direction remain unchanged. Edits to amount or direction do
not manufacture a match.
The preview can also take a versioned statement `draft` and returns ledger
suggestions for that edited result. Confirmation still recomputes and compares
the exact suggested IDs before writing, so a later change requires fresh review.
For transfer drafts, both preview and confirmation validate the chosen destination
against the selected statement row: it must be a different active account owned
by the user and use the statement currency. Preview only checks; it does not
save the draft or create a transaction.
An optional pending-queue `source` filter bounds comparison work, while results
remain matched pairs rather than separate source rows.
The POST takes both IDs, statement version, SMS updated timestamp, balance choice
and explicit acknowledgments; it returns one transaction ID shared by both sources.
An optional `draft` carries reviewed statement-row fields and its matching version.
`type_choice` identifies `statement`, `sms`, or `custom` when parsed types differ;
the final draft type must agree with that choice. The server saves edits and the
pair decision atomically, rechecking the selected match for date, direction or amount
changes while preserving the two original source observations.
Contested confirmation requires exact `competing_source_tokens` from the preview
and `acknowledge_competing_sources=true`; other sources remain pending. A changed
competitor set returns 409, and a missing acknowledgment returns 400.
400 means invalid values/missing review, 409 means stale/resolved/nonmatching
sources, and 404 covers unavailable/foreign sources. Pair retries return unchanged
without another movement. To create a separate pair despite ledger suggestions,
submit all current suggestion UUIDs in `dismissed_ledger_matches` with
`acknowledge_distinct_ledger_matches=true`. The API rejects a missing review
with 400 or a changed suggestion set with 409; linking an existing entry cannot
dismiss suggestions.
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
The snapshot is generated against PostgreSQL, matching CI and production;
SQLite's backend-dependent integer bounds differ and are not used as the
canonical contract.

`GET /api/messages/review/{id}/` returns one owned, still-pending SMS candidate
for direct inbox navigation. `review.pending_sms_match_count` is nullable: null
means the bounded list check was inconclusive, while zero means a completed
check found no match. The pair endpoint rejects selecting a missing balance
when the other source reports one; the chosen transfer balance becomes the
effective account report. Apply the new transfer-evidence migration before API
rollout.

Queue, detail and POST all verify the selected pair and surface competitors. Account, currency,
direction, amount and date are necessary, while reference, reported balance,
normalized counterparty or known transfer counterpart supplies independent
corroboration; amount/date alone does not create a pair.

### What is the Citytouch counterparty-code API boundary?

Authenticated `GET /api/statements/counterparty-codes/` returns all visible
digits (four to 24) of the second Citytouch code by statement account and
debit/credit direction, with `printed_code` showing the complete printed second
segment as printed in an observed row (or null if no row remains), plus
counts, recent masked examples and an optional saved mapping. `POST` upserts a
mapping for a code observed in that user's saved City Bank statements;
`DELETE /{id}/` forgets it. The mapping may hold an external label or a
different active owned account in the same currency, plus an optional
direction-compatible transaction type and category. Foreign account/category
IDs, unobserved codes and external `transfer` suggestions return 400. This is
review metadata only: no endpoint creates or edits a ledger transaction.

The same endpoint now includes `profile` (`city_bank` or `bkash`) on each
observed identifier and accepts it on mapping writes (omission defaults to
`city_bank` for older clients). bKash codes are typed recipient/recharge phone
or merchant/biller-name clues, scoped to a wallet and direction. Transaction
IDs are never accepted as recurring codes. The raw bKash code is retained
encrypted with its statement row; the mapping stores a digest. Re-uploading
an identical older PDF can fill a missing code after source-fingerprint checks,
without changing reviewed draft or ledger fields.

New statement previews also expose optional `citytouch_printed_code` on each
source row. It is the second Citytouch component exactly as printed, including
all visible digits or the bank's mask; other profiles return null. The ordinary description remains
masked. This field supports encrypted server-side code retention and the
temporary maintenance refresh; it never authorizes an automatic mapping.
Saved row responses also include a read-only, nullable
`citytouch_printed_code`; row search includes it. The masked `extracted`
description and editable draft fields are unchanged.

### How does the statement list expose a pending unified SMS pair?

`GET /api/statements/imports/{id}/rows/` returns
`review.unified_pending_sms_pair_id` for a unique reciprocal SMS suggestion,
including pairs whose parsed types differ. `review.unified_pending_sms_status`
distinguishes `none`, `unique`, `ambiguous`, and `unavailable`; the ID is null
unless status is `unique`. The older `pending_sms_match_count` remains the
stricter same-type counter and can be zero for such a pair. Search is scoped to
the selected import and covers saved draft and extracted row values before
pagination.
Optional `sms_status=unique|ambiguous|possible|none|unavailable` filters pending
rows before pagination. `possible` denotes a same-type pending SMS suggestion
when no unique pair is available; resolved rows are omitted.
Optional `ordering` sorts filtered rows before pagination. Values are `source`
(default), `date_desc`, `date_asc`, `amount_desc`, and `amount_asc`; missing
values stay last and ties preserve statement order.

### Does HTTP 200 mean a whole SMS batch was successfully imported?

No. `/api/messages/import/batch/` returns an envelope with one `client_id`/`status`
receipt per submitted message. Clients acknowledge only individually confirmed
200/201 items with saved message IDs. Validation failures remain for correction;
temporary failures and uncertain, incomplete or malformed responses remain queued
for idempotent retry using the same device IDs/body/timestamps. Invalid envelope
IDs or more than 25 items return 400 without partial writes. Reprocessing and
explicit restoration flags retain the single-message contract.
Q: How does archived bKash/EBL identifier refresh cross the API boundary?
A: `POST /api/statements/imports/{id}/refresh-identifiers/` accepts an optional
PDF password and returns `updated_rows`. The action is owner-scoped, no-store,
limited to 20 PDF requests/hour/user independently of uploads, and revalidates
archived bytes and row fingerprints. Failed requests also count; 429 does not
consume or block upload/preview allowance. Statement review
suggestions may include a verified note; counterparty code mappings accept and
return `note_template`.

### What is the mobile transaction activity contract?

`GET /api/transactions/activity/` adds a bounded page envelope while retaining the
legacy list's array response. It reuses list filters and takes limit 1–100
(default 25) and nonnegative offset (default 0); count is the filtered user-owned
total, next_offset is null at the end, and results contains normal Transaction
objects. Mobile aborts superseded requests and deduplicates appended IDs. Offset
pages are refreshed after concurrent ledger changes. API deployment precedes
mobile distribution; no database migration is needed.

### Does sharing presentation helpers change the API boundary?

No. `finance-contracts/presentation.ts` is dependency-free client code, like the
existing Quick Add/transfer helpers. Web and native import it directly; generated
OpenAPI types, decimal strings, date/time payloads, evidence and ownership rules
remain unchanged. Formatting belongs to clients; financial calculations and
validation remain authoritative on the API.


### What contract supports late evidence and future review clients?

Authenticated `POST /api/reconciliation/proposals/` accepts up to one SMS principal
and one statement component from the same reporting account, with an optional
existing target. No target means discovery only; a new target-specific preview is
required before apply. Typed coverage separates SMS candidate IDs, statement row
IDs, legacy SMS and manual observations per account. It does not equate SMS+PDF
on one side with both transfer accounts reporting.

`POST /api/reconciliation/proposals/{id}/apply/` requires the preview fingerprint,
a stable UUID retry key and acknowledgments. It returns an attachment receipt,
zero added movements, selected account balances and latest-action Undo metadata.
Known or uncertain/cleared reports stay intact; only eligible missing transfer
reports can fill. HTTP 400 is a blocked/invalid decision, 404 an unavailable owned
resource, 409 expired/stale/conflicting state. All responses are no-store.
Unknown input fields are rejected. OpenAPI and generated TypeScript cover this
boundary; web intent/coverage integration follows separately. Migration precedes
client rollout; installed clients keep their old routes.

### What does a sub-taka difference mean at the API boundary?

For BDT, a strictly sub-Tk-1 difference in eligible SMS/PDF or statement/ledger
amounts and same-account balances automatically uses the higher exact value at
link time. Existing shapes remain: `rounding_correction` is comparison metadata,
`can_link` reports eligibility, optional amount/timestamp snapshots retain stale
write protection, and normal source versions/ownership checks remain mandatory.
Supplied balance snapshots are validated before the automatic choice. Larger
spans and other currencies retain existing rules. Originals remain evidence;
audit history records the canonical result. This does not auto-post or broaden
the attachment-only proposal API into financial corrections. No migration.

### What is the confirmed-transaction correction boundary?

GET transactions/{id}/revalidate returns a private no-store, user-scoped preview
and a signed 900-second token. It includes a current `ledger` snapshot and each
source's reporting account, currency, direction, date and incompatibility
`issues`; original message bodies remain excluded. POST apply-revalidation accepts token and selected
offered keys only; the server recomputes corrections under locks. Ownership is 404,
invalid selections 400 and expired/stale/replayed previews 409. The atomic response
is the existing Transaction shape, with audit and Undo. No migration or mandatory
old-client changes; deploy API before web. Source evidence is never rewritten and
no new movement is posted.

### How can one saved transfer SMS link be corrected?

The revalidation preview identifies a Saved SMS by candidate ID and returns its
date/time and nullable raw-message ID without embedding private body text.
`POST /api/transactions/{id}/correct-sms-evidence/` requires its signed token,
that candidate ID and `move` or `unlink`; a move also names the receiving account.
The server validates ownership, freshness and saved direction, then returns the
updated Transaction. A stale preview is 409. The action changes one evidence
link, not the transaction movement, and is audited and undoable.

### What should a client do with bulk correction previews?

Consume the signed all-ledger scan cursor in pages, using next_cursor null rather
than checked == total to detect completion. Keep each transaction's own 900-second
preview token with its displayed fields. Apply only explicitly selected keys in
groups of 1–25 unique entries. Each group is atomic and returns applied IDs plus a
whole-group Undo action. Stop on failed/uncertain responses; refresh and obtain a
new explicit selection, never silently retry mutations. Cursor user/policy scope,
source ownership and fresh financial fingerprints are verified server-side.
New entries after scan start appear on a new scan. No import, resync or migration.

### What does `late_posting` mean on review matches?

It is a boolean on `StatementMatch`, `PendingSmsStatementMatch` and
`UnifiedPendingMatch`. The EBL statement posting date is at least two days after
SMS evidence near its printed value date. Clients must not compare those running
balances as if reported at the same time or offer a cross-time balance choice.
The statement row and SMS candidate still expose exact balances separately.

### How are historical source directions refreshed?

`POST /api/transactions/refresh-evidence-directions/` accepts `limit` (1–100)
and `offset` (zero-based). Each page returns SMS and principal-statement checked
and total counts, known/unknown counts, SMS update count, and `next_offset`.
Clients continue until `next_offset` is null. This endpoint only fills blank,
unambiguous SMS parser observations; it does not update ledger transactions or
immutable PDF extractions. `GET /api/transactions/issues/` is the separate
read-only ledger mismatch scan.

### What do the bKash archived direction endpoints guarantee?

The import-level recheck is authenticated, owner-scoped, throttled and read-only; mismatched row identity yields no asserted fresh direction. The row-level review requires a saved archive, explicit PDF confirmation and the current row version. It preserves original extraction, audits the human correction, and can align a saved draft only when a linked ledger entry already agrees. Neither endpoint edits ledger transactions.

### How does SMS confirmation handle a pending PDF match?

`POST /api/messages/review/{id}/statement-matches/` accepts the SMS review
draft and returns bounded statement suggestions plus a uniqueness flag. The
confirm request can carry `distinct_statement_rows` and
`acknowledge_distinct_statements`; without an exact acknowledged set, a
corroborated pending row returns 409. This protects direct API callers as well
as the web flow. The lookup is read-only, and the pair endpoint remains the
way to attach both sources to one movement.

## How do clients customize an account logo?

Create or PATCH an owned account with optional `logo`, a PNG/JPEG/WebP base64
data URL up to 1 MiB decoded. The API verifies and normalizes it to a metadata-free
128px WebP and returns the small embedded image in Account. An empty string
removes it; omission preserves it. No remote URLs, anonymous image endpoint or
ledger mutation is introduced. Existing accounts and older clients use the
empty-logo fallback. Deploy migration `accounts.0003_account_logo` first.

### What is the EBL description mapping contract?

`ebl_bank` accepts observed `ebl:keyword:salary|patapay|bkash` or
`ebl:bkash:phone:<explicit recipient>` values. `npsb:masked` and `npsb:code` are
rejected and cannot suggest a destination, including legacy verified rules.
Payload shapes are unchanged: label, external/owned party, optional other account,
direction-compatible type/category and note. Scope remains owner, reporting
account, provider, clue and direction. Cleanup preserves supported verified rules;
stale previews return 409. Migration 0014 retires pre-release NPSB metadata/rules
without rewriting financial data. Deploy migration and API before the client.

### What is the optional identification and cleanup contract?

Observed-code output includes skipped. A scoped skip POST takes account, profile,
code, direction and skipped, without a label; false restores it. Directory state
persists across future imports, and saved code rules are paused while skipped.
Saving a verified mapping explicitly unskips it. Financial rows never change.

Cleanup GET returns retired_identifiers, retired_rules and a signed owner-bound
15-minute revision; POST accepts revision and returns cleared_identifiers and
deleted_rules. Expired/foreign/changed previews return 409 and apply nothing.
Supported verified wording/recipient mappings and ledger values are excluded. Skip migration 0012 must
precede the new API/web clients. The existing confirmed-SMS remember endpoint's
request/response schema is now explicit; its behavior is unchanged.

### What changed in the financial report and planning boundaries?

`GET /api/reports/monthly/` accepts currency/account scope and publishes policy
`spending-v2`, signed net spending, gross spending/refunds, financing, money movement,
full categories/merchants/accounts, and preceding-period totals/comparisons. Ledger
filters support currency, spending-only, needs_review, Uncategorized and exact
`merchant:` search. `GET /api/reports/overview/` supplies owner-scoped, dated account
coverage/current positions and scheduled commitments without claiming complete capture.

Payment-create endpoints accept `ledger_action`, `funding_account` and `request_id`.
`GET /api/planning-payments/{kind}/{parent_id}/?date=...` lists payment history and up
to 100 eligible movements. DELETE on its payment detail removes that planning record,
restores planning progress and preserves the ledger transaction. Kinds are debt,
card and recurring. Legacy omissions keep record-only compatibility.

`GET /api/timeline-order/` lists range placements, withholding stale orders. Account/day
GET returns complete preview data, a conservative suggestion and a revision/fingerprint.
POST applies, clears or undoes display order. Known-time anchor order is protected;
no transaction timestamp or financial value is changed. Deploy the additive migration
and API before the web client. OpenAPI, generated interfaces and backend snapshot
cover these boundaries; clients should not silently fall back to old report semantics.
