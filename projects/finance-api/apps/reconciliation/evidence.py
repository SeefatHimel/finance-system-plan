"""Shared evidence identity and reporting policy; never another ledger."""

from rest_framework.exceptions import ValidationError

from apps.messages.models import RawMessage, SmsCapturePreference
from apps.transactions.balance_reports import can_fill_missing_transfer_balance


def identity_issues(
    *, record, user_id, account, currency, amount, direction, other_id=None
):
    incoming = record.type == "transfer" and record.transfer_account_id == account.pk
    counterpart = record.account_id if incoming else record.transfer_account_id
    if (
        record.user_id != user_id
        or account.user_id != user_id
        or record.account.user_id != user_id
        or record.amount != amount
        or ("credit" if incoming else record.direction) != direction
        or record.account.currency != currency
        or account.currency != currency
        or not (record.account_id == account.pk or incoming)
        or (
            record.type == "transfer"
            and (
                not record.transfer_account_id
                or record.transfer_account.user_id != user_id
                or record.transfer_account.currency != currency
            )
        )
        or (other_id and (record.type != "transfer" or counterpart != other_id))
    ):
        return [
            "Amount, direction, currency or account path differs from the ledger entry."
        ]
    return []


def missing_report_choice(
    record, account_id, incoming, choice="existing", *, excluded=()
):
    """Only fill captured missing reports; never replace a reviewed value/clear."""
    if not can_fill_missing_transfer_balance(record, account_id):
        if choice != "existing":
            raise ValidationError(
                {
                    "balance_source": "Keep the saved balance; replacing it requires a separate transaction correction."
                }
            )
        return None
    if choice == "existing":
        values = {value for value in incoming.values() if value is not None}
        if len(values) > 1:
            raise ValidationError(
                {
                    "balance_source": "Incoming reports differ. Choose SMS or statement explicitly."
                }
            )
        choice = next(
            (
                kind
                for kind, value in incoming.items()
                if value is not None and kind not in excluded
            ),
            None,
        )
    if choice is None:
        return None
    if choice in excluded or incoming.get(choice) is None:
        raise ValidationError(
            {
                "balance_source": "That source has no usable balance for this movement. Review fees separately."
            }
        )
    return choice


def finish_sms_link(candidate, record):
    """One canonical candidate link; preserve originals and retention on every route."""
    if candidate.transaction_id and candidate.transaction_id != record.pk:
        raise ValidationError(
            {"sms": "This SMS is already attached to another transaction."}
        )
    if candidate.status == "confirmed" and candidate.transaction_id == record.pk:
        return
    if candidate.status != "needs_review":
        raise ValidationError({"sms": "Only a pending SMS can be attached."})
    candidate.transaction = record
    candidate.status = "confirmed"
    candidate.save(update_fields=("transaction", "status", "updated_at"))
    preference = SmsCapturePreference.objects.filter(user=candidate.user).first()
    if preference and preference.raw_sms_retention_days == 0:
        candidate.raw_message.redact(reason=RawMessage.RedactionReason.RETENTION)


def prefetch_source_observations(queryset):
    """Bounded match queries share canonical evidence without per-record lookups."""
    from django.db.models import Prefetch

    from apps.messages.models import ParsedMessageCandidate
    from apps.statements.models import StatementRow

    return queryset.prefetch_related(
        Prefetch(
            "parsed_message_candidates",
            queryset=ParsedMessageCandidate.objects.select_related(
                "account", "destination_account", "raw_message"
            ),
        ),
        Prefetch(
            "statement_rows",
            queryset=StatementRow.objects.select_related("batch__account"),
        ),
    )


def ordinary_observations(record, account_id):
    """Read-only originals survive a retained/cleared effective ledger report."""
    from types import SimpleNamespace

    from apps.statements.unified import sms_observation

    observations = [record] if record.account_id == account_id else []
    for candidate in record.parsed_message_candidates.all():
        account, direction, received = sms_observation(candidate)
        if candidate.status != "confirmed" or not account or account.pk != account_id:
            continue
        if identity_issues(
            record=record,
            user_id=candidate.user_id,
            account=account,
            currency=account.currency,
            amount=candidate.amount,
            direction=direction,
        ):
            continue
        observations.append(
            SimpleNamespace(
                id=candidate.pk,
                date=received.date(),
                time=received.time().replace(tzinfo=None),
                balance_after=candidate.balance_after,
                reference=candidate.reference,
                note=candidate.counterparty_text,
                source="sms",
            )
        )
    for row in record.statement_rows.all():
        if (
            row.batch.account_id != account_id
            or row.state not in {"posted", "linked"}
            or not row.date
        ):
            continue
        if identity_issues(
            record=record,
            user_id=row.batch.user_id,
            account=row.batch.account,
            currency=row.batch.currency,
            amount=row.amount,
            direction=row.direction,
        ):
            continue
        observations.append(
            SimpleNamespace(
                id=row.pk,
                date=row.date,
                time=row.time,
                balance_after=row.balance_after,
                reference=row.reference,
                note=row.note,
                source="import",
            )
        )
    return observations
