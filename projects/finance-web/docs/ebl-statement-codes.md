# Identify EBL statement clues

1. Open **Settings → Statement codes** and select **EBL bank** in Statement type.
2. If older imports have no identifiers, choose **Find identifiers in saved
   EBL/bKash PDFs**. The action scans existing archived PDFs without adding ledger
   entries. If a PDF needs a password, open its statement review, expand Statement
   details and reconciliation, enter the password and choose **Refresh identifiers
   from saved PDF**. If the archive is unavailable, re-upload the identical file.
   Results list EBL and bKash separately. Counts refer to rows receiving missing
   metadata, not unique recipients; zero additions can mean metadata was already
   saved or no supported clue was found. Your filters stay selected after scanning.
3. Compare the printed code with the original statement before choosing Identify.
   The numeric value is an unverified clue; neither the masked card nor the NPSB
   operation label proves who received the payment. A `//` reference identifies a
   movement and may be shared by its charge; it is not a recurring recipient rule.
4. Choose an external party or another owned account, enter a verified display
   name and optionally suggest a compatible transaction type/category/note. An
   internal transfer requires a different active owned account in the same currency.
5. Save the verified mapping. Review the relevant pending statement row and use
   **Apply suggested choices** if correct, then save/review it normally. Existing
   ledger transactions are not updated by the mapping or identifier scan.

A possible separate charge can be suggested for the following row when its
reference, date, debit direction, adjacency, bounded amount and exact balance
step corroborate the pair. The fee remains its own row and does not inherit the
transfer destination. Recognized pairs are not treated as sub-taka rounding
variants of one transaction. Check the original PDF; a small amount alone is insufficient.
Saving or removing a mapping never combines amounts or changes original sources.

The web schema accepts the additive `ebl_bank` counterparty-code profile and
preserves City Bank/bKash behavior. This feature needs API and web deployment;
there is no schema migration or automatic financial-data backfill. Recognition
is deliberately restricted to supported digital EBL bank NPSB descriptions with
one full identifier after `||` and before a closing `|` (including `||digits|DC`
and `||digits||DC`). Older imports missing this metadata can be scanned again
after deploying the updated API. Unseen layouts, partial digits and
ambiguous descriptions require manual review.
