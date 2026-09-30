from decimal import Decimal

from apps.transactions.services import (
    calculate_expected_balance as calculate_ledger_balance,
)


def calculate_expected_balance(*, account, as_of_date=None) -> Decimal:
    return calculate_ledger_balance(account=account, as_of_date=as_of_date)


def snapshot_status_for_difference(difference: Decimal) -> str:
    from .models import BalanceSnapshot

    if difference == Decimal("0.00"):
        return BalanceSnapshot.Status.MATCHED
    if difference < Decimal("0.00"):
        return BalanceSnapshot.Status.MISSING_MONEY
    return BalanceSnapshot.Status.EXTRA_MONEY
