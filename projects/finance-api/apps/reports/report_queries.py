"""One-statement report projections: all sections share a database snapshot."""

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID
from django.db.models import (
    Q,
    F,
    Case,
    When,
    Value,
    DecimalField,
    Sum,
    Count,
    Max,
    CharField,
)
from django.db.models.functions import Cast, Coalesce, Concat, JSONObject
from apps.transactions.models import Transaction
from apps.transactions.policy import (
    CREDIT_TYPES,
    DEBIT_TYPES,
    SPENDING_TYPES,
    FINANCING_TYPES,
)
from .formatting import money, ZERO

MONEY = DecimalField(max_digits=28, decimal_places=2)


def period_projections(*, user, start, end, currency, account, period):
    rows = Transaction.objects.filter(
        user=user, date__range=(start, end), account__currency=currency
    ).order_by()
    if account:
        rows = rows.filter(
            Q(account=account) | Q(type="transfer", transfer_account=account)
        )
    transfer = Q(
        type="transfer",
        transfer_account__isnull=False,
        transfer_account__currency=currency,
    )
    credit = Q(type__in=CREDIT_TYPES) | Q(type="adjustment", direction="credit")
    debit = Q(type__in=DEBIT_TYPES) | (Q(type="adjustment") & ~Q(direction="credit"))
    cash_in, cash_out = credit, debit
    if account:
        cash_in |= transfer & Q(transfer_account=account)
        cash_out |= transfer & Q(account=account)

    def total(condition):
        return Sum("amount", filter=condition, default=ZERO, output_field=MONEY)

    def text(expression):
        # JSON numeric decoding would introduce floats. Financial values cross
        # this SQL projection boundary as text and are processed as Decimal.
        return Cast(expression, CharField())

    def project(query, kind, groups=(), **fields):
        return (
            query.annotate(_report_period=Value(period), _report_kind=Value(kind))
            .values("_report_period", "_report_kind", *groups)
            .annotate(_report_payload=JSONObject(**fields))
            .values("_report_period", "_report_kind", "_report_payload")
        )

    delta = Case(
        When(type="refund", then=-F("amount")), default=F("amount"), output_field=MONEY
    )
    adjustments = Case(
        When(direction="credit", then=F("amount")),
        default=-F("amount"),
        output_field=MONEY,
    )
    metrics = {
        "income_total": total(Q(type="income")),
        "expense_total": Sum(
            delta, filter=Q(type__in=SPENDING_TYPES | {"refund"}), default=ZERO
        ),
        "gross_spending_total": total(Q(type__in=SPENDING_TYPES)),
        "refund_total": total(Q(type="refund")),
        "financing_in_total": total(Q(type__in=FINANCING_TYPES & CREDIT_TYPES)),
        "financing_out_total": total(Q(type__in=FINANCING_TYPES & DEBIT_TYPES)),
        "transfers_total": total(transfer),
        "adjustments_total": Sum(
            adjustments, filter=Q(type="adjustment"), default=ZERO
        ),
        "cash_in_total": total(cash_in),
        "cash_out_total": total(cash_out),
    }
    spending = rows.filter(type__in=SPENDING_TYPES | {"refund"})
    latest_order = Concat(
        text("date"),
        Value("|"),
        Coalesce(text("time"), Value("99:99:99")),
        Value("|"),
        text("created_at"),
    )
    daily_fields = ("income_total", "expense_total", "cash_in_total", "cash_out_total")
    return [
        project(
            rows,
            "totals",
            transaction_count=Count("pk"),
            **{key: text(value) for key, value in metrics.items()},
        ),
        project(
            spending,
            "category",
            ("category_id", "category__name"),
            id=text("category_id"),
            name=Coalesce("category__name", Value("Uncategorized")),
            amount=text(Sum(delta)),
        ),
        project(
            spending,
            "merchant",
            ("counterparty_text",),
            name=F("counterparty_text"),
            amount=text(Sum(delta)),
            count=Count("pk"),
            latest_order=Max(latest_order),
        ),
        project(
            rows,
            "sending",
            ("account_id", "account__name"),
            id=text("account_id"),
            name=F("account__name"),
            money_in=text(total(credit)),
            money_out=text(total(debit | transfer)),
        ),
        project(
            rows.filter(transfer),
            "receiving",
            ("transfer_account_id", "transfer_account__name"),
            id=text("transfer_account_id"),
            name=F("transfer_account__name"),
            money_in=text(Sum("amount")),
        ),
        project(
            rows,
            "day",
            ("date",),
            date=text("date"),
            **{key: text(metrics[key]) for key in daily_fields},
        ),
    ]


