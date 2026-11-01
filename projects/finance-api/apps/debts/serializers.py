from django.db.models import Sum
from decimal import Decimal
from rest_framework import serializers

from apps.transactions.payments import LedgerPaymentSerializer, LockedPlanningUpdateMixin, PAYMENT_FIELDS, record_payment

from apps.transactions.models import Transaction

from .models import Debt, DebtPayment


class DebtSerializer(LockedPlanningUpdateMixin, serializers.ModelSerializer):
    class Meta:
        model = Debt
        fields = (
            "id",
            "counterparty_name",
            "opened_transaction",
            "direction",
            "principal_amount",
            "current_balance",
            "opened_at",
            "due_date",
            "status",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "current_balance", "status", "created_at", "updated_at")

    def validate_opened_transaction(self, opened_transaction):
        if opened_transaction and opened_transaction.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transaction does not belong to this user.")
        return opened_transaction

    def create(self, validated_data):
        return Debt.objects.create(
            **validated_data,
            current_balance=validated_data["principal_amount"],
            status=Debt.Status.OPEN,
            user=self.context["request"].user,
        )

    def validate(self, attrs):
        if self.instance:
            paid = self.instance.payments.aggregate(total=Sum("amount"))["total"] or Decimal("0")
            principal = attrs.get("principal_amount", self.instance.principal_amount)
            if principal < paid:
                raise serializers.ValidationError({"principal_amount": "Principal cannot be less than recorded repayments. Unlink an incorrect payment first."})
            if paid and attrs.get("direction", self.instance.direction) != self.instance.direction:
                raise serializers.ValidationError({"direction": "Unlink repayments before changing the debt direction."})
        return attrs

    def update_locked(self, instance, validated_data):
        paid = instance.payments.aggregate(total=Sum("amount"))["total"] or Decimal("0")
        instance = super().update_locked(instance, validated_data)
        instance.current_balance = instance.principal_amount - paid
        if instance.status != Debt.Status.WRITTEN_OFF:
            instance.status = Debt.Status.PAID if instance.current_balance == 0 else Debt.Status.PARTIALLY_PAID if paid else Debt.Status.OPEN
        instance.save(update_fields=("current_balance", "status", "updated_at"))
        return instance


class DebtPaymentSerializer(LedgerPaymentSerializer):
    class Meta:
        model = DebtPayment
        fields = (
            "id",
            "debt",
            "transaction",
            "amount",
            "paid_at",
            "note",
            "created_at",
            "updated_at",
        ) + PAYMENT_FIELDS
        read_only_fields = ("id", "debt", "created_at", "updated_at")

    def validate_transaction(self, payment_transaction):
        if payment_transaction and payment_transaction.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transaction does not belong to this user.")
        return payment_transaction

    def validate_amount(self, amount):
        # Checked under the parent lock after idempotent retry handling.
        return amount

    def create(self, validated_data):
        return record_payment(self, validated_data, "debt")
