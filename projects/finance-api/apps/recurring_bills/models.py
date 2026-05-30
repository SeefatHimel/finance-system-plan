import calendar
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


def add_months(value, months):
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


class RecurringBill(models.Model):
    class Frequency(models.TextChoices):
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        QUARTERLY = "quarterly", "Quarterly"
        YEARLY = "yearly", "Yearly"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        ENDED = "ended", "Ended"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recurring_bills",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="recurring_bills",
    )
    category = models.ForeignKey(
        "categories.Category",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="recurring_bills",
    )
    name = models.CharField(max_length=160)
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    frequency = models.CharField(max_length=32, choices=Frequency.choices, default=Frequency.MONTHLY)
    next_due_date = models.DateField()
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.ACTIVE)
    auto_create_transaction = models.BooleanField(default=False)
    reminder_days_before = models.PositiveIntegerField(default=3)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("next_due_date", "name")
        indexes = [
            models.Index(fields=("user", "status")),
            models.Index(fields=("user", "next_due_date")),
            models.Index(fields=("account", "status")),
        ]

    def __str__(self) -> str:
        return f"{self.name} {self.amount} due {self.next_due_date}"

    def following_due_date(self):
        if self.frequency == self.Frequency.WEEKLY:
            return self.next_due_date + timedelta(days=7)
        if self.frequency == self.Frequency.QUARTERLY:
            return add_months(self.next_due_date, 3)
        if self.frequency == self.Frequency.YEARLY:
            return add_months(self.next_due_date, 12)
        return add_months(self.next_due_date, 1)


class RecurringBillPayment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recurring_bill_payments",
    )
    bill = models.ForeignKey(RecurringBill, on_delete=models.CASCADE, related_name="payments")
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="recurring_bill_payments",
    )
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    due_date = models.DateField()
    paid_at = models.DateField()
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-paid_at", "-created_at")
        indexes = [
            models.Index(fields=("user", "paid_at")),
            models.Index(fields=("bill", "due_date")),
        ]

    def __str__(self) -> str:
        return f"{self.bill} paid {self.amount}"
