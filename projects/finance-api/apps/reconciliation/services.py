from decimal import Decimal

from apps.transactions.models import Transaction


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


def calculate_expected_balance(*, account, as_of_date=None) -> Decimal:
    transactions = Transaction.objects.filter(user=account.user)
    if as_of_date is not None:
        transactions = transactions.filter(date__lte=as_of_date)

    balance = account.starting_balance

    for transaction in transactions:
        if transaction.account_id == account.id:
            if transaction.type in INCREASE_TYPES:
                balance += transaction.amount
            elif transaction.type in DECREASE_TYPES:
                balance -= transaction.amount
            elif transaction.type == Transaction.Type.TRANSFER:
                balance -= transaction.amount

        if (
            transaction.type == Transaction.Type.TRANSFER
            and transaction.transfer_account_id == account.id
        ):
            balance += transaction.amount

    return balance.quantize(Decimal("0.01"))


def snapshot_status_for_difference(difference: Decimal) -> str:
    from .models import BalanceSnapshot

    if difference == Decimal("0.00"):
        return BalanceSnapshot.Status.MATCHED
    if difference < Decimal("0.00"):
        return BalanceSnapshot.Status.MISSING_MONEY
    return BalanceSnapshot.Status.EXTRA_MONEY
