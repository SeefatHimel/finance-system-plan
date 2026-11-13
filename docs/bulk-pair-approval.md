# Bulk approval of SMS + statement pairs

## User workflow

Open **Review inbox → Matched sources**, filter the queue, and select individual
pairs or **Select this page**. Selections survive pagination, up to 25 pairs;
changing filters or refreshing matches clears them. **Review selected** opens a
read-only preview in the same page. It shows source values, highlighted
agreements/differences, totals per currency and reasons for individual review.
Source excerpts can be expanded without losing the selection.

Review the ready pairs, tick the single final confirmation and choose
**Approve ready (N)**. Only the ready subset is submitted. The rest remains
pending with an individual-review shortcut. Transfers appear in a separate total;
they are not presented as income or spending. Filters stay in place after saving.
Errors use toasts, with an inline refresh/retry action when necessary.

This first version deliberately excludes uncertain matches. A ready pair needs:

- Owned, active, same-currency accounts, compatible active category and explicit
  original debit/credit evidence agreeing with the saved draft.
- A strong, unambiguous pending SMS/statement match, exactly equal amounts and
  compatible transaction types/categories. Known reported balances must agree;
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
POST /api/review/bulk/preview/  {pairs: [{statement: UUID, sms: UUID}]}
POST /api/review/bulk/approve/  {token: string, request_id: UUID, confirmed: true}
```

Preview performs no writes. It returns all preview items, ready/needs-review
counts, decimal-string totals by currency, an expiry and a signed token for only
the ready group. Tokens expire after 15 minutes and bind user, approval policy,
source versions/values, relevant account/category revisions and current eligibility.
Tokens contain source IDs and fingerprints, not SMS text. Excerpts are limited
to 1,200 characters and obey existing retention permissions.

Approval takes the existing per-user financial-write lock and locks selected
source rows in deterministic order. It reruns eligibility and duplicate checks,
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
new ledger records/reports, restores SMS and statement sources to pending review,
and records the recovery. If any member or linked evidence changed, the entire
Undo is rejected rather than partly removing money. A subsequent financial action
supersedes latest-action Undo, matching the existing recovery model.

## Deployment and verification

This is an API, database, contracts and web change; no mobile release is needed.
Deploy the API with `python manage.py migrate` through
`statements.0015_unifiedapprovalbatch` before the updated web app. It creates an
empty receipt table and does not change existing financial data.

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
