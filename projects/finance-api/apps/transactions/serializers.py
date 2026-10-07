from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.messages.identifiers import sanitize_financial_identifier
from apps.messages.models import RawMessage
from apps.payment_methods.models import PaymentMethod

from .models import Transaction, TransferEvidence


class TransactionSourceMessageSerializer(serializers.ModelSerializer):
    body = serializers.SerializerMethodField()

    def get_body(self, instance):
        if instance.status == RawMessage.Status.REDACTED or instance.redacted_at or instance.exclusion_reason:
            return None
        return instance.body

    class Meta:
        model = RawMessage
        fields = ("id", "sender", "body", "received_at", "status", "redacted_at")
        read_only_fields = fields


class TransferEvidenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransferEvidence
        fields = (
            "id",
            "account",
            "raw_message",
            "direction",
            "date",
            "time",
            "balance_after",
            "fee_amount",
            "reference",
            "provider",
            "source",
            "note",
        )
        read_only_fields = fields


class TransactionSerializer(serializers.ModelSerializer):
    transfer_evidence = TransferEvidenceSerializer(many=True, read_only=True)
    account_direction = serializers.SerializerMethodField()

    def get_account_direction(self, instance):
        selected = self.context["request"].query_params.get("account")
        if instance.type == Transaction.Type.TRANSFER:
            return (
                Transaction.Direction.CREDIT
                if selected == str(instance.transfer_account_id)
                else Transaction.Direction.DEBIT
            )
        return instance.direction

    def create(self, validated_data):
        if validated_data["type"] != Transaction.Type.TRANSFER:
            return super().create(validated_data)
        from .transfers import add_transfer_evidence, manual_transfer_data

        user = validated_data.pop("user")
        canonical, observation = manual_transfer_data(validated_data)
        if canonical.get("external_key"):
            from .transfers import compatible

            existing = (
                TransferEvidence.objects.filter(
                    user=user, external_key=canonical["external_key"]
                )
                .select_related("transaction")
                .first()
            )
            if existing:
                if compatible(canonical, existing.transaction):
                    self.reused_transfer = True
                    return existing.transaction
                raise serializers.ValidationError(
                    {"external_key": "This entry key has already been used."}
                )
        record = Transaction.objects.create(user=user, **canonical)
        add_transfer_evidence(record, observation)
        return record

    def update(self, instance, validated_data):
        if instance.transfer_evidence.count() > 1:
            for field in ("type", "account", "transfer_account", "amount"):
                if field in validated_data and validated_data[field] != getattr(
                    instance, field
                ):
                    raise serializers.ValidationError(
                        {
                            field: "A linked transfer's accounts and amount cannot be changed. Review its linked evidence before replacing the transfer."
                        }
                    )
        instance = super().update(instance, validated_data)
        evidence = instance.transfer_evidence.filter(
            raw_message_id=instance.raw_message_id
        ).first()
        if evidence:
            if instance.type != Transaction.Type.TRANSFER:
                instance.transfer_evidence.all().delete()
            else:
                evidence.account_id = (
                    instance.transfer_account_id
                    if evidence.direction == "credit"
                    else instance.account_id
                )
                for field in ("balance_after", "reference", "date", "time", "note"):
                    if field in validated_data:
                        setattr(evidence, field, getattr(instance, field))
                evidence.save()
            getattr(instance, "_prefetched_objects_cache", {}).pop(
                "transfer_evidence", None
            )
        return instance

    class Meta:
        model = Transaction
        fields = (
            "id",
            "transfer_evidence",
            "account_direction",
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
            "sender_account_identifier",
            "sender_card_identifier",
            "receiver_account_identifier",
            "receiver_card_identifier",
            "reference",
            "counterparty_text",
            "external_key",
            "note",
            "source",
            "needs_review",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "created_at",
            "updated_at",
            "transfer_evidence",
            "account_direction",
        )

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        return account

    def validate_transfer_account(self, account):
        if account and account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError(
                "Transfer account does not belong to this user."
            )
        return account

    def validate_category(self, category):
        if category and category.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Category does not belong to this user.")
        return category

    def validate_payment_method(self, payment_method):
        if payment_method and payment_method.user_id != self.context["request"].user.id:
            raise serializers.ValidationError(
                "Payment method does not belong to this user."
            )
        return payment_method

    def validate_raw_message(self, raw_message):
        if raw_message and raw_message.user_id != self.context["request"].user.id:
            raise serializers.ValidationError(
                "Raw message does not belong to this user."
            )
        return raw_message

    def validate(self, attrs):
        for field_name in (
            "sender_account_identifier",
            "sender_card_identifier",
            "receiver_account_identifier",
            "receiver_card_identifier",
        ):
            if field_name in attrs:
                attrs[field_name] = sanitize_financial_identifier(attrs[field_name])

        transaction_type = attrs.get("type", getattr(self.instance, "type", None))
        transfer_account = attrs.get(
            "transfer_account",
            getattr(self.instance, "transfer_account", None),
        )

        if transaction_type == Transaction.Type.TRANSFER and transfer_account is None:
            raise serializers.ValidationError(
                {
                    "transfer_account": "Transfer transactions require a destination account."
                }
            )

        if (
            transaction_type != Transaction.Type.TRANSFER
            and transfer_account is not None
        ):
            raise serializers.ValidationError(
                {
                    "transfer_account": "Only transfer transactions can use a destination account."
                }
            )

        account = attrs.get("account", getattr(self.instance, "account", None))
        if account and transfer_account and account.id == transfer_account.id:
            raise serializers.ValidationError(
                {
                    "transfer_account": "Transfer account must be different from source account."
                }
            )

        payment_method = attrs.get(
            "payment_method", getattr(self.instance, "payment_method", None)
        )
        if payment_method and account and payment_method.account_id != account.id:
            raise serializers.ValidationError(
                {
                    "payment_method": "Payment method must belong to the selected account."
                }
            )

        if (
            "direction" not in attrs
            and transaction_type
            and (self.instance is None or "type" in attrs)
        ):
            attrs["direction"] = Transaction.default_direction_for_type(
                transaction_type
            )

        if self.instance and transaction_type == Transaction.Type.TRANSFER:
            attrs["direction"] = Transaction.Direction.DEBIT
        return attrs

    def get_fields(self):
        fields = super().get_fields()
        user = self.context["request"].user
        fields["account"].queryset = Account.objects.filter(user=user, is_active=True)
        fields["transfer_account"].queryset = Account.objects.filter(
            user=user, is_active=True
        )
        fields["category"].queryset = Category.objects.filter(user=user, is_active=True)
        fields["payment_method"].queryset = PaymentMethod.objects.filter(
            user=user, is_active=True
        )
        fields["raw_message"].queryset = RawMessage.objects.filter(user=user)
        return fields


class TransferMatchRequestSerializer(serializers.Serializer):
    candidate = serializers.UUIDField(required=False)
    draft = serializers.DictField(required=False, default=dict)
    exclude_transaction = serializers.UUIDField(required=False)


class TransferLinkRequestSerializer(TransferMatchRequestSerializer):
    match_transaction = serializers.UUIDField(required=False)
    match_candidate = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if bool(attrs.get("match_transaction")) == bool(attrs.get("match_candidate")):
            raise serializers.ValidationError(
                "Choose exactly one matching transfer or pending message."
            )
        return attrs


class TransferMergeRequestSerializer(serializers.Serializer):
    transaction = serializers.UUIDField()


class TransferMatchSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=("transaction", "candidate"))
    account = serializers.UUIDField()
    account_name = serializers.CharField()
    transfer_account = serializers.UUIDField()
    transfer_account_name = serializers.CharField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True)
    reference = serializers.CharField(allow_blank=True)
    reason = serializers.CharField()
