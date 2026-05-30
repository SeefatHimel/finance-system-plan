# Roadmap

## Phase 0: Planning And Project Setup

Deliverables:

- Finalize product scope for phase 1.
- Create separate project folders or repositories.
- Create local Docker Compose for PostgreSQL.
- Create backend, web, mobile, infra, and contracts skeletons.
- Define initial OpenAPI contract.

Exit criteria:

- All projects can run locally.
- Backend can connect to PostgreSQL.
- Web can call backend health endpoint.
- Mobile can call backend health endpoint from Android emulator/device.

## Phase 1: Manual Finance System

Goal: replace the core spreadsheet workflow manually.

Backend:

- Auth
- Accounts
- Categories
- Transactions
- Monthly reports
- Balance snapshots
- Basic reconciliation differences

Web:

- Dashboard
- Spreadsheet-like transaction table
- Add/edit/delete transaction
- Accounts screen
- Categories screen
- Monthly summary screen
- Reconciliation screen

Mobile:

- Login
- Quick add transaction
- Transaction list
- Account/category sync

Exit criteria:

- User can run one full month without the spreadsheet.
- Monthly category totals match manual expectations.
- Account balances can be checked against real life.

## Phase 2: Payment Methods And SMS Sender Management

Goal: prepare the system for automated SMS tracking.

Backend:

- Payment method model. Done.
- SMS sender rule model. Done.
- Raw message import API. Done.
- Duplicate message detection by hash/device id/body/time. Done.
- Baseline parsed review candidate creation. Done.

Web:

- Payment methods management. Done.
- SMS sender rules management. Done.
- Raw message review list. Done.

Mobile:

- UI to select tracked SMS sender numbers. Done.
- Android permission/module decision. Done.
- Local raw message storage. Done.
- Sync raw messages to backend. Done.

Exit criteria:

- User can choose which SMS senders are tracked. Done.
- Raw messages appear in backend review inbox. Done.
- Duplicate raw messages are not imported repeatedly. Done.

## Phase 3: Rule-Based SMS Parsing

Goal: create transactions from SMS with review.

Backend:

- Provider parser interface. Done.
- bKash parser. Done.
- EBL parser. Done for starter card purchase parsing.
- City Bank parser. Done for starter card purchase parsing.
- Pathao Pay parser. Done for starter top-up, payment, send-money, and
  withdraw parsing.
- Final transaction ledger evidence fields for SMS confirmation. Done.
- Transfer-aware parsing for bank-to-wallet and own-account movement. Done for
  candidate hints.
- Possible related-message matching for two-sided internal transfers. Done.
- Custom regex parser support
- Parsed message confidence scoring
- Confirm/ignore parsed candidates. Done.
- Edit parsed candidates

Web:

- Review inbox for parsed candidates. Done.
- Transfer review controls for source and destination accounts
- Parser confidence and review/duplicate reason display. Done.
- Show debit/credit direction, reference, balance after, and counterparty in
  transaction tables. Done for the first transaction screen.
- Bulk confirm and ignore
- Parser error view

Mobile:

- Review parsed messages. Done.
- Confirm/edit from phone. Done for account/type edits in SMS review.
- Select source/destination account for possible internal transfers. Done.
- Parser confidence and review/duplicate reason display. Done.
- Background or periodic sync

Exit criteria:

- Common transaction SMS messages become reviewable transaction candidates.
- Confirmed candidates create real transactions.
- Low-confidence messages require user review.
- Bank-to-wallet and own-account transfers are not misclassified as expenses or income.

## Phase 4: Debt, Lending, Credit Card, Bills

Goal: cover the richer spreadsheet sections.

Backend:

- Counterparties
- Debt records. Done.
- Debt payments. Done.
- Credit card bill tracking
- Recurring bills

Web:

- Debt/lend dashboard
- Person-wise totals
- Due/done tracking
- Credit card bills view

Mobile:

- Add lent/borrowed money
- Mark repayment
- See due items

Exit criteria:

- Lend/debt records are tracked separately.
- Money movement affects account balances when it actually happens.
- Repayments update both account balances and debt balances.

## Phase 5: Analytics, Export, And Product Readiness

Goal: make the system dependable long term.

Backend:

- CSV/Excel export
- Import tools from existing spreadsheet
- Audit log
- Backup/restore support
- AI categorization extension point

Web:

- Trend reports
- Budget alerts
- Search and advanced filters
- Export UI

Mobile:

- Better offline sync
- Push notifications or local alerts

Exit criteria:

- User can trust the system as the main finance record.
- Data can be exported and backed up.
- Architecture is ready for online deployment.
