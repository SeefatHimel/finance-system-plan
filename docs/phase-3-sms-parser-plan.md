# Phase 3 SMS Parser Plan

Last updated: 2026-05-31

## Goal

Turn imported raw SMS messages into reviewable transaction candidates with enough
structure to avoid common finance-tracking mistakes.

Phase 3 should not only extract an amount. It should classify the movement:

- Expense
- Income
- Transfer between own accounts
- Wallet cash-in/cash-out
- Card purchase
- Card bill payment
- Fee or charge
- Refund or reversal
- Unknown/manual review

## Priority Providers

Based on the user's current usage, parser work should prioritize:

1. bKash
2. EBL
3. City Bank
4. Pathao Pay

These should be treated as the first provider set for real examples, tests, and
parser fixtures.

## Public Format Research

Public provider documentation supports this plan, but also shows why the parser
must remain provider-specific and review-first:

- bKash documents SMS/statement-style templates with amount, fee, balance,
  reference text, `TrxID`, from/to parties, counter/till, and timestamps:
  https://www.bkash.com/en/page/personal-retail-account
- EBL documents SMS alert behavior for debited account transfers and missed-call
  balance alerts with masked account/card information:
  https://www.ebl.com.bd/download/internet_banking_user_handbook_english.pdf
  and https://ebl.com.bd/retail-digital/ebl-missed-call-alert-service
- Pathao Pay/Pay Later documentation emphasizes in-app transaction history,
  wallet/card sources, withdrawals, and activation SMS. Parser support should
  expect some finance events to arrive through app history or push/manual import
  rather than every movement having a detailed SMS:
  https://www.pathaopay.com.bd/faq/user and https://pathao.com/paylater/

These sources confirm that the final transaction should preserve normalized
ledger fields, not just raw SMS text. They also leave gaps for real-world
fixture collection, especially City Bank and Pathao Pay transaction messages.

## Why Internal Transfers Matter

Internal transfers are feature-worthy and important.

Examples:

- Bank to bKash cash-in.
- bKash to bank transfer.
- One own bank account to another own bank account.
- Card bill payment from bank account.
- Wallet top-up from card or bank.

If the parser sees only one SMS, it may incorrectly classify an internal move as
income or expense. The system needs a transfer-aware review flow so the user can
link two sides of the same movement or confirm a one-sided transfer when only
one provider sends an SMS.

## Parser Output Requirements

Each provider parser should return a candidate with these fields when available:

```txt
provider
message_kind
transaction_type
amount
date/time
source account/payment method
destination account/payment method
counterparty text
merchant text
reference number
balance after transaction
fee amount
confidence
parser notes
```

`message_kind` should be more specific than transaction type. Suggested values:

```txt
purchase
cash_in
cash_out
send_money
receive_money
bank_transfer_in
bank_transfer_out
card_purchase
card_payment
fee
refund
reversal
balance_notice
otp_or_security
unknown
```

## Transfer Detection Rules

The parser should mark a candidate as a possible internal transfer when:

- The sender/provider is linked to one of the user's payment methods.
- The message text mentions another known own account, wallet number, card
  suffix, or bank identifier.
- A second raw message with similar amount and close timestamp appears from
  another provider.
- The movement looks like top-up, cash-in, add money, transfer, bill payment, or
  card payment rather than a purchase.

A transfer candidate should preserve both sides separately:

```txt
source_payment_method
destination_payment_method
source_account
destination_account
```

If only one side is known, the review inbox should ask the user to select the
missing account before confirmation.

## Final Transaction Evidence

Raw SMS text is source evidence, not the final ledger. When a candidate is
confirmed, the transaction row should preserve the normalized fields needed for
strict finance review:

```txt
direction
amount
balance_after
reference / TrxID
counterparty_text
payment_method
raw_message
external_key
```

The parser should prefer provider references such as bKash `TrxID`, bank/card
`Ref`, or Pathao Pay references for `external_key`. If no provider reference is
available, use the raw message id as the duplicate key and keep the candidate in
review when confidence is low.

## Matching Two SMS Messages

Some internal transfers may generate two messages, such as one from the bank and
one from bKash. The backend should eventually group likely pairs using:

- Same user.
- Same or near-same amount.
- Close received timestamps.
- Providers that map to the user's own payment methods.
- Reference number or masked account/card/wallet hints.

Initial implementation is conservative: matching candidates are linked as a
"possible related message" review hint rather than auto-merged.

## Fixtures Needed

Before implementing real provider parsers, collect anonymized examples for each
provider and message kind.

For each SMS example, remove or replace:

- Phone numbers.
- Account numbers.
- Card numbers.
- Real names.
- Exact balances if sensitive.
- Reference IDs if sensitive.

Keep the structure, keywords, punctuation, amount placement, date placement, and
sender name as close to real as possible.

Suggested fixture folders:

```txt
projects/finance-api/apps/messages/fixtures/sms/bkash/
projects/finance-api/apps/messages/fixtures/sms/ebl/
projects/finance-api/apps/messages/fixtures/sms/city_bank/
projects/finance-api/apps/messages/fixtures/sms/pathao_pay/
```

## First Implementation Slice

1. Add parser fixture files for bKash, EBL, City Bank, and Pathao Pay. Done
   with starter anonymized-style examples.
2. Add parser test cases from anonymized fixtures. Done for the starter parser
   coverage.
3. Add `message_kind`, reference, balance, fee, and transfer hint fields to
   parsed candidates. Done.
4. Implement bKash parser first. Done.
5. Implement one bank/card parser next, preferably the provider with the most
   frequent SMS messages. Done for starter EBL and City Bank card purchase
   parsing.
6. Add review UI fields for transfer source/destination before confirmation.
   Partially done: web review can select a transfer destination; mobile review
   still needs richer edit controls.
7. Copy parser evidence into final transactions on confirmation. Done for
   direction, balance after, reference, counterparty text, payment method, raw
   message, and duplicate key.

## Current Follow-Up Slice

1. Collect real anonymized SMS fixtures from bKash, EBL, City Bank, and Pathao
   Pay.
2. Expand parser coverage for Pathao Pay, bank transfers, card bill payments,
   refunds, fees, and reversals. Done for starter Pathao Pay top-up, payment,
   send-money, and withdraw confirmations.
3. Extract bKash sender/receiver account text, counter/till, and provider
   timestamps where available. Done for matching known payment method
   identifiers from bKash cash-in, cash-out, send-money, and receive-money
   counterparty text; counter/till and provider timestamp extraction remain.
4. Add richer source/destination account editing in mobile review. Done for
   account chips in the mobile SMS review card.
5. Surface parser confidence and duplicate/review reasons in review inboxes.
   Done for web and mobile.
6. Add raw SMS redaction for privacy after parsing/confirmation. Done with
   soft redaction that keeps parsed evidence and duplicate hashes.
7. Keep internal-transfer matching conservative until fixture coverage proves
   the matching rules.

## Open Questions

1. Which EBL messages are most common: debit card, credit card, account debit,
   account credit, transfer, or bill payment?
2. Which City Bank messages matter most: credit card purchase, card bill payment,
   bank account transfer, or balance notification?
3. Does Pathao Pay send SMS for every wallet movement, or mostly app/push
   notifications?
4. Do bKash cash-in/top-up messages include enough bank/card hints to identify
   the source account?
5. Should the system auto-confirm obvious internal transfers later, or always
   require review?
