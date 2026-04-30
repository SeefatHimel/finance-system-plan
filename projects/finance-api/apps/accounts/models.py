import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Account(models.Model):
    class Type(models.TextChoices):
        CASH = "cash", "Cash"
        HOME_CASH = "home_cash", "Home cash"
        MOBILE_WALLET = "mobile_wallet", "Mobile wallet"
        BANK = "bank", "Bank"
        CREDIT_CARD = "credit_card", "Credit card"
        SAVINGS = "savings", "Savings"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="accounts",
    )
    name = models.CharField(max_length=120)
    type = models.CharField(max_length=32, choices=Type.choices)
    currency = models.CharField(max_length=3, default="BDT")
    starting_balance = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("display_order", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "name"),
                name="unique_account_name_per_user",
            )
        ]

    def __str__(self) -> str:
        return self.name

