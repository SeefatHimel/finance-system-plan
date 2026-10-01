import re
from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction

from .models import (
    ParsedMessageCandidate,
    RawMessage,
    SenderRule,
    SmsCapturePreference,
    SmsDeviceStatus,
)


CAPTURE_MESSAGE_KIND_CHOICES = tuple(
    choice
    for choice, _label in ParsedMessageCandidate.MessageKind.choices
    if choice != ParsedMessageCandidate.MessageKind.UNKNOWN
)


class SenderRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = SenderRule
        fields = (
            "id",
            "account",
            "payment_method",
            "category",
            "name",
            "provider",
            "sender",
            "match_type",
            "pattern",
            "default_transaction_type",
            "priority",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        return account

    def validate_payment_method(self, payment_method):
        if payment_method and payment_method.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Payment method does not belong to this user.")
        return payment_method

    def validate_category(self, category):
        if category and category.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Category does not belong to this user.")
        return category

    def validate(self, attrs):
        account = attrs.get("account", getattr(self.instance, "account", None))
        payment_method = attrs.get(
            "payment_method",
            getattr(self.instance, "payment_method", None),
        )

        if payment_method and account and payment_method.account_id != account.id:
            raise serializers.ValidationError(
                {"payment_method": "Payment method must belong to the selected account."}
            )

        sender = attrs.get("sender", getattr(self.instance, "sender", "")).strip()
        if "sender" in attrs:
            attrs["sender"] = sender
        match_type = attrs.get(
            "match_type",
            getattr(self.instance, "match_type", SenderRule.MatchType.EXACT),
        )
        duplicate_rules = SenderRule.objects.filter(
            user=self.context["request"].user,
            sender__iexact=sender,
            match_type=match_type,
        )
        if self.instance:
            duplicate_rules = duplicate_rules.exclude(id=self.instance.id)
        if sender and duplicate_rules.exists():
            raise serializers.ValidationError(
                {"sender": "A sender rule with this sender and match type already exists."}
            )

        pattern = attrs.get("pattern", getattr(self.instance, "pattern", "")).strip()
        if "pattern" in attrs:
            attrs["pattern"] = pattern
        if match_type == SenderRule.MatchType.REGEX:
            try:
                re.compile(pattern or sender, flags=re.IGNORECASE)
            except re.error as error:
                raise serializers.ValidationError(
                    {"pattern": f"Enter a valid regular expression: {error}."}
                ) from error

        return attrs

    def get_fields(self):
        fields = super().get_fields()
        user = self.context["request"].user
        fields["account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["payment_method"].queryset = PaymentMethod.objects.filter(
            user=user,
            is_active=True,
        )
        fields["category"].queryset = Category.objects.filter(user=user, is_active=True)
        return fields


class RawMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = RawMessage
        fields = (
            "id",
            "sender",
            "body",
            "received_at",
            "device_message_id",
            "body_hash",
            "provider",
            "message_kind",
            "exclusion_reason",
            "status",
            "duplicate_of",
            "created_at",
            "redacted_at",
        )
        read_only_fields = (
            "id",
            "body_hash",
            "provider",
            "message_kind",
            "exclusion_reason",
            "status",
            "duplicate_of",
            "created_at",
            "redacted_at",
        )


class RawMessageImportSerializer(serializers.Serializer):
    sender = serializers.CharField(max_length=120)
    body = serializers.CharField()
    received_at = serializers.DateTimeField()
    device_message_id = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
    )
    reprocess_existing = serializers.BooleanField(required=False, default=False)


