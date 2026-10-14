from decimal import Decimal
from typing import ClassVar

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .details import DETAIL_FIELDS
from .models import StatementImport, StatementRow
from .parser import MAX_BYTES


class StatementIdentifyRequestSerializer(serializers.Serializer):
    file = serializers.FileField()
    password = serializers.CharField(
        required=False,
        allow_blank=True,
        write_only=True,
        max_length=256,
        trim_whitespace=False,
    )

    def validate_file(self, value):
        if value.size > MAX_BYTES:
            raise serializers.ValidationError("Choose a PDF no larger than 4 MiB.")
        if not value.name.lower().endswith(".pdf"):
            raise serializers.ValidationError("Choose a statement PDF.")
        return value


class StatementPreviewRequestSerializer(StatementIdentifyRequestSerializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["account"].queryset = Account.objects.filter(
                user=request.user, is_active=True
            )

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


class StatementIdentityChoiceSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    name = serializers.CharField()


class StatementAccountSuggestionSerializer(serializers.Serializer):
    requires_review = serializers.BooleanField(default=False)
    choices = StatementIdentityChoiceSerializer(many=True, default=list)
    account = serializers.UUIDField(allow_null=True)
    name = serializers.CharField(allow_blank=True)
    reason = serializers.CharField()
    ambiguous = serializers.BooleanField()


class StatementIdentifySerializer(serializers.Serializer):
    profile = serializers.CharField()
    account_hint = serializers.CharField()
    account_suggestion = StatementAccountSuggestionSerializer(allow_null=True)


class StatementPreviewSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    account_hint = serializers.CharField()
    account_identity = serializers.ChoiceField(choices=["matched_suffix", "verify"])
    account_suggestion = StatementAccountSuggestionSerializer(allow_null=True)
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
    account_suggestion = serializers.SerializerMethodField()

    @extend_schema_field(StatementAccountSuggestionSerializer(allow_null=True))
    def get_account_suggestion(self, instance):
        from apps.payment_methods.models import PaymentMethod
        from apps.payment_methods.resolution import statement_account_suggestion

        if "identity_methods" not in self.context:
            self.context["identity_methods"] = list(
                PaymentMethod.objects.filter(
                    user_id=instance.user_id, is_active=True, account__is_active=True
                ).select_related("account")
            )
        return statement_account_suggestion(
            user=instance.user_id,
            profile=instance.profile,
            hint=instance.account_hint,
            methods=self.context["identity_methods"],
        )

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
            "account_suggestion",
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


class StatementSummarySerializer(serializers.Serializer):
    totals = serializers.DictField()
    dispositions = serializers.DictField()
    source_net = serializers.CharField(allow_null=True)
    draft_net = serializers.CharField(allow_null=True)
    opening_is_derived = serializers.BooleanField()
    checks = StatementCheckSerializer(many=True)
    discrepancy_count = serializers.IntegerField()
    incomplete_count = serializers.IntegerField()
    remaining_count = serializers.IntegerField()


class StatementSuggestionSerializer(serializers.Serializer):
    type = serializers.CharField()
    category = serializers.UUIDField(allow_null=True)
    other_account = serializers.UUIDField(allow_null=True)
    reason = serializers.CharField()


class StatementDetailSuggestionSerializer(serializers.Serializer):
    field = serializers.CharField()
    label = serializers.CharField()
    existing_value = serializers.CharField(allow_blank=True)
    suggested_value = serializers.CharField(allow_blank=True)


class StatementMatchSerializer(serializers.Serializer):
    strength = serializers.ChoiceField(choices=["strong", "possible"])
    merchant_similarity = serializers.FloatField()
    time_difference_minutes = serializers.FloatField(allow_null=True)
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
    effective_balance_after = serializers.CharField(allow_null=True)
    detail_suggestions = StatementDetailSuggestionSerializer(many=True)
    conflict = serializers.BooleanField()
    can_link = serializers.BooleanField()
    reasons = serializers.ListField(child=serializers.CharField())


class PendingSmsStatementMatchSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    date = serializers.DateField()
    time = serializers.TimeField()
    sender = serializers.CharField()
    sms_text = serializers.CharField(allow_null=True)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    type = serializers.CharField()
    counterparty_text = serializers.CharField(allow_blank=True)
    balance_after = serializers.DecimalField(max_digits=14, decimal_places=2, allow_null=True)
    reference = serializers.CharField(allow_blank=True)
    confidence = serializers.DecimalField(max_digits=4, decimal_places=2)
    detail_suggestions = StatementDetailSuggestionSerializer(many=True)


class StatementReviewSerializer(serializers.Serializer):
    draft_issues = serializers.ListField(child=serializers.CharField())
    suggestion = StatementSuggestionSerializer(allow_null=True)
    issues = serializers.ListField(child=serializers.CharField())
    review_state = serializers.CharField()
    matches = StatementMatchSerializer(many=True)
    pending_sms_match_count = serializers.IntegerField(min_value=0, allow_null=True)
    pending_sms_matches = PendingSmsStatementMatchSerializer(many=True, required=False)
    matching_truncated = serializers.BooleanField()
    requires_acknowledgement = serializers.BooleanField()


class SavedStatementRowSerializer(serializers.ModelSerializer):
    extracted = StatementRowSerializer(read_only=True)
    review = serializers.SerializerMethodField()

    @extend_schema_field(StatementReviewSerializer)
    def get_review(self, instance):
        from .services import review_context

        result = review_context(
            instance,
            self.context.get("matches", {}).get(instance.id, []),
            self.context.get("matching_truncated", False),
            self.context.get("pending_sms_match_counts", {}).get(instance.id, 0),
        )
        result["pending_sms_matches"] = self.context.get("pending_sms_matches", [])
        return result

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


class StatementBalanceChoiceSerializer(serializers.Serializer):
    keep = serializers.ChoiceField(choices=("existing", "statement"))
    existing_balance_after = serializers.DecimalField(
        max_digits=14, decimal_places=2, allow_null=True
    )
    statement_balance_after = serializers.DecimalField(
        max_digits=14, decimal_places=2, allow_null=True
    )


class StatementDetailChoiceSerializer(serializers.Serializer):
    field = serializers.ChoiceField(choices=tuple(DETAIL_FIELDS))
    existing_value = serializers.CharField(allow_blank=True, trim_whitespace=False)
    value = serializers.CharField(max_length=4000, allow_blank=False)


class StatementDecisionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(
        choices=("create", "link", "combine_sms", "skip", "unlink", "reopen")
    )
    version = serializers.IntegerField(min_value=1)
    transaction = serializers.PrimaryKeyRelatedField(
        queryset=Transaction.objects.none(), required=False
    )
    candidate = serializers.UUIDField(required=False)
    dismissed_ledger_matches = serializers.ListField(
        child=serializers.UUIDField(), required=False, max_length=8
    )
    acknowledge_distinct_ledger_matches = serializers.BooleanField(default=False)
    remember_choices = serializers.BooleanField(default=False)
    allow_separate = serializers.BooleanField(default=False)
    acknowledge_issues = serializers.BooleanField(default=False)
    acknowledge_conflict = serializers.BooleanField(default=False)
    balance_choice = StatementBalanceChoiceSerializer(required=False)
    detail_choices = StatementDetailChoiceSerializer(
        many=True, required=False, max_length=7
    )

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
        if attrs["action"] == "combine_sms" and "candidate" not in attrs:
            raise serializers.ValidationError({"candidate": "Choose a pending SMS."})
        dismissed = attrs.get("dismissed_ledger_matches", [])
        if dismissed and attrs["action"] != "combine_sms":
            raise serializers.ValidationError({"dismissed_ledger_matches": "Only combined review can dismiss ledger suggestions."})
        if attrs["acknowledge_distinct_ledger_matches"] and attrs["action"] != "combine_sms":
            raise serializers.ValidationError({"acknowledge_distinct_ledger_matches": "Only combined review uses this acknowledgement."})
        if len(set(dismissed)) != len(dismissed):
            raise serializers.ValidationError({"dismissed_ledger_matches": "Review each ledger suggestion only once."})
        if "balance_choice" in attrs and attrs["action"] not in {"link", "combine_sms"}:
            raise serializers.ValidationError(
                {
                    "balance_choice": "Balance choices are only available when linking a match."
                }
            )
        details = attrs.get("detail_choices", [])
        if details and attrs["action"] not in {"link", "combine_sms"}:
            raise serializers.ValidationError(
                {
                    "detail_choices": "Detail choices are only available when linking a match."
                }
            )
        if len({item["field"] for item in details}) != len(details):
            raise serializers.ValidationError(
                {"detail_choices": "Select each detail only once."}
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


class StatementSelectedSerializer(StatementBulkSerializer):
    action = serializers.ChoiceField(choices=["create", "skip"])


class StatementBulkResultSerializer(serializers.Serializer):
    added = serializers.IntegerField()
    skipped = serializers.IntegerField()
    unchanged = serializers.IntegerField()
    unresolved = serializers.ListField(child=serializers.DictField())


class StatementLedgerOnlySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True)
    direction = serializers.ChoiceField(choices=["debit", "credit"])
    amount = serializers.CharField()
    balance_after = serializers.CharField(allow_null=True)
    description = serializers.CharField()
    source = serializers.CharField()


class StatementComparisonSerializer(serializers.Serializer):
    ledger_only_available = serializers.BooleanField()
    counts = serializers.DictField(child=serializers.IntegerField())
    period_start = serializers.DateField(allow_null=True)
    period_end = serializers.DateField(allow_null=True)
    complete = serializers.BooleanField()
    warnings = serializers.ListField(child=serializers.CharField())
    count = serializers.IntegerField()
    offset = serializers.IntegerField()
    limit = serializers.IntegerField()
    results = StatementLedgerOnlySerializer(many=True)
