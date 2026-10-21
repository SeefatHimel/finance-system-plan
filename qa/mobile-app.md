# Mobile App Q&A

### How does mobile profile editing and appearance work?

More → Profile & appearance reads the authenticated user and PATCHes only first
name, last name and email. Username is shown but cannot be changed there. The
form keeps unsaved edits when an access token refreshes; server validation stays
visible if Save fails. System, Light and Dark are local device preferences in
AsyncStorage, and System follows the OS appearance. They do not change ledger
data, and web/mobile appearance preferences are independent.

### How are dates shown and stored on mobile?

Read-only dates and local timestamps use `dd/mm/yyyy`. Native pickers still
provide their platform calendar controls; the app submits ISO date values and
does not rewrite original SMS text.

### Can a history rescan restore older redacted transaction SMS?

Yes, if the SMS is still on the phone. Select its date range and enable
**Refresh previous imports**. Also choose **Restore text I previously removed**
for manual or older redactions; policy-redacted messages restore without that
second choice. The API checks the original hash and restores only
transaction-related text with a Keep retention preference; confirmed entries
are not added again. The migration switches existing finite retention choices
to Keep, while OTP/security and promotional exclusions remain.

## What is the mobile app responsible for?

The mobile app's primary responsibility is automatic Android SMS capture,
sender rule management, reliable local message storage and sync, and reviewing
parsed transaction candidates. Quick manual entry is a fallback for activity
that cannot be captured automatically.

## Why build mobile separately from web?

The mobile app needs native Android capabilities, especially SMS access and
possibly background sync. A web app cannot reliably provide that.

## Why Android first?

Android allows SMS access with permission. iOS does not generally allow apps to
read SMS inbox content automatically, so Android is the platform that matches
the core automation goal.

## Why React Native?

React Native allows native Android functionality while keeping React and
TypeScript as the development model. It also makes future cross-platform UI
reuse possible, even if SMS automation remains Android-only.

## Expo or bare React Native?

Expo is easier for general mobile development, but automatic SMS access may
require native Android modules. If Expo managed workflow cannot support the SMS
requirements, the project should use bare React Native.

Current implementation status: the app uses Expo for fast setup, health/API
validation, login testing, quick transaction entry, sender-rule selection,
local raw-message queueing, sync, and SMS review. A local Android native module
now exists for custom dev client or personal APK builds, so Expo Go remains a
manual-import/testing path while generated Android builds can request SMS
permission and capture sender-matched messages.

Current SMS decision: keep broad SMS access out of Expo Go, use the local native
module only in a custom Android build, and process only user-enabled sender-rule
matches. Public distribution still needs SMS permission policy review.

## How is a release APK signed?

The Android release build reads the keystore path, alias, store password, and
key password from private Gradle properties or environment variables. It fails
the release task when those values are missing rather than silently using the
debug key. The permanent key, build commands, signature verification, APK/AAB
paths, and physical-phone SMS smoke test are documented in
`projects/finance-mobile/docs/signed-android-release.md`.

Each update uses the same signing key and a larger Android version code. The
Expo Android version code and native Gradle value stay aligned so regenerating
native files preserves upgrade compatibility. Package, Expo and device-status
versions identify the same release.

## What is currently implemented in the mobile app?

- Project scaffold with Expo + TypeScript.
- Environment-based API base URL (`EXPO_PUBLIC_API_BASE_URL`).
- Initial health-check screen that calls backend `GET /api/health/`.
- Login testing flow (`POST /api/auth/login/`).
- Access token validation flow (`GET /api/auth/me/`).
- Secure session persistence with Expo SecureStore, refresh-token rotation on
  app launch, one transparent refresh/retry after an authenticated request gets
  a `401`, and explicit secure-session removal on logout.
- Account/category fetch flow (`GET /api/accounts/`, `GET /api/categories/`)
  with local cache hydration for offline form choices.
- Legacy detailed transaction flow (`POST /api/transactions/`) plus a local manual
  transaction queue for offline saves and later sync. Manual entries can carry
  an optional transaction time and provider-reported balance after the transaction, and that value
  survives local queue hydration and deduplication.
- Transaction list flow (`GET /api/transactions/`) with local cache hydration
  for the latest loaded transactions.
- Debt/lending flow (`GET /api/debts/`, `POST /api/debts/`, and
  `POST /api/debts/{id}/payments/`) for creating lent/borrowed records,
  seeing balances, due-soon totals, status chips, and recording repayments.
