# finance-mobile

React Native Android app for quick capture and SMS-based transaction tracking.

## Current Status

Phase 1 scaffold now includes:

- Expo + React Native TypeScript setup.
- Environment-based API base URL (`EXPO_PUBLIC_API_BASE_URL`).
- Health check screen that calls `GET /api/health/`.
- Login test flow that calls `POST /api/auth/login/`.
- Access-token validation flow that calls `GET /api/auth/me/`.
- Account and category fetch flow for authenticated users:
  - `GET /api/accounts/`
  - `GET /api/categories/`
- Quick add transaction form:
  - `POST /api/transactions/`
- Transaction list flow:
  - `GET /api/transactions/`
- SMS tracking settings scaffold:
  - permission gate placeholder for native Android SMS access
  - `GET /api/payment-methods/`
  - `GET /api/messages/sender-rules/`
  - local sender rule enable/disable selection
- Local raw message queue:
  - stores queued raw messages with AsyncStorage
  - syncs queued messages to `POST /api/messages/import/`
  - keeps failed sync items queued for retry
- SMS review inbox:
  - loads parsed candidates from `GET /api/messages/review/`
  - shows parser hints, raw SMS evidence, and internal-transfer flags
  - shows parser confidence, raw message status, and review/duplicate reasons
  - lets the user select transaction type plus source/destination accounts
    before confirming transfers
  - confirms or ignores candidates through the review endpoints
- Debt/lending section:
  - loads records from `GET /api/debts/`
  - creates lent/borrowed records through `POST /api/debts/`
  - records repayments through `POST /api/debts/{id}/payments/`
  - shows open balances and due dates
- Credit card bills section:
  - loads bills from `GET /api/credit-card-bills/`
  - creates statement bills through `POST /api/credit-card-bills/`
  - records payments through `POST /api/credit-card-bills/{id}/payments/`
  - shows remaining balances and due dates
- Recurring bills section:
  - loads schedules from `GET /api/recurring-bills/`
  - creates repeating bills through `POST /api/recurring-bills/`
  - records payments through `POST /api/recurring-bills/{id}/payments/`
  - advances the next due date after payment
- Balance reconciliation section:
  - loads expected balances from `GET /api/reconciliation/accounts/{account_id}/`
  - saves real-life balance checks through `POST /api/reconciliation/snapshots/`
  - shows latest snapshot status and difference context
- Transaction API types include strict ledger evidence fields such as
  debit/credit direction, balance after, reference, counterparty text, payment
  method, raw message link, and duplicate key
- Native SMS permission/module decision documented in
  `docs/mobile-sms-permission-decision.md`.

## Local Run (Current)

Prerequisites:

- Node.js installed
- Android Studio emulator running (or physical Android device)
- Backend API running on `http://localhost:8000`

Setup:

```bash
cp .env.example .env
npm install
npm run start
```

From Expo terminal:

- Press `a` to open Android emulator.

If using Android emulator, default API base URL in `.env.example` already uses:

```txt
http://10.0.2.2:8000
```

If using a physical device, replace it with your machine's LAN IP:

```txt
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
```

The current login flow is for local testing. Production mobile auth should use
OS-backed secure storage for refresh tokens. See
`../../docs/auth-token-storage-plan.md`.

## Docker (Optional)

From `projects/finance-infra`:

```bash
cp .env.example .env
docker compose --profile mobile up --build finance-mobile
```

For day-to-day development, native Expo on host is still the recommended path.

## Responsibilities

- Quick manual transaction entry.
- Account/category sync.
- Android SMS permission flow.
- User-selected tracked SMS sender numbers.
- Local raw message storage.
- Message sync to backend.
- Review parsed transactions.
- Offline queue for manual entries.

## Suggested Stack

- React Native
- TypeScript
- React Navigation
- TanStack Query
- SQLite or MMKV for local queue/cache
- Native Android SMS module when needed

Expo can be used only if the SMS requirements remain compatible. If automatic
SMS reading requires native Android APIs not supported by Expo managed workflow,
use bare React Native.

## Android SMS Tracking Flow

Current decision: do not add broad Android SMS permissions in the Expo managed
scaffold. Build sender selection, import, duplicate detection, and review flows
first. If automatic capture is still required, move to Expo prebuild/custom dev
client or bare React Native and add a narrow native Android SMS module.

```mermaid
flowchart TD
  A["User opens SMS tracking settings"] --> B["User grants SMS permission"]
  B --> C["App lists available senders or user enters sender number"]
  C --> D["User enables selected sender rule"]
  D --> E["New matching SMS arrives"]
  E --> F["Store raw message locally"]
  F --> G["Sync raw message to backend"]
  G --> H["Backend parses and returns status"]
  H --> I{"Needs review?"}
  I -->|Yes| J["Show in review inbox"]
  I -->|No| K["Create confirmed transaction"]
```

## Mobile Screens

```txt
Home
Quick Add Transaction
Transactions
Accounts
SMS Tracking Settings
SMS Review Inbox
Debts
Settings
```

## Offline Requirements

- Manual transactions can be saved offline.
- Raw SMS messages can be queued offline.
- Sync retries when network is available.
- Conflicts are resolved by backend timestamps and ids.

## Phase 1 Mobile Milestones

1. Android app skeleton. Done.
2. Login. Done with placeholder/testing flow.
3. Backend health check. Done.
4. Account/category fetch. Done.
5. Quick add transaction. Done.
6. Transaction list. Done.
7. SMS sender selection scaffold. Done.
8. Local raw message cache and sync queue. Done.

## Phase 2 Mobile Milestones

1. SMS permission gate scaffold. Done.
2. Sender number management scaffold. Done.
3. Native Android SMS module decision. Done.
4. Local raw message cache. Done.
5. Raw message sync. Done.
6. Review inbox. Done.
7. Source/destination transfer controls. Done.

## Phase 4 Mobile Milestones

1. Debt/lending screen. Done for first mobile scaffold.
2. Credit-card bill screen. Done for first mobile scaffold.
3. Recurring-bill screen. Done for first mobile scaffold.
4. Reconciliation screen. Done for first mobile scaffold.
