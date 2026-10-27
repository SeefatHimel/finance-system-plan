# Map EBL statement identifiers

1. Open **Settings → Statement codes**, then **Filters → EBL bank**.
2. Find the printed masked card/account, including its trailing star. Different
   movement references with the same mask are grouped; possible fees are separate.
3. Choose **Identify** on the card. Check recent masked rows, choose an external
   party or another account you track, and enter a name. Optionally suggest a
   transaction type, category, and note, just as for a bKash identifier.
4. For an internal transfer, select a different active account in the same
   currency. The mask itself may identify the sending card; verify its meaning
   before mapping it to a destination or merchant.
5. **Save verified mapping** keeps you on this page. It supplies suggestions for
   pending reviews; apply them after checking the movement. Use **Edit mapping**,
   **Forget mapping**, **Skip**, or **Restore identifier** here whenever needed.

Old rules based on changing numeric movement fields remain disabled. Only an
explicit save against the printed mask enables a new EBL mapping. Saving a rule
does not change existing drafts, confirmed transactions, or original statements.

Saved masked descriptions are enough to show EBL clues; re-uploading is not
required. **Find identifiers in saved EBL/bKash PDFs** can correct retired EBL
metadata and recover missing bKash identifiers. Password-protected PDFs must be
refreshed from their own statement review using the transient password. A missing
archive needs the identical PDF. Integrity and saved-row checks still apply.
Results show updated rows by provider, not unique recipients. Scanning preserves
filters and leaves originals, reviewed financial values and posted transactions
unchanged. Identifier scans allow 20 PDF requests/hour, including failed requests,
independently of uploads. Incomplete scans show error toasts and affected PDFs;
loading errors offer **Retry loading identifiers**.

Deploy API migration `statements.0013_verified_ebl_mask_mapping` and the API
before this web client. Historical
transactions are not automatically reclassified or undone. Verify any earlier
manually applied EBL recipient suggestion against its original source before
editing it. Possible bank-charge hints remain separate review decisions.

## Skip without identifying

Use **Skip / don’t identify** for an unknown or one-off clue. No name or label is
needed. The default **Not skipped** filter hides it on later visits and imports;
**Skipped → Restore identifier** brings it back. The skip toast also offers Undo.
Any saved rule for that scope is paused until restoration. Statement and ledger
transactions are never skipped or deleted. Identifying a restored clue is optional.

## Remove the old incorrect EBL metadata and rules

Choose **Clear incorrect EBL data**. A preview shows how many retired numeric
values and old EBL recipient rules belong to your account. Cancel makes no
changes. **Clear incorrect data** confirms only that preview; if it becomes stale,
preview again. Verified mask mappings, correct masked evidence, source statements and financial records
stay saved. Previously applied manual transaction edits are not reversed.
This action is separate from scanning a PDF, and requires the updated API.
The skip feature also requires API migration `statements.0012_identifier_skip`.

## Compact directory controls

The directory uses text badges for provider, direction, review status, and
four-digit ambiguity. Status filter tags include counts for the current search
and account/provider filters. Skip and Restore remain explicit labelled actions;
identification is optional. Open **Filters** for provider/account selectors,
remove applied filter chips individually, and open **Identifier tools** for saved
PDF scanning or the EBL cleanup preview. Expanding tools does not mutate data.
These controls reuse the existing endpoints and require no additional migration.
