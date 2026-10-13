"""Explicit, one-step review of a pending SMS and a pending statement row."""

from datetime import timedelta
from types import SimpleNamespace

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
    candidates = list(
        ParsedMessageCandidate.objects.filter(
            user_id=row.batch.user_id,
            status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
            transaction__isnull=True,
            amount=row.amount,
            transaction_type=row.type,
            raw_message__received_at__date__gte=start,
            raw_message__received_at__date__lt=end,
        )
        .select_related("raw_message", "account", "destination_account", "payment_method", "category")
        .order_by("raw_message__received_at", "id")[:201]
    )
    # A busy window is unsafe to suggest from; ordinary review remains available.
    if len(candidates) > 200:
        return []
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
        for candidate in candidates if _eligible(row, candidate)
    ]


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
    if truncated or matches[row.id]:
        raise ValidationError({"row": "An existing ledger match may already represent this movement. Review that match before combining pending sources."})
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
        candidate.raw_message.redact()
    return linked
