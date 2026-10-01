import django.core.validators
import django.db.models.deletion
import django.utils.timezone
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("categories", "0001_initial"),
        ("finance_messages", "0008_parsedmessagecandidate_rejected_at_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="senderrule",
            name="category",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sender_rules", to="categories.category"),
        ),
        migrations.AddField(
            model_name="senderrule",
            name="default_transaction_type",
            field=models.CharField(blank=True, choices=[("expense", "Expense"), ("income", "Income"), ("transfer", "Transfer"), ("adjustment", "Adjustment"), ("fee", "Fee"), ("refund", "Refund")], default="", max_length=32),
        ),
        migrations.AddField(
            model_name="smscapturepreference",
            name="raw_sms_retention_days",
            field=models.PositiveIntegerField(blank=True, default=30, help_text="Days to retain raw SMS after confirmation. Zero redacts immediately; null keeps it.", null=True, validators=[django.core.validators.MaxValueValidator(3650)]),
        ),
        migrations.AddField(
            model_name="parsedmessagecandidate",
            name="category",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="parsed_message_candidates", to="categories.category"),
        ),
        migrations.CreateModel(
            name="SmsDeviceStatus",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("device_id", models.CharField(blank=True, default="", max_length=120)),
                ("platform", models.CharField(blank=True, default="android", max_length=32)),
                ("app_version", models.CharField(blank=True, default="", max_length=32)),
                ("sms_permission_state", models.CharField(choices=[("unknown", "Unknown"), ("granted", "Granted"), ("denied", "Denied")], default="unknown", max_length=16)),
                ("background_state", models.CharField(choices=[("idle", "Idle"), ("running", "Running"), ("success", "Success"), ("error", "Error"), ("disabled", "Disabled")], default="idle", max_length=16)),
                ("pending_upload_count", models.PositiveIntegerField(default=0)),
                ("failed_upload_count", models.PositiveIntegerField(default=0)),
                ("last_error", models.CharField(blank=True, default="", max_length=255)),
                ("last_scan_at", models.DateTimeField(blank=True, null=True)),
                ("last_successful_sync_at", models.DateTimeField(blank=True, null=True)),
                ("last_seen_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="sms_device_status", to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
