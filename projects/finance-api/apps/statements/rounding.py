"""Small BDT differences are review suggestions, never equivalent money."""

from decimal import Decimal

from django.db.models import Exists, OuterRef

from apps.credit_cards.models import CreditCardBill, CreditCardPayment
from apps.debts.models import Debt, DebtPayment
from apps.recurring_bills.models import RecurringBillPayment

from .models import StatementRow

UNIT = Decimal("1.00")


def nearby_amount(left, right, currency):
    return currency == "BDT" and Decimal(0) < abs(left - right) < UNIT


def corroborates(row, record, result):
    """Keep date/time/reference/balance together from one account observation."""
    if not nearby_amount(row.amount, record.amount, row.batch.currency):
        return False
    if result["distance"] != 0:
        return False
    balance = result["reported_balance"]
    if row.balance_after is not None and balance is not None:
        return abs(row.balance_after - balance) < UNIT
    return result["reference_matches"] or (
        result["signals"]["merchant_similarity"] >= 0.8
        and result["signals"]["time_difference_minutes"] is not None
        and result["signals"]["time_difference_minutes"] <= 10
    )


def correction_guards(queryset):
    # EXISTS avoids multiplying histories or issuing per-suggestion relation reads.
    return queryset.annotate(
        rounding_has_dependencies=(
            Exists(StatementRow.objects.filter(transaction_id=OuterRef("pk")))
            | Exists(Debt.objects.filter(opened_transaction_id=OuterRef("pk")))
            | Exists(DebtPayment.objects.filter(transaction_id=OuterRef("pk")))
            | Exists(
                CreditCardBill.objects.filter(statement_transaction_id=OuterRef("pk"))
            )
            | Exists(CreditCardPayment.objects.filter(transaction_id=OuterRef("pk")))
            | Exists(RecurringBillPayment.objects.filter(transaction_id=OuterRef("pk")))
        )
    )


def correction_metadata(row, record, occupied):
    blocked = (
        "Another row in this statement is already attached to this movement."
        if record.pk in occupied
        else "This transaction has linked statement, debt or bill records. Correct it in Transactions and revalidate those records first."
        if record.rounding_has_dependencies
        else ""
    )
    return {
        "existing_amount": str(record.amount),
        "statement_amount": str(row.amount),
        "difference": f"{row.amount - record.amount:+.2f}",
        "transaction_updated_at": record.updated_at.isoformat(),
        "can_correct": not bool(blocked),
        "blocked_reason": blocked,
    }
