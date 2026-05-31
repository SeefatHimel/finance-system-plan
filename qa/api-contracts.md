# API Contracts Q&A

## What is the contracts project for?

The contracts project documents the API boundary shared by backend, web, and
mobile. It should eventually contain OpenAPI files, examples, generated client
notes, and contract changelogs.

## Why keep contracts separate?

The API is the agreement between projects. Keeping it separate makes it easier
for web and mobile work to proceed without reading backend internals.

## What should be in the OpenAPI schema?

The schema should include auth endpoints, account endpoints, category endpoints,
transaction endpoints, report endpoints, message endpoints, debt endpoints,
reconciliation endpoints, and audit log endpoints. The current API also
includes credit-card bill and recurring-bill endpoints, so those shapes belong
in the shared contract too.

## Why generate clients later?

Generated clients reduce repeated request/response typing in web and mobile.
The project now has a first generated TypeScript client workflow in
`projects/finance-contracts/generated/`, produced from `openapi.yaml` by
`scripts/generate_ts_client.py`. Web and mobile still use their local API
helpers today, but this gives the migration target.

## How do you avoid breaking clients?

Avoid renaming fields casually, version breaking changes, add new fields in a
backward-compatible way, and keep changelogs for contract changes.

## What is the current contract state?

The contracts project now includes `projects/finance-contracts/openapi.yaml`
covering current phase-1 backend endpoints:

- Health
- Auth (`login`, `refresh`, `me`)
- Accounts CRUD
- Categories CRUD
- Payment methods CRUD
- SMS sender rules CRUD
- Raw SMS import with duplicate response shape
- Parsed SMS review candidate list, confirm, ignore, and raw SMS redaction endpoints
- Transactions CRUD and month/account/category/type/direction/source/search list filters
- Transaction CSV export with the same month/account/category/type/direction/source/search filters
- Debt CRUD and repayment endpoint
- Credit card bill CRUD and payment endpoint
- Recurring bill CRUD and payment endpoint
- Monthly report
- Balance snapshot and account reconciliation endpoints
- Read-only audit log endpoints for transaction mutation history

Phase 3 contract work now includes parser fields for provider, message kind,
reference, balance, fee, and possible internal transfer/source-destination
hints. Parsed candidates can also expose a `possible_related_candidate` and
`related_match_reason` when another SMS may be the other side of the same
internal transfer.

Transaction contracts now include strict ledger evidence fields: `direction`,
`balance_after`, `reference`, `counterparty_text`, `payment_method`,
`raw_message`, and `external_key`. The SMS confirm request can override the
same values when the parser needs user correction.

Raw message contracts now include `redacted_at` and the `redacted` status so
clients can show when original SMS text has been removed while parsed evidence
is retained.

Audit log contracts expose action, entity type, entity id, metadata, timestamp,
and nullable before/after snapshots. They are read-only and user-scoped.

The contracts project now generates `generated/types.ts` and
`generated/client.ts` from the shared OpenAPI schema. The generated client is a
small fetch wrapper with typed request bodies, path parameters, query objects,
JSON responses, and CSV `Blob` downloads.

The backend also exposes generated OpenAPI docs through `drf-spectacular` at
`/api/schema/` and `/api/docs/`.

## Why is contract-first thinking useful here?

There are three clients or consumers: web, mobile, and possibly scripts/imports.
A clear contract prevents backend implementation details from leaking into the
clients.

## What examples should be added?

Current examples are available in `projects/finance-contracts/examples/`:

- `account.create.json`
- `audit-log.detail.response.json`
- `audit-log.list.response.json`
- `auth.login.request.json`
- `auth.login.response.json`
- `auth.me.response.json`
- `category.create.json`
- `credit-card-bill.create.json`
- `credit-card-bill.payment.create.json`
- `debt.create.json`
- `debt.payment.create.json`
- `payment-method.create.json`
- `raw-message.import.json`
- `raw-message.import.response.json`
- `message-review.confirm.json`
- `message-review.list.response.json`
- `message-review.redact.response.json`
- `reconciliation.account.response.json`
- `reconciliation.snapshot.create.json`
- `reconciliation.snapshot.response.json`
- `recurring-bill.create.json`
- `recurring-bill.payment.create.json`
- `sender-rule.create.json`
- `transaction.create.json`
- `transaction.export.csv`
- `transaction.list.response.json`
- `transaction.transfer.create.json`
- `validation-error.response.json`
- `report.monthly.response.json`

Next useful additions:

- Pagination envelope examples if list endpoints add pagination
- Production error examples for rate limits or token expiry
