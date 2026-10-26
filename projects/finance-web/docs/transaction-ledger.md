# Transaction ledger workspace

The transaction list uses the existing light/dark theme and API collection. It
keeps daily, monthly, custom-range and all-date filtering, account selection,
search, ordering and advanced filters. One **Apply filters** action applies the
form. Date navigation and ordering still refresh immediately.

## Reading the list

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
unfinished filter edits.

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
preferences, single Apply, empty results, pagination after filtering/deletion,
CSV with unfinished filter edits, in-place editor/source dialogs and Back/Forward
with filters, page and both scroll offsets preserved. Use synthetic data only.
No API, database migration or financial-data backfill is required.
