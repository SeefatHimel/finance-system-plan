from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("payment_methods", "0003_paymentmethod_additional_identifiers_and_more")]

    operations = [
        migrations.AddField(
            model_name="paymentmethod",
            name="encrypted_identifiers",
            field=models.BinaryField(blank=True, default=b"", editable=False),
        ),
    ]
