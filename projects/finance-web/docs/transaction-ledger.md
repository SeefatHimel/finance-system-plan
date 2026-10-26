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
