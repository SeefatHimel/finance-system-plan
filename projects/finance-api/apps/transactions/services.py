from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

from django.db.models import Q

from apps.accounts.models import Account

from .models import Transaction


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
        "direction",
        "transfer_account_id",
        "type",
    ).order_by("date", "created_at")

    for transaction in transactions:
        if transaction.account_id in balances:
            if transaction.type in INCREASE_TYPES:
                balances[transaction.account_id] += transaction.amount
            elif transaction.type in DECREASE_TYPES:
                balances[transaction.account_id] -= transaction.amount
            elif transaction.type == Transaction.Type.TRANSFER:
                balances[transaction.account_id] -= transaction.amount
            elif transaction.type == Transaction.Type.ADJUSTMENT:
                multiplier = (
                    Decimal("1")
                    if transaction.direction == Transaction.Direction.CREDIT
                    else Decimal("-1")
                )
                balances[transaction.account_id] += transaction.amount * multiplier

            if transaction.balance_after is not None:
                latest_reported[transaction.account_id] = (
                    transaction.balance_after,
                    transaction.date,
                )

        if (
            transaction.type == Transaction.Type.TRANSFER
            and transaction.transfer_account_id in balances
        ):
            balances[transaction.transfer_account_id] += transaction.amount

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
