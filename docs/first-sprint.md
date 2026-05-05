# First Sprint Plan

Goal: create runnable project foundations and complete the smallest manual
finance loop.

## Sprint Outcome

By the end of the first sprint:

- PostgreSQL runs locally.
- Django API runs locally and exposes `/api/health/`.
- Next.js web app runs locally and displays backend health.
- React Native Android app runs locally and displays backend health.
- Backend supports accounts, categories, and manual transactions.
- Web can create and list manual transactions.

## Task List

### Workspace

- Create top-level project folders:
  - `finance-api`
  - `finance-web`
  - `finance-mobile`
  - `finance-infra`
  - `finance-contracts`
- Add README files to each project.
- Add `.env.example` files where needed.

### Infrastructure

- Add Docker Compose for PostgreSQL. Done.
- Add local database credentials. Done.
- Document start/stop commands. Done.

### Backend

- Create Django project. Done.
- Add Django REST Framework. Done.
- Configure PostgreSQL. Done.
- Add health endpoint. Done.
- Add JWT authentication endpoints. Done.
- Create custom user model if desired. Skipped for now; using Django's default
  user model for the first personal version.
- Create account model and CRUD API. Done.
- Create category model and CRUD API. Done.
- Create transaction model and CRUD API. Done.
- Add monthly summary endpoint. Done.
- Add basic tests for account/category/transaction APIs. Done.

### Web

- Create Next.js project. Done.
- Configure API base URL. Done.
- Add health check page or dashboard widget. Done.
- Add login screen. Done.
- Add transaction list. Started with filters.
- Add transaction create form. Started.
- Add accounts and categories management. Started.

### Mobile

- Create React Native Android project.
- Configure API base URL for emulator/device.
- Add health check screen.
- Add login placeholder or token input for local testing.
- Add quick transaction form after backend auth is ready.

### Contracts

- Add initial `openapi.yaml`.
- Document transaction create/list endpoints.
- Document account/category endpoints.
- Add example request and response JSON files.

## Suggested Build Order

1. Infrastructure: PostgreSQL.
2. Backend: health endpoint.
3. Web: health check connection.
4. Mobile: health check connection.
5. Backend: accounts and categories.
6. Web: account/category management.
7. Backend: transactions.
8. Web: transaction table and create form.
9. Backend: monthly summary.
10. Web: dashboard summary. Started with `/reports`.

## Definition Of Done

- Narrow tests pass for backend APIs.
- Web can create a transaction and refresh the list.
- Manual transaction affects monthly report totals.
- Account/category choices are loaded from backend.
- README setup instructions are accurate enough to repeat from a clean machine.
