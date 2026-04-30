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
transaction endpoints, report endpoints, message endpoints, debt endpoints, and
reconciliation endpoints.

## Why generate clients later?

Generated clients reduce repeated request/response typing in web and mobile.
The project should wait until the API stabilizes enough that generation saves
time instead of creating churn.

## How do you avoid breaking clients?

Avoid renaming fields casually, version breaking changes, add new fields in a
backward-compatible way, and keep changelogs for contract changes.

## What is the current contract state?

The contracts README sketches the intended endpoints. The backend also exposes
OpenAPI docs through `drf-spectacular` at `/api/schema/` and `/api/docs/`.

## Why is contract-first thinking useful here?

There are three clients or consumers: web, mobile, and possibly scripts/imports.
A clear contract prevents backend implementation details from leaking into the
clients.

## What examples should be added?

Useful examples:

- Login request/response
- Create account
- Create category
- Create transaction
- Monthly report response
- Import raw SMS
- Confirm parsed message
- Create debt and repayment

