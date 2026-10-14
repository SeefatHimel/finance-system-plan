from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("transactions", "0007_transaction_action_recovery"),
    ]

    operations = [
        migrations.AddField(
            model_name="transferevidence",
            name="is_effective_balance",
            field=models.BooleanField(default=False),
        ),
        migrations.AddConstraint(
            model_name="transferevidence",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_effective_balance=True),
                fields=("transaction", "account"),
                name="unique_effective_transfer_report_per_account",
            ),
        ),
    ]
