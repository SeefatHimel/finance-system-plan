import csv
import json

from django.db import transaction as db_transaction
from django.db.models import Count, Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.statements.serializers import SavedStatementRowSerializer

from .models import Transaction, TransactionAction
from .recovery import ActionRecorder, describe, undo_action
from .search import SEARCH_DESCRIPTION, filter_transaction_search
from .serializers import (
    TransactionActionSerializer,
    TransactionSerializer,
    TransactionSourceMessageSerializer,
    TransferEvidenceSerializer,
    TransferLinkRequestSerializer,
    TransferMatchRequestSerializer,
    TransferMatchSerializer,
    TransferMergeRequestSerializer,
    UndoRequestSerializer,
)
from .transfers import (
    find_transfer_matches,
    link_transfer,
    lock_transfer_user,
    merge_transfers,
    prepare_transfer_input,
)

transaction_date_parameters = [
    OpenApiParameter("search", str, description=SEARCH_DESCRIPTION),
    OpenApiParameter("date_field", str, enum=["date", "created_at", "updated_at"], description="Period date basis; timestamp days use Asia/Dhaka."),
    OpenApiParameter("month", str, description="YYYY-MM; excludes a custom range."),
    OpenApiParameter("start_date", OpenApiTypes.DATE, description="Inclusive start; requires end_date."),
    OpenApiParameter("end_date", OpenApiTypes.DATE, description="Inclusive end; range at most 366 days."),
]


class ActivityPageQuery(serializers.Serializer):
    limit = serializers.IntegerField(default=25, min_value=1, max_value=100)
    offset = serializers.IntegerField(default=0, min_value=0, max_value=2147483647)
    account = serializers.UUIDField(required=False)
    category = serializers.UUIDField(required=False)


class TransactionActivityPageSerializer(serializers.Serializer):
    count = serializers.IntegerField(min_value=0)
    next_offset = serializers.IntegerField(min_value=0, allow_null=True)
    results = TransactionSerializer(many=True)


def spreadsheet_safe_text(value):
    """Prevent user-controlled CSV text from becoming a spreadsheet formula."""
    if value and value.lstrip(" \t\r\n\ufeff").startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


