"""Account-bound transfer balances; observations never move money."""

from rest_framework.exceptions import ValidationError

from .models import Transaction, TransferEvidence


def primary_transfer_evidence(record, items):
    if record.raw_message_id:
        return next(
            (item for item in items if item.raw_message_id == record.raw_message_id),
            None,
        )
    if record.external_key:
        primary = next(
            (item for item in items if item.external_key == record.external_key), None
        )
        if primary:
            return primary
    return next(
        (item for item in items if not item.external_key.startswith("balance:")), None
    )


def account_reports(record, items=None):
    items = list(record.transfer_evidence.all()) if items is None else items
    primary = primary_transfer_evidence(record, items)
    chosen = {item.account_id: item for item in items}
    if primary:
        chosen[primary.account_id] = primary
    return chosen, primary


def write_account_reports(record, reports):
    chosen, primary = account_reports(record)
    for report in reports:
        account = report["account"]
        item = chosen.get(account.pk)
        if item:
            item.balance_after = report["balance_after"]
            item.save(update_fields=("balance_after",))
        elif report["balance_after"] is not None:
            item = TransferEvidence.objects.create(
                user=record.user,
                transaction=record,
                account=account,
                direction="credit"
                if account.pk == record.transfer_account_id
                else "debit",
                date=record.date,
                time=record.time,
                balance_after=report["balance_after"],
                external_key=f"balance:{record.pk}:{account.pk}",
                source=Transaction.Source.WEB,
                note="Manually reported balance",
            )
        if primary and item and primary.pk == item.pk:
            record.balance_after = item.balance_after
            record.save(update_fields=("balance_after",))
    getattr(record, "_prefetched_objects_cache", {}).pop("transfer_evidence", None)


def reported_values(record):
    """Effective balances keyed by their actual reporting account."""
    chosen, primary = account_reports(record)
    result = {account_id: item.balance_after for account_id, item in chosen.items()}
    if not primary and record.balance_after is not None:
        result.setdefault(record.account_id, record.balance_after)
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