- Credit-card bill flow (`GET /api/credit-card-bills/`,
  `POST /api/credit-card-bills/`, and
  `POST /api/credit-card-bills/{id}/payments/`) for creating statement bills,
  seeing remaining totals, due-soon counts, status chips, and recording card
  payments.
- Recurring-bill flow (`GET /api/recurring-bills/`,
  `POST /api/recurring-bills/`, and
  `POST /api/recurring-bills/{id}/payments/`) for creating schedules, seeing
  active/monthly/due-soon summaries, and advancing the next due date after
  payment.
- Reconciliation flow (`GET /api/reconciliation/accounts/{account_id}/` and
  `POST /api/reconciliation/snapshots/`) for checking expected balances against
  real account balances from mobile, with compact expected/actual/difference
  metrics.
- SMS tracking settings scaffold that loads payment methods and sender rules,
  shows an Android permission gate, lets the user locally enable trusted sender
  rules, and syncs those enabled rules to native SMS capture in custom Android
  builds.
- User-scoped capture policy controls for excluding providers, OTP/security
  messages, and balance notices. Excluded providers are removed from native
  capture; the backend replaces any policy-excluded body with a deduplication
  tombstone before storage. It also auto-discards trusted-sender messages with
  no digits, so non-transactional notices sync successfully without appearing
  in the review queue or retaining their body.
- A dedicated Capture tab with a four-step setup checklist, explicit permission
  and background-sync state, provider/message-kind switches, and raw-text
  retention choices. The app sends device heartbeats so the web dashboard can
  distinguish ready, syncing, offline, permission, and failure states.
- Native sender discovery that reads distinct Android inbox sender names,
  timestamps, and counts without showing message bodies. The user can search,
  choose a sender, map it to an account and provider, create the backend exact
  match rule, and immediately enable/sync it without switching to the web app.
- Incremental native inbox scanning for historical messages. The scanner uses
  deterministic fingerprints to skip matched messages already processed,
  keeps explicit Tracking/Excluded sender choices across launches, prevents
  excluded senders from entering the upload queue, queues new matches locally
  before upload, and refreshes the review inbox after a sync.
- User-controlled SMS history imports with from/through dates and an explicit
  option to revisit previous imports. Revisits ask the backend to reparse only
  pending review candidates; confirmed transactions remain unchanged.
- A two-step development reset shown only in debug Android builds. It clears
  local scan state plus the signed-in user's SMS imports and SMS-created test
  transactions, while the backend refuses the endpoint outside debug mode.
- Encrypted local raw message queue backed by Android Keystore in native builds
  or Expo SecureStore as a fallback, with sync to `POST /api/messages/import/`,
  local duplicate checks, per-message retry metadata, capped retry backoff, and
  manual removal for invalid queued messages.
- A one-candidate-at-a-time review flow with previous/next navigation. Confirmed
  corrections are remembered for the matched sender rule and detected message
  kind; masked sender/receiver account and card identifiers returned by the
  parser are preserved when the candidate is confirmed. Rejection uses one
  decision dialog for message-only, sender, or provider scope. Scan/sync
  feedback reports imported, duplicate, rejected, queued, and policy-discarded
  counts.

The login/token flow persists the rotated JWT pair in OS-backed secure storage
rather than AsyncStorage and restores the session on relaunch. Startup validates
the saved access token first and rotates the rolling 30-day refresh token only
when needed. Access tokens are loaded into memory for API calls; explicit logout
revokes the latest native refresh token before clearing local session and SMS
state. Authenticated requests share a deduplicated recovery path that rotates
the refresh token and retries the original request once after a mid-session
`401`.

## What does the mobile debt section do?

The mobile debt section loads debt/lending records from the backend, creates
new lent-by-me or borrowed-by-me records, shows current balances and due dates,
summarizes open count, outstanding amount, and due-soon count, and records
repayments against open debt records. It is intentionally compact so it works
as a quick on-phone companion to the fuller web dashboard.

## What does the mobile credit-card section do?

The mobile credit-card section loads card bills, lets the user create statement
bills against credit-card accounts, shows remaining balances and due dates, and
summarizes open bill count, remaining balance, and due-soon count. It records
payments against open bills and acts as a mobile companion to the web
credit-card bill dashboard.

## What does the mobile recurring-bill section do?

The mobile recurring-bill section loads repeating bill schedules, lets the user
create weekly, monthly, quarterly, or yearly bills, and records payments against
active bills. It summarizes active bill count, monthly recurring total, and
due-soon count. The backend advances the next due date when a payment is
recorded.

