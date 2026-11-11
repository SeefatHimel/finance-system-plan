"""Spreadsheet evidence is separate from the canonical ledger."""

import uuid
from django.conf import settings
from django.db import models


class BulkImport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    source_hash = models.CharField(max_length=64)
    filename = models.CharField(max_length=180, default="Pasted table")
    original = models.BinaryField()  # Encrypted original UTF-8, never a list response.
    configuration = models.JSONField(default=dict)
    state = models.CharField(max_length=16, default="draft")
    version = models.PositiveIntegerField(default=1)
    receipt = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("user", "account", "source_hash"),
                name="bulk_source_per_account",
            )
        ]


class BulkImportRow(models.Model):
    batch = models.ForeignKey(
        BulkImport, on_delete=models.CASCADE, related_name="entries"
    )
    number = models.PositiveIntegerField()
    transaction = models.ForeignKey(
        "transactions.Transaction",
        null=True,
        on_delete=models.SET_NULL,
        related_name="bulk_import_rows",
    )
    ledger_identity = models.UUIDField(null=True, db_index=True)
    created_entry = models.BooleanField(default=False)
    saved_fingerprint = models.CharField(max_length=64, blank=True)
    normalized = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("batch", "number"), name="bulk_row_number")
        ]


class BulkImportCheckpoint(models.Model):
    batch = models.ForeignKey(
        BulkImport, on_delete=models.CASCADE, related_name="checkpoints"
    )
    snapshot = models.OneToOneField(
        "reconciliation.BalanceSnapshot",
        null=True,
        on_delete=models.SET_NULL,
        related_name="bulk_import_checkpoint",
    )
    original = models.JSONField(default=dict)
    saved_fingerprint = models.CharField(max_length=64)
