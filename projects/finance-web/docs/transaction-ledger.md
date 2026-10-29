# Transaction ledger workspace

The transaction list uses the existing light/dark theme and API collection. It
keeps daily, monthly, custom-range and all-date filtering, account selection,
search, ordering and advanced filters. Search refreshes after a 300 ms pause
(or immediately on Enter); account selection and date navigation refresh in
place. A filter icon opens secondary choices, with an active-count indicator.
The dialog becomes a bottom sheet on narrow screens. Its dates, date basis,
type, category, debit/credit and source remain drafts until **Apply filters**;
Cancel/Escape discard those drafts without changing the list. Invalid date
ranges stay open with a field error. Reset clears the dialog's secondary choices
and dates while retaining the main search/account selection until Apply.

## Reading the list

- The primary toolbar contains Search, Account, date navigation, Filters, and
  the labelled Add transaction action. The next row contains count/loading state
  and named icon controls for Sort, Export, Display, Clear and More tools.
  Every icon has a hover title and accessible name. Applied filters appear as
  removable, bounded chips; removing one refreshes only that selection.
- Sort keeps the selected date range and date basis. Evidence health and the
  latest action's Edit/Undo are available in More tools. New actions still use
  the shared toast with Edit/Undo. Export success is a toast, not a lasting row.
- Date and time share one column, with time beneath the date.
- Compact type and source badges accompany descriptions. SMS badges reflect SMS
  provenance or linked SMS evidence; PDF badges reflect attached statement rows.
  Imports without attached statement evidence are labelled Import, not PDF.
- Description, account and category text has a bounded width. Hover or keyboard
  focus reveals the full text; touch users can tap to toggle the same preview.
- Account paths retain account avatars and the actual transfer direction. Internal
  transfers have a neutral amount when all accounts are shown; filtering to one
  account shows that account's signed movement.
- **Edit** stays visible. The adjacent actions disclosure contains Details &
  sources, Find match (transfers), Revalidate, History and Delete. Details, sources,
  editing, revalidation and transfer matching open in the current workspace.
  History opens the existing audit-log page.
- Display opens one scrollable dialog containing columns and identifier display.
  Existing v1 Time column choices migrate to Date & time; optional balances and
  masked identifiers remain available. At least one column stays visible.

## Pagination and navigation

Refresh and reset are separate actions: the circular-arrow **Refresh transactions**
button reloads current data while preserving filters and pagination. The **X**
clears applied filters, including the date range. The filter dialog's labeled
**Reset filters** action clears its draft choices and still requires Apply.
Compact date controls use a calendar icon for Today/Current month, rather than
reusing the refresh symbol for date navigation.

The browser displays 25, 50 or 100 rows from the full filtered API collection.
This is presentation pagination, not a new server pagination contract. Filter
application resets to the first page, page-size changes reset to the first page,
and deleting the last item on a page clamps the visible page. CSV exports all
records matching the **applied** filters, independently of the visible page or
unapplied filter-dialog selections or pending search input.

Filters, page and page size are encoded in the URL. Browser history entries also
keep the vertical position and table's horizontal offset without discarding
Next.js history metadata. Returning with Back or Forward reloads the selected
filters and restores position after the collection renders. Only scroll offsets
are added to history; no transaction records or editor drafts are cached there.

The table contains horizontal overscroll, and the document suppresses horizontal
edge gestures while this workspace is mounted, where the browser supports it.
The previous document setting is restored on leaving. Normal browser Back,
Forward and keyboard shortcuts remain available. Native OS touchpad behavior
varies; the restoration path remains necessary even with containment enabled.

Changed editor inputs prompt before Cancel/Close discards them, and register a
browser before-unload warning for reload/tab-close/full-document navigation.
This is not an offline draft store or a guarantee against same-document route
navigation, browser crashes, or device shutdown.

## Verification

The Account Lanes (`/timeline`) toolbar has a Refresh action for the displayed
date range. It retains the existing cards while reloading all activity pages,
account metadata and categories, then replaces the range together and reloads
the inspector's source evidence. The date, visible-day anchor, selected lanes,
layout and full screen state are preserved. On failure, old cards remain with
an error toast. Transaction-change events also refresh the view; prefetched
weeks are invalidated so returning to a cached date does not show old activity.
Refresh reads data only and uses the current activity/account/category APIs.

```sh
cd projects/finance-web
npm run test:transactions
npm run typecheck
npm run build
```

Browser QA should cover desktop and narrow-screen cards, light and dark themes,
long text with mouse/keyboard/touch, action-menu focus and Escape, display
preferences, filter drafts/cancel/apply/reset, invalid custom dates, active chips,
live search, sorting without resetting dates, empty results and pagination after
filtering/deletion, CSV with pending filters, in-place editor/source dialogs and
Back/Forward
with filters, page and both scroll offsets preserved. Use synthetic data only.
No API, database migration or financial-data backfill is required.

