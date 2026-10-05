# Technical Spec

## Backend Source Of Truth

The Django API is the only source of truth. Web and mobile clients should not
calculate permanent balances independently. They may calculate temporary display
values, but persisted records and report totals come from the backend.

## Initial Database Tables

### users_user

Use Django's user model or a custom user model from the beginning.

Important fields:

- id
- email
- password
- default_currency
- timezone
- created_at
- updated_at

### accounts_account

```txt
id
user_id
name
type
currency
starting_balance
is_active
display_order
created_at
updated_at
```

Allowed `type` values:

```txt
cash
home_cash
mobile_wallet
bank
credit_card
savings
other
```

### categories_category

```txt
id
user_id
name
kind
parent_id
is_active
display_order
created_at
updated_at
```

Allowed `kind` values:

```txt
expense
income
transfer
debt
system
```

### payment_methods_paymentmethod

```txt
id
user_id
account_id
name
provider
identifier
is_active
created_at
updated_at
```

Example providers:

```txt
bkash
nagad
rocket
city_bank
credit_card
cash
manual
custom
```

### messages_smssenderrule

```txt
id
user_id
payment_method_id
sender
provider
parse_mode
enabled
notes
created_at
updated_at
```

Allowed `parse_mode` values:

```txt
provider_template
custom_regex
manual_review
ignore
```

### messages_rawmessage

```txt
id
user_id
sender
body
received_at
device_message_id
body_hash
status
created_at
redacted_at
```

Allowed `status` values:

```txt
imported
ignored
duplicate
redacted
```

Raw SMS redaction replaces `body` with `[redacted]`, clears
`device_message_id`, sets `status=redacted`, and records `redacted_at`. Parsed
candidate fields and confirmed transaction evidence remain available so reports
do not depend on storing the original SMS text forever.

### Mobile SMS Capture Boundary

The mobile app now has a local Android native module scaffold for custom dev
client or personal APK builds. Expo Go remains a manual-import/testing path and
does not load the module.

The native path requests SMS permission only from the mobile SMS settings flow,
stores enabled sender rules natively, receives `SMS_RECEIVED` broadcasts, and
keeps only messages whose sender matches an enabled rule. The app then imports
captured messages into the existing raw-message queue before syncing through
`POST /api/messages/import/`.

Keep manual import as a fallback for distributions where broad SMS permissions
are not allowed.

### messages_parsedmessage

```txt
id
raw_message_id
provider
message_kind
detected_type
detected_amount
detected_date
detected_account_id
detected_destination_account_id
detected_category_id
detected_counterparty_text
detected_reference
detected_balance
detected_fee
possible_internal_transfer
possible_related_candidate_id
related_match_reason
confidence_score
needs_review
parser_name
parser_version
error_reason
created_at
updated_at
```

Phase 3 parser priority providers:

```txt
bkash
ebl
city_bank
pathao_pay
```

Internal transfer candidates should carry both source and destination hints when
available. If the parser only knows one side, confirmation should require the
user to select the missing account before creating a transfer transaction.
Candidates may also link to a possible related candidate when another review
item has the same user, amount, close received timestamp, and a different
provider. This is a review hint only, not an automatic merge.

The transfer matching API additionally searches posted transfers and opposite
pending SMS from the same or different providers. It uses exact principal,
compatible accounts, and a three-day window. User acceptance links observations
to one transfer; keep separate remains available. A known account on the other
message can supply a missing side when confirming the pair. Explicit merge of
already-posted duplicates retains their observations and records audit entries.

For bKash transfer-like messages, the parser now tries to match masked account
or wallet identifiers in counterparty text against the user's configured payment
methods. When a known other side is found, the candidate pre-fills both the
primary account/payment method and the secondary transfer account/payment method
for review.

bKash payment parsing also cleans common confirmation suffixes from
`counterparty_text` and records detected till/counter plus provider timestamp
text in parser notes for reviewer context.

### transactions_transaction

```txt
id
user_id
account_id
transfer_account_id
category_id
payment_method_id
raw_message_id
date
type
direction
amount
balance_after
reference
counterparty_text
external_key
note
source
needs_review
created_at
updated_at
```

Allowed `type` values:

```txt
expense
income
transfer
adjustment
fee
refund
lend
borrow
repayment_received
repayment_paid
```

Allowed `source` values:

```txt
web
mobile
sms
import
system
```

Allowed `direction` values:

```txt
debit
credit
```

`direction` records whether the primary `account_id` was debited or credited.
`type` records the business meaning. SMS-confirmed transactions should also
carry provider evidence when available: `reference` or `TrxID`,
`balance_after`, `counterparty_text`, `payment_method_id`, `raw_message_id`, and
`external_key` for duplicate detection. The raw SMS remains stored as source
evidence, but the final transaction row should be usable without reparsing the
SMS body.

