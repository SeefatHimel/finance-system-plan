from django.db import migrations


def backfill(apps, schema_editor):
    Transaction = apps.get_model("transactions", "Transaction")
    Evidence = apps.get_model("transactions", "TransferEvidence")
    Candidate = apps.get_model("finance_messages", "ParsedMessageCandidate")
    incoming = {"cash_in", "receive_money", "bank_transfer_in"}
    for item in (
        Transaction.objects.using(schema_editor.connection.alias)
        .filter(type="transfer")
        .iterator()
    ):
        candidate = (
            Candidate.objects.using(schema_editor.connection.alias)
            .filter(transaction_id=item.pk, raw_message_id=item.raw_message_id)
            .first()
            if item.raw_message_id
            else None
        )
        account_id = (
            item.transfer_account_id
            if candidate and candidate.message_kind in incoming
            else item.account_id
        )
        evidence = Evidence.objects.using(schema_editor.connection.alias).create(
            user_id=item.user_id,
            transaction_id=item.pk,
            account_id=account_id,
            raw_message_id=item.raw_message_id
            if not Evidence.objects.using(schema_editor.connection.alias)
            .filter(raw_message_id=item.raw_message_id)
            .exists()
            else None,
            direction="credit" if account_id == item.transfer_account_id else "debit",
            date=item.date,
            time=item.time,
            balance_after=item.balance_after,
            reference=item.reference,
            provider=candidate.provider if candidate else "",
            source=item.source,
            note=item.note,
            # Old versions did not enforce reference uniqueness. Preserve all rows safely.
            external_key="",
            fee_amount=candidate.fee_amount if candidate else None,
        )
        Evidence.objects.using(schema_editor.connection.alias).filter(
            pk=evidence.pk
        ).update(created_at=item.created_at)
        Transaction.objects.using(schema_editor.connection.alias).filter(
            pk=item.pk
        ).update(direction="debit")


class Migration(migrations.Migration):
    dependencies = [("transactions", "0005_transferevidence")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
