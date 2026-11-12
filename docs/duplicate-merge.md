# Merge duplicate ledger entries without losing evidence

Use this when one real payment was recorded as two or more ledger entries—for
example, once from a spreadsheet and once from an SMS. Attaching a PDF to one
entry alone does not consolidate the other posted entry.

## User flow

1. In **Transactions**, open an entry's **More actions → Merge duplicates**.
   Alternatively, when a pending statement row suggests multiple ledger entries,
   choose **Review duplicate ledger entries** in its review dialog.
2. Select only entries for the same movement. Suggestions use the same amount,
   direction and account path within three days; repeat purchases can still be
   separate payments.
3. Select the entry whose saved values should survive. Compare its date/time,
   type, category, note, reference and reported balance with the other versions.
   Balance, classification and timing differences are highlighted. To retain a
   different saved balance or note, select the entry containing that value.
4. Open **Original sources** to compare SMS text, PDF row facts and spreadsheet
   values. A transaction ID is displayed separately from a customer's message
   reference, such as a gift note.
5. Review the explicit **N ledger entries → 1 entry** result and confirm once.
   From statement review, that pending PDF row is attached in the same action.
   No third transaction is created.

The page and its filters stay in place. The success toast provides **Undo** for
the latest transaction action for 24 hours while the affected records remain
unchanged. Transaction details expose **Pre-merge ledger versions** as saved
history, distinct from independent original sources.

This does not merge records automatically, infer ownership from merchant text,
change cash counts, or manufacture a balance adjustment. It removes duplicate
ledger money only after explicit review. Correct a wrongly linked source first
when the originals describe different movements.

## Source and financial guarantees

- The chosen entry's financial fields and saved scalar choices survive.
- Confirmed SMS candidates, statement rows, spreadsheet evidence and quick-entry
  retry receipts move to the surviving ledger ID. Original message/PDF/table
  content is not rewritten. Statement versions advance to invalidate stale editors.
- Merged-away ledger versions are archived, including legacy raw-message links,
  original notes, balances and entry keys. Existing merge history follows the
  survivor through subsequent merges. Source retention/redaction still applies;
  archives do not copy raw SMS text or resurrect redacted messages.
- Transfer observations remain separate account-bound reports. The keeper's
  existing effective reports remain selected; the incoming originals retain
  their exact balances. Cross-currency transfers and unattributed legacy balances
  require correction before merging.
- Identical amount, direction and account endpoints are required. Ordinary
  transactions cannot be merged with transfers. Dates must be within three days
  of the keeper; this flow does not perform amount rounding or currency conversion.
- Different established transaction IDs for the same reporting account block the
  merge. Opposite transfer accounts have separate identifier namespaces. A
  missing/unknown ID is not displayed as a conflicting ID.
- Two rows from the same statement batch cannot be linked to one ledger entry;
  review the PDF first. Explicit saved-report overrides on multiple selected
  entries must be resolved first. A single override moves with its entry.
- Payment, debt, reconciliation, allocation and unknown future dependencies block
  merging rather than being silently deleted. Ownership is checked for entries
  and attached source records.

## Reference correction

The SMS parser now prefers explicit `TrxID`, `Txn ID` or `Transaction ID` over an
earlier `Ref`/`Reference` message token. This affects new parsing. Existing saved
SMS and ledger reference fields are not bulk-rewritten. Comparisons derive typed
IDs from the retained original message and show human message references
separately. A redacted SMS cannot establish a new transaction ID. Existing exact
saved-reference corroboration remains available to matching; it is not relabelled
as a proven transaction ID when its original is unavailable. Source identifiers
reuse prefetched captures; missing legacy captures are fetched in one owner-scoped
query, avoiding one message query per match observation.

## API and persistence

Deploy transaction migrations **0013 and 0014** before the updated web client.
These add merge archives, idempotent receipts and an index for archived entry
keys. There is no automatic cleanup or merge of existing financial records.

```text
GET  /api/transactions/{id}/duplicate-candidates/
POST /api/transactions/merge-preview/
POST /api/transactions/merge-duplicates/
GET  /api/transactions/{id}/merged-sources/
```

