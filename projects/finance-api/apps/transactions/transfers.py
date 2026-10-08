"""Review-assisted transfer matching. Observations never move money themselves."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import (
    ParsedMessageCandidate,
    SenderRuleMapping,
    SmsCapturePreference,
)

from .models import Transaction, TransferEvidence

MATCH_DAYS = 3  # A suggestion window, never proof that two movements are identical.
INCOMING_KINDS = {"cash_in", "receive_money", "bank_transfer_in"}


def lock_transfer_user(user):
    # Serialize transfer writers for one user, including when no target exists yet.
    get_user_model().objects.select_for_update().get(pk=user.pk)


def manual_transfer_data(data):
    data = dict(data)
    observation = dict(data)
    if data.get("type") != Transaction.Type.TRANSFER:
        raise ValidationError({"type": "Only transfers can be matched."})
    if data.get("direction") == Transaction.Direction.CREDIT:
        data["account"], data["transfer_account"] = (
            data["transfer_account"],
            data["account"],
        )
        data["payment_method"] = None
    data["direction"] = Transaction.Direction.DEBIT
    return data, observation


def sms_reporting_account(candidate):
    incoming = (candidate.suggested_transfer_direction == "credit" if candidate.suggested_transfer_direction
                else candidate.message_kind in INCOMING_KINDS)
    return (candidate.destination_account or candidate.account) if incoming else candidate.account


def sms_transfer_data(candidate, overrides=None):
    overrides = overrides or {}
    received = timezone.localtime(candidate.raw_message.received_at)
    source = overrides.get("account") or candidate.account
    destination = overrides.get("transfer_account", candidate.destination_account)
    incoming = (candidate.suggested_transfer_direction == "credit" if candidate.suggested_transfer_direction
                else candidate.message_kind in INCOMING_KINDS)
    # A receiving SMS with no known sender identifies the destination, not the source.
    if incoming and destination is None:
        source, destination = None, source
    observed_account = destination if incoming else source
    if overrides.get("account_perspective"):
        observed_account = overrides.get("account") or observed_account
        direction = overrides.get("direction") or ("credit" if incoming else "debit")
        other_account = overrides.get(
            "transfer_account",
            candidate.account
            if incoming and candidate.destination_account
            else candidate.destination_account,
        )
        source, destination = (
            (other_account, observed_account)
            if direction == "credit"
            else (observed_account, other_account)
        )
        selected_method = overrides.get("payment_method")
        if selected_method and (
            observed_account is None
            or selected_method.account_id != observed_account.id
        ):
            raise ValidationError(
                {
                    "payment_method": "Payment method must belong to the selected account."
                }
            )
    data = {
        "account": source,
        "transfer_account": destination,
        "amount": overrides.get("amount") or candidate.amount,
        "date": overrides.get("date") or received.date(),
        "time": overrides.get(
            "time", received.time().replace(tzinfo=None, microsecond=0)
        ),
        "direction": Transaction.Direction.DEBIT,
        "type": Transaction.Type.TRANSFER,
        "balance_after": overrides.get("balance_after", candidate.balance_after),
        "reference": overrides.get("reference", candidate.reference),
        "counterparty_text": overrides.get(
            "counterparty_text", candidate.counterparty_text
        ),
        "note": overrides.get("note") or candidate.get_message_kind_display(),
        "source": Transaction.Source.SMS,
        "raw_message": candidate.raw_message,
        "payment_method": overrides.get("payment_method", candidate.payment_method),
        "category": overrides.get("category", candidate.category),
    }
    for field in (
        "sender_account_identifier",
        "sender_card_identifier",
        "receiver_account_identifier",
        "receiver_card_identifier",
    ):
        data[field] = overrides.get(field, getattr(candidate, field))
    if data["payment_method"] and (
        source is None or data["payment_method"].account_id != source.id
    ):
        data["payment_method"] = None
    observation = {
        **data,
        "account": observed_account,
        "direction": "credit" if observed_account == destination else "debit",
    }
    original_account = sms_reporting_account(candidate)
    if original_account and original_account != observed_account and (
        "balance_after" not in overrides or overrides["balance_after"] == candidate.balance_after
    ):
        data["balance_after"] = observation["balance_after"] = None
    if not data["amount"]:
        raise ValidationError(
            {"amount": "An amount is required to find a transfer match."}
        )
    if source is None and destination is None:
        raise ValidationError(
            {"account": "Choose an account before finding a transfer match."}
        )
    return data, observation


def prepare_transfer_input(*, user, payload, context):
    """Validate client corrections with the same serializers as ordinary entry."""
    from apps.messages.serializers import ParsedMessageConfirmSerializer

    from .serializers import TransactionSerializer

    candidate = None
    if payload.get("candidate"):
        candidate = get_object_or_404(
            ParsedMessageCandidate.objects.select_related(
                "raw_message",
                "account",
                "destination_account",
                "payment_method",
                "category",
                "sender_rule",
            ),
            user=user,
            pk=payload["candidate"],
        )
        serializer = ParsedMessageConfirmSerializer(
            data=payload.get("draft", {}), context=context
        )
        serializer.is_valid(raise_exception=True)
        data, observation = sms_transfer_data(candidate, serializer.validated_data)
        return data, observation, candidate, serializer.validated_data
    serializer = TransactionSerializer(data=payload.get("draft", {}), context=context)
    serializer.is_valid(raise_exception=True)
    data, observation = manual_transfer_data(serializer.validated_data)
    return data, observation, None, {}


def compatible(data, target):
    return (
        target.type == Transaction.Type.TRANSFER
        and target.transfer_account_id is not None
        and target.account_id != target.transfer_account_id
        and target.account.currency == target.transfer_account.currency
        and data["amount"] == target.amount
        and (data["account"] is None or data["account"].id == target.account_id)
        and (
            data["transfer_account"] is None
            or data["transfer_account"].id == target.transfer_account_id
        )
        and abs((data["date"] - target.date).days) <= MATCH_DAYS
    )


def match_summary(record, kind, reference=""):
    reason = "Same currency, compatible accounts and amount within three days. Verify this is the same movement."
    normalized_reference = reference.strip().casefold()
    references = [record.reference]
    if kind == "transaction":
        references.extend(item.reference for item in record.transfer_evidence.all())
    if normalized_reference and any(
        value.strip().casefold() == normalized_reference for value in references
    ):
        reason += " Reference also matches; references can be reused."
    return {
        "id": str(record.id),
        "kind": kind,
        "account": str(record.account_id),
        "account_name": record.account.name,
        "transfer_account": str(record.transfer_account_id),
        "transfer_account_name": record.transfer_account.name,
        "amount": f"{record.amount:.2f}",
        "date": record.date.isoformat(),
        "time": record.time.isoformat() if record.time else None,
        "reference": record.reference,
        "reason": reason,
    }


def find_transfer_matches(
    *, user, data, observation, candidate=None, exclude_transaction=None
):
    queryset = Transaction.objects.filter(
        user=user,
        type=Transaction.Type.TRANSFER,
        amount=data["amount"],
        date__range=(
            data["date"] - timedelta(days=MATCH_DAYS),
            data["date"] + timedelta(days=MATCH_DAYS),
        ),
    ).select_related("account", "transfer_account").prefetch_related("transfer_evidence")
    if data["account"]:
        queryset = queryset.filter(account=data["account"])
    if data["transfer_account"]:
        queryset = queryset.filter(transfer_account=data["transfer_account"])
    if exclude_transaction:
        queryset = queryset.exclude(pk=exclude_transaction)
    matches = [
        match_summary(item, "transaction", data.get("reference", ""))
        for item in queryset[:20]
        if compatible(data, item)
    ]
    # Pending SMS may supply the other side before either message has been posted.
    pending = ParsedMessageCandidate.objects.filter(
        user=user,
        status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
        amount=data["amount"],
        raw_message__received_at__date__range=(
            data["date"] - timedelta(days=MATCH_DAYS),
            data["date"] + timedelta(days=MATCH_DAYS),
        ),
    ).select_related(
        "raw_message", "account", "destination_account", "payment_method", "category"
    )
    if candidate:
        pending = pending.exclude(pk=candidate.pk)
    for item in pending[:100]:
        if not (
            item.possible_internal_transfer
            or item.transaction_type == "transfer"
            or item.message_kind in INCOMING_KINDS
        ):
            continue
        try:
            other, other_observation = sms_transfer_data(item)
        except ValidationError:
            continue
        source = data["account"] or other["account"]
        destination = data["transfer_account"] or other["transfer_account"]
        if not source or not destination or source.id == destination.id:
            continue
        if other["account"] and other["account"].id != source.id:
            continue
        if other["transfer_account"] and other["transfer_account"].id != destination.id:
            continue
        if observation.get("account") == other_observation.get("account"):
            continue
        synthetic = Transaction(
            id=item.id,
            type=Transaction.Type.TRANSFER,
            account=source,
            transfer_account=destination,
            amount=item.amount,
            date=other["date"],
            time=other["time"],
            reference=item.reference,
        )
        if compatible(data, synthetic):
            matches.append(
                match_summary(synthetic, "candidate", data.get("reference", ""))
            )
    return matches


def sms_external_key(candidate):
    # References are editable, optional evidence. The captured SMS is the identity.
    return f"raw-message:{candidate.raw_message_id}"


def sms_recorded_elsewhere(candidate, exclude_transaction=None):
    """Protect old reference-keyed records as well as new capture-keyed records."""
    records = Transaction.objects.filter(user_id=candidate.user_id).filter(
        Q(raw_message_id=candidate.raw_message_id)
        | Q(external_key=sms_external_key(candidate))
    )
    evidence = TransferEvidence.objects.filter(
        user_id=candidate.user_id, raw_message_id=candidate.raw_message_id
    )
    if exclude_transaction:
        records = records.exclude(pk=exclude_transaction.pk)
        evidence = evidence.exclude(transaction=exclude_transaction)
    return records.exists() or evidence.exists()


def add_transfer_evidence(record, observation, candidate=None):
    account = observation.get("account")
    if account is None or account.id not in {
        record.account_id,
        record.transfer_account_id,
    }:
        raise ValidationError(
            {"account": "The evidence account must be one side of this transfer."}
        )
    direction = "credit" if account.id == record.transfer_account_id else "debit"
    key = (
        sms_external_key(candidate)
        if candidate
        else observation.get("external_key", "")
    )
    if candidate:
        if sms_recorded_elsewhere(candidate, exclude_transaction=record):
            raise ValidationError(
                {
                    "candidate": "This SMS is already recorded in another transaction."
                }
            )
        existing = record.transfer_evidence.filter(
            raw_message=candidate.raw_message
        ).first()
        if existing:
            return existing
    if key:
        existing = TransferEvidence.objects.filter(
            user=record.user, external_key=key
        ).first()
        if existing:
            if existing.transaction_id == record.id:
                return existing
            raise ValidationError(
                {"detail": "This observation is already linked to another transfer."}
            )
        if (
            Transaction.objects.filter(user=record.user, external_key=key)
            .exclude(pk=record.id)
            .exists()
        ):
            raise ValidationError(
                {"detail": "A transaction with this observation key already exists."}
            )
    evidence = TransferEvidence.objects.create(
        user=record.user,
        transaction=record,
        account=account,
        direction=direction,
        raw_message=candidate.raw_message
        if candidate
        else observation.get("raw_message"),
        date=observation.get("date", record.date),
        time=observation.get("time"),
        balance_after=observation.get("balance_after"),
        fee_amount=candidate.fee_amount if candidate else None,
        reference=observation.get("reference", ""),
        provider=candidate.provider if candidate else "",
        external_key=key,
        source=observation.get("source", record.source),
        note=observation.get("note", ""),
    )
    # New evidence changes the ledger record; retries that reuse evidence do not.
    record.save(update_fields=("updated_at",))
    return evidence


def ensure_transfer_evidence(record):
    """Preserve observations for legacy/system transfers created outside the serializer."""
    if record.transfer_evidence.exists():
        return
    candidate = (
        record.parsed_message_candidates.filter(
            raw_message_id=record.raw_message_id
        ).first()
        if record.raw_message_id
        else None
    )
    account_id = (
        record.transfer_account_id
        if candidate and candidate.message_kind in INCOMING_KINDS
        else record.account_id
    )
    raw_id = record.raw_message_id
    if raw_id and TransferEvidence.objects.filter(raw_message_id=raw_id).exists():
        raw_id = None
    TransferEvidence.objects.create(
        user=record.user,
        transaction=record,
        account_id=account_id,
        raw_message_id=raw_id,
        direction="credit" if account_id == record.transfer_account_id else "debit",
        date=record.date,
        time=record.time,
        balance_after=record.balance_after,
        reference=record.reference,
        provider=candidate.provider if candidate else "",
        fee_amount=candidate.fee_amount if candidate else None,
        source=record.source,
        note=record.note,
    )


def attach_candidate(candidate, record, observation, remember=False):
    if candidate.status == ParsedMessageCandidate.Status.CONFIRMED:
        if candidate.transaction_id == record.id:
            return
        raise ValidationError(
            {
                "candidate": "This message is already confirmed against another transaction."
            }
        )
    if candidate.status != ParsedMessageCandidate.Status.NEEDS_REVIEW:
        raise ValidationError({"candidate": "Only pending messages can be linked."})
    add_transfer_evidence(record, observation, candidate)
    candidate.transaction = record
    candidate.status = ParsedMessageCandidate.Status.CONFIRMED
    candidate.save(update_fields=("transaction", "status", "updated_at"))
    if remember:
        from apps.messages.transfer_suggestions import remember_transfer_path
        remember_transfer_path(candidate, record, observation)
    if remember and candidate.sender_rule and not candidate.counterparty_text:
        SenderRuleMapping.objects.update_or_create(
            sender_rule=candidate.sender_rule,
            message_kind=candidate.message_kind,
            defaults={
                "user": record.user,
                "account": record.account,
                "payment_method": record.payment_method,
                "category": record.category,
                "transaction_type": "transfer",
            },
        )
    preference, _ = SmsCapturePreference.objects.get_or_create(user=record.user)
    if preference.raw_sms_retention_days == 0:
        candidate.raw_message.redact()


@transaction.atomic
def link_transfer(*, user, payload, context):
    lock_transfer_user(user)
    data, observation, candidate, corrections = prepare_transfer_input(
        user=user, payload=payload, context=context
    )
    if payload.get("match_transaction"):
        record = get_object_or_404(
            Transaction.objects.select_for_update(),
            user=user,
            pk=payload["match_transaction"],
        )
        if not compatible(data, record):
            raise ValidationError(
                {
                    "match_transaction": "Accounts, currency, amount, or date no longer match this transfer."
                }
            )
        before = transaction_snapshot(record)
        ensure_transfer_evidence(record)
    else:
        target = get_object_or_404(
            ParsedMessageCandidate.objects.select_for_update(
                of=("self",)
            ).select_related(
                "raw_message",
                "account",
                "destination_account",
                "payment_method",
                "category",
            ),
            user=user,
            pk=payload["match_candidate"],
        )
        if candidate and target.id == candidate.id:
            raise ValidationError({"match_candidate": "Choose a different message."})
        other, other_observation = sms_transfer_data(target)
        source = other["account"] or data["account"]
        destination = other["transfer_account"] or data["transfer_account"]
        if not source or not destination or source.id == destination.id:
            raise ValidationError(
                {"match_candidate": "Both transfer accounts must be known."}
            )
        other.update(account=source, transfer_account=destination)
        proposed = Transaction(**other)
        if not compatible(data, proposed) or observation.get(
            "account"
        ) == other_observation.get("account"):
            raise ValidationError(
                {
                    "match_candidate": "These messages do not describe opposite sides of the same transfer."
                }
            )
        if (
            target.status == ParsedMessageCandidate.Status.CONFIRMED
            and target.transaction_id
        ):
            record = get_object_or_404(
                Transaction.objects.select_for_update(),
                user=user,
                pk=target.transaction_id,
            )
            if not compatible(data, record):
                raise ValidationError(
                    {"match_candidate": "The confirmed transfer no longer matches."}
                )
            before = transaction_snapshot(record)
        elif target.status == ParsedMessageCandidate.Status.NEEDS_REVIEW:
            before = None
            other["external_key"] = sms_external_key(target)
            if sms_recorded_elsewhere(target):
                raise ValidationError(
                    {
                        "match_candidate": "This SMS is already recorded. Refresh matches."
                    }
                )
            record = Transaction.objects.create(user=user, **other)
            attach_candidate(target, record, other_observation)
        else:
            raise ValidationError(
                {"match_candidate": "This message is no longer pending."}
            )
    if candidate:
        attach_candidate(
            candidate, record, observation, corrections.get("remember_mapping", False)
        )
    else:
        add_transfer_evidence(record, observation)
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED if before else AuditLogEntry.Action.CREATED,
        entity=record,
        before=before,
        after=transaction_snapshot(record),
        metadata={
            "transfer_link": True,
            "candidate": str(candidate.id) if candidate else None,
        },
    )
    return record


@transaction.atomic
def merge_transfers(*, user, record_id, other_id):
    lock_transfer_user(user)
    record = get_object_or_404(
        Transaction.objects.select_for_update(), user=user, pk=record_id
    )
    other = get_object_or_404(
        Transaction.objects.select_for_update(), user=user, pk=other_id
    )
    if other.type != Transaction.Type.TRANSFER:
        raise ValidationError({"transaction": "Only a posted transfer can be merged."})
    if record.id == other.id:
        raise ValidationError({"transaction": "Choose a different transfer to merge."})
    if not compatible(
        {
            "account": other.account,
            "transfer_account": other.transfer_account,
            "amount": other.amount,
            "date": other.date,
        },
        record,
    ):
        raise ValidationError(
            {
                "transaction": "Only matching transfers in the same direction can be merged."
            }
        )
    before = transaction_snapshot(record)
    ensure_transfer_evidence(record)
    ensure_transfer_evidence(other)
    other_before = transaction_snapshot(other)
    # Backfilled evidence carries both original references and balances after the merge.
    other.transfer_evidence.update(transaction=record)
    other.parsed_message_candidates.update(transaction=record)
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.DELETED,
        entity=other,
        before=other_before,
        metadata={"merged_into": str(record.id)},
    )
    other.delete()
    record.save(update_fields=("updated_at",))
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=record,
        before=before,
        after=transaction_snapshot(record),
        metadata={"merged_transfer": str(other_id)},
    )
    return record
