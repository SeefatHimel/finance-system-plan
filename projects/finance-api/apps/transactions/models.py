import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Transaction(models.Model):
    class Type(models.TextChoices):
        EXPENSE = "expense", "Expense"
        INCOME = "income", "Income"
        TRANSFER = "transfer", "Transfer"
        ADJUSTMENT = "adjustment", "Adjustment"
        FEE = "fee", "Fee"
        REFUND = "refund", "Refund"
        LEND = "lend", "Lend"
        BORROW = "borrow", "Borrow"
        REPAYMENT_RECEIVED = "repayment_received", "Repayment received"
        REPAYMENT_PAID = "repayment_paid", "Repayment paid"

    class Source(models.TextChoices):
        WEB = "web", "Web"
        MOBILE = "mobile", "Mobile"
        SMS = "sms", "SMS"
        IMPORT = "import", "Import"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="transactions",
    )
    transfer_account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="incoming_transfers",
    )
    category = models.ForeignKey(
        "categories.Category",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="transactions",
    )
    date = models.DateField()
    type = models.CharField(max_length=32, choices=Type.choices)
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
    )
    note = models.TextField(blank=True)
    source = models.CharField(max_length=32, choices=Source.choices, default=Source.WEB)
    needs_review = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-date", "-created_at")
        indexes = [
            models.Index(fields=("user", "date")),
            models.Index(fields=("user", "type")),
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.type} {self.amount}"

