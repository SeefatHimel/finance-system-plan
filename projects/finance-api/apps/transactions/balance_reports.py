"""Account-bound transfer balances; observations never move money."""

from rest_framework.exceptions import ValidationError

from .models import Transaction, TransferEvidence


def legacy_report_account_id(record):
    """Attribute a pre-evidence scalar to its captured SMS side, not its sender.

    Transfer.account is always the sending account, even when the transaction
    was originally created from the receiving account's credit notification.
    Read the same saved interpretation during previews and materialization.
    Unknown/obsolete interpretations must not lend a balance to either side.
    """
    if record.type != Transaction.Type.TRANSFER:
        return record.account_id
    if record.raw_message_id:
        from .transfers import INCOMING_KINDS

        candidate = next((
            item for item in record.parsed_message_candidates.all()
            if item.raw_message_id == record.raw_message_id
            and item.user_id == record.user_id and item.status == "confirmed"
        ), None)
        if candidate:
            incoming = (
                candidate.suggested_transfer_direction == "credit"
                if candidate.suggested_transfer_direction
                else candidate.message_kind in INCOMING_KINDS
            )
            account_id = (
                candidate.destination_account_id or candidate.account_id
                if incoming else candidate.account_id
            )
            if account_id and account_id not in {record.account_id, record.transfer_account_id}:
                return None
            direction = candidate.source_direction or candidate.suggested_transfer_direction
            if not direction and candidate.message_kind in INCOMING_KINDS:
                direction = "credit"
            if direction in {"credit", "debit"}:
                return record.transfer_account_id if direction == "credit" else record.account_id
            return account_id
        if record.source == Transaction.Source.SMS:
            return None
    return record.account_id


def applies_to_transfer(record, item):
    """Only current-path observations can supply an account's reported balance."""
    if record.type != Transaction.Type.TRANSFER:
        return True  # Retain provenance while a transfer is reclassified.
    if item.account_id == record.account_id:
        return not is_captured_report(item) or item.direction == Transaction.Direction.DEBIT
    if item.account_id == record.transfer_account_id:
        return not is_captured_report(item) or item.direction == Transaction.Direction.CREDIT
    return False


def primary_transfer_evidence(record, items):
    items = [item for item in items if applies_to_transfer(record, item)]
    primary = None
    if record.raw_message_id:
        primary = next(
            (item for item in items if item.raw_message_id == record.raw_message_id),
            None,
        )
    if not primary and record.external_key:
        primary = next(
            (item for item in items if item.external_key == record.external_key), None
        )
    if not primary:
        # Attachment order, not event timestamps, identifies the original report.
        # A later-linked source can have an earlier printed/received timestamp.
        primary = min(
            (item for item in items if not item.external_key.startswith("balance:")),
            key=lambda item: (item.created_at, str(item.pk)),
            default=None,
        )
    # The captured sources keep their original balances. A reviewed choice can
    # select which observation supplies the effective report for this account.
    return next(
        (
            item
            for item in items
            if item.is_effective_balance
            and (not primary or item.account_id == primary.account_id)
        ),
        primary,
    )


def account_reports(record, items=None):
    items = list(record.transfer_evidence.all()) if items is None else items
    items = [item for item in items if applies_to_transfer(record, item)]
    primary = primary_transfer_evidence(record, items)
    chosen = {item.account_id: item for item in items}
    if primary:
        chosen[primary.account_id] = primary
    for item in items:
        if item.is_effective_balance:
            chosen[item.account_id] = item
    return chosen, primary


def can_fill_missing_transfer_balance(record, account_id):
    """Only absent/unreported capture evidence is eligible for link-time enrichment.

    Effective nulls and non-captured nulls may be reviewed clears. Preserve them,
    including legacy choices whose original intent cannot be reconstructed.
    """
    if record.type != Transaction.Type.TRANSFER or account_id not in {
        record.account_id,
        record.transfer_account_id,
    }:
        return False
    items = list(record.transfer_evidence.all())
    if has_unattributed_legacy_balance(record, items):
        return False
    reports = [
        item
        for item in items
        if item.account_id == account_id and applies_to_transfer(record, item)
    ]
    if not reports:
        legacy_account = legacy_report_account_id(record)
        return account_id != legacy_account or (
            record.balance_after is None
            and record.source in {Transaction.Source.SMS, Transaction.Source.IMPORT}
        )
    return all(
        item.balance_after is None
        and not item.is_effective_balance
        and is_captured_report(item)
        for item in reports
    )


def has_unattributed_legacy_balance(record, items=None):
    """A scalar report cannot identify a new owner after all evidence is obsolete."""
    if record.type != Transaction.Type.TRANSFER or record.balance_after is None:
        return False
    items = list(record.transfer_evidence.all()) if items is None else items
    return (
        primary_transfer_evidence(record, items) is None if items
        else legacy_report_account_id(record) is None
    )


