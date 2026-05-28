import uuid

from django.conf import settings
from django.db import models


class SenderRule(models.Model):
    class Provider(models.TextChoices):
        BKASH = "bkash", "bKash"
        NAGAD = "nagad", "Nagad"
        ROCKET = "rocket", "Rocket"
        CITY_BANK = "city_bank", "City Bank"
        BANK = "bank", "Bank"
        CARD = "card", "Card"
        OTHER = "other", "Other"

    class MatchType(models.TextChoices):
        EXACT = "exact", "Exact"
        CONTAINS = "contains", "Contains"
        REGEX = "regex", "Regex"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sender_rules",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="sender_rules",
    )
    payment_method = models.ForeignKey(
        "payment_methods.PaymentMethod",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="sender_rules",
    )
    name = models.CharField(max_length=120)
    provider = models.CharField(max_length=32, choices=Provider.choices)
    sender = models.CharField(max_length=120)
    match_type = models.CharField(max_length=32, choices=MatchType.choices, default=MatchType.EXACT)
    pattern = models.CharField(max_length=255, blank=True)
    priority = models.PositiveIntegerField(default=100)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("priority", "name")
        indexes = [
            models.Index(fields=("user", "sender")),
            models.Index(fields=("user", "provider")),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("user", "name"),
                name="unique_sender_rule_name_per_user",
            )
        ]

    def __str__(self) -> str:
        return self.name
