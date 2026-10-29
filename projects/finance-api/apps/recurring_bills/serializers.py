from rest_framework import serializers

from apps.transactions.payments import LedgerPaymentSerializer, PAYMENT_FIELDS, record_payment

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .models import RecurringBill, RecurringBillPayment


class RecurringBillSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringBill
        fields = (
            "id",
            "account",
            "category",
            "name",
            "amount",
            "frequency",
            "next_due_date",
            "status",
            "auto_create_transaction",
            "reminder_days_before",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        return account

    def validate_category(self, category):
        if category and category.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Category does not belong to this user.")
        return category

    def validate_reminder_days_before(self, value):
        if value > 60:
            raise serializers.ValidationError("Reminder lead time cannot exceed 60 days.")
        return value

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user_id = request.user.pk if request and request.user.is_authenticated else None
        fields["account"].queryset = Account.objects.filter(user_id=user_id, is_active=True)
        fields["category"].queryset = Category.objects.filter(user_id=user_id, is_active=True)
        return fields

    def create(self, validated_data):
        return RecurringBill.objects.create(
            **validated_data,
            user=self.context["request"].user,
        )


class RecurringBillPaymentSerializer(LedgerPaymentSerializer):
    class Meta:
        model = RecurringBillPayment
        fields = (
            "id",
            "bill",
            "transaction",
            "amount",
            "due_date",
            "paid_at",
            "note",
            "created_at",
            "updated_at",
        ) + PAYMENT_FIELDS
        read_only_fields = ("id", "bill", "due_date", "created_at", "updated_at")

    def validate_transaction(self, payment_transaction):
        if payment_transaction and payment_transaction.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Transaction does not belong to this user.")
        return payment_transaction

    def validate(self, attrs):
        bill = self.context["bill"]
        payment_transaction = attrs.get("transaction")
        if payment_transaction and payment_transaction.account_id != bill.account_id:
            raise serializers.ValidationError({"transaction": "Transaction must use the recurring bill account."})
        return attrs

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user_id = request.user.pk if request and request.user.is_authenticated else None
        fields["transaction"].queryset = Transaction.objects.filter(user_id=user_id)
        return fields

    def create(self, validated_data):
        return record_payment(self, validated_data, "recurring")
