# finance-web

Next.js web dashboard for managing and reviewing the finance system.

## Current Status

The web app is scaffolded with:

- Next.js App Router
- TypeScript
- Environment-based API URL
- Server-rendered backend health check
- Initial dashboard shell
- Login page connected to JWT auth
- Dashboard session panel with sign out
- Transactions page that loads accounts, categories, and transactions
- Manual transaction creation form
- Manual transaction update form
- Transaction deletion from the list
- Transaction filters for month, type, debit/credit direction, source, account, category, and search text
- Transaction CSV export using the active filters
- Web API input/filter typing reuses generated OpenAPI request and enum types
- Per-transaction history links into the audit log viewer
- Accounts page with account and category creation/listing/updating/deletion,
  derived ledger balances, and latest provider-reported balance evidence
- SMS settings page with payment method and sender rule creation/listing/updating/deletion
- SMS settings provider options align with contract-supported bKash, EBL, City Bank, and Pathao Pay sources
- SMS review inbox with parsed candidate details, parser confidence,
  review/duplicate reasons, internal-transfer hints, raw SMS redaction,
  confirm, and ignore actions
- Transaction table displays debit/credit direction, reported balance after, provider
  reference, and sent-to/received-from text when available
- Monthly reports page with income, expense, net, category, and account totals
- Debts page with debt/lend creation, person-wise balances, due tracking, and
  repayment recording
- Credit card bills page with statement balances, due dates, minimum dues,
  open/overdue totals, and payment recording
- Recurring bills page with repeating payment schedules, due/overdue totals,
  reminder windows, and payment recording
- Reconciliation page with expected-vs-actual balance checks, snapshot history,
  status warnings, and likely missing/duplicate money causes
- Audit logs page with transaction create/update/delete history, URL-backed
  filters, and before/after snapshots

## Responsibilities

- Main dashboard
- Spreadsheet-like transaction table
- Account management
- Payment method management
- Category management
- Monthly reports
- SMS review inbox
- Debt and lend management
- Credit card bill management
- Recurring bill management
- Reconciliation workflow
- Transaction audit review

## Suggested Stack

- Next.js App Router
- TypeScript
- React
- TanStack Query
- React Hook Form
- Zod
- Tailwind CSS or the chosen design system
- Generated API client from `finance-contracts` later

## Local Setup

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
cp .env.example .env.local
```

Start the backend API from `../finance-api`, then run the web app:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

The dashboard will call:

```txt
http://localhost:8000/api/health/
```

Create a backend user first:

```bash
cd ../finance-api
python manage.py createsuperuser
```

Then open the login page:

```txt
http://localhost:3000/login
```

For the local development version, JWT tokens are stored in browser
`localStorage`. Production builds disable this temporary browser token storage
unless `NEXT_PUBLIC_ALLOW_LOCAL_TOKEN_STORAGE=true` is set deliberately.
When browser token storage is disabled, the login and session panel use
same-origin Next.js auth routes that store access and refresh tokens in
HTTP-only cookies. Authenticated workspace API calls use a same-origin backend
proxy route in that mode, so refresh tokens stay out of browser JavaScript. For
local development, authenticated web API calls use the stored refresh token to
rotate tokens and retry once after an expired access token response.
See `../../docs/auth-token-storage-plan.md`.

Transactions page:

```txt
http://localhost:3000/transactions
```

Accounts and categories:

```txt
http://localhost:3000/accounts
```

Create at least one account before using the transaction form. Categories are
optional but recommended for useful monthly reports.

Monthly reports:

```txt
http://localhost:3000/reports
```

Payment methods and SMS sender rules:

```txt
http://localhost:3000/sms-settings
```

SMS review inbox:

```txt
http://localhost:3000/messages/review
```

Audit logs:

```txt
http://localhost:3000/audit-logs
```

## Docker

From `projects/finance-infra`:

```bash
cp .env.example .env
docker compose up --build -d postgres finance-api finance-web
```

Important environment note:

- `NEXT_PUBLIC_API_BASE_URL` is used by browser-side calls.
- `NEXT_SERVER_API_BASE_URL` is used by server-rendered calls.

## Verification

```bash
npm run typecheck
npm run lint
```

## Primary Screens

```txt
/dashboard
/transactions
/accounts
/sms-settings
/messages/review
/debts
/credit-cards
/recurring-bills
/reports/monthly
/reconciliation
/audit-logs
/settings
```

## Transaction Table Requirements

- Fast date/month filters.
- Account filter.
- Category filter.
- Search across transaction ID, counterparty, note, and duplicate key. Done.
- Source filter for web, mobile, SMS, import, and system-created rows. Done.
- Display mode switch:
  - spreadsheet mode: expenses negative, income positive
  - ledger mode: positive amount plus transaction type
  - money in/out mode: separate columns
- Bulk edit later.
- CSV export. Done for active transaction filters, including source and search text.

## Dashboard Requirements

- Current total balance.
- Account balances.
- This month income.
- This month expense.
- This month savings.
- Category breakdown.
- Pending SMS review count.
- Missing/reconciliation amount warnings.

## Reconciliation UX

The user can enter the real-life balance for an account. The UI shows:

- Expected balance.
- Actual balance.
- Difference.
- Possible causes: missing expense, missing income, wrong account, duplicate.
- Synced account selection between the check panel and snapshot form. Done.
- Button to create an adjustment transaction.

## Phase 1 Web Milestones

1. Connect to backend health endpoint. Done.
2. Login screen. Done.
3. Dashboard shell. Done.
4. Accounts CRUD. Done.
5. Categories CRUD. Done.
6. Transaction table and form. Done.
7. Monthly report. Done.
8. Payment methods and sender rules. Done.
9. Debt/lending dashboard. Done.
10. Balance reconciliation screen. Done.
11. Credit card bill tracking. Done.
12. Recurring bill tracking. Done.