## What does the mobile reconciliation section do?

The mobile reconciliation section loads the expected balance for a selected
account, shows the latest balance snapshot if one exists, and lets the user save
a new actual balance snapshot from the phone. This supports quick cash, wallet,
bank, or card balance checks without opening the web dashboard. The compact
summary shows expected balance, latest actual balance, difference, and latest
status so mismatches are visible before saving another snapshot.

## How will SMS tracking work?

The user enables tracking for specific sender numbers or names. The app reads
matching SMS messages, stores the raw message locally, and syncs it to the
backend. The backend parses and returns whether it needs review.

Rule onboarding can happen entirely on Android: after SMS permission is
granted, the app lists distinct inbox sender identifiers and message counts,
supports local search, infers common providers, requires an explicit account
mapping, creates an exact-match backend rule, and syncs the enabled rule to the
native capture module. Exact sender duplicates are blocked by both the client
and API.

The first provider targets are bKash, EBL, City Bank, and Pathao Pay. The mobile
review flow now supports internal transfer confirmation by letting the user
choose transaction type plus source and destination accounts when the parser is
unsure.

Current status: the app can load backend sender rules and payment methods after
login, persist which trusted rules are enabled, capture future messages, and
scan a selected Android inbox date range. Matching messages receive
deterministic fingerprints, so incremental scans skip messages already
processed. A user can explicitly refresh previous imports; the API reparses
pending candidates with current rules and parser logic while leaving confirmed
ledger transactions untouched. The automation action queues matches before
upload, syncs them to the backend import endpoint, and refreshes the review
inbox.
Actual capture requires a custom Android dev client or APK; Expo Go cannot load
the native module.

The mobile SMS review section shows parser hints, raw SMS evidence,
parser confidence, review or duplicate reason, internal-transfer flags, account
selection chips, and lets the user confirm or ignore candidates. Mobile
confirmation sends the selected source account, destination account for
transfers, amount, date, type, and parser evidence fields.

Decision status: the narrow native Android module path is scaffolded for
personal APK/custom dev client use, with manual/non-SMS-permission alternatives
still available if public distribution policy makes broad SMS access unsuitable.

## Why not read every SMS?

Privacy and noise. The app only needs transaction reports from selected senders.
Reading every SMS would be unnecessary, risky, and harder to justify. The target
automatic-capture path is to process only active sender-rule matches and ignore
messages that do not look transaction-related.

## How will the mobile app handle offline mode?

Manual transactions and raw SMS messages should be stored in local queues. When
network returns, the app syncs queued items to the backend.

## What data should be cached locally?

The app caches account/category lists after successful reference-data loads,
the latest loaded transaction list, pending local submissions, and raw SMS sync
status. Sensitive data should be minimized and protected where possible.

Current implementation status: account/category choices are hydrated from the
latest local cache on app startup, so offline queues can still use the last
known IDs.

The latest loaded transaction list is also hydrated from the local cache on app
startup so the user can review recent records before a fresh API request
succeeds.

Manual transactions can be queued locally with
account, category, date, type, amount, note, retry metadata, capped retry
backoff, and manual removal. Successful syncs are removed from the queue, and
failed syncs stay queued until their next retry time.

Raw SMS messages can also be queued locally with
sender, body, received time, optional device message ID, attempt count, last
attempt time, next retry time, and latest sync error. Successful syncs are
removed from the queue; failed syncs remain queued with a next retry timestamp
so repeated taps do not hammer the backend while the device or API is still
failing. Obvious duplicate queued messages are blocked locally before backend
sync, and invalid queued items can be removed manually.

## How will conflicts be handled?

The backend should own final IDs and timestamps. The mobile app can keep local
temporary IDs for queued items, then replace them with server records after
sync.

## What is the SMS permission decision?

Keep Expo Go as the manual-import/testing path. For personal APK or custom dev
client builds, the local Android module can request `READ_SMS` and
`RECEIVE_SMS`, but it only stores messages from user-enabled sender rules.
Captured messages still enter the raw-message queue before backend sync.

## What will the main mobile screens be?

The production-facing shell is organized around five bottom tabs:

- Home
- Activity
- Review
- Accounts
- More

Home is review-first: it surfaces automatically captured SMS candidates, parser
confidence, source evidence, and confirm/edit actions. Activity holds the
transaction timeline, Review exposes the full correction flow, and Accounts
shows connected ledger sources. The slide-out menu and More screen contain
secondary workflows such as debts, credit-card bills, recurring bills,
reconciliation, SMS capture settings, and detailed maintenance tools. Manual
entry remains available but is intentionally secondary to automatic capture.

