from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.messages.identifiers import sanitize_financial_identifier
from apps.messages.models import RawMessage
from apps.payment_methods.models import PaymentMethod

from .balance_reports import (
    account_reports,
    primary_transfer_evidence,
    write_account_reports,
)
from .models import Transaction, TransferEvidence


class TransactionSourceMessageSerializer(serializers.ModelSerializer):
    body = serializers.SerializerMethodField()

    def get_body(self, instance):
        if (
            instance.status == RawMessage.Status.REDACTED
            or instance.redacted_at
            or instance.exclusion_reason
        ):
            return None
        return instance.body

    class Meta:
        model = RawMessage
        fields = ("id", "sender", "body", "received_at", "status", "redacted_at")
        read_only_fields = fields


class AccountReportedBalanceSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    balance_after = serializers.DecimalField(
        max_digits=14, decimal_places=2, allow_null=True
    )

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            fields["account"].queryset = Account.objects.filter(
                user=request.user, is_active=True
            )
        return fields


@extend_schema_field(AccountReportedBalanceSerializer(many=True))
class AccountReportedBalancesField(serializers.Field):
    def get_attribute(self, instance):
        return instance

    def to_internal_value(self, data):
        if not isinstance(data, list) or len(data) > 2:
            raise serializers.ValidationError(
                "Provide at most two account balance reports."
            )
        child = AccountReportedBalanceSerializer(
            data=data, many=True, context=self.context
        )
        child.is_valid(raise_exception=True)
        return child.validated_data

    def to_representation(self, record):
        if record.type != Transaction.Type.TRANSFER:
            return []
        chosen, primary = account_reports(record)
        return [
            {
                "account": str(account_id),
                "balance_after": (
                    str(chosen[account_id].balance_after)
                    if account_id in chosen
                    and chosen[account_id].balance_after is not None
                    else str(record.balance_after)
                    if not primary
                    and not chosen
                    and account_id == record.account_id
                    and record.balance_after is not None
                    else None
                ),
            }
            for account_id in (record.account_id, record.transfer_account_id)
        ]


