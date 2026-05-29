from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Account

from .models import BalanceSnapshot
from .services import calculate_expected_balance, snapshot_status_for_difference


class BalanceSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = BalanceSnapshot
        fields = (
            "id",
            "account",
            "checked_at",
            "actual_balance",
            "expected_balance",
            "difference",
            "status",
            "adjustment_transaction",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "expected_balance",
            "difference",
            "status",
            "adjustment_transaction",
            "created_at",
            "updated_at",
        )

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        return account

    def create(self, validated_data):
        account = validated_data["account"]
        expected_balance = calculate_expected_balance(
            account=account,
            as_of_date=validated_data["checked_at"].date(),
        )
        difference = (validated_data["actual_balance"] - expected_balance).quantize(Decimal("0.01"))
        return BalanceSnapshot.objects.create(
            **validated_data,
            expected_balance=expected_balance,
            difference=difference,
            status=snapshot_status_for_difference(difference),
            user=self.context["request"].user,
        )

    def get_fields(self):
        fields = super().get_fields()
        fields["account"].queryset = Account.objects.filter(
            user=self.context["request"].user,
            is_active=True,
        )
        return fields
