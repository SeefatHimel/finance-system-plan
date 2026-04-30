# finance-web

Next.js web dashboard for managing and reviewing the finance system.

## Current Status

The web app is scaffolded with:

- Next.js App Router
- TypeScript
- Environment-based API URL
- Server-rendered backend health check
- Initial dashboard shell

## Responsibilities

- Main dashboard
- Spreadsheet-like transaction table
- Account management
- Payment method management
- Category management
- Monthly reports
- SMS review inbox
- Debt and lend management
- Reconciliation workflow

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
/payment-methods
/categories
/messages/review
/debts
/reports/monthly
/reconciliation
/settings
```

## Transaction Table Requirements

- Fast date/month filters.
- Account filter.
- Category filter.
- Source filter: manual, sms, import.
- Display mode switch:
  - spreadsheet mode: expenses negative, income positive
  - ledger mode: positive amount plus transaction type
  - money in/out mode: separate columns
- Bulk edit later.
- Export later.

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
- Button to create an adjustment transaction.

## Phase 1 Web Milestones

1. Connect to backend health endpoint. Done.
2. Login screen.
3. Dashboard shell.
4. Accounts CRUD.
5. Categories CRUD.
6. Transaction table and form.
7. Monthly report.
8. Balance reconciliation screen.
