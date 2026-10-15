from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("statements", "0004_statementcounterpartycode")]

    operations = [
        migrations.AlterField(
            model_name="statementcounterpartycode",
            name="code",
            field=models.CharField(max_length=24),
        ),
    ]
