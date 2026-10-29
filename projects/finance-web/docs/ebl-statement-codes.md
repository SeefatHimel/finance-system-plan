# EBL description clues

NPSB rows repeat **your own sending card/account mask**. That mask and the changing
movement/reference fields do not identify the recipient, so they are no longer
offered for mapping. Account recognition from the statement header is unaffected.

## Useful clues

Open **Settings → Statement codes → Filters → EBL bank**. Supported clues are:

- **Salary / payroll wording** on a credit. Pending unclassified salary credits
  can suggest **Salary & Wages**. Salary loans, advances, reversals and refunds
  are excluded.
- **PataPay wording** and **bKash transfer wording**. These name a service, not
  a particular person. Do not assume every transfer has the same destination.
- **bKash recipient number**, only when explicitly introduced as To, Recipient
  or Beneficiary. Ambiguous, masked or reference-field numbers are not inferred.

Use **Identify / Edit mapping** to save a label and optional type, category, note
or verified owned route. Routes require a different active account in the same
currency. Suggestions remain scoped to your reporting account and debit/credit;
saving a rule does not modify drafts or post transactions. Check each suggestion
before applying it. Existing verified choices take precedence over salary hints.

Use **Skip** for unknown or one-off clues. **Skipped → Restore identifier** or
the toast's Undo restores the clue; Skip never skips a financial transaction.
**Forget mapping** removes a saved suggestion without removing the statement.

## Existing NPSB mappings

Deploy API migration `statements.0014_retire_npsb_own_card_clues` before the web
update. It removes the earlier EBL own-card/movement mappings and skip metadata
and clears NPSB identifier fields, including previously verified mask mappings.
No PDF re-upload is required. Originals, reviewed financial values, notes,
source links, account-recognition settings and ledger entries remain unchanged.
Previously applied manual classifications are not automatically reversed; check
those against their original descriptions before editing them.

**Identifier tools → Clear incorrect EBL data** also offers an owner-scoped
preview/confirmation for remaining retired metadata. Supported verified wording
and recipient mappings are preserved. A stale preview must be refreshed.

Saved descriptions provide wording clues immediately. **Find identifiers in saved
EBL/bKash PDFs** can recover explicit full wallet recipients that are masked in
saved descriptions, and clears old NPSB metadata instead of recreating it. Scans
verify the PDF digest and saved row fingerprints and never change financial
values. Password-protected archives need the password from statement review;
missing archives need the identical PDF. Scans are limited to 20 requests/hour,
including failures, separately from uploads. Errors use toasts and identify the
PDFs that need attention. Bank-charge hints remain separate review decisions.
