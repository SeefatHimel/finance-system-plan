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

Current implementation status: phase-1 uses Expo for fast setup and health/API
validation. The project keeps the option open to move to bare React Native
before phase-2 SMS features if required.

## What is currently implemented in the mobile app?

- Project scaffold with Expo + TypeScript.
- Environment-based API base URL (`EXPO_PUBLIC_API_BASE_URL`).
- Initial health-check screen that calls backend `GET /api/health/`.
- Login testing flow (`POST /api/auth/login/`).
- Access token validation flow (`GET /api/auth/me/`).

## How will SMS tracking work?

The user enables tracking for specific sender numbers or names. The app reads
matching SMS messages, stores the raw message locally, and syncs it to the
backend. The backend parses and returns whether it needs review.

## Why not read every SMS?

Privacy and noise. The app only needs transaction reports from selected senders.
Reading every SMS would be unnecessary, risky, and harder to justify.

## How will the mobile app handle offline mode?

Manual transactions and raw SMS messages should be stored in a local queue.
When network returns, the app syncs queued items to the backend.

## What data should be cached locally?

The app should cache account/category lists, pending local submissions, raw SMS
sync status, and recent transactions. Sensitive data should be minimized and
protected where possible.

## How will conflicts be handled?

The backend should own final IDs and timestamps. The mobile app can keep local
temporary IDs for queued items, then replace them with server records after
sync.

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
