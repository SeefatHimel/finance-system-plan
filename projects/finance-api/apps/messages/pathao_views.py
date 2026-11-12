"""Owner-scoped Pathao alias setup and explicit existing-duplicate recovery."""

import hashlib
import json
import uuid

from django.core import signing
from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.transactions.recovery import ActionRecorder, describe
from apps.transactions.serializers import TransactionActionSerializer
from apps.transactions.transfers import lock_transfer_user

from .models import ParsedMessageCandidate, SenderRule, SmsSourceReviewReceipt
from .pathao_sources import (
    SALT,
    SourceConflict,
    assert_plan,
    attach_sources,
    plan_digest,
    preview,
    source_plan,
)
from .sender_groups import PATHAO_SENDERS
from .serializers import SenderRuleSerializer


class PathaoGroupRequest(serializers.Serializer):
    account = serializers.UUIDField()


class PathaoGroupView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=PathaoGroupRequest, responses=SenderRuleSerializer(many=True)
    )
    @transaction.atomic
    def post(self, request):
        serializer = PathaoGroupRequest(data=request.data)
        serializer.is_valid(raise_exception=True)
        lock_transfer_user(request.user)
        account = get_object_or_404(
            Account,
            pk=serializer.validated_data["account"],
            user=request.user,
            is_active=True,
            currency="BDT",
            type="mobile_wallet",
        )
        rules = []
        # Existing IDs, choices and enabled states are preserved. A conflicting
        # route must be resolved by the user, never by an implicit migration.
        for sender in PATHAO_SENDERS:
            rule = SenderRule.objects.filter(
                user=request.user, sender__iexact=sender, match_type="exact"
            ).first()
            if rule and (
                rule.account_id != account.pk or rule.provider != "pathao_pay"
            ):
                raise serializers.ValidationError(
                    {
                        "account": f"{sender} already uses a different provider or account. Edit that rule before setting up this group."
                    }
                )
            if not rule:
                name = f"Pathao Pay · {sender}"
                if SenderRule.objects.filter(user=request.user, name=name).exists():
                    name += f" · {uuid.uuid4().hex[:8]}"
                rule = SenderRule.objects.create(
                    user=request.user,
                    account=account,
                    name=name,
                    sender=sender,
                    provider="pathao_pay",
                    match_type="exact",
                )
                create_audit_log(
                    user=request.user,
                    action=AuditLogEntry.Action.CREATED,
                    entity=rule,
                    metadata={"sender_group": "pathao_pay"},
                )
            rules.append(rule)
        return Response(
            SenderRuleSerializer(rules, many=True, context={"request": request}).data
        )


class SourceResolveRequest(serializers.Serializer):
    preview_token = serializers.CharField(max_length=2000)
    request_id = serializers.UUIDField()
    confirmed = serializers.BooleanField()

    def validate_confirmed(self, value):
        if not value:
            raise serializers.ValidationError(
                "Confirm that these originals describe one movement."
            )
        return value


class PathaoSmsSourceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    sender = serializers.CharField()
    text = serializers.CharField()
    received_at = serializers.DateTimeField()
    status = serializers.CharField()
    transaction = serializers.UUIDField(allow_null=True)
    amount = serializers.CharField(allow_null=True)
    direction = serializers.CharField()
    balance_after = serializers.CharField(allow_null=True)
    fee_amount = serializers.CharField(allow_null=True)


class PathaoSavedEntrySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    account_name = serializers.CharField()
    date = serializers.DateField()
    amount = serializers.CharField()
    direction = serializers.CharField()
    balance_after = serializers.CharField(allow_null=True)
    description = serializers.CharField()
    note = serializers.CharField()
    type = serializers.CharField()


class PathaoSourcePreviewSerializer(serializers.Serializer):
    available = serializers.BooleanField()
    reference = serializers.CharField()
    keep = serializers.UUIDField(allow_null=True)
    preview_token = serializers.CharField()
    can_resolve = serializers.BooleanField()
    blockers = serializers.ListField(child=serializers.CharField())
    sources = PathaoSmsSourceSerializer(many=True)
    transactions = PathaoSavedEntrySerializer(many=True)


class PathaoSourceResultSerializer(serializers.Serializer):
    transaction = serializers.UUIDField()
    source_count = serializers.IntegerField()
    merged_count = serializers.IntegerField()
    undo_action = TransactionActionSerializer(allow_null=True)


