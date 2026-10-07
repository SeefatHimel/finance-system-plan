# Mobile App Q&A

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
- Quick add transaction flow (`POST /api/transactions/`) plus a local manual
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
corrected transaction. Full ledger corrections currently happen in the web
editor; this change does not add a native editor.
