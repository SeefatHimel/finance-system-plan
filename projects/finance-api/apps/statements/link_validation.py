"""Read-only validation of the financial identity of accepted PDF evidence."""


def accepted_link_issues(row, record=None):
    if record is None and not row.transaction_id:
        return []
    record = record or row.transaction
    batch = row.batch
    from apps.reconciliation.evidence import identity_issues

    compatible = not identity_issues(
        record=record,
        user_id=batch.user_id,
        account=batch.account,
        currency=batch.currency,
        amount=row.amount,
        direction=row.direction,
        other_id=row.other_account_id,
    )
    if compatible:
        return []
    return [
        "The linked ledger entry no longer agrees with this statement's amount, direction, currency or account path. Unlink its evidence and review the match again; the ledger entry will be kept."
    ]
