"""Explicit, one-step review of a pending SMS and a pending statement row."""

from collections import defaultdict
from datetime import timedelta
from types import SimpleNamespace

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SmsCapturePreference,
)
from apps.transactions.models import Transaction
from apps.transactions.transfers import (
    add_transfer_evidence,
    sms_external_key,
    sms_recorded_elsewhere,
    sms_reporting_account,
    sms_transfer_data,
)

from .details import detail_suggestions, draft_merchant
from .services import (
    MATCH_DAYS,
    ReviewConflict,
    dates_for,
    find_matches,
    posting_issues,
    resolved,
)


def _eligible(row, candidate):
    if resolved(row) or posting_issues(row) or row.component != "principal":
        return False
    if not hasattr(row, "_has_inline_fee"):
        row._has_inline_fee = row.batch.rows.filter(position=row.position, component="fee").exists()
    if row._has_inline_fee:
        # The principal row's printed balance belongs to the separate fee row.
        return False
    if candidate.status != ParsedMessageCandidate.Status.NEEDS_REVIEW or candidate.transaction_id:
        return False
    if candidate.amount != row.amount or candidate.transaction_type != row.type:
        return False
    if sms_reporting_account(candidate) != row.batch.account:
        return False
    received = timezone.localtime(candidate.raw_message.received_at).date()
    if not any(abs((received - day).days) <= MATCH_DAYS for day in dates_for(row)):
        return False
    if row.type == Transaction.Type.TRANSFER:
        try:
            data, observation = sms_transfer_data(candidate)
        except ValidationError:
            return False
        return bool(
            data["account"]
            and data["transfer_account"]
            and data["account"].id != data["transfer_account"].id
            and observation["account"] == row.batch.account
            and observation["direction"] == row.direction
            and (
                not row.other_account_id
                or row.other_account_id
                == (data["account"].id if row.direction == "credit" else data["transfer_account"].id)
            )
        )
    return (
        candidate.account_id == row.batch.account_id
        and row.direction == Transaction.default_direction_for_type(row.type)
        and not row.other_account_id
    )


def pending_sms_matches(row):
    if resolved(row) or posting_issues(row) or row.component != "principal":
        return []
    start = min(dates_for(row)) - timedelta(days=MATCH_DAYS)
    end = max(dates_for(row)) + timedelta(days=MATCH_DAYS + 1)
    candidates = (
        ParsedMessageCandidate.objects.filter(
            user_id=row.batch.user_id,
            status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
            transaction__isnull=True,
            amount=row.amount,
            transaction_type=row.type,
            **({"account_id": row.batch.account_id} if row.type != Transaction.Type.TRANSFER else {}),
            raw_message__received_at__date__gte=start,
            raw_message__received_at__date__lt=end,
        )
        .select_related("raw_message", "account", "destination_account", "payment_method", "category")
        .order_by("raw_message__received_at", "id")
    )
    if row.type == Transaction.Type.TRANSFER:
        candidates = candidates.filter(
            Q(account_id=row.batch.account_id) | Q(destination_account_id=row.batch.account_id)
        )
    # Bound matching work, but count only candidates from this account's
    # perspective. Unrelated messages must not hide a valid suggestion.
    eligible_candidates = []
    for index, candidate in enumerate(candidates.iterator(chunk_size=200)):
        if index >= 10000:
            return None
        if _eligible(row, candidate):
            eligible_candidates.append(candidate)
            if len(eligible_candidates) > 200:
                return None
    return [
        {
            "id": str(candidate.id),
            "date": timezone.localtime(candidate.raw_message.received_at).date().isoformat(),
            "time": timezone.localtime(candidate.raw_message.received_at).time().replace(microsecond=0).isoformat(),
            "sender": candidate.raw_message.sender,
            "sms_text": (
                candidate.raw_message.body
                if candidate.raw_message.status != RawMessage.Status.REDACTED
                and not candidate.raw_message.redacted_at
                and not candidate.raw_message.exclusion_reason
                else None
            ),
            "amount": str(candidate.amount),
            "type": candidate.transaction_type,
            "counterparty_text": candidate.counterparty_text,
            "balance_after": str(candidate.balance_after) if candidate.balance_after is not None else None,
            "reference": candidate.reference,
            "confidence": str(candidate.confidence),
            "detail_suggestions": detail_suggestions(row, SimpleNamespace(
                counterparty_text=candidate.counterparty_text or draft_merchant(row),
                reference=candidate.reference or row.reference,
                note=_sms_note(candidate, row),
                sender_account_identifier=candidate.sender_account_identifier,
                sender_card_identifier=candidate.sender_card_identifier,
                receiver_account_identifier=candidate.receiver_account_identifier,
                receiver_card_identifier=candidate.receiver_card_identifier,
            )),
        }
        for candidate in eligible_candidates
    ]


