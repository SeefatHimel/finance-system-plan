"""Spending and earned income are distinct from financing and account cash flow."""

from .formatting import money as money
from .report_queries import sql_period_summary, sql_period_summaries


def period_summary(*, user, start, end, currency="BDT", account=None, records=None):
    return sql_period_summary(
        user=user, start=start, end=end, currency=currency, account=account, records=records
    )


def period_summaries(*, user, periods, currency="BDT", account=None, record_sets=None, account_ids=None):
    return sql_period_summaries(
        user=user, periods=periods, currency=currency, account=account, record_sets=record_sets, account_ids=account_ids
    )