@extend_schema_view(list=extend_schema(parameters=transaction_date_parameters))
class TransactionViewSet(ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[*transaction_date_parameters,
                    OpenApiParameter("account", OpenApiTypes.UUID),
                    OpenApiParameter("category", OpenApiTypes.UUID),
                    OpenApiParameter("type", str),
                    OpenApiParameter("direction", str),
                    OpenApiParameter("source", str),
                    OpenApiParameter("ordering", str, enum=["-date", "-created_at", "-updated_at"]),
                    OpenApiParameter("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 25}),
                    OpenApiParameter("offset", {"type": "integer", "minimum": 0, "maximum": 2147483647, "default": 0})],
        responses=TransactionActivityPageSerializer,
    )
    @action(detail=False, methods=("get",))
    def activity(self, request):
        """Bounded timeline; the existing list retains its array response."""
        query = ActivityPageQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        limit, offset = query.validated_data["limit"], query.validated_data["offset"]
        queryset = self.filter_queryset(self.get_queryset())
        count = queryset.count()
        rows = list(queryset[offset:offset + limit])
        return Response({
            "count": count,
            "next_offset": offset + len(rows) if offset + len(rows) < count and rows else None,
            "results": self.get_serializer(rows, many=True).data,
        }, headers={"Cache-Control": "private, no-store"})

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

    @extend_schema(responses=TransactionActionSerializer)
    @action(detail=False, methods=("get",), url_path="recent-action")
    def recent_action(self, request):
        latest = TransactionAction.objects.filter(user=request.user).first()
        return Response(describe(latest, check=True) if latest else None,
                        headers={"Cache-Control": "private, no-store"})

    @extend_schema(request=UndoRequestSerializer, responses=TransactionActionSerializer)
    @action(detail=False, methods=("post",), url_path="undo")
    def undo(self, request):
        serializer = UndoRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = undo_action(user=request.user, action_id=serializer.validated_data["action"])
        return Response(describe(result), headers={"Cache-Control": "private, no-store"})

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

        queryset = filter_transaction_search(queryset, self.request.query_params.get("search"), user=self.request.user)

        if self.action in {"list", "activity"}:
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
        message_ids.extend(
            record.parsed_message_candidates.filter(
                user=request.user, status="confirmed"
            ).values_list("raw_message_id", flat=True)
        )
        if record.raw_message_id:
            message_ids.append(record.raw_message_id)
        messages = RawMessage.objects.filter(
            user=request.user,
            pk__in=message_ids,
        ).select_related("candidate").order_by("received_at", "id")
        return Response(
            TransactionSourceMessageSerializer(
                messages, many=True, context={"transaction": record}
            ).data,
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
    @db_transaction.atomic
    def link_transfer(self, request):
        serializer = TransferLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lock_transfer_user(request.user)
        target_id = serializer.validated_data.get("match_transaction")
        target_candidate = serializer.validated_data.get("match_candidate")
        if target_candidate:
            target_id = ParsedMessageCandidate.objects.filter(user=request.user, pk=target_candidate).values_list("transaction_id", flat=True).first()
        recorder = ActionRecorder(request.user, transaction_ids=(target_id,),
            candidate_ids=(serializer.validated_data.get("candidate"), target_candidate),
            remember=serializer.validated_data.get("draft", {}).get("remember_mapping", False))
        record = link_transfer(
            user=request.user,
            payload=serializer.validated_data,
            context={"request": request},
        )
        recorder.finish(record, "link")
        return Response(self.get_serializer(record).data)

    @extend_schema(
        request=TransferMergeRequestSerializer, responses=TransactionSerializer
    )
    @action(detail=True, methods=("post",), url_path="merge-transfer")
    @db_transaction.atomic
    def merge_transfer(self, request, pk=None):
        serializer = TransferMergeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lock_transfer_user(request.user)
        recorder = ActionRecorder(request.user, transaction_ids=(pk, serializer.validated_data["transaction"]))
        record = merge_transfers(
            user=request.user,
            record_id=pk,
            other_id=serializer.validated_data["transaction"],
            balance_choices=serializer.validated_data.get("balance_choices", []),
        )
        recorder.finish(record, "merge")
        return Response(self.get_serializer(record).data)

    @db_transaction.atomic
    def perform_create(self, serializer):
        lock_transfer_user(self.request.user)
        existing_ids = Transaction.objects.filter(user=self.request.user, external_key=serializer.validated_data.get("external_key", "")).values_list("id", flat=True) if serializer.validated_data.get("external_key") else ()
        recorder = ActionRecorder(self.request.user, transaction_ids=existing_ids)
        transaction = serializer.save(user=self.request.user)
        if getattr(serializer, "reused_transfer", False):
            return
        recorder.finish(transaction, "create")
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
        recorder = ActionRecorder(self.request.user, transaction_ids=(serializer.instance.pk,))
        transaction = serializer.save()
        recorder.finish(transaction, "update")
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
                    spreadsheet_safe_text(transaction.account.name),
                    transaction.transfer_account_id or "",
                    spreadsheet_safe_text(transaction.transfer_account.name)
                    if transaction.transfer_account
                    else "",
                    transaction.category_id or "",
                    spreadsheet_safe_text(transaction.category.name) if transaction.category else "",
                    transaction.payment_method_id or "",
                    spreadsheet_safe_text(transaction.payment_method.name)
                    if transaction.payment_method
                    else "",
                    transaction.balance_after if transaction.balance_after is not None else "",
                    spreadsheet_safe_text(transaction.sender_account_identifier),
                    spreadsheet_safe_text(transaction.sender_card_identifier),
                    spreadsheet_safe_text(transaction.receiver_account_identifier),
                    spreadsheet_safe_text(transaction.receiver_card_identifier),
                    spreadsheet_safe_text(transaction.reference),
                    spreadsheet_safe_text(transaction.counterparty_text),
                    spreadsheet_safe_text(transaction.external_key),
                    transaction.source,
                    transaction.needs_review,
                    spreadsheet_safe_text(transaction.note),
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
