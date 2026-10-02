from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        (
            "transactions",
            "0002_rename_transactio_user_id_453ccf_idx_transaction_user_id_8af7f1_idx_and_more",
        ),
    ]

    operations = [
        migrations.AddField(
            model_name="transaction",
            name="time",
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AlterModelOptions(
            name="transaction",
            options={"ordering": ("-date", "-time", "-created_at")},
        ),
    ]
