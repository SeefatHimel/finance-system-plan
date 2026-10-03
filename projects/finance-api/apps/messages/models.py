import uuid
from datetime import timedelta
from decimal import Decimal
from hashlib import sha256

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower, Trim
from django.utils import timezone


class SenderRule(models.Model):
    class Provider(models.TextChoices):
        BKASH = "bkash", "bKash"
        NAGAD = "nagad", "Nagad"
        ROCKET = "rocket", "Rocket"
        EBL = "ebl", "EBL"
        CITY_BANK = "city_bank", "City Bank"
        PATHAO_PAY = "pathao_pay", "Pathao Pay"
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
    category = models.ForeignKey(
        "categories.Category",
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
    default_transaction_type = models.CharField(
        max_length=32,
        choices=(
            ("expense", "Expense"),
            ("income", "Income"),
            ("transfer", "Transfer"),
            ("adjustment", "Adjustment"),
            ("fee", "Fee"),
            ("refund", "Refund"),
        ),
        blank=True,
        default="",
    )
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
            ),
            models.UniqueConstraint(
                models.F("user"),
                Lower(Trim("sender")),
                models.F("match_type"),
                name="unique_sender_match_type_per_user_ci",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class SenderRuleMapping(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sender_rule_mappings",
    )
    sender_rule = models.ForeignKey(
        SenderRule,
        on_delete=models.CASCADE,
        related_name="learned_mappings",
    )
    message_kind = models.CharField(max_length=32)
    account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        related_name="sender_rule_mappings",
    )
    payment_method = models.ForeignKey(
        "payment_methods.PaymentMethod",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="sender_rule_mappings",
    )
    category = models.ForeignKey(
        "categories.Category",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="sender_rule_mappings",
    )
    transaction_type = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("sender_rule", "message_kind")
        constraints = [
            models.UniqueConstraint(
                fields=("sender_rule", "message_kind"),
                name="unique_mapping_per_sender_rule_kind",
            )
        ]

    def __str__(self) -> str:
        return f"{self.sender_rule.name}: {self.message_kind}"


def default_excluded_message_kinds():
    return ["otp_or_security"]


class SmsCapturePreference(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sms_capture_preference",
    )
    excluded_providers = models.JSONField(default=list, blank=True)
    excluded_message_kinds = models.JSONField(
        default=default_excluded_message_kinds,
        blank=True,
    )
    raw_sms_retention_days = models.PositiveIntegerField(
        blank=True,
        null=True,
        default=30,
        validators=[MaxValueValidator(3650)],
        help_text="Days to retain raw SMS after confirmation. Zero redacts immediately; null keeps it.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"SMS capture preferences for {self.user}"


class RawMessage(models.Model):
    class Status(models.TextChoices):
        IMPORTED = "imported", "Imported"
        DUPLICATE = "duplicate", "Duplicate"
        IGNORED = "ignored", "Ignored"
        REDACTED = "redacted", "Redacted"

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
    provider = models.CharField(max_length=32, choices=SenderRule.Provider.choices, blank=True, default="")
    message_kind = models.CharField(max_length=32, blank=True, default="")
    exclusion_reason = models.CharField(max_length=120, blank=True, default="")
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.IMPORTED)
    duplicate_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="duplicates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    redacted_at = models.DateTimeField(blank=True, null=True)

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

    def redact(self):
        self.body = "[redacted]"
        self.device_message_id = ""
        self.status = self.Status.REDACTED
        self.redacted_at = timezone.now()
        self.save(update_fields=("body", "device_message_id", "status", "redacted_at"))


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

    class MessageKind(models.TextChoices):
        PURCHASE = "purchase", "Purchase"
        CASH_IN = "cash_in", "Cash in"
        CASH_OUT = "cash_out", "Cash out"
        SEND_MONEY = "send_money", "Send money"
        RECEIVE_MONEY = "receive_money", "Receive money"
        BANK_TRANSFER_IN = "bank_transfer_in", "Bank transfer in"
        BANK_TRANSFER_OUT = "bank_transfer_out", "Bank transfer out"
        CARD_PURCHASE = "card_purchase", "Card purchase"
        CARD_PAYMENT = "card_payment", "Card payment"
        FEE = "fee", "Fee"
        REFUND = "refund", "Refund"
        REVERSAL = "reversal", "Reversal"
        BALANCE_NOTICE = "balance_notice", "Balance notice"
        OTP_OR_SECURITY = "otp_or_security", "OTP or security"
        UNKNOWN = "unknown", "Unknown"

    class RejectionReason(models.TextChoices):
        NOT_TRANSACTION = "not_transaction", "Not a transaction"
        OTP_SECURITY = "otp_security", "OTP or security message"
        DUPLICATE = "duplicate", "Duplicate"
        WRONG_PROVIDER_ACCOUNT = "wrong_provider_account", "Wrong provider or account"
        PERSONAL = "personal", "Personal or non-financial"
        UNSUPPORTED_FORMAT = "unsupported_format", "Unsupported format"
        OTHER = "other", "Other"

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
    category = models.ForeignKey(
        "categories.Category",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="parsed_message_candidates",
    )
    destination_account = models.ForeignKey(
        "accounts.Account",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="destination_parsed_message_candidates",
    )
    destination_payment_method = models.ForeignKey(
        "payment_methods.PaymentMethod",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="destination_parsed_message_candidates",
    )
    transaction = models.ForeignKey(
        "transactions.Transaction",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="parsed_message_candidates",
    )
    possible_related_candidate = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="related_candidates",
    )
    provider = models.CharField(max_length=32, choices=SenderRule.Provider.choices, blank=True, default="")
    message_kind = models.CharField(
        max_length=32,
        choices=MessageKind.choices,
        default=MessageKind.UNKNOWN,
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
    sender_account_identifier = models.CharField(max_length=120, blank=True, default="")
    sender_card_identifier = models.CharField(max_length=120, blank=True, default="")
    receiver_account_identifier = models.CharField(max_length=120, blank=True, default="")
    receiver_card_identifier = models.CharField(max_length=120, blank=True, default="")
    counterparty_text = models.CharField(max_length=255, blank=True, default="")
    reference = models.CharField(max_length=120, blank=True, default="")
    balance_after = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    fee_amount = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    possible_internal_transfer = models.BooleanField(default=False)
    related_match_reason = models.CharField(max_length=255, blank=True, default="")
    confidence = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("1"))],
    )
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.NEEDS_REVIEW)
    parser_name = models.CharField(max_length=120, blank=True)
    parser_notes = models.TextField(blank=True)
    rejection_reason = models.CharField(max_length=32, choices=RejectionReason.choices, blank=True, default="")
    rejection_note = models.CharField(max_length=255, blank=True, default="")
    rejected_at = models.DateTimeField(blank=True, null=True)
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