Authentication is a separate entry screen. API URLs, raw JWT fields, and health
diagnostics are no longer part of the primary finance workflow. Connection
checks retry once so a sleeping hosted backend is presented as a server wake-up
state before it is treated as unavailable.

## What is the hardest mobile challenge?

The hardest part is reliable SMS capture and sync while respecting Android
permissions and privacy expectations. Background behavior and Play Store policy
can also affect the final implementation.

## What should happen when parsing confidence is low?

The candidate should go to the review inbox instead of becoming a confirmed
transaction. The user can edit, confirm, or ignore it.

## How should the app handle duplicate messages?

The app can avoid sending the same device message repeatedly, but the backend
should still perform duplicate detection using message hashes, timestamps,
sender, body, and provider reference numbers.

The current local queue blocks obvious duplicates using device message ID when
available, or sender/body/received time as a fallback. It removes messages
after the backend accepts them and keeps failed messages queued with retry
metadata plus capped retry backoff. The backend still handles duplicate
detection if the same raw message is submitted again.

Native-captured SMS messages use a `native:<id>` device message ID when imported
into the raw-message queue, so the local queue can skip duplicates before sync.

## What closes the gap between capture and automatic sync?

New trusted messages enqueue Android WorkManager immediately. The job waits for
network access, uploads to the same raw-message endpoint, refreshes an expired
access token once, and reports a truthful idle/running/success/error state to
the app. API-rejected messages remain encrypted on the phone so the user can
refresh rules and retry; transient failures use WorkManager retry behavior.

## How is sensitive SMS data protected on the device?

Captured bodies, the native sync session, processed-message fingerprints, and
the React Native raw retry queue are encrypted with an Android Keystore key.
Non-native fallback builds use Expo SecureStore for the raw queue. Android
backup is disabled, and logout revokes the server refresh token before clearing
the native sync session and SMS state so one user's data cannot leak into
another user's session.

## What can the user correct before confirming a parsed SMS?

The review form supports amount, date, time, transaction type, source and destination
accounts, payment method, category, counterparty, reference, and note. This is
important because low-confidence parsing must remain a reviewable suggestion,
not an irreversible ledger write.

## What happens when both tracked accounts send transfer SMS?

The confirmation flow checks for existing transfers and opposite pending SMS,
including messages from the same provider. A native dialog offers linking,
confirming both as one transfer, keeping separate, or cancelling. The backend
records one money movement and separate evidence for each account. Manual
transfer entry and SMS review both use the selected account, its debit/credit
direction, and the other account. Incoming SMS drafts preselect the receiver and
Credit. SMS submissions use `account_perspective: true`, so the backend can
normalize the actual transfer and retain the selected account’s balance.
Offline transfer sync pauses when a suggestion needs a decision, preserving the
current and later queue entries. Resolving it removes that entry; the user can
continue syncing. Transfer retry keys and restored opposite-account/direction
fields prevent retries from creating another transfer. The all-account activity
feed displays one A → B transfer with its linked evidence.

## Are promotional messages discarded on the phone or API?

The phone follows shared capture preferences, including the promotional toggle.
The API authoritatively classifies English/Bangla offers and acknowledges ignored
captures without retaining their original body. A trusted-sender Android scan
may therefore upload an advertisement for classification; skipping advertisements
does not disable the bank sender or its genuine financial notices.

## How does mobile Activity handle a transfer reclassified through the web?

The API retains observations as provenance so the original messages remain
available. Activity shows per-account evidence balances/references only while
`type=transfer`, preventing historical transfer balances from appearing on a
corrected expense or other type. The ordinary ledger amount and account use the
corrected transaction. Release 0.1.13 also provides native saved-entry editing
with the same account-bound reported-balance rules.

Transfer evidence caches preserve the API’s read-only `is_primary` flag. Older
caches lacking the field normalize it to false; cache loading never guesses which
account supplied the primary report.

## Why can icons be blank in a standalone APK even when the font is bundled?

In the current Expo SDK, `expo-font` uses `expo-asset` to load the bundled font,
and Android asset caching needs the native file-permission interface supplied by
`expo-file-system`. Expo Go includes that module, but a standalone APK must
declare it as a dependency itself. The app includes the SDK-compatible module
and preloads `MaterialCommunityIcons.font` before rendering icon-bearing screens.
Session restoration can run in parallel; failed font loads show a readable error
instead of invisible controls. Icons load locally and do not need the backend or
a development server. External-storage permissions inherited from the library
are blocked; font loading only uses the app's private cache. Release smoke tests
include offline cold-launch checks.

