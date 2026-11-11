from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal

from apps.accounts.models import Account

from .models import Transaction

from .policy import CREDIT_TYPES as INCREASE_TYPES, DEBIT_TYPES as DECREASE_TYPES


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

    from .balance_queries import (
        ledger_totals,
        latest_reports,
        ambiguous_report_accounts,
    )

    balances = ledger_totals(account_list, as_of_date)
    transactions, reports = latest_reports(account_list, as_of_date)
    ambiguous = ambiguous_report_accounts(transactions, reports)
    cutoffs = {}
    results = {}
    for account in account_list:
        report = reports.get(account.pk)
        if report is None:
            results[account.pk] = AccountBalanceSummary(
                ledger_balance=balances[account.pk].quantize(Decimal("0.01"))
            )
            continue
        cutoff, value, source, posting, report_time = report
        day = cutoff[0]
        if report_time is None and source.date == day and account.pk not in ambiguous:
            cutoff = (day, source.time or time.min, max(source.created_at, cutoff[2]))
        source_order = (source.date, source.time or time.min, source.created_at)
        if posting:
            comparison = "timing_unknown"
        elif account.type == Account.Type.CREDIT_CARD:
            comparison = "credit_card_reference"
        elif source_order > cutoff:
            comparison = "report_precedes_movement"
        elif account.pk in ambiguous:
            comparison = "timing_unknown"
        else:
            comparison = "pending"
            cutoffs[account.pk] = cutoff
        results[account.pk] = AccountBalanceSummary(
            ledger_balance=balances[account.pk].quantize(Decimal("0.01")),
            latest_reported_balance=value,
            latest_reported_balance_date=day,
            reported_balance_comparison=comparison,
        )
    if cutoffs:
        from dataclasses import replace

        expected = ledger_totals(
            [account for account in account_list if account.pk in cutoffs],
            as_of_date,
            cutoffs,
        )
        for account, cutoff in cutoffs.items():
            result = results[account]
            balance = expected[account].quantize(Decimal("0.01"))
            difference = (result.latest_reported_balance - balance).quantize(
                Decimal("0.01")
            )
            results[account] = replace(
                result,
                ledger_balance_at_latest_report=balance,
                latest_reported_balance_difference=difference,
                reported_balance_comparison="matched"
                if difference == 0
                else "mismatch",
            )
    return results


def calculate_expected_balance(*, account: Account, as_of_date=None) -> Decimal:
    from .balance_queries import ledger_totals

    return ledger_totals([account], as_of_date)[account.pk].quantize(Decimal("0.01"))
