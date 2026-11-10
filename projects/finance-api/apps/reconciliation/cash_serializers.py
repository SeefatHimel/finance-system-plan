from rest_framework import serializers


class CashCountRowInput(serializers.Serializer):
    account = serializers.CharField(required=False, allow_blank=True, max_length=120)
    date = serializers.CharField(required=False, allow_blank=True, max_length=40)
    time = serializers.CharField(required=False, allow_blank=True, max_length=30)
    balance = serializers.CharField(required=False, allow_blank=True, max_length=50)
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    action = serializers.ChoiceField(choices=("add", "skip", "replace"), required=False)
    replace_id = serializers.UUIDField(required=False)
    unknown_position = serializers.ChoiceField(
        choices=("unresolved", "before", "after"), required=False
    )
    timing_order = serializers.DictField(
        child=serializers.ChoiceField(choices=("before", "after")),
        required=False,
    )

    def validate_timing_order(self, value):
        if len(value) > 1000:
            raise serializers.ValidationError(
                "Review at most 1,000 untimed entries at once."
            )
        return value


class CashCountInput(serializers.Serializer):
    text = serializers.CharField(
        required=False, allow_blank=True, max_length=1_000_000, trim_whitespace=False
    )
    rows = CashCountRowInput(many=True, required=False, max_length=100)
    mapping = serializers.DictField(
        child=serializers.CharField(allow_blank=True), default=dict
    )
    account_map = serializers.DictField(
        child=serializers.UUIDField(allow_null=True), default=dict
    )
    decisions = serializers.DictField(child=CashCountRowInput(), default=dict)
    date_order = serializers.ChoiceField(choices=("ISO", "DMY", "MDY"), default="ISO")
    end_of_day = serializers.BooleanField(default=False)
    filename = serializers.CharField(max_length=180, default="Cash counts")
    idempotency_key = serializers.UUIDField(required=False)
    review_token = serializers.CharField(required=False, max_length=64)

    def validate(self, data):
        if bool(data.get("text")) == bool(data.get("rows")):
            raise serializers.ValidationError("Provide one count or a table, not both.")
        return data


class CashCountPreviewResponse(serializers.Serializer):
    rows = serializers.ListField(child=serializers.JSONField())
    headers = serializers.ListField(child=serializers.CharField())
    mapping = serializers.JSONField()
    timezone = serializers.CharField()
    ready = serializers.BooleanField()
    review_token = serializers.CharField()


class CashCountReceiptResponse(serializers.Serializer):
    id = serializers.UUIDField()
    counts = serializers.ListField(child=serializers.JSONField())
    saved = serializers.IntegerField()


class CashCountHistoryResponse(serializers.Serializer):
    results = serializers.ListField(child=serializers.JSONField())
    count = serializers.IntegerField()
    next_offset = serializers.IntegerField(allow_null=True)


class CashCountComparisonResponse(serializers.Serializer):
    revision = serializers.CharField()
    count = serializers.JSONField()
    previous = serializers.JSONField(allow_null=True)
    difference_change = serializers.CharField(allow_null=True)
    movements = serializers.ListField(child=serializers.JSONField())
    movement_count = serializers.IntegerField()
    next_offset = serializers.IntegerField(allow_null=True)
    errors = serializers.ListField(child=serializers.CharField())
