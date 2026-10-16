from typing import ClassVar

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies: ClassVar = [("statements", "0008_bkash_statement_identifiers")]

    operations: ClassVar = [
        migrations.AddField(
            model_name="statementmapping",
            name="note_template",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="statementcounterpartycode",
            name="note_template",
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
