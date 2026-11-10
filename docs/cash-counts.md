# Physical cash counts

Open **Planning → Cash counts** (`/cash-counts`) to record cash in a wallet or
storage account whenever it is counted. Only active **Cash** and **Home cash**
accounts can receive new counts. History also includes inactive cash accounts
and existing cash checkpoints. Bank, card and digital-wallet SMS/statement
balance checks remain separate. Reconciliation links to this dedicated screen.

## Record one count

1. Select the cash account, count date and counted amount. Zero is valid.
2. Optionally enter the actual count time and a note.
3. If there is no time, confirm **Counts without a time are end-of-day balances**.
4. Preview the counted cash, calculated ledger balance and difference. Resolve
   invalid input or timing questions, then save.

A nonzero difference is **Needs review**, not a save failure. A count never
creates income, spending, a transfer or an adjustment, and never changes the
account's starting balance. There is no daily counting requirement or overdue
reminder. A difference can reflect unrecorded spending/income, a counting mistake
or an incorrect earlier entry; it does not establish which explanation is true.

## Paste several counts

Choose **Paste count table**, paste cells copied from Excel/Sheets or a Markdown
table, or upload UTF-8 CSV/TSV/text. Binary `.xlsx` files are not accepted here;
copy their cells or export CSV instead. Limit: 100 counts / 1 MB per preview.
For example, using fictional accounts and amounts:

```text
Storage Account	Date	Counted Balance	Expected Balance	Notes
Example wallet	2026-02-01	950	1000	Counted notes and coins
Example wallet	2026-02-02	850	900	Evening count
Example storage	2026-02-02	0	0	Empty cash box
```

Account names are matched against the signed-in user's active cash accounts.
Use **Map table account names** once per source label if names differ. Column
mapping and individual corrections are available without changing the source
table. ISO dates are accepted directly; choose DMY or MDY for other date formats.
Use proper CSV quoting around grouped amounts, e.g. `"1,050"`.

**Expected Balance from the spreadsheet is reference only.** The app calculates
its own expectation from the account's starting balance and saved movements. It
does not import the spreadsheet expectation as financial truth. Refresh after
edits; all non-skipped rows must be valid before saving the batch atomically.

## Dates and unknown times

- All comparisons use the API's local time zone (currently Asia/Dhaka).
- An explicitly confirmed date-only count covers the entire local calendar day,
  including the final seconds. Transactions keep `time = null` when unknown.
- A count with a time includes earlier dates and same-day known times at or before
  that time. Untimed same-day movements need an explicit before/after decision.
  A default can be applied to all of them, with individual exceptions.
- Contradictory ordering between neighboring counts is blocked. For example, an
  entry before a morning count cannot be after an evening count on the same day.
- Later-imported untimed movements can make a historical timed comparison need
  review again. Correct that count and review timing; the app does not invent a
  transaction clock or silently assign new entries before the count.

## Understand a continuing difference

Difference = **counted cash − calculated ledger balance at the count boundary**.
For example, a fictional count of 950 against 1,000 has a −50 difference. If a
recorded expense of 100 follows and the next count is 850 against 900, the same
net −50 persists. These are not two separate shortages of 50.

**Compare movements** opens in the current page. It recalculates the selected and
previous count against the same current ledger, shows the change in their
differences, and lists movements after the previous boundary through the selected
boundary. A zero net change does not prove every transaction was recorded.

History explicitly shows comparisons **as recorded**. If ledger edits change a
comparison, the popup shows the current calculation and the stored expectation
separately. Opening it never rewrites a count. History loads 50 observations at
a time; movement comparisons load 25 movements per page and refresh if the
comparison revision changes while appending pages.

## Duplicate and correction protection

- Saving uses a stable per-user UUID retry key. A lost-response retry returns the
  original receipt instead of saving twice; reusing the key with different input
  returns 409.
- A second count for the same account and exact boundary is flagged. Choose
  **Skip count** or explicitly **Correct saved count**, then refresh the preview.
  A specific-time count at another time on the same date remains distinct.
