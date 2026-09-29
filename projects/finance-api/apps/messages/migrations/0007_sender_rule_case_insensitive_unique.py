from django.db import migrations, models
from django.db.models import Count
from django.db.models.functions import Lower, Trim


def validate_normalized_sender_uniqueness(apps, schema_editor):
    sender_rule = apps.get_model("finance_messages", "SenderRule")
    duplicates_exist = (
        sender_rule.objects.annotate(normalized_sender=Lower(Trim("sender")))
        .values("user_id", "match_type", "normalized_sender")
        .annotate(total=Count("id"))
        .filter(total__gt=1)
        .exists()
    )
    if duplicates_exist:
        raise RuntimeError(
            "Duplicate SMS sender rules exist after trimming and lowercasing. "
            "Resolve them before applying messages.0007."
        )


class Migration(migrations.Migration):
    dependencies = [
        ("finance_messages", "0006_rawmessage_redacted_at_alter_rawmessage_status"),
    ]

    operations = [
        migrations.RunPython(validate_normalized_sender_uniqueness, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="senderrule",
            constraint=models.UniqueConstraint(
                models.F("user"),
                Lower(Trim("sender")),
                models.F("match_type"),
                name="unique_sender_match_type_per_user_ci",
            ),
        ),
    ]
