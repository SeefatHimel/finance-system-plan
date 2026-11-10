import uuid

from django.conf import settings
from django.db import models


class SavedReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=160)
    start_date = models.DateField()
    end_date = models.DateField()
    date_view = models.CharField(max_length=16, default="custom", choices=[(value, value) for value in ("daily", "monthly", "custom")])
    account = models.ForeignKey("accounts.Account", null=True, blank=True, on_delete=models.PROTECT)
    currency = models.CharField(max_length=3, default="BDT")
    filters = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name", "id")


class ReportMembership(models.Model):
    report = models.ForeignKey(SavedReport, on_delete=models.CASCADE, related_name="overrides")
    transaction = models.ForeignKey("transactions.Transaction", on_delete=models.CASCADE)
    included = models.BooleanField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=("report", "transaction"), name="unique_report_transaction_override")]
