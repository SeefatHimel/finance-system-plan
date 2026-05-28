import uuid

from django.conf import settings
from django.db import models


class PaymentMethod(models.Model):
    class Provider(models.TextChoices):
        CASH = "cash", "Cash"
        BKASH = "bkash", "bKash"
        NAGAD = "nagad", "Nagad"
        ROCKET = "rocket", "Rocket"
        CITY_BANK = "city_bank", "City Bank"
        BANK = "bank", "Bank"
        CARD = "card", "Card"
        MANUAL = "manual", "Manual"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="payment_methods",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="payment_methods",
    )
    name = models.CharField(max_length=120)
    provider = models.CharField(max_length=32, choices=Provider.choices)
    identifier = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("display_order", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "name"),
                name="unique_payment_method_name_per_user",
            )
        ]

    def __str__(self) -> str:
        return self.name
