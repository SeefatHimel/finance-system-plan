"""Account-bound transfer balances; observations never move money."""

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
