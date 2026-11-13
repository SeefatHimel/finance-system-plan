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
  fees/components, source warnings, failed source checks or draft discrepancies.
- For transfers, both owned accounts already selected and classification confirmed.

A strong match label alone does not imply bulk eligibility. Original SMS/PDF
values are still shown so the user can inspect them. Existing transactions must
be linked in individual review; bulk approval never silently merges or rewrites
an existing ledger entry. If the selection exceeds the bounded 5,000-row statement
context, use individual review or a smaller selection.

## API and consistency

Authenticated, owner-scoped, no-store endpoints:

```text
POST /api/review/bulk/preview/  {pairs: [{statement: UUID, sms: UUID, edits?: {category: UUID|null, description: string, note: string}}]}
POST /api/review/bulk/approve/  {token: string, request_id: UUID, confirmed: true, pairs?: [...ready pairs with reviewed edits]}
```

Preview performs no writes. It returns all preview items, ready/needs-review
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
then calls the canonical single-pair confirmation service for every ready pair
inside one database transaction. Any stale source, new competitor, changed ledger
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

## Deployment and verification

This is an API, database, contracts and web change; no mobile release is needed.
Deploy the API with `python manage.py migrate` through
`statements.0015_unifiedapprovalbatch` before the updated web app. It creates an
empty receipt table and does not change existing financial data. This metadata
update needs no additional migration; deploy API before web.

Focused API checks:

```bash
cd projects/finance-api
python manage.py test apps.statements.test_bulk_approval apps.statements.test_unified
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