class PathaoSourcesView(APIView):
    permission_classes = (IsAuthenticated,)

    def candidate(self, request, candidate_id):
        return get_object_or_404(
            ParsedMessageCandidate.objects.select_related(
                "user", "account", "destination_account", "raw_message"
            ),
            user=request.user,
            pk=candidate_id,
        )

    @extend_schema(
        responses=PathaoSourcePreviewSerializer,
        parameters=[
            OpenApiParameter(
                "keep",
                OpenApiTypes.UUID,
                OpenApiParameter.QUERY,
                description="Saved transaction to retain in this source group.",
            )
        ],
    )
    def get(self, request, candidate_id):
        choice = serializers.UUIDField(allow_null=True)
        keep = choice.run_validation(request.query_params.get("keep"))
        return Response(
            preview(self.candidate(request, candidate_id), keep),
            headers={"Cache-Control": "no-store"},
        )

    @extend_schema(request=SourceResolveRequest, responses=PathaoSourceResultSerializer)
    @transaction.atomic
    def post(self, request, candidate_id):
        payload = SourceResolveRequest(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        lock_transfer_user(request.user)
        candidate = self.candidate(request, candidate_id)
        digest = hashlib.sha256(
            json.dumps(
                {"candidate": str(candidate_id), "token": data["preview_token"]},
                sort_keys=True,
            ).encode()
        ).hexdigest()
        receipt = (
            SmsSourceReviewReceipt.objects.select_related("action")
            .filter(user=request.user, request_id=data["request_id"])
            .first()
        )
        if receipt:
            if (
                receipt.digest != digest
                or not receipt.action
                or receipt.action.undone_at
            ):
                raise SourceConflict(
                    "This request was already used or undone. Start a fresh source review."
                )
            return Response(
                {**receipt.result, "undo_action": describe(receipt.action, check=True)}
            )
        try:
            token = signing.loads(data["preview_token"], salt=SALT, max_age=900)
            keep = uuid.UUID(token["keep"]) if token["keep"] else None
        except (signing.BadSignature, KeyError, TypeError, ValueError) as exc:
            raise SourceConflict(
                "This source preview expired. Refresh and compare again."
            ) from exc
        plan = source_plan(candidate)
        if token.get("user") != request.user.pk or token.get("digest") != plan_digest(
            candidate, plan, keep
        ):
            raise SourceConflict()
        assert_plan(plan, allow_multiple=True)
        ids = [item.pk for item in plan["records"]]
        if not plan["identity"] or keep not in ids:
            raise serializers.ValidationError(
                "Record a reviewed SMS first; no matching saved transaction is available yet."
            )
        recorder = ActionRecorder(
            request.user,
            transaction_ids=ids,
            candidate_ids=[item.pk for item in plan["sources"]],
            merge_sources=True,
        )
        if len(ids) > 1:
            from apps.transactions.duplicate_merge import apply as merge
            from apps.transactions.duplicate_merge import preview as merge_preview

            merge_data = {"transactions": ids, "keep": keep}
            checked = merge_preview(request.user, merge_data)
            if checked["blockers"]:
                raise serializers.ValidationError({"merge": checked["blockers"]})
            merge(
                request.user,
                {
                    **merge_data,
                    "preview_token": checked["preview_token"],
                    "request_id": data["request_id"],
                    "confirmed": True,
                },
            )
        from apps.transactions.models import Transaction

        record = Transaction.objects.select_related("account", "transfer_account").get(
            user=request.user, pk=keep
        )
        # Re-read reassigned candidate links after a ledger merge, preserving all
        # spreadsheet/PDF sources through the existing merge implementation.
        candidate.refresh_from_db()
        attach_sources(candidate, record, plan=source_plan(candidate))
        action = recorder.finish(
            record, "duplicate_merge" if len(ids) > 1 else "evidence_link"
        )
        result = {
            "transaction": str(record.pk),
            "source_count": len(plan["sources"]),
            "merged_count": max(0, len(ids) - 1),
        }
        SmsSourceReviewReceipt.objects.create(
            user=request.user,
            request_id=data["request_id"],
            digest=digest,
            result=result,
            action=action,
        )
        return Response({**result, "undo_action": describe(action)})
