from rest_framework import serializers

from apps.accounts.models import Account

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
