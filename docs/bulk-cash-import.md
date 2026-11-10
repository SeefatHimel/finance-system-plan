# Bulk cash entries and wallet balance checkpoints

## User workflow

Open **Transactions → Import entries**. The dialog keeps the current page,
search, account and date filters. Choose the reporting wallet/account once, then
paste cells copied from Google Sheets or Excel, or upload UTF-8 CSV, TSV or text.
The limit is **500 data rows and 1 MB per table**. Direct `.xlsx` uploads and
Google account connections are not part of this implementation; copy the cells
or export UTF-8 CSV instead.

This synthetic example is accepted directly:

```tsv
Date	Category	Description	Amount	Notes
2026-01-02	Food	Example lunch	৳150.00	Example note
2026-01-02	Groceries	Example refund	-৳20.00	Returned item
```

Column order is flexible. Recognized headings are suggested; other headings can
be mapped to date, amount, description, category, notes, optional time and
optional balance after. Date and amount are required. ISO dates are unambiguous;
choose DMY or MDY explicitly for other date formats. Unknown times stay null.
There is one signed amount column; sheets with separate incoming/outgoing columns
should first be converted to one signed amount column or imported separately.

Positive amounts default to money out/expense, and negative amounts to money
in/refund. A batch can instead interpret positives as income. The preview lets
users change each row's type, direction, category, description, date, time and
transfer counterpart. Categories never change debit/credit direction. Transfers
require another active, owned account in the same currency. Currency symbols
are not converted: a BDT-marked amount cannot silently enter a USD account.

Category mapping applies to the batch. Unmapped labels are retained in source
notes and can remain uncategorized without blocking every row. Trip labels can
therefore survive while individual entries use normal spending categories.
Missing/zero amounts must be corrected or explicitly skipped. Subtotal-looking
rows, adjustments, ambiguous cash differences and possible duplicates require
review. No amount is invented, rounded to a whole taka or inferred from a note.
Original notes containing itemized sums do not create additional transactions.

Entries are displayed in pages of 25, with a highlighted-rows filter. Expand a
row to edit it, compare existing movements or inspect its original cells. The
bulk review action acknowledges highlighted details; it does not choose a match,
remove repeated purchases or turn a duplicate into a different movement.
Refresh preview after edits, then import the approved entries once.

## Duplicate decisions and safe retries

- Identical normalized UTF-8 input under the same user/account reopens its saved
  batch, including when a file is renamed. BOM/CRLF differences are normalized.
  A committed batch returns its original receipt on retry.
- Repeated date/description/amount/direction combinations inside a sheet are
  highlighted, never automatically removed. Two identical purchases can be real.
- Existing ledger suggestions use the reporting account, exact date, amount and
  financial direction. The source kind, type, time, description, note and saved
  balance are shown. Transfer balances are tied to the reporting account; an
  opposite account’s balance never fills a missing report, and reviewed blanks
  stay unknown. Matching date/amount alone is not proof of one movement.
- Choose **Link existing** only after comparing; the existing transaction's type,
  category, balance and original SMS/PDF evidence are retained. The table row
  becomes additional evidence. Alternatively, explicitly keep a separate entry
  after review, or skip the row. Historical type/direction contradictions remain
  visible and cannot be linked until corrected in Transactions.
- The preview is bounded to 2,500 candidate records and ten suggestions per row.
  Broader collisions require a smaller import or separate review, rather than
  silently hiding potential duplicates. Suggestions are account/date scoped;
  they are not a fuzzy search of every historical movement across accounts.
- Row acknowledgements are bound to the compared candidate fingerprint. New or
  edited suggestions invalidate the acknowledgement. Confirmation rechecks the
  batch version and full preview token while holding the user writer lock.
  A changed review returns 409; the dialog loads the current comparison and asks
  for the affected decisions again.

All approved writes, links, checkpoints and the receipt are one database
transaction. Concurrent or retried confirmations create the batch once. There
is no partial success if a later row or checkpoint fails validation.

## Wallet balance checkpoints

An optional **Balance after** column belongs to its particular transaction.
A separately counted wallet balance belongs in **Wallet balance checkpoints**;
it is not an income, expense or opening-balance transaction.

A checkpoint compares counted cash with the account's starting balance and all
recorded movements up to its boundary, including the new approved rows. Existing
linked rows are counted once. Differences remain visible and saved for review;
no adjustment is created automatically. Missing opening cash or incoming transfers
must be reviewed separately, rather than inferred from the counted balance.

For a count without a time, the user must confirm **end of day**. It includes the
complete local day, through `23:59:59.999999`, in the application's Asia/Dhaka time
zone. Entries do not acquire fake times to place them before that boundary.

For a count with a specific time, known transaction times at or before the count
are included. All untimed entries on that date, including existing ledger entries,
need an explicit before/after decision. One choice applies to the set, with
per-entry exceptions. Confirmation resolves import row references to actual
ledger identities and stores their relative order on the checkpoint. The actual
transaction clocks remain null. A subsequently added untimed entry needs another
timing review when recalculating that checkpoint; it is not silently assumed to
have occurred before the count.

Checkpoints appear in **Reconciliation**, labelled as spreadsheet checkpoints
with the source filename and comparison precision. Their stored expected balance
and difference describe the check when saved. They are observations, not a live
running balance or proof that every movement was recorded. To revisit a count
after historical edits, update/recheck the checkpoint through the reconciliation
API or record a new check; an ambiguous timed recalculation requires ordering the
new untimed entries. Legacy snapshots retain their previous whole-day comparison
semantics via the new `end_of_day` default.

