# Pathao Pay sender group and duplicate notifications

## Existing users

The four exact names `Pathao.Pay`, `Pathao Pay.`, `PathaoPay.` and `PathaoPay`
are displayed as one **Pathao Pay** group per reporting wallet. Existing sender
rules are reused: their IDs, account/payment-method mappings, categories,
priorities, active states and device tracking switches are not recreated or
silently changed. Four existing rules therefore need no replacement.

In **SMS settings**, choose the BDT mobile-wallet account and use **Set up Pathao
Pay group** to add any missing aliases. On mobile, choosing any known alias in
Capture offers the same group setup. Newly created aliases are enabled on that
device; existing switches stay as chosen. If aliases point to different accounts
or providers, correct those individual rules first. Group setup rejects the
conflict atomically instead of remapping financial sources. Exact sender trust
is retained; arbitrary names containing “Pathao” are not enabled.

A mobile rebuild is needed for the grouped Capture display and comparison UI.
Existing builds still submit their individual exact rules; the server protects
against recording verified repeat notifications twice.

## One movement, several SMS originals

- Confirm one pending notification normally. Other verified notifications with
  the same original provider transaction ID/reference, reporting wallet,
  direction and amount attach to that transaction. Known balances and fees must
  agree. Each original SMS remains independently stored and visible.
- A later matching notification offers **Compare SMS sources** and can be linked
  to the existing transaction without recording more money. A statement already
  posted with that original printed ID is also considered.
- In **Transactions → Edit → Original SMS**, choose **Compare Pathao SMS
  sources** to review duplicates already recorded, even when no SMS is pending.
  The transaction currently being edited is kept. In the inbox comparison, the
  user can choose which saved transaction to keep. Compare the originals,
  confirm once, then choose **Merge entries · keep all sources**.
- Merging preserves linked SMS, PDF rows, spreadsheet import rows, notes/source
  history and original evidence through the normal duplicate-merge mechanism.
  The retained transaction's financial/classification values remain unchanged.
  Existing merge dependency/conflict checks still apply. Latest-action **Undo**
  restores removed ledger entries and their original links; newly attached SMS
  return to review where appropriate.

Nothing merges merely because an amount or description repeats. No verified
provider ID, conflicting account/direction/amount/balance/fee, reused IDs more
than three days apart, or unsafe legacy evidence requires individual review.
An old redacted SMS without a retained provider ID cannot be reconstructed;
when its saved reference points to the same movement, automatic recording is
blocked. Do not create another transaction to bypass a blocked comparison.
Raw SMS retention settings continue to apply; keeping all sources does not
restore a deliberately redacted original or bypass retention.

## Backend and deployment

Apply `python manage.py migrate` before deploying the API: migration
`finance_messages.0017_pathao_source_identity` adds an indexed, non-editable
original provider ID and owner/request-scoped source-review retry receipts.
Legacy retained messages derive identity from the original body during review,
then retain that ID when linked. User-edited references do not replace source
identity. No existing financial rows or sender routes are bulk rewritten.

Endpoints (authenticated, owner scoped):

- `POST /api/messages/sender-groups/pathao-pay/` with `{account}` returns the four
  reused/created exact rules. It accepts an active BDT mobile wallet.
- `GET /api/messages/review/{candidate_id}/pathao-sources/?keep={transaction_id}`
  returns original source comparisons, saved entries, blockers and a signed
  15-minute preview. It performs no mutations and uses `Cache-Control: no-store`.
- `POST` to the same review URL with `{preview_token, request_id, confirmed:true}`
  revalidates source/ledger membership under the user transaction lock and
  atomically links or merges. A changed preview returns 409; refresh and compare
  again. Request IDs make retries safe. Reusing an undone request requires a
  fresh preview and request ID. One Undo action covers the whole operation.

Comparison is bounded to 100 related notifications and ten saved entries. The
provider-ID index avoids scanning every SMS for new imports. Legacy body lookup
is limited to plausible dates/amounts or matching saved references. Original
IDs are never exposed through a public or cross-user lookup.

## Verification

Synthetic-only regression tests cover existing rule preservation, missing alias
setup and rollback, all four names, late duplicates, statement-first recording,
original versus edited references, retention/redaction, conflicting directions,
fees and balances, transfer-side evidence, signed-preview staleness, ownership,
idempotent retries, all-confirmed duplicates, three source types and Undo.

```sh
cd projects/finance-api
python manage.py test apps.messages.test_pathao_sources apps.statements.test_pathao apps.statements.test_unified apps.transactions.test_duplicate_merge
```

Use a disposable local database for interactive QA. Never import private SMS or
financial PDFs into committed fixtures or modify the user's live ledger for QA.
