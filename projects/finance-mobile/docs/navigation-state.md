# Mobile navigation and retained state

## Screen lifetime

React Navigation's `NavigationContainer` and `TabRouter` own the header and tab
destinations. More owns secondary navigation; the duplicate drawer is removed.
`backBehavior: "history"` returns through recent distinct
workspaces instead of resetting a panel flag and reconstructing the prior page.
Visible Back and Android hardware Back use the same history. At the root, normal
Android Back behaviour is left to the system. Native modals dismiss their own
top sheet first. A dirty saved-entry editor offers **Keep editing** or **Discard
changes** before Back/Cancel can remove its draft.

`src/retained-navigation.tsx` uses React Navigation's supported custom-navigator
builder/factory APIs, preserving Finance's existing chrome without another native
navigation module. It lazily mounts at most one view for each of the 12 fixed
workspaces. Visited forms, inputs and disclosures stay mounted for this login,
including after Back. Hidden workspaces cannot receive touches or accessibility
focus. They receive a blur update, then stop rendering root updates until focused
again, when they receive current props. Token rotation does not change screen
keys or restart the initial account/review requests.

Each workspace owns a ScrollView; Activity owns a FlatList. Hidden views keep
their layout rather than shrinking to zero. `src/retained-scroll.tsx` retains
offsets in memory and restores after focus/layout without animation. Hidden
layout events cannot overwrite an offset. Activity keeps offsets per filter
query. If a genuine data update removes content, native scrolling clamps the
old offset to the remaining content. Navigation itself never saves a record.

## Server data lifetime

Activity uses a TanStack Query infinite query keyed by backend/user scope and
normalized account/date/category/type/search/order filters, never the token.
Requests use the latest token, existing response validation and abort signal,
and 25-row pages. Search waits 250 ms. Superseded filter/search responses cannot
overwrite the selected query; overlapping page IDs are deduplicated and repeated
Load more taps share one request.

Data is fresh for 60 seconds. Returning to fresh Activity reuses every loaded
page immediately. Stale/invalidated Activity refreshes on screen/app focus in the
background. The loaded page sequence is rechecked; the old complete list stays
visible until refresh completes. Failed refreshes retain that list and expose
Retry. Pull-to-refresh and explicit Refresh remain available. Unobserved filter
caches expire after five minutes; a retained screen's current query remains
observed. This is not a complete offline ledger download.

The existing save/sync completion revision invalidates Activity queries. Hidden
Activity defers the new fetch until return. SMS review still keeps drafts by
candidate ID; refresh now rereads enough pages to retain the previously loaded
window instead of replacing it with the first 100 messages. It commits only
after the full window loads, preserves drafts for still-pending IDs and ignores
superseded responses. A message resolved elsewhere can disappear after refresh.
Other workspaces retain their explicit/load-on-open refreshes. SMS decisions now
use [immediate queue updates and save recovery](review-save-recovery.md): affected
rows disappear before the write finishes, failed decisions restore their drafts,
and unresolved outcomes remain visible for status checking and explicit retry.

## Session boundary

Navigation and the query provider are keyed to the authenticated backend/user.
Logout/scope changes destroy retained views, cancel reads, clear the in-memory
query cache and reset root drafts. A later login starts at Home with empty
history, even for the same user. Existing encrypted queues and bounded local
account/transaction previews retain their previous storage rules.

There is no new persistent draft store, API contract, database migration, native
module, SMS permission or financial mutation. Process death/restart loses these
in-memory drafts, loaded pages and positions. An already installed APK does not
update itself; build/install a new app to ship the JavaScript changes.

## Verification

From `projects/finance-mobile`:

```bash
npm ci
npm run typecheck
npm run test:navigation
npm test
CI=1 npx expo export --platform android --output-dir dist/navigation-check
```

Tests use real React Navigation core/router and TanStack Query with synthetic
APIs and native host mocks. App-level coverage checks Back through More/Accounts
to Activity, stable list/input identity, manual-entry handoff, token rotation
without bootstrap reload and logout/relogin cleanup. Other cases cover nested
history, scroll/accessibility scrolling, hidden layout events, drafts and
disclosures, retained pages, stale/background/failed refreshes, aborts, review
window refresh and dirty-editor dismissal.

The Android export checks Metro/Hermes bundling; it is not an APK or a physical
device test. On a phone, check native Back/gestures and keyboard-first dismissal,
top modal dismissal, several loaded Activity pages, Accounts/reconciliation Back,
profile/manual/SMS unsaved edits, larger fonts/TalkBack, slow/offline background
refresh, foreground resume and logout/relogin. Follow the signed-release guide
before distribution.
