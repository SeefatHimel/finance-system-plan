"""Calendar-day checkpoints and explicit ordering of unknown times."""

from decimal import Decimal
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.transactions.models import Transaction
from apps.transactions.balance_queries import ledger_totals


def account_rows(account):
    return Transaction.objects.filter(user=account.user).filter(
        Q(account=account) | Q(type="transfer", transfer_account=account)
    )


def checkpoint_expected(account, checked_at, precision="end_of_day", timing_order=None):
    local = timezone.localtime(checked_at)
    day, clock = local.date(), local.time().replace(tzinfo=None)
    condition = Q(date__lt=day)
    if precision == "end_of_day":
        condition |= Q(date=day)
    else:
        unknown = set(
            str(pk)
            for pk in account_rows(account)
            .filter(date=day, time__isnull=True)
            .values_list("pk", flat=True)
        )
        timing_order = timing_order or {}
        if unknown - timing_order.keys() or any(
            timing_order[pk] not in {"before", "after"} for pk in unknown
        ):
            raise ValidationError(
                {
                    "timing_order": "Decide whether every untimed entry on this date happened before or after this balance. New untimed entries require another review."
                }
            )
        condition |= Q(date=day, time__lte=clock)
        condition |= Q(
            date=day,
            time__isnull=True,
            pk__in=[pk for pk in unknown if timing_order[pk] == "before"],
        )
    return ledger_totals([account], row_filter=condition)[account.pk].quantize(
        Decimal("0.01")
    )