def select_effective_account_report(record, item):
    """Choose one preserved observation for an account without changing its value."""
    if item.transaction_id != record.pk or item.account_id not in {
        record.account_id, record.transfer_account_id
    } or not applies_to_transfer(record, item):
        raise ValidationError({"balance_after": "Choose evidence from this transfer account."})
    record.transfer_evidence.filter(
        account_id=item.account_id, is_effective_balance=True
    ).exclude(pk=item.pk).update(is_effective_balance=False)
    if not item.is_effective_balance:
        item.is_effective_balance = True
        item.save(update_fields=("is_effective_balance",))
    getattr(record, "_prefetched_objects_cache", {}).pop("transfer_evidence", None)


def reviewed_account_report(record, account, balance_after):
    """Keep a reviewed ledger choice separate from captured source evidence."""
    if account.pk not in {record.account_id, record.transfer_account_id}:
        raise ValidationError({"balance_after": "Choose an account in this transfer."})
    key = f"balance:{record.pk}:{account.pk}"
    item, _ = TransferEvidence.objects.get_or_create(
        user=record.user,
        external_key=key,
        defaults={
            "transaction": record,
            "account": account,
            "direction": "credit" if account.pk == record.transfer_account_id else "debit",
            "date": record.date,
            "time": record.time,
            "balance_after": balance_after,
            "source": Transaction.Source.WEB,
            "note": "Reviewed reported balance",
        },
    )
    if item.transaction_id != record.pk or item.account_id != account.pk:
        raise ValidationError({"balance_after": "This report belongs to another transfer."})
    if item.balance_after != balance_after:
        item.balance_after = balance_after
        item.save(update_fields=("balance_after",))
    return item


def is_captured_report(item):
    return (
        bool(item.raw_message_id)
        or item.source in {Transaction.Source.SMS, Transaction.Source.IMPORT}
        or item.external_key.startswith("statement-row:")
    )


def write_account_reports(record, reports):
    chosen, _ = account_reports(record)
    for report in reports:
        account = report["account"]
        item = chosen.get(account.pk)
        if item:
            if item.balance_after != report["balance_after"]:
                if is_captured_report(item):
                    item = reviewed_account_report(record, account, report["balance_after"])
                    select_effective_account_report(record, item)
                else:
                    item.balance_after = report["balance_after"]
                    item.save(update_fields=("balance_after",))
        elif report["balance_after"] is not None:
            item = reviewed_account_report(record, account, report["balance_after"])
            select_effective_account_report(record, item)
    getattr(record, "_prefetched_objects_cache", {}).pop("transfer_evidence", None)
    _, primary = account_reports(record)
    if primary and record.balance_after != primary.balance_after:
        record.balance_after = primary.balance_after
        record.save(update_fields=("balance_after",))


def reported_values(record):
    """Effective balances keyed by their actual reporting account."""
    chosen, primary = account_reports(record)
    result = {account_id: item.balance_after for account_id, item in chosen.items()}
    if not primary and record.balance_after is not None and not has_unattributed_legacy_balance(record):
        result.setdefault(legacy_report_account_id(record), record.balance_after)
    return result


def resolve_reported_values(record, incoming, choices):
    """Require an explicit, current choice for each same-account disagreement."""
    existing = reported_values(record)
    decisions = {item["account"]: item for item in choices}
    if len(decisions) != len(choices):
        raise ValidationError({"balance_choices": "Choose each account only once."})
    conflicts = {
        account_id
        for account_id, value in incoming.items()
        if value is not None
        and existing.get(account_id) is not None
        and value != existing[account_id]
    }
    if set(decisions) != conflicts:
        raise ValidationError(
            {
                "balance_choices": "Reported balances disagree for the same account. Review the balances and choose which report to keep for each conflict."
            }
        )
    resolved = {key: value for key, value in existing.items() if value is not None}
    for account_id, value in incoming.items():
        if account_id in conflicts:
            decision = decisions[account_id]
            if (
                decision["existing_balance_after"] != existing[account_id]
                or decision["incoming_balance_after"] != value
            ):
                raise ValidationError(
                    {
                        "balance_choices": "Reported balances changed since you reviewed them. Refresh the matches and choose again."
                    }
                )
            resolved[account_id] = (
                existing[account_id] if decision["keep"] == "existing" else value
            )
        elif value is not None:
            resolved[account_id] = value
    return [
        {"account": account, "balance_after": resolved[account.pk]}
        for account in (record.account, record.transfer_account)
        if account.pk in resolved
    ]
