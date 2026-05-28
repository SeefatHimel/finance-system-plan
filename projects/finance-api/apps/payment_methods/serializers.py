from rest_framework import serializers

from apps.accounts.models import Account

from .models import PaymentMethod


class PaymentMethodSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentMethod
        fields = (
            "id",
            "account",
            "name",
            "provider",
            "identifier",
            "is_active",
            "display_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        return account

    def get_fields(self):
        fields = super().get_fields()
        fields["account"].queryset = Account.objects.filter(
            user=self.context["request"].user,
            is_active=True,
        )
        return fields
