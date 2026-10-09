"""Read-only validation of the financial identity of accepted PDF evidence."""


def accepted_link_issues(row, record=None):
    if record is None and not row.transaction_id:
        return []
    record = record or row.transaction
    batch = row.batch
    incoming = (
        record.type == "transfer" and record.transfer_account_id == batch.account_id
    )
    perspective = "credit" if incoming else record.direction
    counterpart = record.account_id if incoming else record.transfer_account_id
    compatible = (
        record.user_id == batch.user_id
        and record.amount == row.amount
        and perspective == row.direction
        and record.account.currency == batch.currency
        and batch.account.currency == batch.currency
        and (record.account_id == batch.account_id or incoming)
        and (
            record.type != "transfer"
            or (
                record.transfer_account is not None
                and record.transfer_account.currency == batch.currency
            )
        )
        and (
            not row.other_account_id
            or (record.type == "transfer" and counterpart == row.other_account_id)
        )
    )
    if compatible:
        return []
    return [
        "The linked ledger entry no longer agrees with this statement's amount, direction, currency or account path. Unlink its evidence and review the match again; the ledger entry will be kept."
    ]
