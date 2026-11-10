from rest_framework import serializers


class CreateBulkImportSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    text = serializers.CharField(max_length=1_000_000, trim_whitespace=False)
    filename = serializers.CharField(max_length=180, default="Pasted table")


class RowDecisionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=("new", "skip", "link"), default="new")
    date = serializers.CharField(required=False, max_length=40)
    time = serializers.CharField(required=False, allow_blank=True, max_length=30)
    amount = serializers.CharField(required=False, max_length=50)
    type = serializers.ChoiceField(
        choices=(
            "expense",
            "income",
            "refund",
            "fee",
            "transfer",
            "adjustment",
            "lend",
            "borrow",
            "repayment_paid",
            "repayment_received",
        ),
        required=False,
    )
    direction = serializers.ChoiceField(choices=("debit", "credit"), required=False)
    description = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )
    category = serializers.UUIDField(required=False, allow_null=True)
    other_account = serializers.UUIDField(required=False, allow_null=True)
    transaction = serializers.UUIDField(required=False, allow_null=True)
    reviewed = serializers.BooleanField(default=False)
    review_fingerprint = serializers.CharField(
        max_length=64, required=False, allow_blank=True
    )


class CheckpointInputSerializer(serializers.Serializer):
    date = serializers.DateField()
    time = serializers.TimeField(required=False, allow_null=True)
    balance = serializers.CharField(max_length=50)
    end_of_day = serializers.BooleanField(default=False)
    unknown_position = serializers.ChoiceField(
        choices=("unresolved", "before", "after"), default="unresolved"
    )
    exceptions = serializers.DictField(
        child=serializers.ChoiceField(choices=("before", "after")), default=dict
    )
    note = serializers.CharField(max_length=2000, allow_blank=True, default="")


class ReviewBulkImportSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True), required=False
    )
    date_order = serializers.ChoiceField(choices=("ISO", "DMY", "MDY"), default="ISO")
    positive_direction = serializers.ChoiceField(
        choices=("debit", "credit"), default="debit"
    )
    category_map = serializers.DictField(
        child=serializers.UUIDField(allow_null=True), default=dict
    )
    decisions = serializers.DictField(child=RowDecisionSerializer(), default=dict)
    checkpoints = CheckpointInputSerializer(many=True, max_length=50, default=list)


class CommitBulkImportSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    review_token = serializers.CharField(max_length=64)


class BulkImportResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    account = serializers.UUIDField()
    filename = serializers.CharField()
    state = serializers.CharField()
    version = serializers.IntegerField()
    headers = serializers.ListField(child=serializers.CharField())
    configuration = serializers.JSONField()
    rows = serializers.ListField(child=serializers.JSONField())
    checkpoints = serializers.ListField(child=serializers.JSONField())
    errors = serializers.ListField(child=serializers.CharField())
    summary = serializers.JSONField()
    review_token = serializers.CharField()
    timezone = serializers.CharField()
    receipt = serializers.JSONField()


class BulkImportListSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    account = serializers.UUIDField()
    filename = serializers.CharField()
    state = serializers.CharField()
    created_at = serializers.DateTimeField()
    receipt = serializers.JSONField()


class BulkSourceSerializer(serializers.Serializer):
    batch = serializers.UUIDField()
    filename = serializers.CharField()
    number = serializers.IntegerField()
    original = serializers.JSONField()
    normalized = serializers.JSONField()
