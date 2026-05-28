from rest_framework import serializers

from apps.accounts.models import Account
from apps.payment_methods.models import PaymentMethod

from .models import SenderRule


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
