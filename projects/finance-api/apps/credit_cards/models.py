import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class CreditCardBill(models.Model):
    class Status(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PARTIALLY_PAID = "partially_paid", "Partially paid"
        PAID = "paid", "Paid"
        WAIVED = "waived", "Waived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="credit_card_bills",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="credit_card_bills",
    )
    statement_transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="credit_card_bills",
    )
    statement_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    minimum_due = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(Decimal("0"))],
    )
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    remaining_balance = models.DecimalField(max_digits=14, decimal_places=2)
    statement_date = models.DateField()
    due_date = models.DateField()
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.UNPAID)
    reference = models.CharField(max_length=120, blank=True, default="")
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("due_date", "-created_at")
        indexes = [
            models.Index(fields=("user", "status")),
            models.Index(fields=("user", "due_date")),
            models.Index(fields=("account", "status")),
        ]

    def __str__(self) -> str:
        return f"{self.account} bill {self.statement_balance} due {self.due_date}"


class CreditCardPayment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="credit_card_payments",
    )
    bill = models.ForeignKey(CreditCardBill, on_delete=models.CASCADE, related_name="payments")
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="credit_card_payments",
    )
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    paid_at = models.DateField()
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-paid_at", "-created_at")
        indexes = [
            models.Index(fields=("user", "paid_at")),
            models.Index(fields=("bill", "paid_at")),
        ]

    def __str__(self) -> str:
        return f"{self.bill} payment {self.amount}"
