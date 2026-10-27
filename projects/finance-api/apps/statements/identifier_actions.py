"""Explicit, owner-scoped identifier dismissals and retired EBL metadata cleanup."""

import hashlib
import json
import re

from cryptography.fernet import InvalidToken
from django.core import signing
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.transactions.models import Transaction
from apps.transactions.transfers import lock_transfer_user

from .bkash_identifiers import CODE as BKASH_CODE
from .bkash_identifiers import mapping_code
from .counterparties import observed_codes
from .ebl_identifiers import CODE as EBL_CODE
from .ebl_identifiers import RETIRED_CODE
from .models import StatementCounterpartyCode, StatementIdentifierSkip, StatementRow

CLEANUP_SALT = "statements.retired-ebl-cleanup.v1"


class IdentifierSkipInputSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    profile = serializers.ChoiceField(choices=["city_bank", "bkash", "ebl_bank"])
    code = serializers.CharField(max_length=150)
    direction = serializers.ChoiceField(choices=Transaction.Direction.choices)
    skipped = serializers.BooleanField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        user = request.user if request and request.user.is_authenticated else None
        self.fields["account"].queryset = Account.objects.filter(user=user)

    def validate(self, attrs):
        profile, code = attrs["profile"], attrs["code"]
        valid = (re.fullmatch(r"\d{4,24}", code) if profile == "city_bank" else
                 BKASH_CODE.fullmatch(code) if profile == "bkash" else EBL_CODE.fullmatch(code))
        if not valid:
            raise serializers.ValidationError({"code": "Choose a valid observed identifier."})
        return attrs


class IdentifierSkipResultSerializer(serializers.Serializer):
    skipped = serializers.BooleanField()


class EblCleanupPreviewSerializer(serializers.Serializer):
    retired_identifiers = serializers.IntegerField(min_value=0)
    retired_rules = serializers.IntegerField(min_value=0)
    revision = serializers.CharField()


class EblCleanupInputSerializer(serializers.Serializer):
    revision = serializers.CharField(max_length=1000)


class EblCleanupResultSerializer(serializers.Serializer):
    cleared_identifiers = serializers.IntegerField(min_value=0)
    deleted_rules = serializers.IntegerField(min_value=0)


class IdentifierActionView(APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (JSONParser,)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class StatementIdentifierSkipView(IdentifierActionView):
    @extend_schema(request=IdentifierSkipInputSerializer, responses=IdentifierSkipResultSerializer, tags=["Statements"])
    @transaction.atomic
    def post(self, request):
        lock_transfer_user(request.user)
        serializer = IdentifierSkipInputSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        scope = {"user": request.user, "account": values["account"], "profile": values["profile"],
                 "code": mapping_code(values["profile"], values["account"].pk, values["code"]),
                 "direction": values["direction"]}
        observed = (values["account"].pk, values["profile"], values["code"], values["direction"])
        if observed not in observed_codes(request.user) and not (
            StatementCounterpartyCode.objects.filter(**scope).exists()
            or StatementIdentifierSkip.objects.filter(**scope).exists()
        ):
            raise serializers.ValidationError({"code": "This identifier was not found in your saved statements."})
        if values["skipped"]:
            StatementIdentifierSkip.objects.get_or_create(**scope)
        else:
            StatementIdentifierSkip.objects.filter(**scope).delete()
        return Response({"skipped": values["skipped"]})


def cleanup_plan(user, *, lock=False):
    rows = StatementRow.objects.filter(batch__user=user, batch__profile="ebl_bank").only(
        "id", "source_code", "version",
    ).order_by("id")
    rules = StatementCounterpartyCode.objects.filter(user=user, profile="ebl_bank").only(
        "id", "updated_at",
    ).order_by("id")
    if lock:
        rows = rows.select_for_update(of=("self",))
        rules = rules.select_for_update()
    rows = [row for row in rows if RETIRED_CODE.fullmatch(row.source_code or "")]
    rules = list(rules)
    digest = hashlib.sha256(json.dumps([
        [[str(row.pk), row.version, row.source_code] for row in rows],
        [[str(rule.pk), rule.updated_at.isoformat()] for rule in rules],
    ]).encode()).hexdigest()
    return rows, rules, digest


class RetiredEblCleanupView(IdentifierActionView):
    @extend_schema(responses=EblCleanupPreviewSerializer, tags=["Statements"])
    def get(self, request):
        try:
            rows, rules, digest = cleanup_plan(request.user)
        except InvalidToken:
            return Response({"detail": "Identifier metadata could not be decrypted. No data was changed."}, status=503)
        return Response({
            "retired_identifiers": len(rows), "retired_rules": len(rules),
            "revision": signing.dumps({"owner": str(request.user.pk), "digest": digest}, salt=CLEANUP_SALT),
        })

    @extend_schema(request=EblCleanupInputSerializer, responses=EblCleanupResultSerializer, tags=["Statements"])
    @transaction.atomic
    def post(self, request):
        lock_transfer_user(request.user)
        serializer = EblCleanupInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            confirmed = signing.loads(serializer.validated_data["revision"], salt=CLEANUP_SALT, max_age=900)
        except signing.BadSignature:
            return Response({"detail": "The cleanup preview expired or changed. Preview it again."}, status=409)
        try:
            rows, rules, digest = cleanup_plan(request.user, lock=True)
        except InvalidToken:
            return Response({"detail": "Identifier metadata could not be decrypted. No data was changed."}, status=503)
        if confirmed != {"owner": str(request.user.pk), "digest": digest}:
            return Response({"detail": "EBL identifier data changed. Preview the cleanup again."}, status=409)
        cleared = StatementRow.objects.filter(pk__in=[row.pk for row in rows], batch__user=request.user).update(
            source_code="", version=F("version") + 1, updated_at=timezone.now(),
        )
        deleted, _ = StatementCounterpartyCode.objects.filter(
            pk__in=[rule.pk for rule in rules], user=request.user,
        ).delete()
        result = {"cleared_identifiers": cleared, "deleted_rules": deleted}
        if cleared or deleted:
            create_audit_log(user=request.user, action=AuditLogEntry.Action.UPDATED, entity=request.user,
                             after=result, metadata={"operation": "retired_ebl_identifier_cleanup"})
        return Response(result)
