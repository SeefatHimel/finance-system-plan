from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.accounts.models import Account

from .models import CreditCardBill, CreditCardPayment


class CreditCardBillSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditCardBill
        fields = (
            "id",
            "account",
            "statement_transaction",
            "statement_balance",
            "minimum_due",
            "paid_amount",
            "remaining_balance",
            "statement_date",
            "due_date",
            "status",
            "reference",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "paid_amount",
            "remaining_balance",
            "status",
            "created_at",
            "updated_at",
        )

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        if account.type != Account.Type.CREDIT_CARD:
            raise serializers.ValidationError("Credit card bills must use a credit card account.")
        return account

    def validate_statement_transaction(self, statement_transaction):
        if statement_transaction and statement_transaction.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transaction does not belong to this user.")
        return statement_transaction

    def validate(self, attrs):
        statement_balance = attrs.get("statement_balance", getattr(self.instance, "statement_balance", None))
        minimum_due = attrs.get("minimum_due", getattr(self.instance, "minimum_due", Decimal("0.00")))
        statement_date = attrs.get("statement_date", getattr(self.instance, "statement_date", None))
        due_date = attrs.get("due_date", getattr(self.instance, "due_date", None))

        if statement_balance is not None and minimum_due > statement_balance:
            raise serializers.ValidationError({"minimum_due": "Minimum due cannot exceed statement balance."})
        if self.instance and statement_balance is not None and statement_balance < self.instance.paid_amount:
            raise serializers.ValidationError({"statement_balance": "Statement balance cannot be less than paid amount."})
        if statement_date and due_date and due_date < statement_date:
            raise serializers.ValidationError({"due_date": "Due date cannot be before statement date."})
        return attrs

    def create(self, validated_data):
        statement_balance = validated_data["statement_balance"]
        return CreditCardBill.objects.create(
            **validated_data,
            paid_amount=Decimal("0.00"),
            remaining_balance=statement_balance,
            status=CreditCardBill.Status.UNPAID,
            user=self.context["request"].user,
        )

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        instance.remaining_balance = (instance.statement_balance - instance.paid_amount).quantize(Decimal("0.01"))
        if instance.remaining_balance == Decimal("0.00"):
            instance.status = CreditCardBill.Status.PAID
        elif instance.paid_amount > Decimal("0.00"):
            instance.status = CreditCardBill.Status.PARTIALLY_PAID
        else:
            instance.status = CreditCardBill.Status.UNPAID
        instance.save(update_fields=("remaining_balance", "status", "updated_at"))
        return instance


class CreditCardPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditCardPayment
        fields = (
            "id",
            "bill",
            "transaction",
            "amount",
            "paid_at",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "bill", "created_at", "updated_at")

    def validate_transaction(self, payment_transaction):
        if payment_transaction and payment_transaction.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transaction does not belong to this user.")
        return payment_transaction

    def validate_amount(self, amount):
        bill = self.context["bill"]
        if amount > bill.remaining_balance:
            raise serializers.ValidationError("Payment cannot exceed the remaining bill balance.")
        return amount

    @transaction.atomic
    def create(self, validated_data):
        bill = self.context["bill"]
        payment = CreditCardPayment.objects.create(
            **validated_data,
            bill=bill,
            user=self.context["request"].user,
        )
        bill.paid_amount = (bill.paid_amount + payment.amount).quantize(Decimal("0.01"))
        bill.remaining_balance = (bill.remaining_balance - payment.amount).quantize(Decimal("0.01"))
        bill.status = (
            CreditCardBill.Status.PAID
            if bill.remaining_balance == Decimal("0.00")
            else CreditCardBill.Status.PARTIALLY_PAID
        )
        bill.save(update_fields=("paid_amount", "remaining_balance", "status", "updated_at"))
        return payment
