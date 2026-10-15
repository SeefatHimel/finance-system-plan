from django.db import migrations

import config.secure_data


class Migration(migrations.Migration):
    dependencies = [("statements", "0006_statement_original_file")]

    operations = [
        migrations.AddField(
            model_name="statementrow",
            name="source_code",
            field=config.secure_data.EncryptedStatementCodeField(blank=True, default=""),
        ),
    ]
