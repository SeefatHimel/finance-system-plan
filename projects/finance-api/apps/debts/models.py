import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Debt(models.Model):
    class Direction(models.TextChoices):
        LENT_BY_ME = "lent_by_me", "Lent by me"
        BORROWED_BY_ME = "borrowed_by_me", "Borrowed by me"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        PARTIALLY_PAID = "partially_paid", "Partially paid"
        PAID = "paid", "Paid"
        WRITTEN_OFF = "written_off", "Written off"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="debts",
    )
    counterparty_name = models.CharField(max_length=160)
    opened_transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="opened_debts",
    )
    direction = models.CharField(max_length=32, choices=Direction.choices)
    principal_amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    current_balance = models.DecimalField(max_digits=14, decimal_places=2)
    opened_at = models.DateField()
    due_date = models.DateField(blank=True, null=True)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.OPEN)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-opened_at", "-created_at")
        indexes = [
            models.Index(fields=("user", "status")),
            models.Index(fields=("user", "direction")),
            models.Index(fields=("user", "counterparty_name")),
        ]

    def __str__(self) -> str:
        return f"{self.counterparty_name} {self.direction} {self.current_balance}"


class DebtPayment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="debt_payments",
    )
    debt = models.ForeignKey(Debt, on_delete=models.CASCADE, related_name="payments")
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="debt_payments",
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
            models.Index(fields=("debt", "paid_at")),
        ]

    def __str__(self) -> str:
        return f"{self.debt} payment {self.amount}"
