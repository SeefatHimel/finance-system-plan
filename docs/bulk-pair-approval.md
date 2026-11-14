# Bulk approval of SMS + statement pairs

## User workflow

Open **Review inbox → Matched sources**, filter the queue, and select individual
pairs or **Select this page**. Selections survive pagination, up to 25 pairs;
changing filters or refreshing matches clears them. **Review selected** opens a
preview in the same page, without writing any data. It shows final transaction
values, source comparisons, highlighted
agreements/differences, totals per currency and reasons for individual review.
Source excerpts can be expanded without losing the selection.

Review the ready pairs, tick the single final confirmation and choose
**Approve ready (N)**. Only the ready subset is submitted. The rest remains
pending with an individual-review shortcut. Transfers appear in a separate total;
they are not presented as income or spending. Filters stay in place after saving.
Errors use toasts, with an inline refresh/retry action when necessary.

Before confirming, edit **Category**, **Merchant / counterparty** or **Notes** directly in each
card. Category defaults use the same precedence as individual review: a compatible
saved statement category, a compatible statement mapping, then the live compatible
SMS suggestion when types agree. Suggestions are visible defaults, not saved rules.
**Apply category to compatible pairs** affects only selected pairs whose unchanged
transaction type supports that category; other types keep their choice.

Expand **Set category or merchant for selected pairs** to use the shared controls.
Enter a merchant (for example, Pathao Pay) and choose **Apply merchant to N selected
pairs** to set it once for the current selection. Notes remain untouched. The API
field is still named `description` for compatibility; it saves the ledger merchant
as `counterparty_text`. Original provider/service wording (such as Pathao Bike)
stays in source evidence. This does not change the account/provider or create a
rule for future messages. Edited blocked pairs remain unposted until their checks
are resolved individually.

Any edit clears confirmation and disables approval until **Recheck changes** runs
on the server. The final preview shows the exact metadata and financial values to
be recorded. No edit changes amount, debit/credit, account path, dates, reported
balance, fees or original source identity. Changing text cannot upgrade a weak
match or dismiss a conflict. Blockers name the source warning, failed check and
expected/observed values when available. Individual review opens original sources;
unapplied bulk edits are not saved by switching to that review.

Bulk approval deliberately excludes uncertain matches. A ready pair needs:

- Owned, active, same-currency accounts, compatible active category and explicit
  original debit/credit evidence agreeing with the saved draft.
- A strong, unambiguous pending SMS/statement match, exactly equal amounts and
  compatible transaction types and a chosen or suggested compatible category.
  Known reported balances must agree;
  a missing report remains unknown, never zero.
- Matching statement date and local SMS receipt date. A different statement
  value date requires individual review. Receipt time is labelled as such;
  statement time is retained, without inventing a time for an untimed row.
- No competing sources, existing ledger suggestions, incomplete duplicate checks,
  fees/components, unresolved source warnings, failed source checks or draft discrepancies.
- For transfers, both owned accounts already selected and classification confirmed.

A strong match label alone does not imply bulk eligibility. Original SMS/PDF
values are still shown so the user can inspect them. Existing transactions must
be linked in individual review; bulk approval never silently merges or rewrites
an existing ledger entry. If the selection exceeds the bounded 5,000-row statement
context, use individual review or a smaller selection.

## Reporting-account confirmation and Pathao wording

When an import carries the standard masked-account verification advisory, bulk
shows one account-review panel for that import, regardless of how many pairs are
selected. Check the original PDF (available inline when archived) or your original
copy against the selected reporting account. Tick the explicit confirmation and
choose **Confirm account and recheck**. No entries are created by that step.

The saved decision binds the owner, PDF digest, selected account/revision, profile,
currency and masked identifier. It is reused for subsequent pairs from that same
import. Changing that context requires confirmation again. The timestamp and
fingerprint are separate review metadata; original account identity, warnings,
PDF and extracted values stay unchanged. Confirmation is audited and idempotent.
Undoing a transaction batch retains this independent account confirmation.

