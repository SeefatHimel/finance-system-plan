import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("statements", "0005_expand_counterparty_code")]

    operations = [
        migrations.CreateModel(
            name="StatementOriginalFile",
            fields=[
                (
                    "batch",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="original_file",
                        serialize=False,
                        to="statements.statementimport",
                    ),
                ),
                ("ciphertext", models.BinaryField()),
                ("size", models.PositiveIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
    ]
