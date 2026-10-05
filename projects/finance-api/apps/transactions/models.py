import uuid
from decimal import Decimal

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

    class Direction(models.TextChoices):
        DEBIT = "debit", "Debit"
        CREDIT = "credit", "Credit"

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
    payment_method = models.ForeignKey(
        "payment_methods.PaymentMethod",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="transactions",
    )
    raw_message = models.ForeignKey(
        "finance_messages.RawMessage",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="transactions",
    )
    date = models.DateField()
    time = models.TimeField(blank=True, null=True)
    type = models.CharField(max_length=32, choices=Type.choices)
    direction = models.CharField(
        max_length=16, choices=Direction.choices, default=Direction.DEBIT
    )
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    balance_after = models.DecimalField(
        max_digits=14, decimal_places=2, blank=True, null=True
    )
    sender_account_identifier = models.CharField(max_length=120, blank=True, default="")
    sender_card_identifier = models.CharField(max_length=120, blank=True, default="")
    receiver_account_identifier = models.CharField(
        max_length=120, blank=True, default=""
    )
    receiver_card_identifier = models.CharField(max_length=120, blank=True, default="")
    reference = models.CharField(max_length=120, blank=True, default="")
    counterparty_text = models.CharField(max_length=255, blank=True, default="")
    external_key = models.CharField(max_length=180, blank=True, default="")
    note = models.TextField(blank=True)
    source = models.CharField(max_length=32, choices=Source.choices, default=Source.WEB)
    needs_review = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-date", "-time", "-created_at")
        indexes = [
            models.Index(fields=("user", "date")),
            models.Index(fields=("user", "type")),
            models.Index(fields=("user", "direction")),
            models.Index(fields=("user", "reference")),
            models.Index(fields=("user", "external_key")),
        ]

    def __str__(self) -> str:
        return f"{self.date} {self.type} {self.amount}"

    @classmethod
    def default_direction_for_type(cls, transaction_type: str) -> str:
        credit_types = {
            cls.Type.INCOME,
            cls.Type.REFUND,
            cls.Type.BORROW,
            cls.Type.REPAYMENT_RECEIVED,
        }
        return (
            cls.Direction.CREDIT
            if transaction_type in credit_types
            else cls.Direction.DEBIT
        )


class TransferEvidence(models.Model):
    """An account's observation of a transfer; never an additional ledger movement."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.CASCADE, related_name="transfer_evidence"
    )
    account = models.ForeignKey("accounts.Account", on_delete=models.PROTECT)
    raw_message = models.OneToOneField(
        "finance_messages.RawMessage",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="transfer_evidence",
    )
    direction = models.CharField(max_length=16, choices=Transaction.Direction.choices)
    date = models.DateField()
    time = models.TimeField(blank=True, null=True)
    balance_after = models.DecimalField(
        max_digits=14, decimal_places=2, blank=True, null=True
    )
    fee_amount = models.DecimalField(
        max_digits=14, decimal_places=2, blank=True, null=True
    )
    reference = models.CharField(max_length=120, blank=True, default="")
    provider = models.CharField(max_length=32, blank=True, default="")
    external_key = models.CharField(max_length=180, blank=True, default="")
    source = models.CharField(max_length=32, choices=Transaction.Source.choices)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("date", "time", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "external_key"),
                condition=~models.Q(external_key=""),
                name="unique_transfer_evidence_key_per_user",
            ),
        ]