## How do SMS settings avoid accidental changes while scrolling?

Capture providers, non-transaction message kinds and retention choices wrap into
visible rows instead of requiring nested sideways scrolling. Each choice has a
48-point minimum height and labels can wrap at larger text sizes. The parent
scroll view can cancel the press; a separate touch-movement guard also suppresses
selection once movement exceeds eight points, even when the finger returns to
its start. The guard resets for the next gesture and permits accessibility
activation without touch movement. Gesture regressions run with
`npm run test:gestures` from `projects/finance-mobile`; device smoke testing should
verify that swipes do not change the policy and deliberate taps still do.

## Why could the signed app show queued SMS while background sync said nothing was waiting?

Earlier builds had separate encrypted native capture and app retry queues. History
scans moved records to the app queue, while the background worker consumed only
native captures. Version 0.1.4 migrates existing retry records into the native
queue and makes that worker the single consumer for installed Android captures
and scans. Migration preserves backend identities and reprocessing intent and
commits both encrypted values atomically. Each successful upload is acknowledged
immediately, and all SMS pending indicators use native queue metadata. The
activity summary identifies the unrelated manual transaction queue explicitly.

## How does the mobile UI stay current without continuously refreshing APIs?

In installed builds, while signed in and foregrounded, it reads local native
sync status every 1.5 seconds and when resumed. This is not backend API polling.
Review and transaction lists reload when a sync run completes. Native uploads
use WorkManager connectivity constraints, continue bounded batches, and retry
network errors, HTTP 408/429 and server failures. API-rejected records are held
for explicit retry while other messages continue. Foreground/auth requests also
have a timeout, including response-body reads, so a request cannot hang forever.

## How do mobile screens avoid system-bar overlap and overflowing text?

The root uses a safe-area provider and safe-area views for Android and iOS system
insets. Horizontal text columns have bounded width, zero flex basis and shrink
support; long labels wrap and the header title can scale down on narrow screens.
These native layout changes need validation on a physical phone, including
larger accessibility fonts; browser previews cannot prove Android inset behavior.

## How do named Quick Add presets work on mobile?

The header plus, Home shortcuts, Activity action and More settings open a compact
entry/preset manager. Defaults and favorites sync through the same API as web.
Only Save records an entry; editing a draft does not change a preset. Today/Now,
Yesterday, native calendar/clock and exact text input make timestamps easy to
correct. Android's native clock and iOS's spinner require the committed native
picker dependency to be included in the next installed build.

## How does Quick Add avoid losing keyboard focus in its popup?

Mount-time autofocus can run before Android's dialog owns window focus. The form
waits for `Modal.onShow`, then focuses its primary input on the next frame. Moving
from an already visible manager into a preset editor also focuses once. Closing
or switching away cancels pending focus; typing and background refreshes do not
refocus or remount inputs. Android uses the native dialog's `adjustResize` instead
of also shrinking a JavaScript KeyboardAvoidingView; iOS keeps padding avoidance.
Scrolling retains the keyboard and mounted inputs. Component regressions cover
focus timing, cancellation and retained preset/entry drafts, with native keyboard
behavior requiring a physical-device check.
Release 0.1.10 (Android code 11) packages this fix using the existing signing key;
component checks and signed assembly passed, with the OnePlus keyboard check pending.

## Is the new Quick Add offline queue the same as the SMS or legacy manual queue?

No. Quick Add uses encrypted chunked SecureStore documents scoped by backend
and user, with at most 100 immutable requests. Save persists locally before
clearing the draft. Foreground/resume retries use the original UUID and timestamps;
backoff is 15 seconds to 15 minutes and empty queues cause no retry requests.
Validation errors stay visible for correction; uncertain requests and conflicts
are retained for review. Activity combines both manual queue counts, while the
header counts native SMS only. The existing detailed-form AsyncStorage queue and
native SMS WorkManager remain separate. Source checks preceded the signed 0.1.5 build, which verifies bundling and
module packaging. Physical-device UI/storage checks remain pending.

## Why does mobile need a Metro watch folder for shared Quick Add helpers?

