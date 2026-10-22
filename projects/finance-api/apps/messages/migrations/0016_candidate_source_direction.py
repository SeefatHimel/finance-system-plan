from django.db import migrations, models


def backfill_source_direction(apps, schema_editor):
    Candidate = apps.get_model("finance_messages", "ParsedMessageCandidate")
    incoming = ("cash_in", "receive_money", "bank_transfer_in", "refund")
    outgoing = (
        "purchase", "bill_payment", "cash_out", "send_money", "bank_transfer_out",
        "card_purchase", "fee",
    )
    # Only source classifications with an unambiguous reporting-side direction
    # are backfilled. Unknown, security and balance-only SMS remain blank.
    Candidate.objects.filter(message_kind__in=incoming).update(source_direction="credit")
    Candidate.objects.filter(message_kind__in=outgoing).update(source_direction="debit")


class Migration(migrations.Migration):
    dependencies = [("finance_messages", "0015_alter_parsedmessagecandidate_message_kind")]

    operations = [
        migrations.AddField(
            model_name="parsedmessagecandidate",
            name="source_direction",
            field=models.CharField(blank=True, default="", max_length=6),
        ),
        migrations.RunPython(backfill_source_direction, migrations.RunPython.noop),
    ]
