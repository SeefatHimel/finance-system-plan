import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions.models import Transaction

from .periods import custom_bounds

INCOME_TYPES = {
    Transaction.Type.INCOME,
    Transaction.Type.REFUND,
    Transaction.Type.BORROW,
    Transaction.Type.REPAYMENT_RECEIVED,
}

EXPENSE_TYPES = {
    Transaction.Type.EXPENSE,
    Transaction.Type.FEE,
    Transaction.Type.LEND,
    Transaction.Type.REPAYMENT_PAID,
}


def decimal_string(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def month_bounds(month: str | None) -> tuple[date, date, str]:
    if not month:
        today = timezone.localdate()
        month = today.strftime("%Y-%m")

    try:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise ValueError
        year_text, month_text = month.split("-", maxsplit=1)
        year = int(year_text)
        month_number = int(month_text)
        start = date(year, month_number, 1)
        end = (
            date(year + 1, 1, 1)
            if month_number == 12
            else date(year, month_number + 1, 1)
        )
    except ValueError as exc:
        raise ValidationError({"month": "Use YYYY-MM format."}) from exc

    return start, end, month


class MonthlyReportView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        bounds = custom_bounds(request.query_params)
        if bounds:
            start, inclusive_end = bounds
            month = None
        else:
            start, end, month = month_bounds(request.query_params.get("month"))
            inclusive_end = end - timedelta(days=1)
        transactions = (
            Transaction.objects.filter(
                user=request.user,
                date__range=(start, inclusive_end),
                account__currency="BDT",
            )
            .select_related("account", "transfer_account", "category")
            .order_by("date")
        )

        income_total = Decimal("0.00")
        expense_total = Decimal("0.00")
        category_totals = defaultdict(Decimal)
        spending_totals = defaultdict(Decimal)
        daily = defaultdict(
            lambda: {"income": Decimal("0.00"), "expense": Decimal("0.00")}
        )
        account_totals = defaultdict(
            lambda: {"money_in": Decimal("0.00"), "money_out": Decimal("0.00")}
        )

        for transaction in transactions:
            if transaction.type in INCOME_TYPES:
                income_total += transaction.amount
                daily[transaction.date]["income"] += transaction.amount
                account_totals[transaction.account.name]["money_in"] += (
                    transaction.amount
                )
            elif transaction.type in EXPENSE_TYPES:
                expense_total += transaction.amount
                daily[transaction.date]["expense"] += transaction.amount
                spending_totals[
                    transaction.category.name
                    if transaction.category
                    else "Uncategorized"
                ] += transaction.amount
                account_totals[transaction.account.name]["money_out"] += (
                    transaction.amount
                )
            elif (
                transaction.type == Transaction.Type.TRANSFER
                and transaction.transfer_account
            ):
                account_totals[transaction.account.name]["money_out"] += (
                    transaction.amount
                )
                account_totals[transaction.transfer_account.name]["money_in"] += (
                    transaction.amount
                )

            if transaction.category:
                category_totals[transaction.category.name] += transaction.amount

        return Response(
            {
                "month": month,
                "start_date": start.isoformat(),
                "end_date": inclusive_end.isoformat(),
                "currency": "BDT",
                "daily": [
                    {
                        "date": (start + timedelta(days=n)).isoformat(),
                        "income_total": decimal_string(
                            daily[start + timedelta(days=n)]["income"]
                        ),
                        "expense_total": decimal_string(
                            daily[start + timedelta(days=n)]["expense"]
                        ),
                    }
                    for n in range((inclusive_end - start).days + 1)
                ],
                "spending_categories": [
                    {"name": name, "amount": decimal_string(amount)}
                    for name, amount in sorted(spending_totals.items())
                ],
                "income_total": decimal_string(income_total),
                "expense_total": decimal_string(expense_total),
                "net_total": decimal_string(income_total - expense_total),
                "categories": [
                    {"name": name, "amount": decimal_string(amount)}
                    for name, amount in sorted(category_totals.items())
                ],
                "accounts": [
                    {
                        "name": name,
                        "money_in": decimal_string(totals["money_in"]),
                        "money_out": decimal_string(totals["money_out"]),
                    }
                    for name, totals in sorted(account_totals.items())
                ],
            }
        )
