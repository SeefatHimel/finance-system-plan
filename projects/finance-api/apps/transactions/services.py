from bisect import bisect_right
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal

from django.db.models import Q

from apps.accounts.models import Account

from .balance_reports import account_reports
from .models import Transaction, TransferEvidence

INCREASE_TYPES = {
    Transaction.Type.INCOME,
    Transaction.Type.REFUND,
    Transaction.Type.BORROW,
    Transaction.Type.REPAYMENT_RECEIVED,
}

DECREASE_TYPES = {
    Transaction.Type.EXPENSE,
    Transaction.Type.FEE,
    Transaction.Type.LEND,
    Transaction.Type.REPAYMENT_PAID,
}


@dataclass(frozen=True)
class AccountBalanceSummary:
    ledger_balance: Decimal
    latest_reported_balance: Decimal | None = None
    latest_reported_balance_date: date | None = None
    ledger_balance_at_latest_report: Decimal | None = None
    latest_reported_balance_difference: Decimal | None = None
    reported_balance_comparison: str = "unavailable"


def calculate_account_balance_summaries(
    *,
    accounts: Iterable[Account],
    as_of_date=None,
) -> dict[object, AccountBalanceSummary]:
    account_list = list(accounts)
    if not account_list:
        return {}

    account_ids = {account.id for account in account_list}
    user_ids = {account.user_id for account in account_list}
    balances = {
        account.id: Decimal(account.starting_balance) for account in account_list
    }
    latest_reported = {account.id: (None, None) for account in account_list}

    transactions = Transaction.objects.filter(user_id__in=user_ids).filter(
        Q(account_id__in=account_ids) | Q(transfer_account_id__in=account_ids)
    )
    if as_of_date is not None:
        transactions = transactions.filter(date__lte=as_of_date)

    transactions = transactions.only(
        "account_id",
        "amount",
        "balance_after",
        "created_at",
        "date",
        "time",
        "direction",
        "transfer_account_id",
        "type",
        "raw_message_id",
        "external_key",
    ).order_by("date", "time", "created_at")

    evidence = TransferEvidence.objects.filter(
        user_id__in=user_ids,
        account_id__in=account_ids,
        transaction__type=Transaction.Type.TRANSFER,
        transaction__in=transactions,
    )
    if as_of_date is not None:
        evidence = evidence.filter(
            date__lte=as_of_date, transaction__date__lte=as_of_date
        )
    evidence_transaction_ids = set(
        TransferEvidence.objects.filter(
            transaction__in=transactions, transaction__type=Transaction.Type.TRANSFER
        ).values_list("transaction_id", flat=True)
    )
    # Normalize absent times consistently on PostgreSQL and SQLite, then retain
    # cumulative account balances for comparisons at the report's cutoff.
    transactions = sorted(
        transactions,
        key=lambda item: (
            item.date,
            item.time or time.min,
            item.created_at,
            str(item.pk),
        ),
    )
    history = {account.id: [] for account in account_list}
    reported_order = {}
    reported_source = {}

    def record_reported(
        account_id, value, record_date, record_time, created_at, source,
        posting_context=False,
    ):
        order = (record_date, record_time or time.min, created_at)
        if value is not None and order >= reported_order.get(account_id, order):
            reported_order[account_id] = order
            latest_reported[account_id] = (value, record_date)
            reported_source[account_id] = (source, record_time, posting_context)

    for transaction in transactions:
        if transaction.account_id in balances:
            if transaction.type in INCREASE_TYPES:
                balances[transaction.account_id] += transaction.amount
            elif (
                transaction.type in DECREASE_TYPES
                or transaction.type == Transaction.Type.TRANSFER
            ):
                balances[transaction.account_id] -= transaction.amount
            elif transaction.type == Transaction.Type.ADJUSTMENT:
                multiplier = (
                    Decimal(1)
                    if transaction.direction == Transaction.Direction.CREDIT
                    else Decimal(-1)
                )
                balances[transaction.account_id] += transaction.amount * multiplier

            if transaction.id not in evidence_transaction_ids:
                record_reported(
                    transaction.account_id,
                    transaction.balance_after,
                    transaction.date,
                    transaction.time,
                    transaction.created_at,
                    transaction,
                )

        if (
            transaction.type == Transaction.Type.TRANSFER
            and transaction.transfer_account_id in balances
        ):
            balances[transaction.transfer_account_id] += transaction.amount

        for account_id in {transaction.account_id, transaction.transfer_account_id}:
            if account_id in history and (
                account_id == transaction.account_id
                or transaction.type == Transaction.Type.TRANSFER
            ):
                history[account_id].append(
                    (
                        (
                            transaction.date,
                            transaction.time or time.min,
                            transaction.created_at,
                        ),
                        balances[account_id],
                        transaction,
                    )
                )

    # Use the same effective account report as the editor/matching API. Retained
    # source evidence can disagree after an explicit merge resolution.
    records_by_id = {record.pk: record for record in transactions}
    grouped_evidence = {}
    for item in evidence:
        grouped_evidence.setdefault(item.transaction_id, []).append(item)
    for record_id, items in grouped_evidence.items():
        chosen, _ = account_reports(records_by_id[record_id], items)
        for item in chosen.values():
            record_reported(
                item.account_id,
                item.balance_after,
                item.date,
                item.time,
                item.created_at,
                records_by_id[record_id],
            )

    # EBL may post a movement days after its SMS. Its printed running balance
    # belongs to posting order, so it can be the latest provider report without
    # replacing the transaction-time SMS report on the ledger entry. Existing
    # linked rows participate immediately; no historical rewrite is needed.
    from apps.statements.models import StatementRow

    delayed_rows = StatementRow.objects.filter(
        batch__profile="ebl_bank",
        batch__account_id__in=account_ids,
        state=StatementRow.State.LINKED,
        transaction_id__in=records_by_id,
        balance_after__isnull=False,
        date__isnull=False,
        value_date__isnull=False,
    ).only(
        "batch__account_id", "date", "time", "value_date", "balance_after",
        "created_at", "transaction_id",
    ).select_related("batch")
    if as_of_date is not None:
        delayed_rows = delayed_rows.filter(date__lte=as_of_date)
    for row in delayed_rows:
        record = records_by_id[row.transaction_id]
        if record.source != Transaction.Source.SMS or not (
            row.date > record.date
            and (row.date - record.date).days >= 2
            and abs((row.value_date - record.date).days) <= 1
        ):
            continue
        record_reported(
            row.batch.account_id, row.balance_after, row.date, row.time,
            row.created_at, row, posting_context=True,
        )

    summaries = {}
    for account in account_list:
        value, record_date = latest_reported[account.id]
        expected = difference = None
        comparison = "unavailable"
        if value is not None:
            source, record_time, posting_context = reported_source[account.id]
            cutoff = reported_order[account.id]
            same_day = [
                item
                for item in history[account.id]
                if item[2].date == record_date and item[2].pk != source.pk
            ]
            source_order = (source.date, source.time or time.min, source.created_at)
            if record_time is None and source.date == record_date and not same_day:
                # With exactly one movement on that day, its after-balance is
                # unambiguous even when the provider omits the report time.
                cutoff = (
                    record_date,
                    source.time or time.min,
                    max(source.created_at, cutoff[2]),
                )
            if posting_context:
                # Posting order and transaction-time order are different; an
                # exact ledger comparison would claim a false discrepancy.
                comparison = "timing_unknown"
            elif account.type == Account.Type.CREDIT_CARD:
                comparison = "credit_card_reference"
            elif source_order > cutoff:
                comparison = "report_precedes_movement"
            elif any(
                item[2].time is None
                or record_time is None
                or item[2].time == record_time
                for item in same_day
            ):
                comparison = "timing_unknown"
            else:
                index = (
                    bisect_right([item[0] for item in history[account.id]], cutoff) - 1
                )
                expected = (
                    history[account.id][index][1]
                    if index >= 0
                    else Decimal(account.starting_balance)
                ).quantize(Decimal("0.01"))
                difference = (value - expected).quantize(Decimal("0.01"))
                comparison = "matched" if difference == 0 else "mismatch"
        summaries[account.id] = AccountBalanceSummary(
            ledger_balance=balances[account.id].quantize(Decimal("0.01")),
            latest_reported_balance=value,
            latest_reported_balance_date=record_date,
            ledger_balance_at_latest_report=expected,
            latest_reported_balance_difference=difference,
            reported_balance_comparison=comparison,
        )
    return summaries


def calculate_expected_balance(*, account: Account, as_of_date=None) -> Decimal:
    return calculate_account_balance_summaries(
        accounts=(account,),
        as_of_date=as_of_date,
    )[account.id].ledger_balance