Only the exact standard account advisory stops blocking after this confirmation.
Other warnings, failed checks, unreadable evidence and financial conflicts remain
blocked. The UI labels this **Account confirmed by you**, not provider verification.

For Pathao Pay statements, the known leading **Make Payment** operation prefix
and its separator are ignored when comparing counterparties. Thus **Make Payment ·
Pathao Bike** can agree with **Pathao Bike**. Bike, Car, Food and other genuine
merchant differences remain distinct. The normal account, direction, amount,
date, balance, reference and duplicate checks still apply. Setting the displayed
merchant to Pathao Pay never overrides source identity checks.

## API and consistency

Authenticated, owner-scoped, no-store endpoints:

```text
POST /api/review/bulk/preview/  {pairs: [{statement: UUID, sms: UUID, edits?: {category: UUID|null, description: string, note: string}}]}
POST /api/review/bulk/approve/  {token: string, request_id: UUID, confirmed: true, pairs?: [...ready pairs with reviewed edits]}
POST /api/review/statement-account/verify/ {token: string, confirmed: true}
```

Preview performs no writes. Its `imports` array includes one account-review
context/token per selected import with the standard account advisory. Verification
tokens are user/context-bound and expire after 15 minutes; stale tokens return 409.

Preview returns all preview items, ready/needs-review
counts, decimal-string totals by currency, an expiry and a signed token for only
the ready group. Tokens expire after 15 minutes and bind user, approval policy,
source versions/values, relevant account/category revisions and current eligibility.
The token covers final metadata by fingerprint; it contains source IDs and
fingerprints, not descriptions, notes or SMS text. Approval sends the reviewed
ready pairs and metadata separately; changing them without a new preview returns
409. Only category, description (255 characters) and notes (4,000 characters) may
be submitted as edits. Unknown edit fields are rejected. Omitted approval pairs
recompute defaults for older clients. A refresh is required for older-policy tokens. Excerpts are limited
to 1,200 characters and obey existing retention permissions.

Approval takes the existing per-user financial-write lock and locks selected
source rows and category records in deterministic order. It reruns eligibility and duplicate checks,
then writes eligible ordinary pairs in batches using the transaction serializer
and a final live-ledger check. Transfers, multi-SMS source plans and immediate
redaction use canonical single-pair confirmation. Both paths share one database
transaction and recovery action. Any stale source, new competitor, changed ledger
suggestion or confirmation failure rolls back the entire ready group, including
source links, audits, recovery action and receipt. Refresh the preview after a
409; the user must review and confirm again.

A `UnifiedApprovalBatch` receipt has a unique `(user, request_id)` constraint and
stores the token digest, approved source/transaction IDs and recovery action.
Retry the same token and UUID after an interrupted response. A committed receipt
is replayed even after token expiry, another action or Undo; it never re-adds
money. Reusing its UUID for another preview is rejected. A fresh preview gets a
new request ID. Receipts contain no original financial text.

## Sources and Undo

Each created transaction retains its SMS link and statement-row link, original
extraction, original PDF and account-specific balance observations. Existing
SMS retention preferences still apply; Undo does not recover redacted SMS text.
No saved parser directions or source descriptions are overwritten by approval.

The batch creates one latest-action **Undo batch**, available for 24 hours while
all affected records and source links remain unchanged. Undo deletes only the
new ledger records/reports, restores SMS and statement sources and their previous draft metadata to pending review,
and records the recovery. If any member or linked evidence changed, the entire
Undo is rejected rather than partly removing money. A subsequent financial action
supersedes latest-action Undo, matching the existing recovery model.

## Backend query budgets and request-local checks

Bulk preview shares statement rows, fee positions, recorded-SMS discovery and
competing-source discovery across the selection. Edited merchant values are
checked against the ledger together per import, rather than one scan per edit.
Discovery pools are capped at 5,000 candidates/rows; overflow falls back to the
canonical per-pair discovery without relaxing eligibility or growing memory
without a bound. Other-account imports and printed value dates remain in scope.