The helper module is runtime code in the sibling `finance-contracts` project.
TypeScript can resolve that import while Metro's default mobile-root file map
cannot. The explicit watch folder includes those helpers without copying them or
expanding the watch scope to backend data. Native release bundling verifies this
boundary. Release 0.1.5 uses Android version code 6 and the existing signing key.

## Why can the SMS count stay unchanged, and what changed in 0.1.6?

The count means saved messages awaiting acknowledgement, including rejected
records. DNS/connection failures do not upload anything, so lowering the count
would falsely imply success or lose messages. Previously Retry appended a job
behind the delayed WorkManager chain. It now replaces waiting work, while
preserving an active upload and at most one successor. Routine requests coalesce;
app resume or a validated default-network transition restarts eligible work.
Automatic recovery does not release rejected records. The UI separates Waiting
from Attention, displays correction/retry details and reads the native count even
when the legacy queue read fails. Actual execution still depends on Android and
a usable network. Native unit tests verify policy and classification; device
connectivity/power behavior remains a physical-phone smoke check.

## What did the deeper SMS queue investigation prove?

It found app-side failure paths: foreground token rotation could invalidate the
worker's cached refresh token; the first retryable server failure could stop all
later messages; idle-read timeouts did not bound an entire trickling response;
and Expo's single default native-function queue could delay progress reads.
The revised production engine and transport are tested against a local HTTP
server: 552 accepted messages drain to zero, a first-record HTTP 500 leaves one
and uploads 551, concurrent refresh is shared, slow responses time out without
acknowledging records, and changed users/storage failures retain unacknowledged
messages. These tests demonstrate the app defects and fixes, not the exact cause
on a user's phone. Operational diagnostics identify that cause without copying
SMS content, user identifiers or login tokens.

## What context remains visible when deciding whether to link transfers?

The enlarged modal pins the warning and edited entry being reviewed above the
scrolling match cards, with explicit actions below. Outside touches do not close
it. Both show account path, amount, date and time; references are hidden, missing
times are explicit and matches identify pending SMS or recorded transfers. The shared
client helper aligns credit drafts to canonical sender-to-receiver order without
altering the request or linking automatically. The review header also shows
local received time, not just the day. The modal remains available after a link
error so the user can compare again.

## How does the compact SMS direction control work?

Debit/Credit appears as a button with a change icon beside the review amount.
A reporting-account caption and accessibility hint clarify whether money moves
into or out of the selected account. It replaces the separate two-choice row
on the primary review screen. Tapping patches only that candidate's direction,
preserving account choices and other edits, with no automatic confirmation or
reclassification. The target is at least 44px and disabled while confirming.

### Can SMS transfer matching silently overwrite a balance on mobile?

The modal shows both entries' account-labelled reported balances. Same-account
disagreements have explicit balance choices and a disabled link button until
each conflict is resolved. The server validates the reviewed values again;
a stale choice does not post. Keeping entries separate is always available.

### How does compact transfer help work on phones?

Accessible info/warning buttons open native explanation dialogs on tap. Conflict status and balance choices stay visible; no merge decision depends on hover or is accepted just by opening help.

### How does mobile review handle three-digit account/card suffixes?

It displays API-provided sender/receiver account and card/method choices, with no
weak default selected. Buttons update the corresponding draft account using the
current Debit/Credit direction and preserve other edits. Confirmation/linking is
still explicit. Older APIs omit the optional list safely; longer saved identifiers
remain useful without separate short mappings. A new mobile release is needed for
the buttons; no APK was built during implementation.

### Which release includes the recent native review improvements?

Release 0.1.9 (Android code 10) includes the review improvements first packaged
in 0.1.8 (code 9), which is superseded because sign-in failed. These include
transfer comparison and review time/direction changes,
account-labelled balance conflicts, native help dialogs and explicit short-suffix
account/card suggestions. It keeps the existing signing identity for upgrades.
In that release, Add/Edit and Undo remained web workflows. Native saved-entry
Edit and latest-action recovery arrive in 0.1.13; Android device smoke tests cover
the native interactions separately. Version metadata and SMS diagnostics stay aligned.

### Why did a compiled release fail during native session initialization?

A Kotlin lambda implicitly returned its last expression: an internal SmsSession
object that Expo cannot serialize. The JavaScript API expected a void command.
Release 0.1.9 discards native command results and returns Unit; tests cover Expo
conversion, stored session state and error propagation. Maps remain the explicit
contract for getters and refresh. Compilation and signing alone cannot validate
the installed JavaScript/native boundary, so sign-in is a release smoke check.
# Local account separation

