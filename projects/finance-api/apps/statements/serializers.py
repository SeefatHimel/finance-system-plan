from decimal import Decimal
from typing import ClassVar

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .models import StatementImport, StatementRow
from .parser import MAX_BYTES


class StatementPreviewRequestSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    file = serializers.FileField()
    password = serializers.CharField(
        required=False,
        allow_blank=True,
        write_only=True,
        max_length=256,
        trim_whitespace=False,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["account"].queryset = Account.objects.filter(
                user=request.user, is_active=True
            )

    def validate_file(self, value):
        if value.size > MAX_BYTES:
            raise serializers.ValidationError("Choose a PDF no larger than 4 MiB.")
        if not value.name.lower().endswith(".pdf"):
            raise serializers.ValidationError("Choose a statement PDF.")
        return value

    def validate_account(self, value):
        if value.type not in {
            Account.Type.BANK,
            Account.Type.SAVINGS,
            Account.Type.MOBILE_WALLET,
        }:
            raise serializers.ValidationError(
                "Choose a bank, savings, or wallet account. Credit-card statement layouts are not supported yet."
            )
        if value.currency != "BDT":
            raise serializers.ValidationError(
                "Only BDT statement previews are currently supported."
            )
        return value


class StatementRowSerializer(serializers.Serializer):
    id = serializers.CharField()
    page = serializers.IntegerField()
    row = serializers.IntegerField()
    date = serializers.DateField(allow_null=True)
    time = serializers.TimeField(allow_null=True)
    posting_date = serializers.DateField(allow_null=True)
    value_date = serializers.DateField(allow_null=True)
    description = serializers.CharField()
    provider_type = serializers.CharField()
    reference = serializers.CharField()
    direction = serializers.ChoiceField(choices=["debit", "credit"])
    amount = serializers.CharField(allow_null=True)
    signed_fee = serializers.CharField()
    balance_after = serializers.CharField(allow_null=True)
    issues = serializers.ListField(child=serializers.CharField())
    bounds = serializers.ListField(child=serializers.FloatField())


class StatementCheckSerializer(serializers.Serializer):
    label = serializers.CharField()
    expected = serializers.CharField(allow_null=True)
    observed = serializers.CharField(allow_null=True)
    passed = serializers.BooleanField(allow_null=True)


class StatementPreviewSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    account_hint = serializers.CharField()
    account_identity = serializers.ChoiceField(choices=["matched_suffix", "verify"])
    profile = serializers.CharField()
    parser_version = serializers.CharField()
    currency = serializers.CharField()
    page_count = serializers.IntegerField()
    period_start = serializers.DateField(allow_null=True)
    period_end = serializers.DateField(allow_null=True)
    opening_balance = serializers.CharField(allow_null=True)
    closing_balance = serializers.CharField(allow_null=True)
    balance_transitions_checked = serializers.IntegerField()
    needs_review_count = serializers.IntegerField()
    can_post = serializers.BooleanField()
    rows = StatementRowSerializer(many=True)
    checks = StatementCheckSerializer(many=True)
    warnings = serializers.ListField(child=serializers.CharField())


class StatementCountsSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    pending = serializers.IntegerField()
    posted = serializers.IntegerField()
    linked = serializers.IntegerField()
    skipped = serializers.IntegerField()


class StatementImportSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    counts = serializers.SerializerMethodField()

    @extend_schema_field(StatementCountsSerializer)
    def get_counts(self, instance):
        return {
            name: getattr(instance, f"count_{name}")
            for name in ("total", "pending", "posted", "linked", "skipped")
        }

    class Meta:
        model = StatementImport
        fields = (
            "id",
            "account",
            "account_name",
            "profile",
            "parser_version",
            "currency",
            "account_hint",
            "account_identity",
            "period_start",
            "period_end",
            "page_count",
            "checks",
            "warnings",
            "opening_balance",
            "closing_balance",
            "counts",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class StatementMatchSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True)
    type = serializers.CharField()
    source = serializers.CharField()
    amount = serializers.CharField()
    account_name = serializers.CharField()
    transfer_account_name = serializers.CharField(allow_null=True)
    category_name = serializers.CharField(allow_null=True)
    reference = serializers.CharField()
    note = serializers.CharField()
    balance_after = serializers.CharField(allow_null=True)
    conflict = serializers.BooleanField()
    can_link = serializers.BooleanField()
    reasons = serializers.ListField(child=serializers.CharField())


class StatementReviewSerializer(serializers.Serializer):
    issues = serializers.ListField(child=serializers.CharField())
    review_state = serializers.CharField()
    matches = StatementMatchSerializer(many=True)
    matching_truncated = serializers.BooleanField()
    requires_acknowledgement = serializers.BooleanField()


class SavedStatementRowSerializer(serializers.ModelSerializer):
    extracted = StatementRowSerializer(read_only=True)
    review = serializers.SerializerMethodField()

    @extend_schema_field(StatementReviewSerializer)
    def get_review(self, instance):
        from .services import review_context

        return review_context(
            instance,
            self.context.get("matches", {}).get(instance.id, []),
            self.context.get("matching_truncated", False),
        )

    class Meta:
        model = StatementRow
        fields = (
            "id",
            "batch",
            "position",
            "component",
            "extracted",
            "date",
            "time",
            "value_date",
            "direction",
            "amount",
            "balance_after",
            "type",
            "other_account",
            "category",
            "reference",
            "counterparty_text",
            "note",
            "classification_confirmed",
            "state",
            "transaction",
            "version",
            "review",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class StatementRowEditSerializer(serializers.ModelSerializer):
    version = serializers.IntegerField(min_value=1, required=True)

    class Meta:
        model = StatementRow
        fields = (
            "version",
            "date",
            "time",
            "value_date",
            "direction",
            "amount",
            "balance_after",
            "type",
            "other_account",
            "category",
            "reference",
            "counterparty_text",
            "note",
            "classification_confirmed",
        )
        extra_kwargs: ClassVar = {
            "amount": {"min_value": Decimal("0.01")},
            "note": {"max_length": 4000},
        }

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user = request.user if request and request.user.is_authenticated else None
        fields["other_account"].queryset = (
            Account.objects.filter(user=user, is_active=True)
            if user
            else Account.objects.none()
        )
        fields["category"].queryset = (
            Category.objects.filter(user=user, is_active=True)
            if user
            else Category.objects.none()
        )
        return fields

    def validate_other_account(self, value):
        if value and (
            value.id == self.instance.batch.account_id
            or value.currency != self.instance.batch.currency
        ):
            raise serializers.ValidationError(
                "Choose a different owned account in the statement currency."
            )
        return value

    def validate(self, attrs):
        if "version" not in attrs:
            raise serializers.ValidationError(
                {"version": "Reload the row and include its version before saving."}
            )
        return attrs


class StatementDecisionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(
        choices=("create", "link", "skip", "unlink", "reopen")
    )
    version = serializers.IntegerField(min_value=1)
    transaction = serializers.PrimaryKeyRelatedField(
        queryset=Transaction.objects.none(), required=False
    )
    allow_separate = serializers.BooleanField(default=False)
    acknowledge_issues = serializers.BooleanField(default=False)
    acknowledge_conflict = serializers.BooleanField(default=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["transaction"].queryset = Transaction.objects.filter(
                user=request.user
            )

    def validate(self, attrs):
        if attrs["action"] == "link" and "transaction" not in attrs:
            raise serializers.ValidationError(
                {"transaction": "Choose a matching transaction."}
            )
        return attrs


class StatementBulkRowSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)


class StatementBulkSerializer(serializers.Serializer):
    rows = StatementBulkRowSerializer(many=True, min_length=1, max_length=50)

    def validate_rows(self, value):
        if len({r["id"] for r in value}) != len(value):
            raise serializers.ValidationError("Choose each row once.")
        return value


class StatementRowPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    offset = serializers.IntegerField()
    limit = serializers.IntegerField()
    results = SavedStatementRowSerializer(many=True)


class StatementBulkResultSerializer(serializers.Serializer):
    added = serializers.IntegerField()
    unchanged = serializers.IntegerField()
    unresolved = serializers.ListField(child=serializers.DictField())
