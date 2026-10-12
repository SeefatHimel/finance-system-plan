import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class QuickAddPreset(models.Model):
    class Type(models.TextChoices):
        EXPENSE = "expense", "Expense"
        INCOME = "income", "Income"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.EXPENSE)
    account = models.ForeignKey("accounts.Account", on_delete=models.SET_NULL, null=True, blank=True)
    category = models.ForeignKey("categories.Category", on_delete=models.SET_NULL, null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(Decimal("0.01"))])
    counterparty_text = models.CharField(max_length=255, blank=True, default="")
    note = models.TextField(blank=True, default="")
    is_enabled = models.BooleanField(default=True)
    is_favorite = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("display_order", "name", "id")


class QuickEntryReceipt(models.Model):
    """Retain the original request identity even after a ledger edit or deletion."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    client_request_id = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    transaction = models.ForeignKey("transactions.Transaction", on_delete=models.SET_NULL, null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("user", "client_request_id"), name="unique_quick_entry_request_per_user")]
