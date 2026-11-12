# Pathao Pay statement imports

## Using the feature

Open **Review inbox → Statements → Import a statement PDF**. Choose the Pathao
Pay **mobile wallet** account, upload the digital PDF, and review the saved rows.
Account recognition can suggest a saved Pathao Pay account with a unique matching
identifier; verify it against the original. A card brand in an Add Money row does
not identify the funding bank account.

Both the short and long Pathao Pay exports use the same parser. Monthly exports
are also supported when they retain the same headings and balance summary.
Upload each separately exported period on its own; do not concatenate exports
with different periods/accounts into one PDF. Existing limits apply: 4 MiB,
30 pages, 2,000 transaction rows. Scanned/image-only PDFs need OCR first.

Uploading saves a pending import and an encrypted original PDF, not ledger
transactions. Review possible matches before choosing **Add as separate**. A
matching statement and SMS can be recorded together, or attached to an existing
transaction, retaining the original sources and counting the movement once.
Conflicting references, balances, account paths, or ambiguous competing matches
still require review. Identical-file retries under the same account reuse the
import; overlapping exports still need normal duplicate review.

## What is preserved

- Direction comes exclusively from the printed **In** or **Out** column. Type,
  merchant and balance arithmetic never reverse it. Reversing a Pathao principal
  draft blocks adding **and linking** until its direction is restored.
- Transaction ID, printed date and AM/PM time, principal and final reported
  balance are preserved. Unreadable times stay unknown and require review.
- The original **Charge/Fee** cell is retained as optional `printed_fee` metadata.
  A positive charge becomes a negative `signed_fee`; a negative charge is a
  rebate. Nonzero values produce separate fee/refund review rows. The principal
  amount never absorbs the fee, and a new principal's balance remains unset when
  the final balance belongs to its separate fee entry.
- Explicit Add Money / cash-in funding and withdrawal wording creates a transfer
  draft. Choose the other owned account; the app does not guess it. Make Payment
  defaults to expense. Cashback defaults to income and uses an existing active,
  compatible **Interest & Rewards** category when available.

## Validation and implementation

`apps/statements/pathao.py` reads positioned words from the bounded PDF worker.
It validates the table headings on every page, consistent account and period,
summary, exactly one positive In/Out principal, and each numeric cell. It excludes
provider/legal footers even when they immediately follow a short final page.
Ambiguous money/columns fail extraction without saving a partial import.

Independent Decimal checks cover every transition from the opening balance,
including cross-page transitions and charges/rebates, plus summary Total In,
Total Out, closing balance and the summary equation. Discrepancies flag review;
they never rewrite printed evidence. Original long account identifiers are
masked in previews. PDF bytes and private identifiers are not test fixtures.

The profile is `pathao_pay`; existing import/review/SMS/ledger endpoints and
owner-scoped matching are reused. No new database tables, migrations, dependencies
or background services are required. Deploy the API and web changes together.

## Regression checks

From `projects/finance-api` with a disposable PostgreSQL database configured:

```sh
python manage.py test apps.statements.test_pathao --keepdb --noinput
```

Synthetic in-memory PDFs cover one-, three- and nine-page exports, wrapped
headings/types, final-page footers, AM/PM, opposite columns, exact charges and
rebates, malformed cells, repeated IDs, mixed accounts, unknown times, balance
mismatches, account eligibility/recognition, archive/idempotency, classification,
posting guards, SMS pairing and existing ordinary/transfer links. Provider PDFs
are checked privately; real financial data must not be committed.
