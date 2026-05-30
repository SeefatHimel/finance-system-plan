# Mobile App Q&A

## What is the mobile app responsible for?

The mobile app is responsible for quick manual entry, Android SMS capture,
sender rule management, local message storage, sync, and reviewing parsed
transaction candidates.

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
local raw-message queueing, sync, and SMS review. The project keeps the option
open to move to Expo prebuild/custom dev client or bare React Native when
automatic SMS capture requires a native Android module.

Current SMS decision: keep Expo managed for Phase 2 UI/API work, avoid broad
SMS permissions for now, and only move to Expo prebuild/custom dev client or
bare React Native when real automatic SMS capture is ready to be implemented.

## What is currently implemented in the mobile app?

- Project scaffold with Expo + TypeScript.
- Environment-based API base URL (`EXPO_PUBLIC_API_BASE_URL`).
- Initial health-check screen that calls backend `GET /api/health/`.
- Login testing flow (`POST /api/auth/login/`).
- Access token validation flow (`GET /api/auth/me/`).
- Account/category fetch flow (`GET /api/accounts/`, `GET /api/categories/`).
- Quick add transaction flow (`POST /api/transactions/`).
- Transaction list flow (`GET /api/transactions/`).
- Debt/lending flow (`GET /api/debts/`, `POST /api/debts/`, and
  `POST /api/debts/{id}/payments/`) for creating lent/borrowed records,
  seeing balances, and recording repayments.
- Credit-card bill flow (`GET /api/credit-card-bills/`,
  `POST /api/credit-card-bills/`, and
  `POST /api/credit-card-bills/{id}/payments/`) for creating statement bills,
  seeing remaining balances, and recording card payments.
- SMS tracking settings scaffold that loads payment methods and sender rules,
  shows a permission gate placeholder, and lets the user locally enable trusted
  sender rules for future import.
- Local raw message queue backed by AsyncStorage, with sync to
  `POST /api/messages/import/` and retry behavior for failed submissions.

The login/token flow is still a local testing scaffold. Production mobile auth
should store refresh tokens in OS-backed secure storage, as documented in
`docs/auth-token-storage-plan.md`.

## What does the mobile debt section do?

The mobile debt section loads debt/lending records from the backend, creates
new lent-by-me or borrowed-by-me records, shows current balances and due dates,
and records repayments against open debt records. It is intentionally compact so
it works as a quick on-phone companion to the fuller web dashboard.

## What does the mobile credit-card section do?

The mobile credit-card section loads card bills, lets the user create statement
bills against credit-card accounts, shows remaining balances and due dates, and
records payments against open bills. It is a mobile companion to the web
credit-card bill dashboard.

## How will SMS tracking work?

The user enables tracking for specific sender numbers or names. The app reads
matching SMS messages, stores the raw message locally, and syncs it to the
backend. The backend parses and returns whether it needs review.

The first provider targets are bKash, EBL, City Bank, and Pathao Pay. The mobile
review flow now supports internal transfer confirmation by letting the user
choose transaction type plus source and destination accounts when the parser is
unsure.

Current scaffold status: the app can load backend sender rules and payment
methods after login, then locally toggle which sender rules should be enabled.
It can also queue raw SMS messages locally, sync them to the backend import
endpoint, and review parsed SMS candidates from the backend review inbox.
Actual automatic inbox reading still needs the native Android module
implementation.

The mobile SMS review section shows parser hints, raw SMS evidence,
parser confidence, review or duplicate reason, internal-transfer flags, account
selection chips, and lets the user confirm or ignore candidates. Mobile
confirmation sends the selected source account, destination account for
transfers, amount, date, type, and parser evidence fields.

Decision status: the native path is deferred until automatic capture work starts.
The documented direction is a narrow native Android module for personal APK use,
with manual/non-SMS-permission alternatives if public distribution policy makes
broad SMS access unsuitable.

## Why not read every SMS?

Privacy and noise. The app only needs transaction reports from selected senders.
Reading every SMS would be unnecessary, risky, and harder to justify. The target
automatic-capture path is to process only active sender-rule matches and ignore
messages that do not look transaction-related.

## How will the mobile app handle offline mode?

Manual transactions and raw SMS messages should be stored in a local queue.
When network returns, the app syncs queued items to the backend.

## What data should be cached locally?

The app should cache account/category lists, pending local submissions, raw SMS
sync status, and recent transactions. Sensitive data should be minimized and
protected where possible.

Current implementation status: raw SMS messages can be queued locally with
sender, body, received time, and optional device message ID. Successful syncs
are removed from the queue; failed syncs remain queued for retry.

## How will conflicts be handled?

The backend should own final IDs and timestamps. The mobile app can keep local
temporary IDs for queued items, then replace them with server records after
sync.

## What is the SMS permission decision?

Do not add `READ_SMS` or `RECEIVE_SMS` in the current Expo managed scaffold.
Build the sender-selection, raw import, duplicate detection, and review flows
first. If automatic capture is still needed, move to Expo prebuild/custom dev
client or bare React Native and add the smallest native Android module that only
processes user-enabled sender rules.

## What will the main mobile screens be?

Planned screens:

- Home
- Quick Add Transaction
- Transactions
- Accounts
- SMS Tracking Settings
- SMS Review Inbox
- Debts
- Settings

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

The current local queue removes messages after the backend accepts them. The
backend still handles duplicate detection if the same raw message is submitted
again.