## Financial overview and reviewed timeline placement

The financial overview is current; a report or transaction period filters activity,
not current balances. Currencies remain separate. Earned income excludes loan
principal and refunds. Net spending is expenses plus fees less refunds; lending,
borrowing and principal repayments are financing. Own transfers do not increase
portfolio spending or cash flow. An account-scoped money-flow view includes that
account's transfer leg. Refund-only periods can have negative spending.

Reports compare full months with the previous calendar month and other ranges
with an equal preceding duration. Categories (including Uncategorized), merchants
and accounts open the contributing transactions with the period/currency intact.
Category and merchant comparisons use the same prior period. Filtered transaction
totals use every matching row, not just the visible page. The dashboard groups
small categories into Other; when categories have net credits, it shows signed
rows rather than misrepresenting negative values as donut slices.

Accounts show dated source reports, saved statement periods, manual checks and
pending decisions. A saved statement period or matching balance is not proof of
complete capture. Current card liability and remaining statement dues describe
different dates and must not be added together. Debt records are separate from
account balances and currently use BDT. Recurring monthly estimates annualize
weekly/monthly/quarterly/yearly schedules separately by currency.

Payment actions on each debt/bill open an explicit choice: link an existing
compatible ledger movement, record a new movement, or update only the planning
record. Card payments create a transfer, debt payments create principal repayments,
and recurring payments create an expense. Review imports before recording a new
entry. Retry IDs prevent duplicate payments; linked financial fields, Delete,
merge and ledger Undo require removing the planning link first. Removing a payment
record restores the planning balance/schedule and keeps the ledger movement.
Only the latest recurring payment can be removed, and an independently changed
schedule needs review. Creation forms are collapsed after the balances/schedule.

On the timeline, **Suggest placement** reviews the entire recorded account day.
A unique continuous balance chain can suggest an order; missing balances,
ambiguous chains, card reference balances, or differing posting/observation dates
require manual review. Known-time movements keep their relative order. Apply saves
per-account display metadata and a balance-supported/manual label; actual times
stay unknown. There are no artificial seconds to run out of. Transfers stay one
transaction, with a separate display order possible in each account.

Changing the day's activity or evidence invalidates its saved placement until
reviewed again. Preview fingerprints and revisions reject stale decisions. Clear
placement and Undo placement change only display metadata; placement changes are
recorded in History. The timeline's precise balance-gap checks continue to require
actual times and do not treat reviewed placement as clock evidence.

This broader feature requires both API and web deployment. Apply transaction
migration `0009_timeline_day_order` before deploying the new web client. No
financial values are backfilled or changed automatically.

Verify with `npm run test:finance`, the existing workflow/date checks, lint,
typecheck and a production build. Browser checks should cover report drill-through,
create/link/remove payment, stale placement, desktop/phone layout, and focus after
opening a payment from a row. Use isolated synthetic data.

## View a saved transaction

Click a transaction row, its description, or **View** to open the centered,
read-only detail sheet. Description and View are native keyboard buttons; row
clicking ignores links, other controls, modifier clicks and text selection.
**Edit transaction** is a separate action in the sheet and the row's overflow
menu. Viewing never posts, matches, reparses or changes money.

The sheet fetches the latest saved transaction and attached SMS/statement rows
through existing authenticated read endpoints. It keeps the list's filters,
page and scroll position. Previous/Next follows the complete filtered result
order, including rows on other pages; it does not silently change the list page.
Escape/Close restores focus to the trigger and unlocks scrolling. On phones,
the body scrolls while Close/Edit stay reachable in a fixed footer.

Original SMS messages and distinct statement PDFs are counted separately from
statement rows. Inline fees remain labelled rows within their original PDF count.
Saved source facts show amount, account, reported balance and date/time. Amber
marks known differences; absent times and unknown balances are not declared
matches or mismatches. SMS receipt dates are labelled Received when a saved event
observation is absent. Currency/account differences are not compared as like
monetary units, and an unattributed legacy transfer balance is never assigned to
one account by assumption. Internal transfers are neutral in the all-accounts
view; selecting an account shows the direction of its leg.

Original text and recent history are expandable. History is fetched only when
opened; statement/PDF links open the saved review in another tab. Missing archives,
redacted originals and failed source checks remain explicit. Retrying or moving
to another record cancels stale reads. Record changes trigger a fresh view.
Saved sender/receiver identifiers have their own optional disclosure. Eligible
saved cash-withdrawal SMS retain the explicit Remember route action under the
original source; simply opening the viewer never saves a rule.
This is frontend-only and needs no API migration or new endpoint.
