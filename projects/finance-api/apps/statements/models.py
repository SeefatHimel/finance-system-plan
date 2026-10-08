import uuid
from typing import ClassVar

from django.conf import settings
from django.db import models

from apps.transactions.models import Transaction


class StatementImport(models.Model):
    """Saved masked extraction; original PDF bytes and passwords are never saved."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    file_digest = models.CharField(max_length=64)
    profile = models.CharField(max_length=32)
    parser_version = models.CharField(max_length=16)
    currency = models.CharField(max_length=3)
    account_hint = models.CharField(max_length=16, blank=True)
    account_identity = models.CharField(max_length=32)
    period_start = models.DateField(null=True)
    period_end = models.DateField(null=True)
    page_count = models.PositiveIntegerField()
    checks = models.JSONField(default=list)
    warnings = models.JSONField(default=list)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, null=True)
    closing_balance = models.DecimalField(max_digits=14, decimal_places=2, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=("user", "account", "file_digest"),
                name="statement_file_per_account",
            )
        ]
        indexes: ClassVar = [models.Index(fields=("user", "created_at"))]


class StatementRow(models.Model):
    class State(models.TextChoices):
        PENDING = "pending", "Pending"
        POSTED = "posted", "Added"
        LINKED = "linked", "Linked"
        SKIPPED = "skipped", "Skipped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        StatementImport, on_delete=models.CASCADE, related_name="rows"
    )
    position = models.PositiveIntegerField()
    component = models.CharField(
        max_length=16, choices=(("principal", "Principal"), ("fee", "Fee"))
    )
    extracted = models.JSONField()
    source_fingerprint = models.CharField(max_length=64, db_index=True)
    date = models.DateField(null=True)
    time = models.TimeField(null=True)
    value_date = models.DateField(null=True)
    direction = models.CharField(max_length=16, choices=Transaction.Direction.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True)
    balance_after = models.DecimalField(max_digits=14, decimal_places=2, null=True)
    type = models.CharField(max_length=32, choices=Transaction.Type.choices)
    other_account = models.ForeignKey(
        "accounts.Account",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="statement_counterparties",
    )
    category = models.ForeignKey(
        "categories.Category", null=True, blank=True, on_delete=models.SET_NULL
    )
    reference = models.CharField(max_length=120, blank=True)
    counterparty_text = models.CharField(max_length=255, blank=True)
    note = models.TextField(blank=True)
    classification_confirmed = models.BooleanField(default=False)
    state = models.CharField(
        max_length=16, choices=State.choices, default=State.PENDING
    )
    transaction = models.ForeignKey(
        Transaction,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="statement_rows",
    )
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "-component", "id")
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=("batch", "position", "component"),
                name="statement_component_per_row",
            ),
            models.UniqueConstraint(
                fields=("batch", "transaction"),
                condition=models.Q(transaction__isnull=False),
                name="statement_movement_per_batch",
            ),
        ]
        indexes: ClassVar = [models.Index(fields=("batch", "state"))]


class StatementMapping(models.Model):
    """Explicitly remembered classification, scoped to one reporting account."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    account = models.ForeignKey("accounts.Account", on_delete=models.CASCADE)
    profile = models.CharField(max_length=32)
    pattern_key = models.CharField(max_length=64)
    pattern_label = models.CharField(max_length=180)
    type = models.CharField(max_length=32, choices=Transaction.Type.choices)
    direction = models.CharField(max_length=16, choices=Transaction.Direction.choices)
    category = models.ForeignKey(
        "categories.Category", on_delete=models.SET_NULL, null=True
    )
    other_account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.CASCADE,
        null=True,
        related_name="statement_mappings",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints: ClassVar = [
            models.UniqueConstraint(
                fields=("user", "account", "profile", "pattern_key"),
                name="statement_mapping_scope",
            )
        ]
