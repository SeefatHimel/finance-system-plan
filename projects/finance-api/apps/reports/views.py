from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions.models import Transaction


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
        year_text, month_text = month.split("-", maxsplit=1)
        year = int(year_text)
        month_number = int(month_text)
        start = date(year, month_number, 1)
    except ValueError as exc:
        raise ValidationError({"month": "Use YYYY-MM format."}) from exc

    if month_number == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month_number + 1, 1)

    return start, end, month


class MonthlyReportView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        start, end, month = month_bounds(request.query_params.get("month"))
        transactions = (
            Transaction.objects.filter(user=request.user, date__gte=start, date__lt=end)
            .select_related("account", "category")
            .order_by("date")
        )

        income_total = Decimal("0.00")
        expense_total = Decimal("0.00")
        category_totals = defaultdict(Decimal)
        account_totals = defaultdict(lambda: {"money_in": Decimal("0.00"), "money_out": Decimal("0.00")})

        for transaction in transactions:
            if transaction.type in INCOME_TYPES:
                income_total += transaction.amount
                account_totals[transaction.account.name]["money_in"] += transaction.amount
            elif transaction.type in EXPENSE_TYPES:
                expense_total += transaction.amount
                account_totals[transaction.account.name]["money_out"] += transaction.amount
            elif transaction.type == Transaction.Type.TRANSFER and transaction.transfer_account:
                account_totals[transaction.account.name]["money_out"] += transaction.amount
                account_totals[transaction.transfer_account.name]["money_in"] += transaction.amount

            if transaction.category:
                category_totals[transaction.category.name] += transaction.amount

        return Response(
            {
                "month": month,
                "currency": "BDT",
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
