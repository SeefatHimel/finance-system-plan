# Architecture

## System Overview

```mermaid
flowchart LR
  Web["finance-web<br/>Next.js"] --> API["finance-api<br/>Django REST API"]
  Mobile["finance-mobile<br/>React Native Android"] --> API
  Mobile --> SMS["Android SMS Inbox<br/>Allowed Senders"]
  API --> DB["PostgreSQL"]
  API --> Parser["Message Parsing Rules"]
  API --> Reports["Reporting Services"]
  Contracts["finance-contracts<br/>OpenAPI + shared docs"] --> Web
  Contracts --> Mobile
  Infra["finance-infra<br/>Docker + deployment"] --> API
  Infra --> DB
  Infra --> Web
```

## Project Boundaries

### finance-api

The backend owns:

- Authentication and authorization
- Transaction ledger
- Account and payment method management
- Category management
- SMS message ingestion and parsing
- Duplicate detection
- Reports and summaries
- Debt and repayment tracking
- Credit card bill tracking
- Recurring bill tracking
- Balance reconciliation

### finance-web

The web app owns:

- Dashboard and reporting UI
- Spreadsheet-like transaction management
- Account and payment method management
- SMS review inbox
- Debt and credit card management
- Reconciliation workflows

### finance-mobile

The Android app owns:

- Quick transaction entry
- SMS sender rule setup
- Local SMS collection
- Raw message sync to backend
- Review and confirm parsed transactions
- Offline queue for manual entries

### finance-infra

The infrastructure project owns:

- Local Docker Compose
- PostgreSQL setup
- Environment templates
- Deployment notes
- Backup and restore scripts later

### finance-contracts

The contracts project owns:

- OpenAPI schema
- API examples
- Shared event/data shape documentation
- Generated TypeScript client later

## Data Flow: Manual Transaction

```mermaid
sequenceDiagram
  participant User
  participant Client as Web or Mobile
  participant API as Django API
  participant DB as PostgreSQL

  User->>Client: Add transaction
  Client->>API: POST /api/transactions/
  API->>API: Validate account, category, amount
  API->>DB: Save transaction
  API->>DB: Save transaction audit entry
  API-->>Client: Transaction response
  Client-->>User: Updated list and balances
```

## Data Flow: SMS Transaction

```mermaid
sequenceDiagram
  participant SMS as Android SMS
  participant Mobile as Mobile App
  participant API as Django API
  participant Parser as Parser Rules
  participant DB as PostgreSQL
  participant User

  SMS->>Mobile: New message from tracked sender
  Mobile->>Mobile: Store raw message locally
  Mobile->>API: POST /api/messages/import/
  API->>DB: Save raw message
  API->>Parser: Parse amount/date/account/type
  Parser-->>API: Candidate transaction
  API->>API: Check duplicate risk
  API->>DB: Save parsed candidate
  API-->>Mobile: needs_review or confirmed
  User->>Mobile: Confirm or edit candidate
  Mobile->>API: POST /api/messages/{id}/confirm/
  API->>DB: Create transaction
```

## Balance Philosophy

Expected account balances are calculated from confirmed money movement:

- Expenses reduce an account.
- Income increases an account.
- Transfers reduce one account and increase another.
- Lending money reduces the source account and creates a receivable debt record.
- Getting repaid increases the receiving account and reduces the receivable debt.
- Borrowing money increases the receiving account and creates a payable debt.
- Paying debt reduces the source account and reduces the payable debt.

Manual real-life balance snapshots are stored separately. When a snapshot does
not match the calculated balance, the system shows the missing amount and allows
the user to create an adjustment transaction if needed.

## Local Development Shape

```txt
finance-system/
  finance-api/       # Django, DRF, pytest
  finance-web/       # Next.js, TypeScript
  finance-mobile/    # React Native Android
  finance-infra/     # docker-compose.yml
  finance-contracts/ # openapi.yaml
```

Run locally with Docker for PostgreSQL and native dev servers for backend, web,
and mobile.
