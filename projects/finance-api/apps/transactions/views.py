import csv
import json

from django.db import transaction as db_transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import RawMessage
from apps.statements.serializers import SavedStatementRowSerializer

from .models import Transaction
from .serializers import (
    TransactionSerializer,
    TransactionSourceMessageSerializer,
    TransferEvidenceSerializer,
    TransferLinkRequestSerializer,
    TransferMatchRequestSerializer,
    TransferMatchSerializer,
    TransferMergeRequestSerializer,
)
from .transfers import (
    find_transfer_matches,
    link_transfer,
    lock_transfer_user,
    merge_transfers,
    prepare_transfer_input,
)


transaction_date_parameters = [
    OpenApiParameter("date_field", str, enum=["date", "created_at", "updated_at"], description="Period date basis; timestamp days use Asia/Dhaka."),
    OpenApiParameter("month", str, description="YYYY-MM; excludes a custom range."),
    OpenApiParameter("start_date", OpenApiTypes.DATE, description="Inclusive start; requires end_date."),
    OpenApiParameter("end_date", OpenApiTypes.DATE, description="Inclusive end; range at most 366 days."),
]


@extend_schema_view(list=extend_schema(parameters=transaction_date_parameters))
class TransactionViewSet(ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        responses=SavedStatementRowSerializer(many=True), tags=["Transactions"]
    )
    @action(detail=True, methods=("get",), url_path="statement-evidence")
    def statement_evidence(self, request, pk=None):
        record = self.get_object()
        rows = (
            record.statement_rows.filter(batch__user=request.user)
            .select_related("batch__account", "category", "other_account")
            .order_by("-updated_at")[:100]
        )
        return Response(
            SavedStatementRowSerializer(rows, many=True).data,
            headers={"Cache-Control": "private, no-store"},
        )

    def get_queryset(self):
        queryset = (
            Transaction.objects.filter(user=self.request.user)
            .annotate(statement_count=Count("statement_rows", distinct=True))
            .select_related(
                "account",
                "transfer_account",
                "category",
                "payment_method",
                "raw_message",
            )
            .prefetch_related("transfer_evidence")
        )

        from apps.reports.periods import filter_period

        queryset = filter_period(
            queryset, self.request.query_params,
            fields={"date": "date", "created_at": "created_at__date", "updated_at": "updated_at__date"},
            default="date",
        )

        account = self.request.query_params.get("account")
        if account:
            queryset = queryset.filter(
                Q(account_id=account)
                | Q(type=Transaction.Type.TRANSFER, transfer_account_id=account)
            )

        category = self.request.query_params.get("category")
        if category:
            queryset = queryset.filter(category_id=category)

        transaction_type = self.request.query_params.get("type")
        if transaction_type:
            queryset = queryset.filter(type=transaction_type)

        direction = self.request.query_params.get("direction")
        if direction:
            if account:
                if direction == Transaction.Direction.CREDIT:
                    queryset = queryset.filter(
                        Q(type=Transaction.Type.TRANSFER, transfer_account_id=account)
                        | (Q(direction=direction) & ~Q(type=Transaction.Type.TRANSFER))
                    )
                else:
                    queryset = queryset.filter(account_id=account, direction=direction)
            else:
                queryset = queryset.filter(direction=direction)

        source = self.request.query_params.get("source")
        if source:
            queryset = queryset.filter(source=source)

        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(reference__icontains=search)
                | Q(counterparty_text__icontains=search)
                | Q(sender_account_identifier__icontains=search)
                | Q(sender_card_identifier__icontains=search)
                | Q(receiver_account_identifier__icontains=search)
                | Q(receiver_card_identifier__icontains=search)
                | Q(note__icontains=search)
                | Q(external_key__icontains=search)
                | Q(transfer_evidence__reference__icontains=search)
                | Q(transfer_evidence__note__icontains=search)
            ).distinct()

        if self.action == "list":
            ordering = self.request.query_params.get("ordering", "-date")
            if ordering in {"-created_at", "-updated_at"}:
                queryset = queryset.order_by(ordering, "-id")
            elif ordering == "-date":
                queryset = queryset.order_by("-date", "-time", "-created_at", "-id")
            else:
                raise ValidationError(
                    {"ordering": "Use -date, -created_at or -updated_at."}
                )

        return queryset

    @extend_schema(responses=TransactionSourceMessageSerializer(many=True))
    @action(detail=True, methods=("get",), url_path="source-messages")
    def source_messages(self, request, pk=None):
        record = self.get_object()
        message_ids = list(
            record.transfer_evidence.filter(
                user=request.user,
                raw_message__isnull=False,
            ).values_list("raw_message_id", flat=True)
        )
        if record.raw_message_id:
            message_ids.append(record.raw_message_id)
        messages = RawMessage.objects.filter(
            user=request.user,
            pk__in=message_ids,
        ).order_by("received_at", "id")
        return Response(
            TransactionSourceMessageSerializer(messages, many=True).data,
            headers={"Cache-Control": "private, no-store"},
        )

    @extend_schema(
        request=TransferMatchRequestSerializer,
        responses=TransferMatchSerializer(many=True),
    )
    @action(detail=False, methods=("post",), url_path="transfer-matches")
    def transfer_matches(self, request):
        serializer = TransferMatchRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data, observation, candidate, _ = prepare_transfer_input(
            user=request.user,
            payload=serializer.validated_data,
            context={"request": request},
        )
        return Response(
            find_transfer_matches(
                user=request.user,
                data=data,
                observation=observation,
                candidate=candidate,
                exclude_transaction=serializer.validated_data.get(
                    "exclude_transaction"
                ),
            )
        )

    @extend_schema(
        request=TransferLinkRequestSerializer, responses=TransactionSerializer
    )
    @action(detail=False, methods=("post",), url_path="link-transfer")
    def link_transfer(self, request):
        serializer = TransferLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = link_transfer(
            user=request.user,
            payload=serializer.validated_data,
            context={"request": request},
        )
        return Response(self.get_serializer(record).data)

    @extend_schema(
        request=TransferMergeRequestSerializer, responses=TransactionSerializer
    )
    @action(detail=True, methods=("post",), url_path="merge-transfer")
    def merge_transfer(self, request, pk=None):
        serializer = TransferMergeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        record = merge_transfers(
            user=request.user,
            record_id=pk,
            other_id=serializer.validated_data["transaction"],
        )
        return Response(self.get_serializer(record).data)

    @db_transaction.atomic
    def perform_create(self, serializer):
        lock_transfer_user(self.request.user)
        transaction = serializer.save(user=self.request.user)
        if getattr(serializer, "reused_transfer", False):
            return
        create_audit_log(
            user=self.request.user,
            action=AuditLogEntry.Action.CREATED,
            entity=transaction,
            after=transaction_snapshot(transaction),
        )

    @db_transaction.atomic
    def update(self, request, *args, **kwargs):
        lock_transfer_user(request.user)
        return super().update(request, *args, **kwargs)

    @db_transaction.atomic
    def destroy(self, request, *args, **kwargs):
        lock_transfer_user(request.user)
        return super().destroy(request, *args, **kwargs)

    def perform_update(self, serializer):
        before = transaction_snapshot(serializer.instance)
        transaction = serializer.save()
        create_audit_log(
            user=self.request.user,
            action=AuditLogEntry.Action.UPDATED,
            entity=transaction,
            before=before,
            after=transaction_snapshot(transaction),
            metadata=(
                {"linked_correction_acknowledged": True}
                if serializer.validated_data.get("allow_linked_correction")
                else None
            ),
        )

    def perform_destroy(self, instance):
        before = transaction_snapshot(instance)
        create_audit_log(
            user=self.request.user,
            action=AuditLogEntry.Action.DELETED,
            entity=instance,
            before=before,
        )
        instance.delete()

    @extend_schema(parameters=transaction_date_parameters)
    @action(detail=False, methods=("get",), url_path="export")
    def export(self, request):
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="transactions.csv"'
        writer = csv.writer(response)
        writer.writerow(
            [
                "id",
                "date",
                "time",
                "type",
                "direction",
                "amount",
                "account_id",
                "account_name",
                "transfer_account_id",
                "transfer_account_name",
                "category_id",
                "category_name",
                "payment_method_id",
                "payment_method_name",
                "balance_after",
                "sender_account_identifier",
                "sender_card_identifier",
                "receiver_account_identifier",
                "receiver_card_identifier",
                "reference",
                "counterparty_text",
                "external_key",
                "source",
                "needs_review",
                "note",
                "raw_message_id",
                "created_at",
                "updated_at",
                "account_direction",
                "transfer_evidence",
            ]
        )

        for transaction in self.get_queryset().order_by(
            "date", "time", "created_at", "id"
        ):
            writer.writerow(
                [
                    transaction.id,
                    transaction.date,
                    transaction.time.isoformat() if transaction.time else "",
                    transaction.type,
                    transaction.direction,
                    transaction.amount,
                    transaction.account_id,
                    transaction.account.name,
                    transaction.transfer_account_id or "",
                    transaction.transfer_account.name
                    if transaction.transfer_account
                    else "",
                    transaction.category_id or "",
                    transaction.category.name if transaction.category else "",
                    transaction.payment_method_id or "",
                    transaction.payment_method.name
                    if transaction.payment_method
                    else "",
                    transaction.balance_after or "",
                    transaction.sender_account_identifier,
                    transaction.sender_card_identifier,
                    transaction.receiver_account_identifier,
                    transaction.receiver_card_identifier,
                    transaction.reference,
                    transaction.counterparty_text,
                    transaction.external_key,
                    transaction.source,
                    transaction.needs_review,
                    transaction.note,
                    transaction.raw_message_id or "",
                    transaction.created_at.isoformat(),
                    transaction.updated_at.isoformat(),
                    self.get_serializer(transaction).data["account_direction"],
                    json.dumps(
                        TransferEvidenceSerializer(
                            transaction.transfer_evidence.all(), many=True
                        ).data,
                        default=str,
                    ),
                ]
            )

        return response
