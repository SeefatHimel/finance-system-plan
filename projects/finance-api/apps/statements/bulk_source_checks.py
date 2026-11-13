"""Bounded request-local discovery; the canonical pair checks remain authoritative."""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Q

from apps.messages.models import ParsedMessageCandidate
from apps.transactions.models import Transaction, TransferEvidence
from apps.transactions.transfers import sms_external_key

from .models import StatementRow
from .services import dates_for
from .unified import has_competing_sources, pair_signals, sms_observation

MAX_SOURCES = 5000


def amount_filter(amount, currency):
    if currency == "BDT":
        return Q(amount__gt=amount - Decimal(1), amount__lt=amount + Decimal(1))
    return Q(amount=amount)


def recorded_sms(user, messages):
    raw_ids = {item.raw_message_id for item in messages}
    external_keys = {sms_external_key(item) for item in messages}
    records = (
        Transaction.objects.filter(user=user)
        .filter(Q(raw_message_id__in=raw_ids) | Q(external_key__in=external_keys))
        .values_list("raw_message_id", "external_key")
    )
    recorded_ids, recorded_keys = set(), set()
    for raw_id, key in records:
        recorded_ids.add(raw_id)
        recorded_keys.add(key)
    recorded_ids.update(
        TransferEvidence.objects.filter(
            user=user, raw_message_id__in=raw_ids
        ).values_list("raw_message_id", flat=True)
    )
    return {
        str(item.pk)
        for item in messages
        if item.raw_message_id in recorded_ids
        or sms_external_key(item) in recorded_keys
    }


def competing_pairs(user, selected):
    """Use the same time/amount scopes and pair_signals as single-pair discovery."""
    candidate_scope, row_scope = Q(pk__in=[]), Q(pk__in=[])
    for row, sms in selected:
        days = dates_for(row)
        if not days or row.amount is None or sms.amount is None:
            continue
        received = sms_observation(sms)[2].date()
        candidate_scope |= amount_filter(row.amount, row.batch.currency) & Q(
            raw_message__received_at__date__range=(
                min(days) - timedelta(days=3),
                max(days) + timedelta(days=3),
            )
        )
        row_scope |= (
            amount_filter(sms.amount, row.batch.currency)
            & Q(batch__account_id=row.batch.account_id)
            & (
                Q(
                    date__range=(
                        received - timedelta(days=3),
                        received + timedelta(days=3),
                    )
                )
                | Q(
                    value_date__range=(
                        received - timedelta(days=3),
                        received + timedelta(days=3),
                    )
                )
            )
        )
    candidates = list(
        ParsedMessageCandidate.objects.filter(
            candidate_scope,
            user=user,
            status="needs_review",
            transaction__isnull=True,
        ).select_related("account", "destination_account", "raw_message")[
            : MAX_SOURCES + 1
        ]
    )
    rows = list(
        StatementRow.objects.filter(
            row_scope,
            batch__user=user,
            state="pending",
            transaction__isnull=True,
        ).select_related("batch__account", "other_account")[: MAX_SOURCES + 1]
    )
    if len(candidates) > MAX_SOURCES or len(rows) > MAX_SOURCES:
        # Preserve the canonical behavior without unbounded request memory.
        return {
            (str(row.pk), str(sms.pk)): has_competing_sources(row, sms)
            for row, sms in selected
        }
    return {
        (str(row.pk), str(sms.pk)): (
            any(item.pk != sms.pk and pair_signals(row, item) for item in candidates)
            or any(item.pk != row.pk and pair_signals(item, sms) for item in rows)
        )
        for row, sms in selected
    }