- **Correct count** from history preloads the saved observation. Corrections are
  audited, keep the original encrypted import archive and do not alter money.
  An explicit correction target also lets you fix its account, date or time
  without leaving the old observation behind. Moving onto another saved count
  period or correcting the same observation twice in one batch is blocked.
- Legacy duplicate periods and counts with an associated ledger adjustment require
  separate review; this flow does not silently overwrite them or their adjustment.
- Final save recomputes the preview under the shared user write lock. Changed
  counts, accounts or ledger context return 409 before any batch is written.

## Implementation and deployment

This is a frontend, API, database and contract change. Deploy API migration
`reconciliation.0004_cashcountbatch_balancesnapshot_cash_count_batch_and_more`
before the web client. It adds an idempotent receipt/source archive model and a
nullable relation on existing `BalanceSnapshot`; it does not backfill financial
entries or change existing checkpoint values.

Original table input plus review decisions are encrypted using the existing
source-encryption key policy. Count values remain observations in
`BalanceSnapshot`, not another transaction ledger. Endpoints are authenticated,
owner-scoped and `Cache-Control: no-store`:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/cash-counts/preview/` | Read-only validation, projection and review token |
| `POST /api/cash-counts/` | Atomic observation save/correction and idempotent receipt |
| `GET /api/cash-counts/?account=UUID&offset=0` | History, including stored previous difference |
| `GET /api/cash-counts/UUID/?offset=0` | Current-ledger comparison and interval movements |

Read queries are batched: active accounts, neighboring snapshots and one aggregate
SQL projection for all count boundaries. Preview does not fetch all transactions
or query separately for every row. Timed previews fetch thin untimed-entry values,
capped at 1,000 relevant entries. Combined ordering work is capped at 5,000
entry/count relationships and neighboring snapshot reads at 300, preventing
excessive SQL parameters or legacy-duplicate floods. Larger comparisons must be split into smaller
groups. Concurrent retries and other participating ledger writers share the
existing user lock; the database also enforces one receipt per user/retry key.

The UI preserves its account filter when opening/closing the comparison, uses
abortable initial reads and suppresses stale history responses. Errors appear in
toasts; discrepancy amounts and timing questions stay alongside the observation
they describe. Saved counts remain unchanged when comparisons are refreshed.

## Verification

Run the focused API tests from `projects/finance-api`:

```sh
python manage.py test apps.reconciliation.test_cash_counts
```

Use PostgreSQL to include the independent concurrent retry test. From
`projects/finance-web`, run `node --test tests/cash-counts.test.cjs`, lint,
typecheck and build. `e2e/cash-counts.spec.ts` exercises the complete single,
table and timed flows on desktop/mobile with WCAG checks against the disposable
synthetic browser fixture documented in `docs/local-setup.md`. Never run fixture
creation or write-based browser tests against a real account database.

### Reviewed implementation — 10 November 2026

Local verification passed: 929 API tests (including 31 cash-count tests), 223 web
unit tests, 24 desktop/mobile browser regressions, and a final six-flow cash-count
browser rerun after the date-correction fix. Production web build, web lint,
web/mobile typechecks, migration drift and API schema checks also passed.
The environment used Python 3.12.13, PostgreSQL 18, Node 24.16 and fresh installed
Chrome contexts through Playwright; the browser plugin was unavailable. No real
financial records or the user's signed-in Chrome profile were used. The deployed
Python 3.13 runtime was not exercised locally.

Review fixes covered incomplete-row validation, local-day duplicate detection,
contradictory timing, bounded SQL parameters/legacy duplicates, audited corrections
to the same observation (including account/date/time), and popup keyboard-focus
restoration. Counts remain distinct from ledger adjustments and original source
archives remain encrypted. Correcting a spreadsheet checkpoint also makes its
original import's existing guarded Undo require review rather than deleting the
subsequently corrected observation.
