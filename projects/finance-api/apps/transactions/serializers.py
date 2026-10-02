from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.messages.models import RawMessage
from apps.payment_methods.models import PaymentMethod

from .models import Transaction


class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = (
            "id",
            "account",
            "transfer_account",
            "category",
            "payment_method",
            "raw_message",
            "date",
            "time",
            "type",
            "direction",
            "amount",
            "balance_after",
            "reference",
            "counterparty_text",
            "external_key",
            "note",
            "source",
            "needs_review",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        return account

    def validate_transfer_account(self, account):
        if account and account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transfer account does not belong to this user.")
        return account

    def validate_category(self, category):
        if category and category.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Category does not belong to this user.")
        return category

    def validate_payment_method(self, payment_method):
        if payment_method and payment_method.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Payment method does not belong to this user.")
        return payment_method

    def validate_raw_message(self, raw_message):
        if raw_message and raw_message.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Raw message does not belong to this user.")
        return raw_message

    def validate(self, attrs):
        transaction_type = attrs.get("type", getattr(self.instance, "type", None))
        transfer_account = attrs.get(
            "transfer_account",
            getattr(self.instance, "transfer_account", None),
        )

        if transaction_type == Transaction.Type.TRANSFER and transfer_account is None:
            raise serializers.ValidationError(
                {"transfer_account": "Transfer transactions require a destination account."}
            )

        if transaction_type != Transaction.Type.TRANSFER and transfer_account is not None:
            raise serializers.ValidationError(
                {"transfer_account": "Only transfer transactions can use a destination account."}
            )

        account = attrs.get("account", getattr(self.instance, "account", None))
        if account and transfer_account and account.id == transfer_account.id:
            raise serializers.ValidationError(
                {"transfer_account": "Transfer account must be different from source account."}
            )

        payment_method = attrs.get("payment_method", getattr(self.instance, "payment_method", None))
        if payment_method and account and payment_method.account_id != account.id:
            raise serializers.ValidationError(
                {"payment_method": "Payment method must belong to the selected account."}
            )

        if "direction" not in attrs and transaction_type and (self.instance is None or "type" in attrs):
            attrs["direction"] = Transaction.default_direction_for_type(transaction_type)

        return attrs

    def get_fields(self):
        fields = super().get_fields()
        user = self.context["request"].user
        fields["account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["transfer_account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["category"].queryset = Category.objects.filter(user=user, is_active=True)
        fields["payment_method"].queryset = PaymentMethod.objects.filter(user=user, is_active=True)
        fields["raw_message"].queryset = RawMessage.objects.filter(user=user)
        return fields