def pending_sms_match_counts(rows):
    """Find list-level suggestions in one bounded query, without sending SMS text."""
    rows = list(rows)
    counts = {row.id: 0 for row in rows}
    eligible = [
        row for row in rows
        if not resolved(row) and row.component == "principal" and not posting_issues(row)
    ]
    if not eligible:
        return counts
    fee_positions = {
        (row.batch_id, row.position) for row in rows if row.component == "fee"
    }
    for row in eligible:
        row._has_inline_fee = (row.batch_id, row.position) in fee_positions
    eligible = [row for row in eligible if not row._has_inline_fee]
    if not eligible:
        return counts
    days = [day for row in eligible for day in dates_for(row)]
    candidates = list(
        ParsedMessageCandidate.objects.filter(
            user_id=eligible[0].batch.user_id,
            status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
            transaction__isnull=True,
            amount__in={row.amount for row in eligible},
            transaction_type__in={row.type for row in eligible},
            raw_message__received_at__date__gte=min(days) - timedelta(days=MATCH_DAYS + 1),
            raw_message__received_at__date__lte=max(days) + timedelta(days=MATCH_DAYS + 1),
        )
        .select_related("raw_message", "account", "destination_account", "payment_method")
        .order_by("id")[:10001]
    )
    if len(candidates) > 10000:
        # Do not label unchecked rows as statement-only or make them bulk eligible.
        return {**counts, **{row.id: None for row in eligible}}
    by_day = defaultdict(list)
    for candidate in candidates:
        key = (
            candidate.amount,
            candidate.transaction_type,
            timezone.localtime(candidate.raw_message.received_at).date(),
        )
        by_day[key].append(candidate)
    for row in eligible:
        possible = {}
        for date in dates_for(row):
            for offset in range(-MATCH_DAYS, MATCH_DAYS + 1):
                for candidate in by_day[(row.amount, row.type, date + timedelta(days=offset))]:
                    possible[candidate.id] = candidate
        matching_count = sum(_eligible(row, candidate) for candidate in possible.values())
        counts[row.id] = matching_count if matching_count <= 200 else None
    return counts


def _sms_note(candidate, row):
    return (
        f"{candidate.get_message_kind_display()} · {candidate.counterparty_text}"
        if candidate.counterparty_text else row.note or candidate.get_message_kind_display()
    )