## Source retention, history and Undo

The original table is encrypted with the same key/fallback infrastructure as
other retained financial sources. Mapping and review decisions are separate from
that immutable archive. Rows reference the canonical ledger; they do not create
another ledger whose totals must be synchronized. A retained ledger identity lets
a restored entry retrieve its source even if deletion previously cleared its FK.

The receipt shows new, linked, skipped and checkpoint counts. **Recent imports**
lists the latest 25 batches. Receipts retain a paginated original-table viewer.
Transaction details and editors also show spreadsheet evidence, with up to 100
linked rows per read and an explicit limit label. Originals remain in the saved
batch even when a row was skipped or the transaction was corrected/deleted.

**Undo this import** removes only unchanged entries created by that batch and its
unchanged checkpoints. Pre-existing linked transactions are kept and their table
links detached. Edited/deleted entries, added evidence, payment use or modified
checkpoints block the entire automatic Undo before any deletion occurs. Each
write and Undo is audited. Repeated Undo is safe. After Undo, **Review this table
again** reopens the original with a new version; old confirmations cannot post it.

## Architecture and API

`apps.bulk_imports` owns the archive, mapping, duplicate review and batch receipt:

- `parsing.py`: bounded table/date/money parsing with exact Decimal amounts.
- `sources.py`: encryption access and stable fingerprints.
- `review.py`: normalized rows, scoped suggestions and checkpoint projections.
- `services.py`: user-locked, atomic commit, Undo and reopen.
- `views.py` / `serializers.py`: authenticated, private/no-store API boundary.

Shared ledger totals and monetary policy remain in Transactions. Checkpoint
cutoffs are in `apps.reconciliation.timing`. Ordinary snapshot mutations use the
same user lock, so they cannot race a bulk Undo. The web dialog is lazy-loaded;
mapping, entry review, checkpoint editing and source inspection are separate
components. Lookups come from the existing transaction workspace. Writes emit a
targeted financial-change event instead of reloading the page.

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/api/bulk-imports/` | Recent batches / create or recover a source batch |
| GET / PATCH | `/api/bulk-imports/{id}/` | Read / review a versioned draft |
| POST | `/api/bulk-imports/{id}/commit/` | Confirm the reviewed version and token |
| POST | `/api/bulk-imports/{id}/undo/` | Undo an unchanged committed batch |
| POST | `/api/bulk-imports/{id}/reopen/` | Reopen an undone batch for another review |
| GET | `/api/transactions/{id}/bulk-sources/` | Inspect owned spreadsheet source rows |

Original-source access, destination accounts, categories, linked transactions,
batches and checkpoints are scoped to their owner. Responses never grant access
through a supplied identifier alone. Spreadsheet formulas are treated as text;
formula-like amounts are rejected. Imported data is not added to repository
fixtures, logs, documentation examples or test artifacts.

## Deployment and verification

This is **API, database, contracts and web work**. Deploy the API and apply
`reconciliation.0003` plus `bulk_imports.0001` / `0002` before exposing the web
flow. These migrations add metadata and import tables, not financial repairs or
changes to historical transaction values. Existing archive key/fallback retention
requirements apply. Deploy a matched API/web preview when reviewing the branch;
a new frontend pointed at an older API cannot use these endpoints.

Run from `projects/finance-api` against an isolated PostgreSQL database:

```sh
python manage.py migrate --noinput
python manage.py test apps.bulk_imports apps.reconciliation
python manage.py makemigrations --check --dry-run
```

Web checks run from `projects/finance-web`:

```sh
npm run typecheck
npm run lint
node --test tests/*.test.cjs
npm run build
npm run test:e2e -- e2e/bulk-import.spec.ts
```

Browser fixtures must use the disposable `finance_e2e_*` workflow documented in
[local setup](local-setup.md). The new browser tests refuse non-local base URLs.
Verification covers exact amounts, source preservation, correction/skip/refund,
transfers, owner isolation, concurrent confirmation, stale reviews, report totals,
checkpoint boundaries and exceptions, safe Undo/reopen, bounded preview queries,
responsive layouts and keyboard/accessibility checks. It uses synthetic data only.

### Local verification record — 10 November 2026

- Full PostgreSQL API suite: **888 tests passed**, including 29 new import cases.
- Web unit suite: **218 tests passed**; production build, lint and typecheck pass.
- Browser suite: **16 tests passed** at desktop and mobile widths, including eight
  import cases across light/dark layouts, timed ordering exceptions, source
  inspection, duplicate review, Undo/reopen and filter retention. The tested import
  dialog and existing transaction/quick-entry surfaces pass the exercised WCAG
  A/AA axe checks; this is not an app-wide accessibility certification.
- Mobile TypeScript check passes after the additive contract changes. Native
  mobile behavior is outside this feature's scope.
- Fresh migrations, migration drift, generated-contract parity and Python name
  checks pass. OpenAPI generation has zero errors and the existing class of enum
  naming/operation-ID warnings (85 total); it is not warning-free.
- Browser plugin not available: verification used the repository's Playwright
  workflow with fresh contexts and the installed Chrome executable because the
  bundled headless browser was absent. The user's Chrome profile was not used.
  Synthetic screenshots and traces were stored outside source control.

No user spreadsheet was imported into a real account, and no production database
was accessed. Hosted CI and a matched staging deployment still need to run after
publication; local verification does not claim that production is deployed.
