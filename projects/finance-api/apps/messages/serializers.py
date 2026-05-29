from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction

from .models import ParsedMessageCandidate, RawMessage, SenderRule


class SenderRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = SenderRule
        fields = (
            "id",
            "account",
            "payment_method",
            "name",
            "provider",
            "sender",
            "match_type",
            "pattern",
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

        return attrs

    def get_fields(self):
        fields = super().get_fields()
        user = self.context["request"].user
        fields["account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["payment_method"].queryset = PaymentMethod.objects.filter(
            user=user,
            is_active=True,
        )
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
            "status",
            "duplicate_of",
            "created_at",
        )
        read_only_fields = (
            "id",
            "body_hash",
            "status",
            "duplicate_of",
            "created_at",
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
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "raw_message",
            "sender_rule",
            "account",
            "payment_method",
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
            "created_at",
            "updated_at",
        )


class ParsedMessageConfirmSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none(), required=False)
    amount = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.01"),
        required=False,
    )
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(),
        required=False,
        allow_null=True,
    )
    date = serializers.DateField(required=False)
    note = serializers.CharField(required=False, allow_blank=True)
    type = serializers.ChoiceField(choices=Transaction.Type.choices, required=False)

    def get_fields(self):
        fields = super().get_fields()
        user = self.context["request"].user
        fields["account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["category"].queryset = Category.objects.filter(user=user, is_active=True)
        return fields
