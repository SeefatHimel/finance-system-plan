from collections.abc import Mapping
from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Account

from .models import BalanceSnapshot
from .services import snapshot_status_for_difference
from .timing import checkpoint_expected


class BalanceSnapshotSerializer(serializers.ModelSerializer):
    source_label = serializers.SerializerMethodField()

    def get_source_label(self, instance) -> str:
        if instance.cash_count_batch_id:
            return "Cash count"
        from django.core.exceptions import ObjectDoesNotExist
        try:
            return f"Spreadsheet checkpoint · {instance.bulk_import_checkpoint.batch.filename}"
        except ObjectDoesNotExist:
            return "Manual balance check"

    class Meta:
        model = BalanceSnapshot
        fields = (
            "id",
            "account",
            "checked_at",
            "source_label",
            "precision",
            "timing_order",
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
        expected_balance = checkpoint_expected(account, validated_data["checked_at"], validated_data.get("precision", "end_of_day"), validated_data.get("timing_order", {}))
        difference = (validated_data["actual_balance"] - expected_balance).quantize(Decimal("0.01"))
        return BalanceSnapshot.objects.create(
            **validated_data,
            expected_balance=expected_balance,
            difference=difference,
            status=snapshot_status_for_difference(difference),
            user=self.context["request"].user,
        )

    def validate_timing_order(self, value):
        if not isinstance(value, dict) or len(value) > 1000:
            raise serializers.ValidationError("Provide at most 1,000 explicit before/after decisions.")
        import uuid
        for key, position in value.items():
            try:
                uuid.UUID(key)
            except (ValueError, TypeError, AttributeError) as exc:
                raise serializers.ValidationError("Use a transaction identifier for timing decisions.") from exc
            if position not in {"before", "after"}:
                raise serializers.ValidationError("Choose before or after for each untimed entry.")
        return value

    def update(self, instance, validated_data):
        account = validated_data.get("account", instance.account)
        expected = checkpoint_expected(account, validated_data.get("checked_at", instance.checked_at), validated_data.get("precision", instance.precision), validated_data.get("timing_order", instance.timing_order))
        actual = validated_data.get("actual_balance", instance.actual_balance)
        validated_data.update(expected_balance=expected, difference=actual - expected, status=snapshot_status_for_difference(actual - expected))
        return super().update(instance, validated_data)

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user_id = request.user.pk if request and request.user.is_authenticated else None
        fields["account"].queryset = Account.objects.filter(
            user_id=user_id,
            is_active=True,
        )
        return fields


class EvidenceInputSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError({field: "This field is not supported by this evidence decision." for field in sorted(unknown)})
        return super().to_internal_value(data)


class EvidenceSourceRefSerializer(EvidenceInputSerializer):
    kind = serializers.ChoiceField(choices=("sms", "statement"))
    id = serializers.UUIDField()
    component = serializers.ChoiceField(choices=("principal", "fee"))

    def validate(self, attrs):
        if attrs["kind"] == "sms" and attrs["component"] != "principal":
            raise serializers.ValidationError("SMS fee components require separate review.")
        return attrs


class EvidenceProposalInputSerializer(EvidenceInputSerializer):
    sources = EvidenceSourceRefSerializer(many=True, min_length=1, max_length=2)
    transaction = serializers.UUIDField(required=False)

    def validate_sources(self, sources):
        if len({s["kind"] for s in sources}) != len(sources):
            raise serializers.ValidationError(
                "Choose at most one SMS and one statement component."
            )
        return sources


class EvidenceApplySerializer(EvidenceInputSerializer):
    fingerprint = serializers.RegexField(r"^[a-f0-9]{64}$")
    idempotency_key = serializers.UUIDField()
    balance_source = serializers.ChoiceField(
        choices=("existing", "sms", "statement"), default="existing"
    )
    acknowledge_match = serializers.BooleanField(default=False)
    acknowledge_conflict = serializers.BooleanField(default=False)
    acknowledge_issues = serializers.BooleanField(default=False)


class EvidenceSourceSummarySerializer(EvidenceSourceRefSerializer):
    account = serializers.UUIDField(allow_null=True)
    amount = serializers.CharField(allow_null=True)
    currency = serializers.CharField(allow_blank=True)
    direction = serializers.CharField()
    date = serializers.DateField(allow_null=True)
    time = serializers.TimeField(allow_null=True)
    balance_after = serializers.CharField(allow_null=True)
    updated_at = serializers.DateTimeField()


class EvidenceTargetSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    type = serializers.CharField()
    account = serializers.UUIDField()
    transfer_account = serializers.UUIDField(allow_null=True)
    amount = serializers.CharField()
    currency = serializers.CharField()
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True)
    updated_at = serializers.DateTimeField()


