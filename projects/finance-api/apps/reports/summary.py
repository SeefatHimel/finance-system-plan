"""Spending and earned income are distinct from financing and account cash flow."""

from .formatting import money as money
from .report_queries import sql_period_summary, sql_period_summaries


def period_summary(*, user, start, end, currency="BDT", account=None):
    return sql_period_summary(
        user=user, start=start, end=end, currency=currency, account=account
    )


def period_summaries(*, user, periods, currency="BDT", account=None):
    return sql_period_summaries(
        user=user, periods=periods, currency=currency, account=account
    )
