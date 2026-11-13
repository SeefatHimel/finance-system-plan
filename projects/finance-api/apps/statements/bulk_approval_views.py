from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions.serializers import TransactionActionSerializer

from . import bulk_approval
from .review_views import NoStoreMixin
from .unified_views import PairSelection, UnifiedPendingSourceSerializer


class BulkMetadataSerializer(serializers.Serializer):
    category = serializers.UUIDField(allow_null=True, required=False)
    description = serializers.CharField(
        max_length=255, allow_blank=True, required=False, trim_whitespace=False
    )
    note = serializers.CharField(
        max_length=4000, allow_blank=True, required=False, trim_whitespace=False
    )

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError(
                "Only category, description and notes can be edited in bulk."
            )
        return super().to_internal_value(data)


class BulkPairInputSerializer(PairSelection):
    edits = BulkMetadataSerializer(required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError(
                "Financial fields cannot be edited in bulk."
            )
        return super().to_internal_value(data)


class BulkFinalValuesSerializer(serializers.Serializer):
    category = serializers.UUIDField(allow_null=True)
    description = serializers.CharField(allow_blank=True)
    note = serializers.CharField(allow_blank=True)


class BulkPairSelectionSerializer(serializers.Serializer):
    pairs = BulkPairInputSerializer(
        many=True, min_length=1, max_length=bulk_approval.LIMIT
    )

    def validate_pairs(self, pairs):
        if len({(item["statement"], item["sms"]) for item in pairs}) != len(pairs):
            raise serializers.ValidationError("Select each pair only once.")
        return pairs


class BulkApprovalNameSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()


class BulkApprovalItemSerializer(serializers.Serializer):
    id = serializers.CharField()
    statement = UnifiedPendingSourceSerializer()
    sms = UnifiedPendingSourceSerializer()
    category = BulkApprovalNameSerializer(allow_null=True)
    other_account = BulkApprovalNameSerializer(allow_null=True)
    final = BulkFinalValuesSerializer()
    category_origin = serializers.CharField()
    ready = serializers.BooleanField()
    blockers = serializers.ListField(child=serializers.CharField())
    statement_text = serializers.CharField(allow_blank=True)
    sms_text = serializers.CharField(allow_blank=True)
    balance_source = serializers.CharField(
        help_text="The selected report: sms or statement."
    )


class BulkApprovalPreviewSerializer(serializers.Serializer):
    items = BulkApprovalItemSerializer(many=True)
    ready_count = serializers.IntegerField()
    needs_review = serializers.IntegerField()
    totals = serializers.DictField(
        child=serializers.DictField(child=serializers.CharField())
    )
    expires_at = serializers.DateTimeField()
    token = serializers.CharField(allow_null=True)


class BulkApprovalRequestSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=16000)
    request_id = serializers.UUIDField()
    confirmed = serializers.BooleanField()
    pairs = BulkPairInputSerializer(
        many=True, min_length=1, max_length=bulk_approval.LIMIT, required=False
    )

    def validate_confirmed(self, value):
        if not value:
            raise serializers.ValidationError(
                "Review the preview and confirm the ready pairs."
            )
        return value


class BulkApprovedPairSerializer(PairSelection):
    transaction = serializers.UUIDField()


class BulkApprovalResultSerializer(serializers.Serializer):
    batch = serializers.UUIDField()
    approved = BulkApprovedPairSerializer(many=True)
    needs_review = serializers.IntegerField()
    undo_action = TransactionActionSerializer(allow_null=True)
    replayed = serializers.BooleanField()


class BulkApprovalPreviewView(NoStoreMixin, APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (JSONParser,)

    @extend_schema(
        request=BulkPairSelectionSerializer,
        responses=BulkApprovalPreviewSerializer,
        tags=["Unified review"],
    )
    def post(self, request):
        serializer = BulkPairSelectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            bulk_approval.preview(
                user=request.user, pairs=serializer.validated_data["pairs"]
            )
        )


class BulkApprovalView(NoStoreMixin, APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (JSONParser,)

    @extend_schema(
        request=BulkApprovalRequestSerializer,
        responses=BulkApprovalResultSerializer,
        tags=["Unified review"],
    )
    def post(self, request):
        serializer = BulkApprovalRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            bulk_approval.approve(
                user=request.user,
                request=request,
                token=serializer.validated_data["token"],
                request_id=serializer.validated_data["request_id"],
                pairs=serializer.validated_data.get("pairs"),
            )
        )
