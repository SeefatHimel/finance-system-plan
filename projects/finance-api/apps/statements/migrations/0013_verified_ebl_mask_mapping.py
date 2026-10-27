from typing import ClassVar

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies: ClassVar = [("statements", "0012_identifier_skip")]

    operations: ClassVar = [
        migrations.AddField(
            model_name="statementcounterpartycode",
            name="ebl_mask_verified",
            field=models.BooleanField(default=False),
        ),
    ]
