from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_account_identity_method")]

    operations = [
        migrations.AddField(
            model_name="account",
            name="logo",
            field=models.TextField(blank=True, default=""),
        ),
    ]
