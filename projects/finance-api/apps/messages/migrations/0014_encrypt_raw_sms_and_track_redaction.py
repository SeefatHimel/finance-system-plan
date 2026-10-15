from django.db import migrations, models

import config.secure_data


def encrypt_saved_sms(apps, schema_editor):
    RawMessage = apps.get_model("finance_messages", "RawMessage")
    database = schema_editor.connection.alias
    RawMessage.objects.using(database).filter(status="redacted").update(
        redaction_reason="legacy"
    )
    # Bound each query without PostgreSQL server-side cursors. A transaction
    # pooler can invalidate those cursors between fetches during deployment.
    last_pk = None
    while True:
        page = RawMessage.objects.using(database).order_by("pk")
        if last_pk is not None:
            page = page.filter(pk__gt=last_pk)
        ids = list(page.values_list("pk", flat=True)[:500])
        if not ids:
            break
        for message in RawMessage.objects.using(database).filter(pk__in=ids):
            message.save(using=database, update_fields=("body",))
        last_pk = ids[-1]


class Migration(migrations.Migration):
    dependencies = [("finance_messages", "0013_default_keep_transaction_sms")]

    operations = [
        migrations.AddField(
            model_name="rawmessage",
            name="redaction_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("manual", "User requested"),
                    ("retention", "Retention policy"),
                    ("legacy", "Reason unknown before migration"),
                ],
                default="",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="rawmessage",
            name="body",
            field=config.secure_data.EncryptedSmsTextField(),
        ),
        migrations.RunPython(encrypt_saved_sms, migrations.RunPython.noop),
    ]
