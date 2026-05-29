from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.transactions.models import Transaction

from .models import Debt, DebtPayment


class DebtSerializer(serializers.ModelSerializer):
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


class DebtPaymentSerializer(serializers.ModelSerializer):
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
        )
        read_only_fields = ("id", "debt", "created_at", "updated_at")

    def validate_transaction(self, payment_transaction):
        if payment_transaction and payment_transaction.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transaction does not belong to this user.")
        return payment_transaction

    def validate_amount(self, amount):
        debt = self.context["debt"]
        if amount > debt.current_balance:
            raise serializers.ValidationError("Payment cannot exceed the current debt balance.")
        return amount

    @transaction.atomic
    def create(self, validated_data):
        debt = self.context["debt"]
        payment = DebtPayment.objects.create(
            **validated_data,
            debt=debt,
            user=self.context["request"].user,
        )
        debt.current_balance = (debt.current_balance - payment.amount).quantize(Decimal("0.01"))
        debt.status = Debt.Status.PAID if debt.current_balance == Decimal("0.00") else Debt.Status.PARTIALLY_PAID
        debt.save(update_fields=("current_balance", "status", "updated_at"))
        return payment
