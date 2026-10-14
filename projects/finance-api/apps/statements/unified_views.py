from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.messages.models import ParsedMessageCandidate
from apps.messages.serializers import ParsedMessageCandidateSerializer

from .models import StatementRow
from .review_views import NoStoreMixin, StatementRowViewSet
from .serializers import SavedStatementRowSerializer, StatementImportSerializer
from .unified import confirm_pair, pair_signals, pending_sources, queue


class PendingReviewFilters(serializers.Serializer):
    account = serializers.UUIDField(required=False)
    search = serializers.CharField(max_length=255, required=False, allow_blank=True)
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)
    offset = serializers.IntegerField(min_value=0, default=0)

    def validate(self, data):
        start, end = data.get("start_date"), data.get("end_date")
        if bool(start) != bool(end) or (
            start and (end < start or (end - start).days >= 366)
        ):
            raise serializers.ValidationError(
                "Choose an inclusive date range of at most 366 days."
            )
        return data


class UnifiedPendingSourceSerializer(serializers.Serializer):
    source = serializers.ChoiceField(choices=("sms", "statement"))
    id = serializers.UUIDField()
    account = serializers.UUIDField(allow_null=True)
    account_name = serializers.CharField()
    currency = serializers.CharField(allow_blank=True)
    date = serializers.DateField(allow_null=True)
    time = serializers.TimeField(allow_null=True)
    amount = serializers.CharField(allow_null=True)
    balance_after = serializers.CharField(allow_null=True)
    direction = serializers.CharField()
    type = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    reference = serializers.CharField(allow_blank=True)
    updated_at = serializers.DateTimeField()
    version = serializers.IntegerField(allow_null=True)
    batch = serializers.UUIDField(allow_null=True)
    needs_correction = serializers.BooleanField()


class UnifiedPendingMatchSerializer(serializers.Serializer):
    strength = serializers.ChoiceField(choices=("strong", "possible"))
    conflict = serializers.BooleanField()
    reasons = serializers.ListField(child=serializers.CharField())


class UnifiedPendingItemSerializer(serializers.Serializer):
    id = serializers.CharField()
    statement = UnifiedPendingSourceSerializer()
    sms = UnifiedPendingSourceSerializer()
    match = UnifiedPendingMatchSerializer()
    needs_correction = serializers.BooleanField()


class UnifiedPendingPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    offset = serializers.IntegerField()
    limit = serializers.IntegerField()
    results = UnifiedPendingItemSerializer(many=True)


class PairSelection(serializers.Serializer):
    statement = serializers.UUIDField()
    sms = serializers.UUIDField()


class PairDecision(PairSelection):
    statement_version = serializers.IntegerField(min_value=1)
    sms_updated_at = serializers.DateTimeField()
    transaction = serializers.UUIDField(required=False, allow_null=True)
    balance_source = serializers.ChoiceField(choices=("sms", "statement", "existing"))
    acknowledge_match = serializers.BooleanField(default=False)
    acknowledge_conflict = serializers.BooleanField(default=False)
    acknowledge_issues = serializers.BooleanField(default=False)
    remember_choices = serializers.BooleanField(default=False)


class PairDetailSerializer(serializers.Serializer):
    row = SavedStatementRowSerializer()
    batch = StatementImportSerializer()
    sms = ParsedMessageCandidateSerializer()
    match = serializers.JSONField()


class PairResultSerializer(serializers.Serializer):
    transaction = serializers.UUIDField()
    statement = serializers.UUIDField()
    sms = serializers.UUIDField()
    unchanged = serializers.BooleanField()


def selected_sources(user, data):
    row = get_object_or_404(
        StatementRow.objects.select_related(
            "batch__account", "category", "other_account", "transaction"
        ),
        pk=data["statement"],
        batch__user=user,
    )
    candidate = get_object_or_404(
        ParsedMessageCandidate.objects.select_related(
            "account", "destination_account", "raw_message"
        ),
        pk=data["sms"],
        user=user,
    )
    return row, candidate


class UnifiedPendingView(NoStoreMixin, APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[PendingReviewFilters],
        responses=UnifiedPendingPageSerializer,
        tags=["Unified review"],
    )
    def get(self, request):
        filters = PendingReviewFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        return Response(queue(request.user, filters.validated_data))


class UnifiedPairView(NoStoreMixin, APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[PairSelection],
        responses=PairDetailSerializer,
        tags=["Unified review"],
    )
    def get(self, request):
        selection = PairSelection(data=request.query_params)
        selection.is_valid(raise_exception=True)
        row, candidate = selected_sources(request.user, selection.validated_data)
        signals = pair_signals(row, candidate)
        if not signals:
            raise ValidationError(
                {
                    "match": "These sources are no longer pending matches. Refresh the queue."
                }
            )
        rows, candidates = pending_sources(request.user, row.batch.account_id)
        if (
            sum(pair_signals(row, item) is not None for item in candidates) > 1
            or sum(pair_signals(item, candidate) is not None for item in rows) > 1
        ):
            signals = {
                **signals,
                "strength": "possible",
                "reasons": [
                    *signals["reasons"],
                    "Multiple pending sources overlap. Verify one-to-one correspondence.",
                ],
            }
        states = list(row.batch.rows.values_list("state", flat=True))
        for name in ("total", "pending", "posted", "linked", "skipped"):
            setattr(
                row.batch,
                f"count_{name}",
                len(states) if name == "total" else states.count(name),
            )
        return Response(
            {
                "row": StatementRowViewSet().representation(row),
                "batch": StatementImportSerializer(row.batch).data,
                "sms": ParsedMessageCandidateSerializer(candidate).data,
                "match": signals,
            }
        )

    @extend_schema(
        request=PairDecision, responses=PairResultSerializer, tags=["Unified review"]
    )
    def post(self, request):
        serializer = PairDecision(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        row, candidate = selected_sources(request.user, data)
        record, unchanged = confirm_pair(
            user=request.user,
            row=row,
            candidate=candidate,
            payload=data,
            request=request,
        )
        return Response(
            {
                "transaction": str(record.pk),
                "statement": str(row.pk),
                "sms": str(candidate.pk),
                "unchanged": unchanged,
            }
        )
