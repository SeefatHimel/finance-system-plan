from django.db.models import Model
from django.utils import timezone

from .models import AuditLogEntry


def transaction_snapshot(transaction) -> dict[str, object]:
    return {
        "id": str(transaction.id),
        "account": str(transaction.account_id),
        "transfer_account": str(transaction.transfer_account_id)
        if transaction.transfer_account_id
        else None,
        "category": str(transaction.category_id) if transaction.category_id else None,
        "payment_method": str(transaction.payment_method_id)
        if transaction.payment_method_id
        else None,
        "raw_message": str(transaction.raw_message_id)
        if transaction.raw_message_id
        else None,
        "date": transaction.date.isoformat(),
        "time": transaction.time.isoformat() if transaction.time else None,
        "type": transaction.type,
        "direction": transaction.direction,
        "amount": str(transaction.amount),
        "balance_after": str(transaction.balance_after)
        if transaction.balance_after is not None
        else None,
        "sender_account_identifier": transaction.sender_account_identifier,
        "sender_card_identifier": transaction.sender_card_identifier,
        "receiver_account_identifier": transaction.receiver_account_identifier,
        "receiver_card_identifier": transaction.receiver_card_identifier,
        "reference": transaction.reference,
        "counterparty_text": transaction.counterparty_text,
        "external_key": transaction.external_key,
        "note": transaction.note,
        "source": transaction.source,
        "needs_review": transaction.needs_review,
        "transfer_evidence": [
            {
                "id": str(item.id),
                "account": str(item.account_id),
                "raw_message": str(item.raw_message_id)
                if item.raw_message_id
                else None,
                "direction": item.direction,
                "date": item.date.isoformat(),
                "time": item.time.isoformat() if item.time else None,
                "reference": item.reference,
                "provider": item.provider,
                "balance_after": str(item.balance_after)
                if item.balance_after is not None
                else None,
                "fee_amount": str(item.fee_amount)
                if item.fee_amount is not None
                else None,
            }
            for item in transaction.transfer_evidence.all()
        ],
    }


def create_audit_log(
    *,
    user,
    action: str,
    entity: Model,
    before: dict[str, object] | None = None,
    after: dict[str, object] | None = None,
    metadata: dict[str, object] | None = None,
) -> AuditLogEntry:
    return AuditLogEntry.objects.create(
        user=user,
        action=action,
        entity_type=entity._meta.label_lower,
        entity_id=str(entity.pk),
        before=before,
        after=after,
        metadata={
            "recorded_at": timezone.now().isoformat(),
            **(metadata or {}),
        },
    )
