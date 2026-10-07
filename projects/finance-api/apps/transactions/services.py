from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal

from django.db.models import Q

from apps.accounts.models import Account

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
    ).order_by("date", "time", "created_at")

    evidence = TransferEvidence.objects.filter(
        user_id__in=user_ids,
        account_id__in=account_ids,
        transaction__type=Transaction.Type.TRANSFER,
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
    reported_order = {}

    def record_reported(account_id, value, record_date, record_time, created_at):
        order = (record_date, record_time or time.min, created_at)
        if value is not None and order >= reported_order.get(account_id, order):
            reported_order[account_id] = order
            latest_reported[account_id] = (value, record_date)

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
                )

        if (
            transaction.type == Transaction.Type.TRANSFER
            and transaction.transfer_account_id in balances
        ):
            balances[transaction.transfer_account_id] += transaction.amount

    for item in evidence:
        record_reported(
            item.account_id, item.balance_after, item.date, item.time, item.created_at
        )

    return {
        account.id: AccountBalanceSummary(
            ledger_balance=balances[account.id].quantize(Decimal("0.01")),
            latest_reported_balance=latest_reported[account.id][0],
            latest_reported_balance_date=latest_reported[account.id][1],
        )
        for account in account_list
    }


def calculate_expected_balance(*, account: Account, as_of_date=None) -> Decimal:
    return calculate_account_balance_summaries(
        accounts=(account,),
        as_of_date=as_of_date,
    )[account.id].ledger_balance