class EvidenceMatchSignalSerializer(serializers.Serializer):
    source = EvidenceSourceRefSerializer()
    corroborated = serializers.BooleanField()
    contradictions = serializers.ListField(child=serializers.CharField())
    reasons = serializers.ListField(child=serializers.CharField())


class EvidenceMatchSerializer(EvidenceTargetSerializer):
    signals = EvidenceMatchSignalSerializer(many=True)


class EvidenceCoverageSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    sms = serializers.ListField(child=serializers.UUIDField())
    statement = serializers.ListField(child=serializers.UUIDField())
    legacy_sms = serializers.BooleanField()
    manual = serializers.BooleanField()


class EvidenceBalanceChoiceSerializer(serializers.Serializer):
    source = serializers.ChoiceField(choices=("existing", "sms", "statement"))
    value = serializers.CharField(allow_null=True)


class EvidenceFieldChangeSerializer(serializers.Serializer):
    field = serializers.ChoiceField(choices=("reported_balance",))
    account = serializers.UUIDField()
    current = serializers.CharField(allow_null=True)
    proposed = serializers.CharField(allow_null=True)
    origin = serializers.ChoiceField(choices=("sms", "statement"))


class EvidenceImpactSerializer(serializers.Serializer):
    ledger_movements = serializers.IntegerField()
    ledger_amount = serializers.CharField()
    classification_changed = serializers.BooleanField()


class EvidenceProposalSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    fingerprint = serializers.CharField()
    expires_at = serializers.DateTimeField()
    policy_version = serializers.CharField()
    intent = serializers.ChoiceField(choices=("attach", "blocked"))
    sources = EvidenceSourceSummarySerializer(many=True)
    target = EvidenceTargetSerializer(allow_null=True)
    matches = EvidenceMatchSerializer(many=True)
    truncated = serializers.BooleanField()
    blocked_reasons = serializers.ListField(child=serializers.CharField())
    required_decisions = serializers.ListField(child=serializers.CharField())
    balance_choices = EvidenceBalanceChoiceSerializer(many=True)
    can_fill_missing_balance = serializers.BooleanField()
    field_changes = EvidenceFieldChangeSerializer(many=True)
    coverage_before = EvidenceCoverageSerializer(many=True)
    coverage_after = EvidenceCoverageSerializer(many=True)
    impact = EvidenceImpactSerializer()
    limitations = serializers.ListField(child=serializers.CharField())


class EvidenceReceiptSerializer(serializers.Serializer):
    from apps.transactions.serializers import TransactionActionSerializer

    undo_action = TransactionActionSerializer(allow_null=True)
    proposal = serializers.UUIDField()
    transaction = serializers.UUIDField()
    intent = serializers.ChoiceField(choices=("attach",))
    sources = EvidenceSourceRefSerializer(many=True)
    coverage = EvidenceCoverageSerializer(many=True)
    balances = serializers.DictField(child=serializers.CharField(allow_null=True))
    ledger_movements_added = serializers.IntegerField()
    unchanged = serializers.BooleanField()
