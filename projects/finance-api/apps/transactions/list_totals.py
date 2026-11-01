"""Database-side totals for the entire filtered ledger, independent of page size."""

from decimal import Decimal
from django.db.models import Q, Sum
from .models import Transaction


def filtered_totals(queryset, selected_account=""):
    # Isolate the monetary rows from evidence joins/annotations in the list query.
    rows = Transaction.objects.filter(pk__in=queryset.order_by().values("pk"))
    transfer = Q(type="transfer")
    incoming = Q(direction="credit") & ~transfer
    outgoing = Q(direction="debit") & ~transfer
    if selected_account:
        incoming |= transfer & Q(transfer_account_id=selected_account)
        outgoing |= transfer & Q(account_id=selected_account)
    filters = {
        "income": Q(type="income"),
        "spending": Q(type__in=("expense", "fee")),
        "refunds": Q(type="refund"),
        "financingIn": Q(type__in=("borrow", "repayment_received")),
        "financingOut": Q(type__in=("lend", "repayment_paid")),
        "moneyIn": incoming,
        "moneyOut": outgoing,
        "transfers": transfer,
    }
    values = (
        rows.values("account__currency")
        .annotate(
            **{
                key: Sum("amount", filter=condition, default=Decimal("0"))
                for key, condition in filters.items()
            }
        )
        .order_by("account__currency")
    )
    result = []
    for value in values:
        currency = value.pop("account__currency")
        value["spending"] -= value["refunds"]
        value["net"] = value["moneyIn"] - value["moneyOut"]
        result.append(
            {
                "currency": currency,
                **{key: f"{amount:.2f}" for key, amount in value.items()},
            }
        )
    return result