Preview accepts `transactions` (2–10 distinct owned UUIDs), `keep` (one selected
UUID) and optional `statement_row`. It returns entries and source facts, blockers,
retained-field guidance and a signed preview token. Candidates are capped at 25;
source previews at 100 records per entry and related dependency collections at
200. Reads use `private, no-store`.

Apply also requires `preview_token`, UUID `request_id` and `confirmed: true`.
The token is bound to the user, choices, ledger fields, source facts, related
records and statement version, and expires after 15 minutes. Apply holds the
shared user mutation lock plus selected ledger row locks, rechecks the preview,
moves links, archives old versions, removes duplicates and saves recovery and
receipt metadata in one database transaction. A stale/expired preview returns
409; the UI discards it and requires a fresh review. No partial merge is saved.
An identical retried request returns the receipt without recording money again;
a changed or undone request cannot replay the mutation. Archived entry keys
prevent old create requests from recreating removed duplicates.

Undo restores removed ledger rows before restoring source links, spreadsheet
ledger identities, receipts and report membership. New archives/evidence are
removed. Original source text is never restored from an Undo snapshot. Undoing an entire
spreadsheet
batch is blocked once one of its entries contains merged versions, including
legacy SMS without a parsed candidate. Recovery
reads tolerate actions written before the new model keys existed.

The earlier transfer-only merge endpoint remains compatible for simple transfers.
It refuses auxiliary spreadsheet/archive/receipt/report links and directs users
to this flow, avoiding silent source detachment.

## Local verification

Use only a disposable PostgreSQL database named `finance_e2e_*` for browser data.
After the normal synthetic login seed, run `manage.py seed_merge_browser`; it
refuses other database names and creates synthetic desktop/mobile SMS, table and
pending-statement fixtures. Use `--reset` only to replace these fixture accounts
after an interrupted test run. Never point this seed or the browser tests at a real
account. Keep the same test-only Django encryption key across API startup/seeding.

From the API project:

```sh
python manage.py migrate
python manage.py seed_quality_browser
python manage.py seed_merge_browser
python manage.py test apps.transactions.test_duplicate_merge apps.transactions.test_recovery --keepdb --noinput
```

Run the web production build/start against the synthetic API, because the local
production flow uses HTTP-only session cookies. Browser plugin tools are absent
in this environment; the regression suite uses repository Playwright with a fresh
Chrome profile and no signed-in personal browser state:

```sh
npm run build
npm run start -- --hostname 127.0.0.1 --port 3039
FINANCE_E2E_PASSWORD='<test-only password>' npm run test:e2e -- e2e/duplicate-merge.spec.ts
```

Backend tests cover source retention, optional statement attachment, legacy SMS,
multiple duplicates, conflicting IDs, redaction, stale/expired previews,
idempotent retries, ownership, financial guards, protected links, report choices,
transfer reports, archived entry keys and complete Undo. Browser tests exercise
both entry points, source inspection, unchanged filters, Undo and WCAG checks on
desktop and mobile. Generated contracts and the full regression suites must also
pass before shipping.

### Verification recorded on 12 November 2026

- Full API regression suite: **965 passed**. After final stale-entry/query batching
  changes, the merge/recovery/statement import/rounding suite: **152 passed**.
- Web unit tests: **233 passed**; production build, ESLint and TypeScript passed.
- Production-mode Playwright: **22 passed**, covering merge, bulk import and
  transaction workspace behavior on desktop Chrome and Pixel 7 emulation.
  Additional explicit same-transaction-ID/human-reference assertions passed on
  both viewport configurations. Merge and surrounding forms passed the scoped
  WCAG 2 A/AA and 2.1 AA checks; captured page errors were empty.
- New merge/reference/recovery/fixture modules passed Ruff. Migration drift check,
  validated OpenAPI generation, backend schema snapshot gate and generated client
  TypeScript checks passed. Existing framework/schema annotation and unrelated
  CSS-prefixer warnings remain non-blocking.

Screenshots were visually inspected outside the repository using synthetic data.
The Browser plugin was unavailable, so tests used the repository's Playwright
runner with installed Chrome in fresh profiles. Production data and the signed-in
personal Chrome profile were not modified. Deployment and Safari/iOS were not
verified in this task.
