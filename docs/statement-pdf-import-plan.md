# Statement PDF Import Plan

Last updated: 2026-10-08

Status: saved imports, matching, editable review, explicit posting/linking,
import history, bulk approval and retry protection implemented for the initial
BDT digital layouts. The preview endpoint remains stateless. OCR, credit-card
billing layouts and automatic posting remain future work.

## Next reconciliation implementation

The cross-source follow-up is specified in the
[evidence reconciliation and historical revalidation plan](evidence-reconciliation-plan.md).
It addresses combined links retaining a missing effective report, the distinction
between statement-draft edits and ledger corrections, evidence arriving after
posting, account-side source coverage, and preview-first repair of existing data.
Existing import/posting features remain in place; the new service and historical
revalidation workflow are proposed work with explicit acceptance gates.

## Evidence And Initial Scope

Private, user-provided EBL bank, City Bank savings, and bKash statement samples
were inspected locally. Text extraction covered every page; rendered first,
final, and relevant summary pages were checked against the extracted columns.
A temporary coordinate-based extraction experiment reconciled row balance
changes and the available summary totals/counts. This establishes feasibility
for these layouts, not production accuracy across all statement versions.

No original PDFs, extracted financial values, personal identifiers, filenames,
or private source links belong in this repository. Commit only synthetic
fixtures that reproduce the structural cases below.

The reviewed EBL sample is a bank account statement containing card payments,
not a credit-card statement. Credit-card billing layouts require separate
samples before claiming support.

| Layout | Observed structure | Required handling |
| --- | --- | --- |
| EBL bank | Transaction date, wrapped description, reference column, debits, credits, balance; value dates and identifiers embedded in descriptions | Extract by column position and dated row anchors. Exclude the dated opening balance even though it occupies the credit column. Preserve embedded value date separately. |
| EBL bank summaries | Closing balance follows the final dated row; a later page contains totals, debit/credit counts, uncollected funds, unsettled transaction section, and a reversal legend | Detect section boundaries. Store summary facts separately; never append them to the last transaction. Reconcile totals and counts excluding opening balance. |
| City Bank savings | Date, description, cheque number, withdrawal, deposit, balance; repeated headers and footer; totals and opening/available balance at the end | Use withdrawal/deposit columns for direction. Preserve printed descriptions even when truncated. Verify totals and opening-to-closing balance. |
| City Bank reversals | A purchase, reversing credit, and subsequent purchase can share date, merchant, and amount | Keep each movement. Suggest reversal relationships without treating an opposite-direction row as a duplicate. |
| bKash | Date and time, transaction type, wrapped details, Out, In, signed Charge/Fee, balance; transaction ID inside details | Use In/Out rather than the type label for direction. Preserve time and principal separately from fees. Join wrapped descriptions/IDs before classification. |
| bKash fees and summaries | Negative fee values debit the wallet in the reviewed layouts; Total Out includes charges | Validate signed fee effects using balance arithmetic. Do not drop the sign or compare principal-only Out sums to fee-inclusive totals. |

Other observations:

- All reviewed pages have a native text layer. Default table extraction returned
  no transaction tables for the bank statements and header-only tables for
  bKash. Native text does not guarantee that generic table extraction works.
- EBL principal and charge rows can repeat embedded references and descriptions.
  A reference is supporting evidence, never a unique transaction identifier.
- EBL card purchases can be recorded later than the embedded value date. A value
  date is not automatically the purchase timestamp.
- Filename dates can disagree with the statement period printed inside the PDF.
  Parse the document metadata and show discrepancies; do not trust filenames.
- Opening balances, summary totals, and statement issue dates are not money
  movements. An opening balance cannot be imported as income.

## Extraction And Normalization

1. Accept an authenticated upload and select a reporting account. Detect provider
   and layout using header anchors and column geometry, then check ownership,
   currency, and account identity against the selected account. Support multiple
   accounts/sections only when each section is explicitly mapped.
