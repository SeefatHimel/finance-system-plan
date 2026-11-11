"""Read-only structural checks. Never parses sources or changes financial values."""

from django.db import connection
from django.db.models import Q, F, Count
from .models import Transaction, TransferEvidence
from .policy import CREDIT_TYPES, DEBIT_TYPES, TRANSACTION_TYPES


def audit_integrity(*, user_id=None):
    rows = Transaction.objects.all().order_by()
    reports = TransferEvidence.objects.all().order_by()
    if user_id is not None:
        rows = rows.filter(user_id=user_id)
        reports = reports.filter(user_id=user_id)
    transfer = Q(type="transfer")
    checks = {
        "nonpositive_amount": Q(amount__lte=0),
        "same_account_transfer": Q(account_id=F("transfer_account_id")),
        "unknown_type": ~Q(type__in=TRANSACTION_TYPES),
        "type_direction_mismatch": (Q(type__in=CREDIT_TYPES) & ~Q(direction="credit"))
        | (Q(type__in=DEBIT_TYPES | {"transfer"}) & ~Q(direction="debit"))
        | ~Q(direction__in=("debit", "credit")),
        "account_owner_mismatch": ~Q(user_id=F("account__user_id")),
        "destination_owner_mismatch": Q(transfer_account__isnull=False)
        & ~Q(user_id=F("transfer_account__user_id")),
        "cross_currency_transfer": transfer
        & Q(transfer_account__isnull=False)
        & ~Q(account__currency=F("transfer_account__currency")),
        "invalid_transfer_path": (transfer & Q(transfer_account__isnull=True))
        | (~transfer & Q(transfer_account__isnull=False)),
        "source_owner_mismatch": Q(raw_message__isnull=False)
        & ~Q(user_id=F("raw_message__user_id")),
    }
    counts = rows.aggregate(
        total=Count("pk"),
        **{name: Count("pk", filter=condition) for name, condition in checks.items()},
    )
    report_counts = reports.aggregate(
        total=Count("pk"),
        owner_mismatch=Count(
            "pk",
            filter=~Q(user_id=F("transaction__user_id"))
            | ~Q(user_id=F("account__user_id")),
        ),
        source_owner_mismatch=Count(
            "pk",
            filter=Q(raw_message__isnull=False) & ~Q(user_id=F("raw_message__user_id")),
        ),
    )
    constraints = []
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT conname, convalidated FROM pg_constraint WHERE conrelid = %s::regclass AND conname IN ('ledger_amount_positive', 'ledger_distinct_accounts') ORDER BY conname",
                [Transaction._meta.db_table],
            )
            constraints = [
                {"name": name, "validated": validated}
                for name, validated in cursor.fetchall()
            ]
    return {
        "transactions": counts,
        "reports": report_counts,
        "constraints": constraints,
        "read_only": True,
    }


def violation_count(report):
    return sum(
        value
        for section in ("transactions", "reports")
        for name, value in report[section].items()
        if name != "total"
    )