def assemble_period(groups, *, start, end, currency, account):
    # UUID casts are compact hex in SQLite and hyphenated text in PostgreSQL.
    for kind in ("category", "sending", "receiving"):
        for row in groups[kind]:
            if row["id"] is not None:
                row["id"] = str(UUID(row["id"]))
    totals = {
        key: Decimal(value)
        for key, value in groups["totals"][0].items()
        if key != "transaction_count"
    }
    categories = [
        {**row, "amount": money(Decimal(row["amount"]))}
        for row in sorted(
            groups["category"], key=lambda row: (-Decimal(row["amount"]), row["name"])
        )
    ]
    merchants = {}
    for row in sorted(
        groups["merchant"],
        key=lambda row: (row["latest_order"], row["name"]),
        reverse=True,
    ):
        name = row["name"].strip()
        merchant = merchants.setdefault(
            name.casefold(),
            {
                "name": name or "Unspecified merchant",
                "search": name,
                "amount": ZERO,
                "count": 0,
            },
        )
        merchant["amount"] += Decimal(row["amount"])
        merchant["count"] += row["count"]
    positions = {}
    for row in groups["sending"] + groups["receiving"]:
        position = positions.setdefault(
            row["id"],
            {"id": row["id"], "name": row["name"], "money_in": ZERO, "money_out": ZERO},
        )
        position["money_in"] += Decimal(row["money_in"])
        position["money_out"] += Decimal(row.get("money_out", "0"))
    daily = {date.fromisoformat(row["date"]): row for row in groups["day"]}
    daily_fields = ("income_total", "expense_total", "cash_in_total", "cash_out_total")
    return {
        "policy": "spending-v2",
        "currency": currency,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "transaction_count": groups["totals"][0]["transaction_count"],
        **{key: money(value) for key, value in totals.items()},
        "net_total": money(totals["income_total"] - totals["expense_total"]),
        "cash_net_total": money(totals["cash_in_total"] - totals["cash_out_total"]),
        "categories": categories,
        "spending_categories": categories,
        "merchants": [
            {**row, "amount": money(row["amount"])}
            for row in sorted(
                merchants.values(), key=lambda row: (-row["amount"], row["name"])
            )
        ],
        "accounts": [
            {
                **row,
                "money_in": money(row["money_in"]),
                "money_out": money(row["money_out"]),
            }
            for row in sorted(
                positions.values(), key=lambda row: (row["name"], row["id"])
            )
            if not account or row["id"] == str(account.pk)
        ],
        "daily": [
            {
                "date": (start + timedelta(days=n)).isoformat(),
                **{
                    key: money(
                        Decimal(daily.get(start + timedelta(days=n), {}).get(key, "0"))
                    )
                    for key in daily_fields
                },
            }
            for n in range((end - start).days + 1)
        ],
    }


def sql_period_summaries(*, user, periods, currency, account=None):
    from collections import defaultdict

    periods = list(periods)
    if not periods:
        return []
    queries = [
        query
        for index, (start, end) in enumerate(periods)
        for query in period_projections(
            user=user,
            start=start,
            end=end,
            currency=currency,
            account=account,
            period=index,
        )
    ]
    results = [defaultdict(list) for _ in periods]
    # UNION ALL retains repeated/equal contributions. One statement gives every
    # section and comparison period the same snapshot at any isolation level.
    for row in queries[0].union(*queries[1:], all=True):
        results[row["_report_period"]][row["_report_kind"]].append(
            row["_report_payload"]
        )
    return [
        assemble_period(
            groups, start=start, end=end, currency=currency, account=account
        )
        for groups, (start, end) in zip(results, periods)
    ]


def sql_period_summary(*, user, start, end, currency, account=None):
    return sql_period_summaries(
        user=user, periods=[(start, end)], currency=currency, account=account
    )[0]