2. Inspect the PDF for encryption, page count, native text, and supported layout.
   Accept an unlock password transiently; never store it, put it in a URL, or log
   it. The reviewed unlocked files do not validate the encrypted-file flow.
3. Start with `pdfplumber` word coordinates and provider-specific, versioned
   profiles. Detect headers on each page rather than assuming one fixed absolute
   position. Reconstruct wrapped rows, exclude footers/summary sections, and
   retain page, row, and bounding-box provenance.
4. Normalize date, optional time, posting date, value date, currency, principal,
   debit/credit direction, signed adjustments, reported balance, description,
   and available references. Preserve absent time as null. Keep full account,
   phone, card, and customer identifiers out of ordinary ledger descriptions;
   store only safe masked matching hints and access-controlled source evidence.
5. Use local OCR/table reconstruction only for image-only or unsupported layouts.
   Evaluate Docling as a fallback against synthetic samples; do not introduce
   OCR for supported digital statements just because generic table detection
   fails. Unknown layouts remain reviewable and cannot silently post.

For the reviewed wallet layout, the balance equation is:

`next balance = previous balance + In - Out + signed Charge/Fee`

The negative fee is an additional debit. Other layouts must declare their own
sign and summary conventions. Use Decimal arithmetic, not floating-point
amounts. When no opening balance is printed, an implied opening balance may be
displayed as a derived check; it must not be presented as bank-reported data.

Store printed available balance, ledger closing balance, uncollected funds,
unsettled amounts, and credit-card amount due/limit as distinct facts. Only apply
a reconciliation identity when the profile establishes compatible semantics.

## Statement Evidence And Matching

Delivered backend concepts:

- `StatementImport`: user, reporting account, file digest, detected profile and
  parser version, period, currency, summary checks and timestamps. Masked extraction is retained;
  original PDFs are stored encrypted for source recovery; unlock passwords are
  discarded. Processing is separate from posting.
- `StatementRow`: stable source identity, page/row locations, normalized values,
  validation results, review decision, and optional ledger/evidence links.
- Fee/adjustment components: preserve separately posted fee rows and inline
  wallet charges. Associate a charge with a principal only when evidence proves
  the relationship; never discard a row because its reference repeats.

Extend matching beyond the existing transfer-specific matcher to purchases,
income, fees, cashback, refunds, and other ordinary transactions. Account,
currency, direction, principal, references, merchant hints, reported balance,
and date semantics all contribute. A unique corroborated reference is stronger
than merchant similarity; date/amount proximity alone is insufficient.

Use posting/value dates as extra matching evidence without overwriting an
existing SMS transaction's date or user corrections. The current window is three days; changing it requires fixture evidence.
Previously linked identical source values also surface corrected ledger entries
outside that window and require draft correction before linking.

An accepted existing-transaction match attaches the statement evidence to the
ledger record instead of posting another movement. Preserve its category,
type, notes, original source, and original SMS. Conflicting amounts, balances,
or account mappings require an explicit correction decision. Retain multiple
source observations without silently replacing the primary reported balance.

For owned-account transfers, retain canonical From -> To direction and the
statement's reporting side. Match opposite account observations through the
existing transfer evidence model. Wallet funding is a transfer only if the
other owned account is established; merchant wording alone cannot establish
ownership. A fee is an additional expense even when linked to that transfer,
and must affect the ledger exactly once.

Retries of the same file/row must be idempotent under database constraints and
atomic posting. The constraint must include user/account scope. Exact-file retries reopen the original extraction and preserve accepted links.
Extraction revisions/re-parsing saved imports remain future work.
Overlapping statements and unlocked/re-exported copies can have different file
digests: compare source observations across batches and propose matches rather
than relying on file hashes alone. Do not collapse genuine repeat purchases or
principal/fee components sharing a reference.

## Review And Automation Flow

`Upload -> Account/layout check -> Extract -> Validate -> Match -> Review -> Post/link`

