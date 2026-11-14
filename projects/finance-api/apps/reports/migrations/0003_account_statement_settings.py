from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("reports", "0002_savedreport_filters")]
    operations = [
        migrations.AddField(model_name="savedreport", name="report_view", field=models.CharField(choices=[("analysis", "Analysis"), ("account_statement", "Account statement")], default="analysis", max_length=24)),
        migrations.AddField(model_name="savedreport", name="opening_balances", field=models.JSONField(blank=True, default=dict)),
    ]