class ParsedMessageCandidateSerializer(serializers.ModelSerializer):
    raw_message = RawMessageSerializer(read_only=True)

    class Meta:
        model = ParsedMessageCandidate
        fields = (
            "id",
            "raw_message",
            "sender_rule",
            "account",
            "payment_method",
            "category",
            "destination_account",
            "destination_payment_method",
            "transaction",
            "possible_related_candidate",
            "provider",
            "message_kind",
            "transaction_type",
            "amount",
            "counterparty_text",
            "reference",
            "balance_after",
            "fee_amount",
            "possible_internal_transfer",
            "related_match_reason",
            "confidence",
            "status",
            "parser_name",
            "parser_notes",
            "rejection_reason",
            "rejection_note",
            "rejected_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "raw_message",
            "sender_rule",
            "account",
            "payment_method",
            "category",
            "destination_account",
            "destination_payment_method",
            "transaction",
            "possible_related_candidate",
            "provider",
            "message_kind",
            "transaction_type",
            "amount",
            "counterparty_text",
            "reference",
            "balance_after",
            "fee_amount",
            "possible_internal_transfer",
            "related_match_reason",
            "confidence",
            "status",
            "parser_name",
            "parser_notes",
            "rejection_reason",
            "rejection_note",
            "rejected_at",
            "created_at",
            "updated_at",
        )


class SmsCapturePreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmsCapturePreference
        fields = (
            "excluded_providers",
            "excluded_message_kinds",
            "raw_sms_retention_days",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def validate_excluded_providers(self, providers):
        allowed = {choice for choice, _label in SenderRule.Provider.choices}
        invalid = set(providers) - allowed
        if invalid:
            raise serializers.ValidationError(
                f"Unsupported provider values: {', '.join(sorted(invalid))}."
            )
        return list(dict.fromkeys(providers))

    def validate_excluded_message_kinds(self, message_kinds):
        invalid = set(message_kinds) - set(CAPTURE_MESSAGE_KIND_CHOICES)
        if invalid:
            raise serializers.ValidationError(
                f"Unsupported message kind values: {', '.join(sorted(invalid))}."
            )
        return list(dict.fromkeys(message_kinds))


class SmsDeviceStatusSerializer(serializers.ModelSerializer):
    health_state = serializers.SerializerMethodField()
    health_label = serializers.SerializerMethodField()

    class Meta:
        model = SmsDeviceStatus
        fields = (
            "device_id",
            "platform",
            "app_version",
            "sms_permission_state",
            "background_state",
            "pending_upload_count",
            "failed_upload_count",
            "last_error",
            "last_scan_at",
            "last_successful_sync_at",
            "last_seen_at",
            "health_state",
            "health_label",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("health_state", "health_label", "last_seen_at", "created_at", "updated_at")

    def get_health_state(self, instance):
        return instance.health_state

    def get_health_label(self, instance):
        return instance.health_label


class MessageCandidateRejectSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=ParsedMessageCandidate.RejectionReason.choices)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    redact_raw_sms = serializers.BooleanField(required=False, default=False)
    exclude_sender = serializers.BooleanField(required=False, default=False)
    exclude_provider = serializers.BooleanField(required=False, default=False)


class ParsedMessageConfirmSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none(), required=False)
    transfer_account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(),
        required=False,
        allow_null=True,
    )
    amount = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.01"),
        required=False,
    )
    balance_after = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(),
        required=False,
        allow_null=True,
    )
    payment_method = serializers.PrimaryKeyRelatedField(
        queryset=PaymentMethod.objects.none(),
        required=False,
        allow_null=True,
    )
    date = serializers.DateField(required=False)
    direction = serializers.ChoiceField(choices=Transaction.Direction.choices, required=False)
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)
    counterparty_text = serializers.CharField(max_length=255, required=False, allow_blank=True)
    note = serializers.CharField(required=False, allow_blank=True)
    type = serializers.ChoiceField(choices=Transaction.Type.choices, required=False)
    remember_mapping = serializers.BooleanField(required=False, default=False)

    def get_fields(self):
        fields = super().get_fields()
        user = self.context["request"].user
        fields["account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["transfer_account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["category"].queryset = Category.objects.filter(user=user, is_active=True)
        fields["payment_method"].queryset = PaymentMethod.objects.filter(user=user, is_active=True)
        return fields