**Can a second user see or sync the first user's cached finance entries?** The
legacy manual queue and read caches are now keyed by backend URL and token user
ID, and React account state is cleared on logout or account switch. Shared
legacy AsyncStorage keys had no verifiable owner, so they are deleted rather
than silently assigned to the next login. Mobile SMS review fetches 100 records
per page and exposes a load-more control.

**Can an account switch be forced by pasting a fabricated token?** No. The
app validates the current server-issued session automatically and planning tools
do not expose token-entry controls. Existing secure sessions still restore offline
and retain their owner's queued work.

## Which APK includes session isolation, paged review and redacted-SMS restoration?

Release 0.1.11 (Android code 12) includes those changes and retains the 0.1.10
Quick Add keyboard fix. Redacted text is restored only after the explicit
historical-reprocessing choice; ordinary scans leave restoration off. The flag
is handled by native capture, encrypted queuing and upload code, so deploying
only the backend/web cannot deliver this native change. Upgrade over the existing
app with the same signing key to preserve local work, and use the current API.
Physical-device checks cover account switching/offline isolation, Load more,
restoration opt-in, sign-in, keyboard behavior and SMS upload.
## Why does Android SMS sync use batches, and are retries still safe?

Release 0.1.12 (Android code 13) sends up to 25 messages/128 KiB per request with
one request in flight. Per-item receipts are validated before one encrypted queue
commit applies successes, correction holds and retry delays. Partial or malformed
receipts, timeouts and lost responses never acknowledge unknown outcomes. Stable
device IDs/body/timestamps keep server-side duplicate protection intact, and
authentication rotation replays the same batch. User/backend changes stop the
old upload, while newer restoration intents survive an older acknowledgement.
Batch 404/405 falls back to the existing endpoint for rollout compatibility.
Repeated queue counting and full-queue writes now occur per batch instead of per
SMS. Deploy the updated API to enable the speedup; real-phone smoke checks remain
separate from unit and HTTP fault tests.

### How does mobile browse the full ledger without loading every transaction?

Activity requests 25 owned transactions at a time from the paginated activity
endpoint, with server search/filtering, date grouping, retry and Load more. Home
uses a bounded preview plus the exact API count. The timeline is a FlatList
outside the outer ScrollView. TanStack Query isolates requests by user/backend
and filters, cancels superseded work, merges duplicate IDs and preserves
loaded rows. Cached previews are labeled incomplete, and user/backend scope
changes clear local selection/filter state. Details support the native editor in 0.1.13 and preserve
the timeline position. Date filters use transaction date; added/updated grouping
uses Asia/Dhaka. The API must be deployed before installing the updated APK.

### Does each More item open a distinct screen, and which SMS opens from Home?

More/drawer share stable destination IDs. Accounts and SMS settings use their
native screens; each planning item displays only its own existing form, with
visible and Android hardware Back navigation. Full Quick Add opens manual entry
directly. A review card opens its exact candidate ID, preserves that selection
across queue reordering and keeps drafts keyed by candidate, rather than opening
whichever index happened to be selected previously.

### Why does Back retain a screen instead of loading it again?

React Navigation's history router owns screen changes instead of conditional
rendering in App. The custom workspace navigator lazily retains one native view
per fixed destination for the login, including forms and disclosures. Each view
keeps its scroll position. Hidden workspaces cannot receive touch/accessibility
focus and avoid rendering unrelated root updates. Native modals dismiss first;
a dirty saved-entry editor requires explicit discard before Back/Cancel can
remove its draft.

Activity's infinite query caches loaded pages by user/backend and filter query.
Fresh data is reused for 60 seconds; stale data refreshes in the background on
screen/app focus, keeping the old complete list through slow or failed requests.
Unobserved filter caches expire after five minutes. Token rotation does not
replace screen keys/drafts or restart bootstrap requests. SMS refresh retains
the loaded window and drafts for still-pending IDs.

Logout/scope changes cancel reads, clear query data, destroy navigation/scroll
state and reset root drafts. Process death also loses this in-memory state;
encrypted upload queues keep their existing persistence rules. No financial
write or API migration is added. Tests use real router/query libraries with
native host mocks; phone Back gestures, keyboard, TalkBack and scroll geometry
still need the [device checklist](../projects/finance-mobile/docs/navigation-state.md).

### What shared interface improvements are implemented on native?