class TransferEvidenceSerializer(serializers.ModelSerializer):
    is_primary = serializers.SerializerMethodField()

    def get_is_primary(self, instance):
        record = instance.transaction
        primary = primary_transfer_evidence(record, record.transfer_evidence.all())
        return primary is not None and instance.pk == primary.pk

    class Meta:
        model = TransferEvidence
        fields = (
            "id",
            "account",
            "raw_message",
            "is_primary",
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


class TransactionActionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.CharField()
    label = serializers.CharField()
    transaction = serializers.UUIDField(allow_null=True)
    created_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    can_undo = serializers.BooleanField()
    undone = serializers.BooleanField()


class UndoRequestSerializer(serializers.Serializer):
    action = serializers.UUIDField()


class TransactionSerializer(serializers.ModelSerializer):
    undo_action = TransactionActionSerializer(read_only=True, default=None, allow_null=True)
    reported_balances = AccountReportedBalancesField(required=False)
    balance_reporting_account = serializers.SerializerMethodField()
    allow_linked_correction = serializers.BooleanField(required=False, write_only=True)
    transfer_evidence = TransferEvidenceSerializer(many=True, read_only=True)
    account_direction = serializers.SerializerMethodField()
    statement_evidence_count = serializers.SerializerMethodField()

    @extend_schema_field(serializers.UUIDField())
    def get_balance_reporting_account(self, record):
        primary = (
            primary_transfer_evidence(record, list(record.transfer_evidence.all()))
            if record.type == Transaction.Type.TRANSFER
            else None
        )
        return str(primary.account_id if primary else record.account_id)

    @extend_schema_field(serializers.IntegerField())
    def get_statement_evidence_count(self, instance):
        count = getattr(instance, "statement_count", None)
        return count if count is not None else instance.statement_rows.count()

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
        validated_data.pop("allow_linked_correction", None)
        if validated_data["type"] != Transaction.Type.TRANSFER:
            key = validated_data.get("external_key")
            if key:
                existing = Transaction.objects.filter(user=validated_data["user"], external_key=key).first()
                if existing:
                    if any(getattr(existing, field) != value for field, value in validated_data.items()):
                        raise serializers.ValidationError({"detail": "This entry was already saved with different details. Use Edit to correct it."})
                    self.reused_transfer = True
                    return existing
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
        reports = validated_data.pop("reported_balances", None)
        allow_linked_correction = validated_data.pop("allow_linked_correction", False)
        evidence_items = list(instance.transfer_evidence.all())
        core_changed = any(
            field in validated_data
            and validated_data[field] != getattr(instance, field)
            for field in ("type", "account", "transfer_account", "amount")
        )
        statement_changed = core_changed or (
            "direction" in validated_data
            and validated_data["direction"] != instance.direction
        )
        if (
            statement_changed
            and instance.statement_rows.exists()
            and not allow_linked_correction
        ):
            raise serializers.ValidationError(
                {
                    "allow_linked_correction": "Review the linked statement evidence and confirm this ledger correction before changing its type, accounts, direction or amount."
                }
            )
        involves_transfer = (
            instance.type == Transaction.Type.TRANSFER
            or validated_data.get("type") == Transaction.Type.TRANSFER
        )
        if (
            involves_transfer
            and len(evidence_items) > 1
            and core_changed
            and not allow_linked_correction
        ):
            raise serializers.ValidationError(
                {
                    "allow_linked_correction": "Review the linked messages and confirm this ledger correction before changing the transfer's type, accounts or amount."
                }
            )
        primary_evidence = primary_transfer_evidence(instance, evidence_items)
        was_transfer = instance.type == Transaction.Type.TRANSFER
        old_endpoint_ids = {instance.account_id, instance.transfer_account_id}
        old_reporting_account_id = (
            primary_evidence.account_id
            if was_transfer and primary_evidence
            else instance.account_id
        )
        old_reported_balance = instance.balance_after
        if was_transfer and primary_evidence and old_reported_balance is None:
            old_reported_balance = primary_evidence.balance_after
        if reports is not None and not was_transfer and primary_evidence:
            # Restore the original report when returning to a transfer. The
            # non-transfer scalar may have belonged to the other account.
            old_reporting_account_id = primary_evidence.account_id
            old_reported_balance = (
                instance.balance_after
                if instance.account_id == primary_evidence.account_id
                else primary_evidence.balance_after
            )
        primary_account = (
            validated_data.get("transfer_account", instance.transfer_account)
            if validated_data.get("type", instance.type) == Transaction.Type.TRANSFER
            and primary_evidence
            and primary_evidence.direction == "credit"
            else validated_data.get("account", instance.account)
        )
        new_type = validated_data.get("type", instance.type)
        new_from = validated_data.get("account", instance.account)
        new_to = validated_data.get("transfer_account", instance.transfer_account)
        # Swapping From/To changes debit/credit, not ownership of the report.
        if new_type == Transaction.Type.TRANSFER and old_reporting_account_id in {
            new_from.pk,
            new_to.pk,
        }:
            if reports is not None or (
                was_transfer
                and instance.account_id == new_to.pk
                and instance.transfer_account_id == new_from.pk
            ):
                primary_account = (
                    new_from if old_reporting_account_id == new_from.pk else new_to
                )
        reporting_account_changed = old_reporting_account_id != getattr(
            primary_account, "pk", None
        )
        if reporting_account_changed and (
            "balance_after" not in validated_data
            or validated_data["balance_after"] == old_reported_balance
        ):
            validated_data["balance_after"] = None
        elif not reporting_account_changed and "balance_after" not in validated_data:
            # Keep primary evidence usable when a transfer becomes a same-account
            # expense/income. Explicit null still means the user cleared the report.
            validated_data["balance_after"] = old_reported_balance
        original_report = {
            "account": primary_account,
            "balance_after": validated_data.get("balance_after", old_reported_balance),
            "raw_message": instance.raw_message,
            "reference": instance.reference,
            "date": instance.date,
            "time": instance.time,
            "source": instance.source,
            "external_key": instance.external_key,
            "note": instance.note,
        }
        instance = super().update(instance, validated_data)
        if instance.type == Transaction.Type.TRANSFER:
            endpoint_ids = {instance.account_id, instance.transfer_account_id}
            preserve_accounts = reports is not None or old_endpoint_ids == endpoint_ids
            retained_ids = {
                item.account_id
                for item in evidence_items
                if item.account_id in endpoint_ids
            }
            for evidence in evidence_items:
                new_account_id = (
                    instance.transfer_account_id
                    if evidence.direction == "credit"
                    else instance.account_id
                )
                if preserve_accounts and evidence.account_id in {
                    instance.account_id,
                    instance.transfer_account_id,
                }:
                    new_account_id = evidence.account_id
                    evidence.direction = (
                        "credit"
                        if new_account_id == instance.transfer_account_id
                        else "debit"
                    )
                elif preserve_accounts and new_account_id in retained_ids:
                    new_account_id = next(
                        pk for pk in endpoint_ids if pk not in retained_ids
                    )
                if new_account_id != evidence.account_id:
                    evidence.account_id = new_account_id
                    evidence.balance_after = None
                    evidence.fee_amount = None
                evidence.direction = (
                    "credit"
                    if new_account_id == instance.transfer_account_id
                    else "debit"
                )
                if primary_evidence and evidence.pk == primary_evidence.pk:
                    for field in ("balance_after", "reference", "date", "time", "note"):
                        if field in validated_data:
                            setattr(evidence, field, getattr(instance, field))
                evidence.save()
            if reports is not None:
                if not primary_evidence:
                    from .transfers import add_transfer_evidence

                    if (
                        original_report["raw_message"]
                        and TransferEvidence.objects.filter(
                            raw_message=original_report["raw_message"]
                        ).exists()
                    ):
                        raise serializers.ValidationError(
                            {
                                "raw_message": "This SMS is already linked to a transfer. Review and merge or link the existing movement instead."
                            }
                        )
                    add_transfer_evidence(instance, original_report)
                getattr(instance, "_prefetched_objects_cache", {}).pop(
                    "transfer_evidence", None
                )
                write_account_reports(instance, reports)
        # Keep observations as provenance when a transfer is reclassified.
        # Reporting only consumes them while this entry remains a transfer.
        getattr(instance, "_prefetched_objects_cache", {}).pop(
            "transfer_evidence", None
        )
        return instance

    class Meta:
        model = Transaction
        fields = (
            "undo_action",
            "id",
            "allow_linked_correction",
            "transfer_evidence",
            "account_direction",
            "statement_evidence_count",
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
            "reported_balances",
            "balance_reporting_account",
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
            "statement_evidence_count",
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
        reports = attrs.get("reported_balances")
        if reports is not None:
            if transaction_type != Transaction.Type.TRANSFER:
                raise serializers.ValidationError(
                    {
                        "reported_balances": "Account-specific balances are only available for transfers."
                    }
                )
            ids = [item["account"].pk for item in reports]
            if (
                len(ids) > 2
                or len(ids) != len(set(ids))
                or any(pk not in {account.pk, transfer_account.pk} for pk in ids)
            ):
                raise serializers.ValidationError(
                    {
                        "reported_balances": "Report each From/To account at most once; other accounts are not part of this transfer."
                    }
                )
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


class TransferBalanceChoiceSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    keep = serializers.ChoiceField(choices=("existing", "incoming"))
    existing_balance_after = serializers.DecimalField(max_digits=14, decimal_places=2)
    incoming_balance_after = serializers.DecimalField(max_digits=14, decimal_places=2)


class TransferLinkRequestSerializer(TransferMatchRequestSerializer):
    balance_choices = TransferBalanceChoiceSerializer(
        many=True, required=False, max_length=2
    )
    match_transaction = serializers.UUIDField(required=False)
    match_candidate = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if bool(attrs.get("match_transaction")) == bool(attrs.get("match_candidate")):
            raise serializers.ValidationError(
                "Choose exactly one matching transfer or pending message."
            )
        return attrs


class TransferMergeRequestSerializer(serializers.Serializer):
    balance_choices = TransferBalanceChoiceSerializer(
        many=True, required=False, max_length=2
    )
    transaction = serializers.UUIDField()


class TransferMatchSerializer(serializers.Serializer):
    reported_balances = AccountReportedBalanceSerializer(many=True, read_only=True)
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
