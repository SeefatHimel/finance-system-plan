from django.shortcuts import get_object_or_404
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions.models import Transaction
from .models import BulkImport, BulkImportRow
from .serializers import (
    CreateBulkImportSerializer,
    ReviewBulkImportSerializer,
    CommitBulkImportSerializer,
    BulkImportResponseSerializer,
    BulkImportListSerializer,
    BulkSourceSerializer,
)
from .sources import original_table
from .review import preview
from .services import (
    create_batch,
    review_batch,
    commit_batch,
    undo_batch,
    reopen_batch,
)


class ReceiptSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    state = serializers.CharField()
    receipt = serializers.JSONField()


class PrivateView(APIView):
    permission_classes = (IsAuthenticated,)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response


class BulkImportsView(PrivateView):
    @extend_schema(responses=BulkImportListSerializer(many=True))
    def get(self, request):
        batches = BulkImport.objects.filter(user=request.user).defer(
            "original", "configuration"
        )[:25]
        return Response(BulkImportListSerializer(batches, many=True).data)

    @extend_schema(
        request=CreateBulkImportSerializer, responses=BulkImportResponseSerializer
    )
    def post(self, request):
        serializer = CreateBulkImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        batch = create_batch(request.user, serializer.validated_data)
        return Response(preview(batch))


class BulkImportDetailView(PrivateView):
    @extend_schema(responses=BulkImportResponseSerializer)
    def get(self, request, pk):
        batch = get_object_or_404(
            BulkImport.objects.select_related("account"), pk=pk, user=request.user
        )
        return Response(preview(batch))

    @extend_schema(
        request=ReviewBulkImportSerializer, responses=BulkImportResponseSerializer
    )
    def patch(self, request, pk):
        serializer = ReviewBulkImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(review_batch(request.user, pk, serializer.validated_data))


class BulkImportCommitView(PrivateView):
    @extend_schema(request=CommitBulkImportSerializer, responses=ReceiptSerializer)
    def post(self, request, pk):
        serializer = CommitBulkImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            commit_batch(request.user, pk, serializer.validated_data, request)
        )


class BulkImportUndoView(PrivateView):
    @extend_schema(request=None, responses=ReceiptSerializer)
    def post(self, request, pk):
        return Response(undo_batch(request.user, pk))


class TransactionBulkSourcesView(PrivateView):
    @extend_schema(responses=BulkSourceSerializer(many=True))
    def get(self, request, pk):
        get_object_or_404(Transaction, pk=pk, user=request.user)
        entries = (
            BulkImportRow.objects.filter(
                Q(transaction_id=pk) | Q(transaction__isnull=True, ledger_identity=pk),
                batch__user=request.user,
                batch__state="committed",
            )
            .select_related("batch")
            .order_by("pk")[:100]
        )
        result, archives = [], {}
        for entry in entries:
            if entry.batch_id not in archives:
                headers, rows, _ = original_table(entry.batch)
                archives[entry.batch_id] = [dict(zip(headers, row)) for row in rows]
            result.append(
                {
                    "batch": str(entry.batch_id),
                    "filename": entry.batch.filename,
                    "number": entry.number,
                    "original": archives[entry.batch_id][entry.number - 1],
                    "normalized": entry.normalized,
                    "notes_edited": "notes" in entry.batch.configuration.get("decisions", {}).get(str(entry.number), {}),
                }
            )
        return Response(result)


class ReopenSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class BulkImportReopenView(PrivateView):
    @extend_schema(request=ReopenSerializer, responses=BulkImportResponseSerializer)
    def post(self, request, pk):
        serializer = ReopenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            reopen_batch(request.user, pk, serializer.validated_data["version"])
        )