Finance is the visible product name, including the installed Android label after
rebuilding. Core transaction amounts/dates share web's pure presentation helpers.
SMS review puts Type/Category before accounts and Amount/Date/Time, exposes native
calendar/24-hour clock pickers, and places optional payment methods in a mounted
disclosure so collapsing it cannot erase drafts. Selected review radios announce
checked state and show a check; Quick Add distinguishes selections from Save.
Local SMS date and time resolve together instead of mixing UTC dates with local
times. Picker open/cancel does not alter values; exact text entry remains.
Release 0.1.13 adds native reported-balance corrections and saved-entry editing
with the account ownership rules below. Physical-device checks are still needed
for keyboard, TalkBack and picker appearance.

Changing a known reporting account during SMS review now omits the original
account’s parsed balance and shows a visible warning; zero balances remain valid.
Type/direction corrections alone do not clear that account’s balance.

### How do native review and saved-entry editing avoid losing corrections?

Stable field components retain typing through lookup/token refreshes. Searchable
selection sheets commit only an explicit choice, and incompatible categories ask
for the intended type before changing it. SMS review can correct its labelled
reported balance; changing reporting account visibly clears the old value.
Saved-entry editing loads by UUID and patches only changed fields, with separate
account-bound transfer balances and a collapsed second report. Source evidence
loads independently. Linked core corrections need acknowledgement after sources
load. A preflight updated timestamp check catches already changed entries and
keeps the draft, but is not an atomic concurrency lock. Full selectable SMS obeys
redaction/retention; original identifiers and provenance are preserved.

### Can a mobile user recover an accidental confirmation or save?

Yes. Online acceptance refreshes a 15-second Edit/Undo notice, and More retains
the latest action. The existing server permits Undo only for the latest unchanged
action within 24 hours; removed SMS text cannot be restored by Undo. The client
rechecks eligibility, rejects double taps and reconciles an uncertain response
with GET instead of blindly retrying POST. A locally queued entry is not called
saved to the ledger. Recovery survives foregrounding and is scoped to user/backend;
stale responses and old-owner callbacks cannot act on another user's session.
There is no arbitrary action-history undo. Deploy the existing recovery API;
no additional migration is introduced by this native pass.

### What do the new mobile sync and account summaries actually prove?

Capture distinguishes accepted acknowledgements this run, waiting, delayed and
correction counts. Delayed native metadata excludes rejected records. Unknown or
unreadable queue state cannot claim Ready. Retry guidance says whether Android
has scheduled work; timestamps are server-reported and may include this user's
other devices. Accepted SMS still need ledger review. A successful health check
means connection to the server, not complete processing.

Accounts compare the dated report against the ledger at that report, rather than
today's ledger. Credit-card reports are references rather than cash comparisons;
cached snapshots are labelled. Mismatches link directly to the existing balance
check. Automated checks cover classification decisions, balance ownership, full
SMS retention, stale edits/owners, repeated taps and lost Undo responses. Physical
phone layout, keyboard, TalkBack and end-to-end SMS acceptance remain separate
release smoke checks.

### How do compact native forms avoid losing edits or squeezing small screens?

A shared grid measures available form width and scales its minimum cell width
with the system font size. Phones stack, and wider layouts can add columns.
Date/time share a main slot with native calendar/clock affordances beside exact
inputs; targets remain at least 48 points. Optional reference/note/payment details
stay mounted behind an accessible disclosure, while transfer warnings and linked
correction consent stay visible. Full entry uses searchable names instead of IDs.

Column changes update wrapper widths without moving fields between parents.
Disclosure and Quick Add date/time toggles hide their existing children instead
of destroying them, and busy saved editing disables its pickers without removing
them. Temporary drafts, exact seconds, zero values, both account-bound balances,
search text and consent therefore survive layout/refresh changes. Validation
reveals optional details. Existing confirmation, undo, matching and offline queue
APIs stay unchanged; no migration or durable draft storage is added.

Component regressions check input identity, selected values and outgoing patches
at narrow/wide widths and enlarged font sizes, including Quick Add's native-window
focus timing. They do not replace an installed-device keyboard, accessibility or
visual layout check. Build and install the new signed APK to receive these changes.

### Why does Home show account balances instead of one total?

Accounts may have different currencies, and adding them without conversion would
be misleading. Home shows up to three active ledger balances with their currency
codes and links to the full account comparison. Activity makes debit, credit and
transfer rows scannable with text labels as well as color. Debts & lending keeps
owed-to-you and you-owe totals separate; name search filters loaded records only.
Release 0.1.15/code 16 changes presentation and needs no API migration. Physical
device layout and SMS capture still require the signed-release smoke test.