The web app shows:

- Extraction progress without blocking navigation.
- Statement period/account, parsed row count, summary reconciliation, and gaps.
- Filters for New, Possible match, Needs correction, and Already linked, plus
  date/type/category and readable error reasons.
- Original row/page evidence alongside editable fields; wrapped text stays
  available, with private identifiers masked outside protected source access.
- Bulk approval for validated new rows and explicit acceptance of match
  suggestions. Any unresolved row remains visible and unposted.
- A summary and toast indicating how many entries were added, linked, or left
  unresolved. Posting failures and retries must not create partial duplicates.

Reuse existing account/category suggestions, but keep layout/direction parsing
separate from SMS sender learning. Learn merchant aliases and confirmed mappings
from user decisions. Start with user-reviewed posting. Future opt-in automation
can link or post unambiguous validated cases with audit history and reversible
links; AI confidence alone never authorizes a money movement or merge.

## Current Delivery Limits

Saved imports require `statements.0001_initial`. The selected reporting account
is fixed for a saved batch; remapping needs a new upload for the correct account.
Original PDFs are encrypted and available to their owner on demand; unlock
passwords are not retained. Review rows expose masked extraction/page provenance.
Original checks are not rewritten
by draft edits. No OCR, saved extraction revisions, background queue, or automatic
posting is delivered. Limits: 4 MiB, 30 pages, 2000 source rows, 10 uploads/hour/user,
20-second worker timeout. Saved review components can double for inline fees.
Bulk approval handles up to 50 visible rows; matches and discrepancies require
individual review. History queries are bounded; truncated matching blocks posting.
The worker may finish after client cancellation and save a draft, but cannot post.

The initial extraction and review delivery (steps 1–3 below) is complete.

## Delivery Sequence And Acceptance Checks

1. Build synthetic EBL bank, City Bank, and bKash fixtures, then versioned
   extraction profiles. Reproduce repeated headers, wrapped text, empty reference
   columns, mixed direction labels, signed fees, opening/closing/summary rows,
   posting/value dates, and purchase/reversal/re-purchase collisions.
2. Implement authenticated import jobs, source retention, normalized evidence,
   reconciliation checks, cross-source matching, and idempotent posting.
3. Add statement review UI and bulk actions; test account remapping, saved edits,
   same-file retry, overlapping statements, ambiguous matches, and concurrent
   approval. Update contracts and project-specific docs with the delivered API.
4. Validate actual credit-card layouts separately, including liability direction,
   repayments, interest, installments, refunds, fees, and separate currencies.
5. Measure extraction/matching precision and expand OCR or opt-in automation
   only after reviewing failures on additional layouts.

Before claiming a profile is supported, all fixture rows must have explainable
direction/amounts, balance transitions must reconcile where evidence permits,
and statement totals/counts must agree under that provider's conventions.
Insufficient source data is a visible limitation, not a fabricated successful
check. Manual corrections and linked SMS transactions survive every retry.

Raw files need bounded upload/page/processing limits, protected temporary
storage, redacted logs, user-scoped access, and an explicit deletion policy.
Local extraction is the default; an external OCR/AI service requires a separate
data-processing decision and must not receive private statements implicitly.

## Technical References

