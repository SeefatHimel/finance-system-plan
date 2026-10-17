import uuid
from decimal import Decimal
from typing import ClassVar

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class BalanceSnapshot(models.Model):
    class Status(models.TextChoices):
        MATCHED = "matched", "Matched"
        MISSING_MONEY = "missing_money", "Missing money"
        EXTRA_MONEY = "extra_money", "Extra money"
        ADJUSTED = "adjusted", "Adjusted"
        IGNORED = "ignored", "Ignored"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="balance_snapshots",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="balance_snapshots",
    )
    checked_at = models.DateTimeField()
    actual_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    expected_balance = models.DecimalField(max_digits=14, decimal_places=2)
    difference = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.MATCHED,
    )
    adjustment_transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="balance_snapshot_adjustments",
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-checked_at", "-created_at")
        indexes = [
            models.Index(fields=("user", "account", "checked_at")),
            models.Index(fields=("user", "status")),
        ]

    def __str__(self) -> str:
        return f"{self.account} {self.checked_at} {self.status}"


class EvidenceProposal(models.Model):
    """Expiring decisions/receipts only. Canonical links remain on source models."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    # UUID references deliberately do not add ledger relations or affect Undo.
    sources = models.JSONField()
    target_id = models.UUIDField(null=True)
    fingerprint = models.CharField(max_length=64)
    preview = models.JSONField()
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True)
    idempotency_key = models.UUIDField(null=True)
    decision_hash = models.CharField(max_length=64, blank=True)
    result = models.JSONField(null=True)
    result_fingerprint = models.CharField(max_length=64, blank=True)

    class Meta:
        indexes: ClassVar = [models.Index(fields=("user", "created_at"))]
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=("user", "idempotency_key"),
                name="evidence_decision_key_per_user",
            )
        ]
