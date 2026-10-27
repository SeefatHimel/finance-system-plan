# Review EBL masked card/account clues

1. Open **Settings → Statement codes** and choose **EBL bank**.
2. The displayed value is the printed masked card/account, including any trailing
   star. Different movement references with the same mask are grouped together.
   Possible companion fees are excluded from the principal movement count.
3. Treat it as account-recognition evidence. It may identify your own sending
   card, and cannot establish who received the money. Use **Review account
   recognition** to check your saved account/card details in Accounts.
4. EBL clues have no recipient-rule editor. Old EBL rules based on the numeric
   field after the mask are no longer applied. They are not automatically
   converted to masked-card rules. Citytouch/bKash rules continue to work.

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

The API must deploy before the web client; no migration is required. Historical
transactions are not automatically reclassified or undone. Verify any earlier
manually applied EBL recipient suggestion against its original source before
editing it. Possible bank-charge hints remain separate review decisions.