- [pdfplumber](https://github.com/jsvine/pdfplumber): text coordinates and
  configurable table extraction.
- [pypdf text extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html):
  PDF positioning and scanned-document limitations.
- [Docling](https://docling-project.github.io/docling/): candidate local OCR and
  document/table reconstruction fallback.

## Review assistance delivered

Merchant/time corroboration now ranks strong versus possible matches and explains
the evidence. Multiple strong candidates remain ambiguous. Matching considers
posting/value dates and the reporting account's transfer observation dates.
Explicitly remembered category/type/owned-account choices appear as suggestions
for later matching source patterns; generic transfer wording is excluded. These
suggestions never auto-post or change reported amounts, dates or balances.

For bKash `Card to bKash` credits, new imports start as unconfirmed transfer
drafts. A reviewer must identify the other **owned** account before recording a
transfer; a card-funded top-up from someone else's card may instead be classified
as income or another appropriate type. A trailing `/ City` or `/ ebl` in the
statement details offers matching active BDT bank/card accounts as choices, but
never selects one from the bank name alone. Existing pending rows receive this
read-only suggestion when opened; their saved drafts and ledger entries are not
rewritten. The source transaction type and masked details remain in the immutable
extracted row, and the original uploaded PDF is retained encrypted for imports
made after original-file storage was introduced. Older imports without an archive
can attach it by uploading the identical PDF again.

Full-import saved-draft reconciliation is independent of original extraction checks.
The summary separates principal/inline fee totals and review decisions, labels derived
openings and unavailable checks, and retains skipped rows in statement arithmetic.
Corrected financial drafts with discrepancies need explicit individual review.
Selected-row create/skip actions use frozen IDs/versions (max 50), fresh backend
validation and atomic decisions. Save & next and editor shortcuts speed review
without accepting matches or posting implicitly. OCR, card billing layouts and
precision-based automatic posting remain future work.

### Statement-to-ledger comparison

Review extracted transactions in a table alongside existing-ledger suggestions.
Confirmed links retain masked printed PDF fields separately from canonical ledger
values. No duplicate movement is created. Amount plus reporting-account balance
on the same day is a strong suggestion; shared candidates across source rows and
multiple corroborated ledger candidates remain ambiguous. Confirmation is explicit.

Compare in both directions: statement-only rows may be added after validation;
ledger-only entries are shown for investigation within the selected account's
printed period. Account-side transfer observations define date/balance coverage.
Unresolved candidate matches are excluded from ledger-only results. Failed source
checks, incomplete source rows, missing periods and search limits make absence
provisional, never an instruction to delete. Older statements may predate recorded
ledger history; category/merchant wording differences do not establish duplicates.

A private evaluation of the four supplied digital layouts passed all available
printed-total checks. The sanitized export lacks original merchant/reference text
and saved account identifiers, limiting fuzzy matching and account identification.
Real exports/PDFs stay outside the repository; regression fixtures are synthetic.

Balance differences are shown with their signed delta against the nearest
reporting-account ledger observation. Even a small difference remains an explicit
conflict; do not silently round it away or assume available and statement balances
have identical semantics. Exact matching selects the agreeing observation when
several observations exist for the same account.

### Keep transfer corroboration within one observation

Evaluate each observation of the selected reporting account independently. Do not
combine the sender's canonical date with the receiver's balance, or combine one
report's reference with another report's timestamp. The selected eligible
observation supplies the suggestion's date/time/reference/balance/note/source.
Receiving-account evidence takes precedence over canonical sender fields. If it is
absent, sender date is only a fallback search hint, with no borrowed sender time,
reference or balance. Legacy source-account canonical reports remain usable.
Explicit links preserve both original ledger fields and separate statement evidence.

### Preserve PDF coverage through draft corrections

Determine statement presence using immutable extracted dates/times, direction,
principal or inline fee amount, balance and reference. Draft classification and
owned-other-account selections do not restrict this source coverage check. Compare
corrected drafts independently so their suggestions still participate. Exclude
candidates found through either view from ledger-only results. A changed draft
must not erase a transaction actually printed in the PDF.

Source/draft matching differences and failed saved-draft reconciliation make
absence provisional with explicit comparison warnings. Original missing amounts
or dates remain incomplete even after a valid draft correction. Corrections and
source evidence are never rewritten by the read-only comparison endpoint.

### Use consistent statement-wide match confidence

Single-row reads, draft edits and confirmations include unresolved siblings from
the same statement when calculating shared candidate claims. Opening one row does
not promote a shared candidate to strong. Other statements do not compete in this
same-statement ambiguity check. Supplied corrected/source views retain their own
values, while missing siblings are loaded from the saved draft. Return only the
requested rows. Explicit individual acceptance remains available; it rechecks
current evidence and cannot attach one movement twice within the same statement.
Statement-wide history limits are surfaced instead of bypassed by opening a row.

### Revalidate accepted financial identity

Accepted PDF evidence must not certify a ledger movement solely because its link
exists. Reads recheck amount, debit/credit perspective, reporting-account currency
and account path (including a selected owned transfer counterpart). Stale links
show a correction warning, count as needing review and make coverage provisional.
A stale fingerprint cannot hide a financially incompatible ledger entry from
ledger-only results. Evidence and ledger records remain intact until explicit
unlink and review. Editorial category/note changes and previously acknowledged
balance differences do not invalidate a financial identity match.

### Reuse account identity metadata

Payment methods can register multiple typed masked identifiers and text aliases.
The shared resolver suggests the reporting account from the header suffix and
shows ambiguity rather than choosing between collisions. Saved imports recompute
this advisory mapping from current settings. Transfer-worded source rows can also
suggest the other owned account from explicit account/card/wallet evidence or a
saved text alias, without changing the extracted description or posting values.
Identity hints do not merge transactions or accept statement matches.

### Reviewing a pending SMS together with a pending statement row

Statement row detail can suggest an eligible pending SMS when account perspective,
type, direction, amount and date window agree. This is a separate manual decision:
verify the pair, choose between conflicting reported balances, then create one
SMS-dated ledger transaction and attach the PDF row atomically. If ledger
candidates also exist, compare each one and explicitly confirm that each is a
different movement. The server rechecks the exact candidate IDs before saving;
a changed list requires a fresh review. Different amount/type/account/
direction, an unresolved transfer path, a busy candidate window, or a separate
inline-fee balance keeps sources in their established independent review flows.
A suggestion never posts or links money by itself.

### Citytouch recurring code review

For City Bank `CT-FT-***1234-***5678` rows, group only the recurring second
masked code, using every visible digit and scoping it to the reporting account
and debit/credit direction. Four visible digits remain a suffix clue: the
asterisks do not reveal the masked digits, so collisions remain possible. Treat
it as an unverified clue until the user names an external counterparty or
links a different owned account in the Statement codes directory. Show recent
masked source examples for verification. A verified code may suggest the party,
type, category and owned transfer path on pending rows, but the user applies
the suggestion in review. The bank's fund-transfer operation does not decide
whether the ledger movement is an internal transfer, expense or income. The
generic learned-description mapper must not collapse different `CT-FT` codes.
Source evidence and confirmed ledger entries remain unchanged when mappings
are edited or forgotten.

The parser now captures the entire **printed** second component, whether the
PDF shows full or masked digits, before masking long identifiers in the general
description. It stores that separate clue
encrypted. For older City Bank imports whose original PDFs are archived, the
temporary `refresh_citytouch_codes` maintenance command supports dry-run and
digest-confirmed apply. It upgrades only codes with extra visible digits that
end in the previously saved suffix; it preserves all draft and ledger fields.
The command is disabled unless `ALLOW_STATEMENT_CODE_REFRESH=1` is set for that
invocation. It does not apply to EBL, whose statement layout has no Citytouch
code, or recover digits that the PDF itself masks.
Existing four-digit mappings are not migrated to longer codes automatically;
the user must verify the new observation before saving its mapping.
Statement review uses the separate retained code to display an enhanced
Citytouch reference. It does not overwrite the masked historical extraction,
user-edited draft details, or posted ledger entries.
For a pending SMS + statement pair, a saved Citytouch code mapping prefills the
result merchant when the statement merchant is still the raw bank reference. Its
category also prefills when active and compatible with the selected transaction
type. A mapping for a different type waits until that type is chosen; a saved
statement category takes precedence on initial load, and the result stays editable.
The user can edit or choose the SMS/statement wording before confirmation;
manually corrected merchants and the original source descriptions stay intact.
