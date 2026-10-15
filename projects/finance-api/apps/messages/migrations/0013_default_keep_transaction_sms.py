from django.core.validators import MaxValueValidator
from django.db import migrations, models


def keep_existing_transaction_sms(apps, schema_editor):
    Preference = apps.get_model("finance_messages", "SmsCapturePreference")
    Preference.objects.using(schema_editor.connection.alias).exclude(
        raw_sms_retention_days__isnull=True
    ).update(raw_sms_retention_days=None)


class Migration(migrations.Migration):
    dependencies = [("finance_messages", "0012_alter_parsedmessagecandidate_message_kind")]

    operations = [
        migrations.AlterField(
            model_name="smscapturepreference",
            name="raw_sms_retention_days",
            field=models.PositiveIntegerField(blank=True, null=True, default=None, validators=[MaxValueValidator(3650)], help_text="Days to retain raw SMS after confirmation. Zero redacts immediately; null keeps it."),
        ),
        migrations.RunPython(keep_existing_transaction_sms, migrations.RunPython.noop),
    ]
