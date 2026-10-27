"""Bounded BDT source rounding policy; preserve originals and use the higher value."""

from decimal import Decimal

from django.db.models import Exists, OuterRef

from apps.credit_cards.models import CreditCardBill, CreditCardPayment
from apps.debts.models import Debt, DebtPayment
from apps.recurring_bills.models import RecurringBillPayment

from .models import StatementRow

UNIT = Decimal("1.00")


def nearby_amount(left, right, currency):
    return (
        left is not None
        and right is not None
        and currency == "BDT"
        and Decimal(0) < abs(left - right) < UNIT
    )


def corroborates(row, record, result):
    """Keep date/time/reference/balance together from one account observation."""
    if not nearby_amount(row.amount, record.amount, row.batch.currency):
        return False
    if has_separate_fee(row):
        return False
    if result["distance"] > 3:
        return False
    balance = result["reported_balance"]
    if row.balance_after is not None and balance is not None:
        return abs(row.balance_after - balance) < UNIT
    if result["distance"] > 1 and not result["reference_matches"]:
        return False
    return (
        result["reference_matches"]
        or bool(row.other_account_id)
        or (result["signals"]["merchant_similarity"] >= 0.8)
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
        if record.rounding_has_dependencies and row.amount > record.amount
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


def equivalent_amount(left, right, currency):
    return (
        left is not None
        and right is not None
        and (left == right or nearby_amount(left, right, currency))
    )


def resolved_amount(values, currency):
    """Compare the full span, never chain together several sub-unit differences."""
    from rest_framework.exceptions import ValidationError

    if not values or any(value is None for value in values):
        raise ValidationError({"amount": "Both sources must report an amount."})
    low, high = min(values), max(values)
    if not equivalent_amount(low, high, currency):
        raise ValidationError(
            {
                "amount": "The amounts differ by at least one taka or use another currency. Review the sources separately."
            }
        )
    return high


def automatic_balance_choice(values, currency):
    """Known reports only; nulls and reports for another account are not money."""
    known = {key: value for key, value in values.items() if value is not None}
    if len(known) < 2 or not nearby_amount(
        min(known.values()), max(known.values()), currency
    ):
        return None
    return max(known, key=known.get)


def amount_candidates(queryset, amounts, currency=None):
    """Bound SQL discovery by integer buckets; callers verify exact Decimal spans."""
    from django.db.models import Q
    from django.db.models.functions import Floor

    amounts = {value for value in amounts if value is not None}
    if not amounts:
        return queryset.none()
    if currency is not None and currency != "BDT":
        return queryset.filter(amount__in=amounts)
    if len(amounts) <= 50:
        predicate = Q()
        for value in amounts:
            predicate |= Q(amount__gt=value - UNIT, amount__lt=value + UNIT)
        return queryset.filter(predicate)
    buckets = {int(value) + step for value in amounts for step in (-1, 0, 1)}
    return queryset.alias(source_amount_bucket=Floor("amount")).filter(
        Q(amount__in=amounts) | Q(source_amount_bucket__in=buckets)
    )


def nearby_candidates(buckets, account_id, direction, amount, currency):
    if amount is None:
        return []
    return [
        candidate
        for step in ((-1, 0, 1) if currency == "BDT" else (0,))
        for candidate in buckets[(account_id, direction, int(amount) + step)]
    ]


def mark_fee_rows(rows):
    """One batched EXISTS query, rather than a fee lookup for every near pair."""
    rows = list(rows)
    if not rows:
        return
    from .ebl_identifiers import mark_possible_fees

    mark_possible_fees(rows)
    flags = dict(
        StatementRow.objects.filter(pk__in=[row.pk for row in rows])
        .annotate(
            has_fee=Exists(
                StatementRow.objects.filter(
                    batch_id=OuterRef("batch_id"),
                    position=OuterRef("position"),
                    component="fee",
                )
            )
        )
        .values_list("pk", "has_fee")
    )
    for row in rows:
        row._has_inline_fee = flags.get(row.pk, False) or getattr(row, "_ebl_has_companion", False)


def has_separate_fee(row):
    if row.component != "principal":
        return False
    if not hasattr(row, "_has_inline_fee"):
        mark_fee_rows([row])
    return row._has_inline_fee or bool(
        Decimal(str(row.extracted.get("signed_fee") or "0"))
    )
