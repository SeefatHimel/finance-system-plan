from typing import ClassVar

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies: ClassVar = [("statements", "0010_specific_pending_bills")]

    operations: ClassVar = [
        migrations.AddField(
            model_name="statementrow",
            name="reviewed_source_direction",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
    ]