For transfers, the stored `account_id` is always the source and
`transfer_account_id` is the destination, with canonical `direction=debit`.
A manual credit draft uses the selected account as receiver and is normalized
on creation. Account-scoped responses add `account_direction`, and the same
transfer appears in both histories. `transfer_evidence` contains account-specific
references, dates, reported balances, fee metadata, and raw-message links;
observations never post an additional ledger amount. Fees require a separate
expense, and delayed settlement still uses one canonical posting date.

### counterparties_counterparty

```txt
id
user_id
name
phone
notes
created_at
updated_at
```

### debts_debt

```txt
id
user_id
counterparty_id
opened_transaction_id
direction
principal_amount
current_balance
opened_at
due_date
status
note
created_at
updated_at
```

Allowed `direction` values:

```txt
lent_by_me
borrowed_by_me
```

Allowed `status` values:

```txt
open
partially_paid
paid
written_off
```

### debts_debtpayment

```txt
id
debt_id
transaction_id
amount
paid_at
note
created_at
updated_at
```

### credit_cards_creditcardbill

```txt
id
user_id
account_id
statement_transaction_id
statement_balance
minimum_due
paid_amount
remaining_balance
statement_date
due_date
status
reference
note
created_at
updated_at
```

Allowed `status` values:

```txt
unpaid
partially_paid
paid
waived
```

### credit_cards_creditcardpayment

```txt
id
user_id
bill_id
transaction_id
amount
paid_at
note
created_at
updated_at
```

### recurring_bills_recurringbill

```txt
id
user_id
account_id
category_id
name
amount
frequency
next_due_date
status
auto_create_transaction
reminder_days_before
note
created_at
updated_at
```

Allowed `frequency` values:

```txt
weekly
monthly
quarterly
yearly
```

Allowed `status` values:

```txt
active
paused
ended
```

### recurring_bills_recurringbillpayment

```txt
id
user_id
bill_id
transaction_id
amount
due_date
paid_at
note
created_at
updated_at
```

### reconciliation_balancesnapshot

```txt
id
user_id
account_id
checked_at
actual_balance
expected_balance
difference
status
adjustment_transaction_id
note
created_at
updated_at
```

Allowed `status` values:

```txt
matched
missing_money
extra_money
adjusted
ignored
```

## Initial API Response Shape

Use predictable JSON with ids and timestamps:

```json
{
  "id": "uuid",
  "created_at": "2026-05-01T10:00:00+06:00",
  "updated_at": "2026-05-01T10:00:00+06:00"
}
```

Pagination:

```json
{
  "count": 100,
  "next": null,
  "previous": null,
  "results": []
}
```

## Implemented API Surface

The backend currently implements the first manual finance loop:

```txt
GET    /api/health/
POST   /api/auth/login/
POST   /api/auth/refresh/
POST   /api/auth/logout/
POST   /api/auth/logout-all/
GET    /api/auth/me/
GET    /api/accounts/
POST   /api/accounts/
GET    /api/categories/
POST   /api/categories/
GET    /api/transactions/
POST   /api/transactions/
GET    /api/transactions/export/?month=YYYY-MM
POST   /api/messages/import/
POST   /api/messages/raw/{id}/redact/
GET    /api/messages/review/
POST   /api/messages/review/{id}/confirm/
POST   /api/messages/review/{id}/ignore/
GET    /api/reports/monthly/?month=YYYY-MM
GET    /api/audit-logs/
```

The account, category, transaction, and report endpoints are authenticated and
scoped to the current user.

Transaction create, update, and delete actions write read-only audit log entries
with before/after snapshots of normalized ledger fields.

Authenticated requests use JWT Bearer tokens:

```txt
Authorization: Bearer <access-token>
```

## Transaction Create Example

```json
{
  "date": "2026-05-01",
  "type": "expense",
  "direction": "debit",
  "amount": "250.00",
  "account": "account-id",
  "category": "category-id",
  "payment_method": "payment-method-id",
  "balance_after": "1150.00",
  "reference": "DEF456XYZ",
  "counterparty_text": "SAMPLE MERCHANT",
  "note": "Lunch",
  "source": "mobile"
}
```

## SMS Import Example

```json
{
  "sender": "BKASH",
  "body": "Payment Tk 250.00 to merchant successful.",
  "received_at": "2026-05-01T12:30:00+06:00",
  "device_message_id": "android-message-id",
  "source_device_id": "android-device-id"
}
```

## Monthly Report Shape

```json
{
  "month": "2026-05",
  "currency": "BDT",
  "income_total": "50000.00",
  "expense_total": "25000.00",
  "net_total": "25000.00",
  "accounts": [],
  "categories": [],
  "debts": [],
  "reconciliation_warnings": []
}
```

## Security Notes

- Use HTTPS in deployed environments.
- Encrypt secrets outside the repo.
- Do not store SMS data for untracked senders.
- Do not upload native-captured SMS messages until the user imports them into
  the raw-message queue.
- Allow raw SMS deletion later.
- Use per-user scoping on every query.
- Keep audit-friendly timestamps on financial records.
