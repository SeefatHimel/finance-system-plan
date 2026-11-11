"""Bounded, account-specific projections. One SQL snapshot for every compared cutoff."""

from datetime import datetime, time
from decimal import Decimal

from django.db.models import Case, Count, F, Max, Q, Sum, TimeField, Value, When
from django.db.models.functions import TruncDate, TruncTime
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.transactions.balance_queries import DEBITS, MONEY
from apps.transactions.models import Transaction
from apps.transactions.policy import CREDIT_TYPES

from .models import BalanceSnapshot

CASH_TYPES = ("cash", "home_cash")


def boundary(day, clock=None):
    return timezone.make_aware(datetime.combine(day, clock or time.max))


def snapshots(user):
    # Older whole-day snapshots may have a clock in checked_at. Their true
    # comparison boundary is still the end of that local calendar day.
    return BalanceSnapshot.objects.filter(
        user=user, account__type__in=CASH_TYPES
    ).alias(
        count_day=TruncDate("checked_at", tzinfo=timezone.get_default_timezone()),
        count_time=Case(
            When(precision="end_of_day", then=Value(time.max)),
            default=TruncTime("checked_at", tzinfo=timezone.get_default_timezone()),
            output_field=TimeField(),
        ),
    )


def period(point, *, earlier=False, later=False):
    clock = point["time"] or time.max
    if earlier:
        return Q(count_day__lt=point["date"]) | Q(
            count_day=point["date"], count_time__lt=clock
        )
    if later:
        return Q(count_day__gt=point["date"]) | Q(
            count_day=point["date"], count_time__gt=clock
        )
    return Q(count_day=point["date"], count_time=clock)


def snapshot_point(record):
    local = timezone.localtime(record.checked_at)
    return {
        "account": record.account,
        "date": local.date(),
        "time": local.time().replace(tzinfo=None)
        if record.precision == "instant"
        else None,
        "timing_order": record.timing_order,
        "unknown_position": "unresolved",
        "balance": record.actual_balance,
        "errors": [],
        "key": str(record.pk),
    }


def predicate(point):
    result = Q(date__lt=point["date"])
    if point["time"] is None:
        return result | Q(date=point["date"])
    return (
        result
        | Q(date=point["date"], time__lte=point["time"])
        | Q(
            date=point["date"],
            time__isnull=True,
            pk__in=[
                key
                for key, value in point.get("timing_order", {}).items()
                if value == "before"
            ],
        )
    )


def project(user, points):
    valid = [p for p in points if not p["errors"]]
    timed = [p for p in valid if p["time"] is not None]
    unknown = []
    if timed:
        ids = {p["account"].pk for p in timed}
        unknown = list(
            Transaction.objects.filter(
                user=user, date__in={p["date"] for p in timed}, time__isnull=True
            )
            .filter(
                Q(account_id__in=ids) | Q(type="transfer", transfer_account_id__in=ids)
            )
            .order_by("pk")
            .values(
                "id",
                "account_id",
                "transfer_account_id",
                "type",
                "amount",
                "date",
                "counterparty_text",
            )[:1001]
        )
        if len(unknown) > 1000:
            raise ValidationError(
                {
                    "counts": "Too many untimed entries. Compare fewer accounts/dates at once."
                }
            )
    expressions = {}
    timing_cost = 0
    scope_all = Q(pk__in=[])
    for i, point in enumerate(valid):
        account = point["account"]
        items = [
            item
            for item in unknown
            if point["time"] is not None
            and item["date"] == point["date"]
            and (
                account.pk == item["account_id"]
                or item["type"] == "transfer"
                and account.pk == item["transfer_account_id"]
            )
        ]
        order = point.get("timing_order", {})
        point["unknown"] = [
            {
                "id": str(item["id"]),
                "description": item["counterparty_text"] or item["type"],
                "amount": str(item["amount"]),
                "position": order.get(
                    str(item["id"]), point.get("unknown_position", "unresolved")
                ),
            }
            for item in items
        ]
        point["timing_order"] = {
            item["id"]: item["position"] for item in point["unknown"]
        }
        if any(
            item["position"] not in {"before", "after"} for item in point["unknown"]
        ):
            point["errors"].append(
                "Decide whether each untimed entry occurred before or after this count."
            )
            continue
        timing_cost += len(point["timing_order"])
        # Bound SQL parameters as well as row count when the same untimed
        # entries are compared against many cutoffs in one table.
        if timing_cost > 5000:
            raise ValidationError(
                {
                    "counts": "This timed comparison is too large. Split it into fewer counts and preview again."
                }
            )
        scope = (
            Q(account=account) | Q(type="transfer", transfer_account=account)
        ) & predicate(point)
        scope_all |= scope
        signed = Case(
            When(
                Q(account=account)
                & (Q(type__in=CREDIT_TYPES) | Q(type="adjustment", direction="credit")),
                then=F("amount"),
            ),
            When(
                Q(account=account)
                & (Q(type__in=DEBITS) | Q(type="adjustment", direction="debit")),
                then=-F("amount"),
            ),
            When(type="transfer", transfer_account=account, then=F("amount")),
            default=Value(Decimal(0)),
            output_field=MONEY,
        )
        expressions[f"v{i}"] = Sum(signed, filter=scope)
        expressions[f"n{i}"] = Count("pk", filter=scope)
        expressions[f"t{i}"] = Max("updated_at", filter=scope)
        point["projection_index"] = i
    totals = (
        Transaction.objects.filter(user=user).filter(scope_all).aggregate(**expressions)
        if expressions
        else {}
    )
    for point in valid:
        if point["errors"]:
            continue
        i = point["projection_index"]
        point["expected"] = (
            Decimal(point["account"].starting_balance) + (totals[f"v{i}"] or Decimal(0))
        ).quantize(Decimal("0.01"))
        point["difference"] = point["balance"] - point["expected"]
        if any(
            abs(point[field]) >= Decimal(1000000000000)
            for field in ("expected", "difference")
        ):
            point["errors"].append(
                "The ledger balance or difference exceeds the supported amount range. Review the account before saving."
            )
        point["revision"] = (
            totals[f"n{i}"],
            str(totals[f"t{i}"]),
            str(point["account"].starting_balance),
        )
    before = {}
    superseded = {
        p["duplicate"]["id"]
        for p in valid
        if p.get("duplicate") and p.get("action") == "replace"
    }
    for point in sorted(
        valid, key=lambda p: (str(p["account"].pk), p["date"], p["time"] or time.max)
    ):
        if point.get("key") in superseded:
            continue
        key = (point["account"].pk, point["date"])
        seen = before.setdefault(key, {})
        for item in point.get("unknown", []):
            if item["id"] in seen and item["position"] == "after":
                message = "Timing choices conflict between counts: an entry before an earlier count cannot be after a later count."
                for affected in (point, seen[item["id"]]):
                    if message not in affected["errors"]:
                        affected["errors"].append(message)
            elif item["position"] == "before":
                seen[item["id"]] = point