class SmsDeviceStatus(models.Model):
    class PermissionState(models.TextChoices):
        UNKNOWN = "unknown", "Unknown"
        GRANTED = "granted", "Granted"
        DENIED = "denied", "Denied"

    class BackgroundState(models.TextChoices):
        IDLE = "idle", "Idle"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        ERROR = "error", "Error"
        DISABLED = "disabled", "Disabled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sms_device_status",
    )
    device_id = models.CharField(max_length=120, blank=True, default="")
    platform = models.CharField(max_length=32, blank=True, default="android")
    app_version = models.CharField(max_length=32, blank=True, default="")
    sms_permission_state = models.CharField(
        max_length=16,
        choices=PermissionState.choices,
        default=PermissionState.UNKNOWN,
    )
    background_state = models.CharField(
        max_length=16,
        choices=BackgroundState.choices,
        default=BackgroundState.IDLE,
    )
    pending_upload_count = models.PositiveIntegerField(default=0)
    failed_upload_count = models.PositiveIntegerField(default=0)
    last_error = models.CharField(max_length=255, blank=True, default="")
    last_scan_at = models.DateTimeField(blank=True, null=True)
    last_successful_sync_at = models.DateTimeField(blank=True, null=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"SMS device status for {self.user}"

    @property
    def health_state(self):
        if self.sms_permission_state != self.PermissionState.GRANTED:
            return "permission_required"
        if self.background_state == self.BackgroundState.DISABLED:
            return "background_disabled"
        if self.background_state == self.BackgroundState.ERROR or self.failed_upload_count:
            return "error"
        if self.background_state == self.BackgroundState.RUNNING:
            return "syncing"
        if self.last_seen_at < timezone.now() - timedelta(hours=24):
            return "offline"
        if self.last_successful_sync_at is None:
            return "setup_required"
        return "healthy"

    @property
    def health_label(self):
        labels = {
            "permission_required": "SMS permission required",
            "background_disabled": "Background sync is disabled",
            "error": "Sync needs attention",
            "syncing": "Sync in progress",
            "offline": "Mobile app has not checked in",
            "setup_required": "Run the first SMS scan",
            "healthy": "Mobile sync healthy",
        }
        return labels[self.health_state]
