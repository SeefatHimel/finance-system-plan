import hashlib
import json

from django.db import transaction as db_transaction
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.categories.models import Category
from apps.transactions.models import Transaction, TransactionAction
from apps.transactions.recovery import ActionRecorder, describe
from apps.transactions.transfers import lock_transfer_user

from .models import QuickAddPreset, QuickEntryReceipt
from .serializers import (
    PresetOrderSerializer,
    QuickAddPresetSerializer,
    QuickEntryResultSerializer,
    QuickEntrySerializer,
    compatible,
)


class QuickAddPresetViewSet(ModelViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = QuickAddPresetSerializer
    pagination_class = None

    def get_queryset(self):
        return QuickAddPreset.objects.filter(user=self.request.user).select_related("account", "category")

    @db_transaction.atomic
    def perform_create(self, serializer):
        lock_transfer_user(self.request.user)
        serializer.save(user=self.request.user)

    @db_transaction.atomic
    def perform_update(self, serializer):
        lock_transfer_user(self.request.user)
        serializer.save()

    @db_transaction.atomic
    def perform_destroy(self, instance):
        lock_transfer_user(self.request.user)
        instance.delete()

    @extend_schema(request=PresetOrderSerializer, responses=QuickAddPresetSerializer(many=True))
    @action(detail=False, methods=("post",))
    @db_transaction.atomic
    def reorder(self, request):
        serializer = PresetOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lock_transfer_user(request.user)
        ids = serializer.validated_data["ids"]
        rows = {row.pk: row for row in self.get_queryset()}
        if len(ids) != len(set(ids)) or set(ids) != set(rows):
            raise ValidationError({"ids": "Refresh presets and include each of your preset IDs exactly once."})
        for position, identifier in enumerate(ids):
            rows[identifier].display_order = position
        QuickAddPreset.objects.bulk_update(rows.values(), ("display_order",))
        return Response(self.get_serializer(self.get_queryset(), many=True).data)


class QuickEntryView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=QuickEntrySerializer,
        description="Save a manual expense/income. Reuse the same client_request_id and values after an uncertain response; a replay never reverts later ledger edits.",
        responses={
            201: OpenApiResponse(QuickEntryResultSerializer, description="New ledger entry saved."),
            200: OpenApiResponse(QuickEntryResultSerializer, description="Identical request already saved; original transaction returned."),
            400: OpenApiResponse(description="Invalid values or account/category ownership, activity or compatibility."),
            401: OpenApiResponse(description="Authentication required."),
            409: OpenApiResponse(description="Request ID reused with different values, or original transaction later deleted."),
        },
    )
    @db_transaction.atomic
    def post(self, request):
        serializer = QuickEntrySerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        request_id = data.pop("client_request_id")
        canonical = {key: str(getattr(value, "pk", value)) if value is not None else None for key, value in data.items()}
        fingerprint = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
        lock_transfer_user(request.user)
        receipt = QuickEntryReceipt.objects.filter(user=request.user, client_request_id=request_id).first()
        if receipt:
            if receipt.fingerprint != fingerprint:
                return Response({"detail": "This entry ID was already used with different values. Retry the original entry or start a new one."}, status=409)
            if receipt.transaction_id is None:
                return Response({"detail": "This entry was saved and later deleted. Start a new entry instead of retrying it."}, status=409)
            latest = TransactionAction.objects.filter(user=request.user).first()
            recovery = describe(latest, check=True) if latest and latest.kind == "create" and latest.transaction_id == receipt.transaction_id else None
            return Response({"transaction": receipt.transaction_id, "replayed": True, "undo_action": recovery})
        account = Account.objects.filter(user=request.user, pk=data["account"]).first()
        if account is None:
            raise ValidationError({"account": "Choose one of your accounts."})
        category = Category.objects.filter(user=request.user, pk=data["category"]).first() if data["category"] else None
        if data["category"] and category is None:
            raise ValidationError({"category": "Choose one of your categories."})
        data["account"] = account
        data["category"] = category
        if not data["account"].is_active:
            raise ValidationError({"account": "Choose an active account."})
        if data["category"] and (not data["category"].is_active or not compatible(data["category"], data["type"])):
            raise ValidationError({"category": "Choose an active category compatible with this entry."})
        recorder = ActionRecorder(request.user)
        record = Transaction.objects.create(user=request.user, direction=Transaction.default_direction_for_type(data["type"]), **data)
        QuickEntryReceipt.objects.create(user=request.user, client_request_id=request_id, fingerprint=fingerprint, transaction=record)
        create_audit_log(user=request.user, action=AuditLogEntry.Action.CREATED, entity=record, after=transaction_snapshot(record))
        recorder.finish(record, "create")
        return Response({"transaction": record.id, "replayed": False, "undo_action": record.undo_action}, status=201)