Approval reproduces the signed eligibility proof under the per-user financial-write
lock, with selected rows, SMS and categories locked. Eligible new expense, income,
refund and debt movements use `bulk_writer.py`: the ordinary transaction serializer
still validates every value. Owner-scoped locked account, category and original-SMS
objects resolve foreign keys without repeating their database lookups. An account
revision or original-SMS change after inspection aborts the batch. Existing ledger
and merge-archive keys are checked before staging.

Ordinary transactions are staged with `bulk_create`, then ledger discovery runs
again for the selected rows per import **before any source is marked confirmed**.
The newly staged record for that exact row is expected; any other candidate,
including a duplicate created elsewhere in this batch, or truncated history rolls
back the whole group. Statement-row links and SMS confirmation updates are batched
only after this check.
Every source stays attached and every per-entry audit transition/version increment
is retained; audit inserts and import timestamps are batched. The existing
`ActionRecorder`, signed receipt, retry and Undo model remain shared across paths.
No conflicting insert is silently ignored.

Transfers, non-ordinary types, multi-SMS/complex Pathao source plans, immediate
SMS-redaction preferences and legacy identifier values retain canonical
confirmation and all existing source handling. They can add queries. Mixed groups remain atomic and the canonical path
sees the ordinary records already staged in that transaction. Request-local
statement/arithmetic reuse remains guarded by identical original inputs; nothing
is cached across requests. Disposition totals are never served from this cache.

Measured with synthetic clean pairs in one import; the current comparison starts
at `5ccd2d3` (the first optimization). Counts include SQL statements captured around
the endpoint call. SQLite counts are shown below; PostgreSQL matches except the
25-pair merchant-edit case is 88 rather than 89 due to insert chunking. These are
query budgets, not production response-time guarantees.

| Pairs / edits | Preview (unchanged) | Approval before | Approval now |
| --- | ---: | ---: | ---: |
| 1 / defaults | 16 | 98 | 84 |
| 5 / defaults | 16 | 234 | 84 |
| 25 / defaults | 16 | 914 | 84 |
| 25 / shared merchant | 20 | 993 | 89 |
| 25 / Pathao provider IDs | 16 | 1,014 | 184 |

A further scenario with 200 existing ledger entries approves 25 pairs in 87
queries. Provider-ID checks, source observations and per-entry audits remain
present. The initial pre-optimization baseline (`c76406d`) was 1,334 approval
queries and 138 preview queries for 25 ordinary pairs.

Reproduce the current budgets using a disposable test database:

```bash
cd projects/finance-api
FINANCE_QUERY_BENCHMARK=1 python manage.py test apps.statements.test_bulk_performance --noinput
```

The tests print counts and local elapsed time only when the environment flag is
set. They assert query ceilings rather than unstable timing limits, and use only
synthetic fixtures. Run the full PostgreSQL suite for lock/concurrency coverage.
This optimization changes no API response shape, database schema or web workflow.

## Deployment and verification

This is an API, database, contracts and web change; no mobile release is needed.
Deploy the API with `python manage.py migrate` through
`statements.0015_unifiedapprovalbatch` before the updated web app. It creates an
empty receipt table and does not change existing financial data. The reporting-account
confirmation update additionally requires `statements.0016`; it adds empty review
metadata fields without automatically confirming any existing import. Deploy API
and migrations before web.

Focused API checks:

```bash
cd projects/finance-api
python manage.py test apps.statements.test_bulk_approval apps.statements.test_bulk_writer apps.statements.test_bulk_performance apps.statements.test_unified
```

Use disposable PostgreSQL for concurrency verification; SQLite cannot exercise
row locking. Tests cover source preservation, one-action Undo, stale data,
competitors, existing ledger entries, fees, balances, permissions, token expiry,
rollback, durable retries and simultaneous submissions. Web selection checks:

```bash
cd projects/finance-web
node --test tests/bulk-approval-selection.test.cjs
npm run lint
npm run typecheck
npm run build
```

Browser verification uses synthetic source data only: mixed ready/blocked preview,
approval, source queue refresh, Undo, stale preview recovery and narrow layouts.
