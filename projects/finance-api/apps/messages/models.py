import uuid
from decimal import Decimal
from hashlib import sha256

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
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


class RawMessage(models.Model):
    class Status(models.TextChoices):
        IMPORTED = "imported", "Imported"
        DUPLICATE = "duplicate", "Duplicate"
        IGNORED = "ignored", "Ignored"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="raw_messages",
    )
    sender = models.CharField(max_length=120)
    body = models.TextField()
    received_at = models.DateTimeField()
    device_message_id = models.CharField(max_length=120, blank=True)
    body_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.IMPORTED)
    duplicate_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="duplicates",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-received_at", "-created_at")
        indexes = [
            models.Index(fields=("user", "sender")),
            models.Index(fields=("user", "received_at")),
            models.Index(fields=("user", "body_hash")),
            models.Index(fields=("user", "device_message_id")),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("user", "body_hash"),
                name="unique_raw_message_hash_per_user",
            )
        ]

    @classmethod
    def build_body_hash(cls, *, sender: str, body: str, received_at) -> str:
        normalized = "|".join(
            [
                sender.strip().lower(),
                received_at.isoformat(),
                " ".join(body.split()),
            ]
        )
        return sha256(normalized.encode("utf-8")).hexdigest()

    def __str__(self) -> str:
        return f"{self.sender} {self.received_at}"


class ParsedMessageCandidate(models.Model):
    class Status(models.TextChoices):
        NEEDS_REVIEW = "needs_review", "Needs review"
        CONFIRMED = "confirmed", "Confirmed"
        IGNORED = "ignored", "Ignored"

    class TransactionType(models.TextChoices):
        EXPENSE = "expense", "Expense"
        INCOME = "income", "Income"
        TRANSFER = "transfer", "Transfer"
        ADJUSTMENT = "adjustment", "Adjustment"
        FEE = "fee", "Fee"
        REFUND = "refund", "Refund"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="parsed_message_candidates",
    )
    raw_message = models.OneToOneField(
        RawMessage,
        on_delete=models.CASCADE,
        related_name="candidate",
    )
    sender_rule = models.ForeignKey(
        SenderRule,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="parsed_candidates",
    )
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="parsed_message_candidates",
    )
    payment_method = models.ForeignKey(
        "payment_methods.PaymentMethod",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="parsed_message_candidates",
    )
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="parsed_message_candidates",
    )
    transaction_type = models.CharField(
        max_length=32,
        choices=TransactionType.choices,
        default=TransactionType.EXPENSE,
    )
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    confidence = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("1"))],
    )
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.NEEDS_REVIEW)
    parser_name = models.CharField(max_length=120, blank=True)
    parser_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("user", "status")),
            models.Index(fields=("user", "created_at")),
        ]

    def __str__(self) -> str:
        return f"{self.raw_message.sender} {self.status}"