def combine_pending_sms(*, row, user, payload, request):
    """Called under the statement decision transaction and user lock."""
    from .services import decide_locked

    if resolved(row) or row.version != payload["version"]:
        raise ReviewConflict()
    candidate = (
        ParsedMessageCandidate.objects.select_related(
            "raw_message", "account", "destination_account", "payment_method", "category"
        )
        .select_for_update(of=("self",))
        .filter(user=user, pk=payload["candidate"])
        .first()
    )
    if not candidate or not _eligible(row, candidate) or sms_recorded_elsewhere(candidate):
        raise ReviewConflict("The SMS or statement changed. Reload both reviews before combining them.")
    matches, truncated = find_matches([row])
    if truncated:
        raise ValidationError({"row": "Too much ledger history to verify this movement safely. Review a shorter statement period."})
    visible_ids = {item["id"] for item in matches[row.id]}
    dismissed_ids = {str(item) for item in payload.get("dismissed_ledger_matches", [])}
    if visible_ids != dismissed_ids:
        raise ReviewConflict("Ledger suggestions changed. Reload and compare every suggested movement before combining.")
    if visible_ids and not payload.get("acknowledge_distinct_ledger_matches"):
        raise ValidationError({"acknowledge_distinct_ledger_matches": "Confirm that every suggested ledger entry is a different movement."})
    if row.type == Transaction.Type.TRANSFER:
        data, observation = sms_transfer_data(candidate)
        account = data["account"]
        transfer_account = data["transfer_account"]
        direction = Transaction.Direction.DEBIT
        reported_balance = observation["balance_after"]
    else:
        observation = None
        account = row.batch.account
        transfer_account = None
        direction = row.direction
        reported_balance = candidate.balance_after
    if (
        not account.is_active or account.user_id != user.id
        or (transfer_account and (not transfer_account.is_active or transfer_account.user_id != user.id))
    ):
        raise ValidationError({"account": "The SMS account is inactive. Review the account before combining."})
    if transfer_account and transfer_account.currency != row.batch.currency:
        raise ValidationError({"account": "Transfer accounts must use the statement currency."})
    choice = payload.get("balance_choice")
    conflict = reported_balance is not None and row.balance_after is not None and reported_balance != row.balance_after
    if conflict and not choice:
        raise ValidationError({"balance_choice": "The SMS and statement balances differ. Choose which reported balance to keep."})
    if choice and (choice["existing_balance_after"] != reported_balance or choice["statement_balance_after"] != row.balance_after):
        raise ReviewConflict("Reported balances changed. Reload and choose again.")
    if choice and choice["keep"] == "statement" and row.balance_after is None:
        raise ValidationError({"balance_choice": "The statement has no balance to use."})
    received = timezone.localtime(candidate.raw_message.received_at)
    record = Transaction.objects.create(
        user=user, account=account, transfer_account=transfer_account,
        category=candidate.category or row.category,
        payment_method=candidate.payment_method if candidate.payment_method and candidate.payment_method.account_id == account.id else None,
        raw_message=candidate.raw_message, date=received.date(),
        time=received.time().replace(tzinfo=None, microsecond=0),
        type=row.type, direction=direction, amount=candidate.amount,
        balance_after=reported_balance if reported_balance is not None else row.balance_after,
        reference=candidate.reference or row.reference,
        counterparty_text=candidate.counterparty_text or draft_merchant(row),
        note=_sms_note(candidate, row),
        sender_account_identifier=candidate.sender_account_identifier,
        sender_card_identifier=candidate.sender_card_identifier,
        receiver_account_identifier=candidate.receiver_account_identifier,
        receiver_card_identifier=candidate.receiver_card_identifier,
        external_key=sms_external_key(candidate), source=Transaction.Source.SMS,
        needs_review=False,
    )
    if observation:
        add_transfer_evidence(record, observation, candidate)
    create_audit_log(user=user, action=AuditLogEntry.Action.CREATED, entity=record,
                     after=transaction_snapshot(record),
                     metadata={"candidate": str(candidate.id), "statement_row": str(row.id)})
    link_payload = {
        **payload, "action": "link", "transaction": record,
        "balance_choice": {
            "keep": choice["keep"] if choice else "existing",
            "existing_balance_after": reported_balance if reported_balance is not None else row.balance_after,
            "statement_balance_after": row.balance_after,
        },
    }
    # The existing link engine rechecks eligibility, statement-wide ambiguity,
    # discrepancy acknowledgement and transfer evidence within this transaction.
    linked, _ = decide_locked(row=row, user=user, payload=link_payload, request=request)
    candidate.transaction = record
    candidate.status = ParsedMessageCandidate.Status.CONFIRMED
    candidate.save(update_fields=("transaction", "status", "updated_at"))
    preference, _ = SmsCapturePreference.objects.get_or_create(user=user)
    if preference.raw_sms_retention_days == 0:
        candidate.raw_message.redact(reason=RawMessage.RedactionReason.RETENTION)
    return linked
