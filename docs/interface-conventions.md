# Shared interface conventions

Web and Android use **Finance** as the product name. Native package IDs, URLs,
API names and the Expo slug remain stable; the installed Android label changes
when a new APK is installed.

## Transaction workflows

The web transaction editor and SMS review use Type/Category, account selection,
Amount/Reported balance, Date/Time, then merchant, reference and note. Native SMS
review now follows that sequence for the fields it supports: Type/Category,
reporting account and optional other transfer account, Amount/Reported balance,
Date/Time, then merchant, reference and note. Native review and the saved-entry
editor accept account-labelled balance corrections. Changing a known reporting
account clears its old balance with a warning. Transfer edits retain separate
account-bound balances through reversal; the second balance is collapsed. An
initially unassigned parser balance binds to the first account choice.

A reporting account is the account described by the SMS. For a credit transfer,
“Other transfer account · From” identifies the sender; for a debit it says “To.”
The other account control is visible only for transfers. Optional native payment
method choices live in an expandable section whose heading includes the current
selection. Its children stay mounted and parent-owned drafts survive collapse.
Required corrections and conflicting matching evidence remain visible.

Quick Add deliberately keeps Amount first. Saving a manual entry says **Save
transaction**; confirming a parsed SMS says **Confirm & add**. A selected choice
uses a mint border/soft background and a check or native selected/checked state;
filled mint marks primary actions such as Save/Confirm. Native choice and
picker targets are at least 48 logical pixels. Native review's type choices wrap
on narrow screens; date/time fields wrap when their minimum widths do not fit.

Web contextual help supports hover, keyboard focus and tap. Native optional help
uses an expandable button with its expanded state exposed to accessibility.
Important errors and financial conflicts must not live only in help text.

## Dates, time and amounts

`projects/finance-contracts/presentation.ts` contains dependency-free client
presentation helpers, alongside the existing shared Quick Add and transfer
comparison helpers. It is not an HTTP contract or ledger calculation layer.

- Full read-only calendar dates use `dd MMM yyyy`; compact queue dates may omit
  the year. Date-only values are validated and formatted without timezone shifts.
- Absolute timestamps use the viewer's local timezone and a 24-hour clock. SMS
  review resolves its input date and time from that same local timestamp, avoiding
  a UTC date paired with a local time. Mobile Today/history defaults also use the
  local day. API date/time strings, original evidence and stored timestamps retain
  their existing formats. Activity Added/Updated day grouping remains Asia/Dhaka.
- Browser-native input rendering follows the browser locale; date/month/time
  inputs declare a dark color scheme so native affordances remain visible.
  Android opens the system calendar/24-hour clock; iOS uses dark spinner dialogs.
  Opening or cancelling a picker never commits a value. Exact text inputs remain
  available. A blank time remains unreported until the user chooses a time.
- Core ledger, account/report and review displays show a currency code and two
  decimal places. Decimal API strings retain exact cents and grouping without
  conversion through a floating-point number. Negative balances retain their sign;
  zero is different from absent or malformed data. Charts may abbreviate axis or
  centre labels, while their monetary details include cents.
- Internal transfers stay neutral in unfiltered timelines, with both account
  names; account-filtered transactions retain that account's debit/credit sign.
  Reported balances retain their account's currency. These helpers do not perform
  currency conversion or change matching and balance calculations.

Saved filter views and an overview privacy toggle are deferred by product choice.
Native Edit/Undo use existing authenticated transaction and recovery endpoints;
account summaries use the existing dated comparison fields. No new API schema or
database migration is added.

## Verification

Run `npm run typecheck` and `node --test tests/*.test.cjs` in both client projects.
Web's presentation regression tests exercise exact decimal values and run SMS
input/date formatting in both Asia/Dhaka and America/Los_Angeles. Native tests
cover Android/iOS picker cancellation, a time containing seconds, invalid calendar
seeds, and optional fields remaining mounted through collapse/expansion. Existing
Quick Add focus and Activity cancellation/pagination checks remain part of the
full mobile suite.

Also inspect the rendered web UI at desktop and phone widths, including nested
clock cancellation, transaction dates, help buttons and transfer direction.
Export an Android JS bundle as a packaging check; native keyboard, screen-reader
announcements, system picker appearance and installed app name still need a
physical-device test with a new APK. Never use real SMS or account data in committed
fixtures or screenshots.

## Native recovery and status

Native account/category/payment-method choices use searchable sheets with
explicit selection and Cancel. Incompatible classification choices require a
visible decision. Full SMS uses a separate selectable, read-only view respecting
retention; original statement/SMS evidence stays separate from editable notes.
Review actions and their errors remain pinned below the scrollable fields.

A 15-second recovery notification offers Edit and Undo after server acceptance;
More retains the latest action and Refresh. Undo follows the backend's 24-hour,
latest-unchanged-action rules, rechecks availability and reads after an uncertain
response instead of blindly repeating the mutation. Ordinary offline queueing
is not presented as a posted ledger entry.

Native Capture distinguishes last-run acknowledgements, queued work, temporary
delays and records needing correction. Unknown counts are unavailable, not zero.
Server health and upload/review completion are separate states. Account reports
are compared with the ledger at the report time; credit-card references are not
cash mismatches. Run mobile `npm test` and native unit checks, then verify the
signed APK on a physical phone for large text, nested sheets, keyboard and Back.
