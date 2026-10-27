"""Manage user-verified meanings of recurring statement identifiers."""

import re

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .bkash_identifiers import CODE as BKASH_CODE
from .bkash_identifiers import mapping_code
from .counterparties import observed_codes
from .ebl_identifiers import CODE as EBL_CODE
from .models import StatementCounterpartyCode


class CodeMappingInputSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none())
    profile = serializers.ChoiceField(choices=["city_bank", "bkash", "ebl_bank"], default="city_bank")
    code = serializers.CharField(max_length=150)
    direction = serializers.ChoiceField(choices=Transaction.Direction.choices)
    party_kind = serializers.ChoiceField(
        choices=StatementCounterpartyCode.PartyKind.choices
    )
    label = serializers.CharField(max_length=120, trim_whitespace=True)
    other_account = serializers.PrimaryKeyRelatedField(
        queryset=Account.objects.none(),
        allow_null=True,
        required=False,
    )
    suggested_type = serializers.ChoiceField(
        choices=[("", "No type suggestion"), *Transaction.Type.choices],
        required=False,
    )
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(),
        allow_null=True,
        required=False,
    )
    note_template = serializers.CharField(max_length=500, allow_blank=True, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        user = request.user if request and request.user.is_authenticated else None
        self.fields["account"].queryset = Account.objects.filter(
            user=user, is_active=True
        )
        self.fields["other_account"].queryset = Account.objects.filter(
            user=user, is_active=True
        )
        self.fields["category"].queryset = Category.objects.filter(
            user=user, is_active=True
        )

    def validate(self, attrs):
        account = attrs["account"]
        kind = attrs["party_kind"]
        other = attrs.get("other_account")
        direction = attrs["direction"]
        suggested_type = attrs.get("suggested_type", "")
        profile = attrs["profile"]
        if (profile in {"city_bank", "ebl_bank"} and account.type not in {"bank", "savings"}) or (
            profile == "bkash" and account.type != "mobile_wallet"
        ):
            raise serializers.ValidationError(
                {"account": "Choose an account matching this statement provider."}
            )
        if (profile == "city_bank" and not re.fullmatch(r"\d{4,24}", attrs["code"])) or (
            profile == "bkash" and not BKASH_CODE.fullmatch(attrs["code"])
        ) or (profile == "ebl_bank" and not EBL_CODE.fullmatch(attrs["code"])):
            raise serializers.ValidationError({"code": "Choose a valid observed statement identifier."})
        if kind == "owned" and (
            not other or other.id == account.id or other.currency != account.currency
        ):
            raise serializers.ValidationError(
                {
                    "other_account": "Choose a different active owned account in the same currency."
                }
            )
        if kind == "external" and other:
            raise serializers.ValidationError(
                {"other_account": "External parties are not tracked accounts."}
            )
        if suggested_type == "transfer" and kind != "owned":
            raise serializers.ValidationError(
                {"suggested_type": "An internal transfer needs another owned account."}
            )
        if (
            suggested_type
            and suggested_type not in {"transfer", "adjustment"}
            and direction != Transaction.default_direction_for_type(suggested_type)
        ):
            raise serializers.ValidationError(
                {
                    "suggested_type": "This type does not agree with debit/credit for the statement account."
                }
            )
        if attrs.get("category") and not suggested_type:
            raise serializers.ValidationError(
                {"category": "Choose a transaction type before suggesting a category."}
            )
        category = attrs.get("category")
        compatible = {
            "expense": {"expense", "fee"},
            "income": {"income", "refund"},
            "transfer": {"transfer"},
            "debt": {"lend", "borrow", "repayment_received", "repayment_paid"},
        }
        if (
            category
            and category.kind in compatible
            and suggested_type not in compatible[category.kind]
        ):
            raise serializers.ValidationError(
                {"category": "Choose a category that agrees with the suggested type."}
            )
        return attrs


class CodeMappingOutputSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    party_kind = serializers.CharField()
    label = serializers.CharField()
    other_account = serializers.UUIDField(allow_null=True)
    suggested_type = serializers.CharField(allow_blank=True)
    category = serializers.UUIDField(allow_null=True)
    note_template = serializers.CharField(allow_blank=True)
    updated_at = serializers.DateTimeField()


class CodeExampleSerializer(serializers.Serializer):
    date = serializers.DateField(allow_null=True)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, allow_null=True)
    description = serializers.CharField()


class ObservedCodeSerializer(serializers.Serializer):
    account = serializers.UUIDField()
    account_name = serializers.CharField()
    profile = serializers.CharField()
    code = serializers.CharField()
    printed_code = serializers.CharField(allow_null=True)
    direction = serializers.CharField()
    count = serializers.IntegerField()
    pending_count = serializers.IntegerField()
    last_seen = serializers.DateField(allow_null=True)
    examples = CodeExampleSerializer(many=True)
    mapping = CodeMappingOutputSerializer(allow_null=True)


class ObservedCodeListSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    results = ObservedCodeSerializer(many=True)


def mapping_data(mapping):
    return {
        "id": str(mapping.id),
        "party_kind": mapping.party_kind,
        "label": mapping.label,
        "other_account": str(mapping.other_account_id)
        if mapping.other_account_id
        else None,
        "suggested_type": mapping.suggested_type,
        "category": str(mapping.category_id) if mapping.category_id else None,
        "note_template": mapping.note_template,
        "updated_at": mapping.updated_at,
    }


class StatementCounterpartyCodeView(APIView):
    permission_classes = (IsAuthenticated,)
    parser_classes = (JSONParser,)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response

    @extend_schema(responses=ObservedCodeListSerializer, tags=["Statements"])
    def get(self, request):
        observed = observed_codes(request.user)
        mappings = StatementCounterpartyCode.objects.filter(
            user=request.user
        ).select_related("account", "other_account", "category")
        saved = {(m.account_id, m.profile, m.code, m.direction): m for m in mappings}
        keys = set(observed)
        # Legacy Citytouch mappings remain visible even if their source row was removed.
        keys.update(
            (m.account_id, m.profile, m.code, m.direction)
            for m in mappings if m.profile == "city_bank"
        )
        results = []
        for account_id, profile, code, direction in sorted(
            keys, key=lambda key: (str(key[0]), key[1], key[2], key[3])
        ):
            stats = observed.get((account_id, profile, code, direction), {})
            mapping = saved.get((account_id, profile, mapping_code(profile, account_id, code), direction))
            results.append(
                {
                    "account": str(account_id),
                    "account_name": stats.get("account_name") or mapping.account.name,
                    "profile": profile,
                    "code": code,
                    "printed_code": stats.get("printed_code"),
                    "direction": direction,
                    "count": stats.get("count", 0),
                    "pending_count": stats.get("pending_count", 0),
                    "last_seen": stats.get("last_seen"),
                    "examples": stats.get("examples", []),
                    "mapping": mapping_data(mapping) if mapping else None,
                }
            )
        return Response(
            ObservedCodeListSerializer({"count": len(results), "results": results}).data
        )

    @extend_schema(
        request=CodeMappingInputSerializer,
        responses=CodeMappingOutputSerializer,
        tags=["Statements"],
    )
    @transaction.atomic
    def post(self, request):
        serializer = CodeMappingInputSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        account = values["account"]
        profile = values["profile"]
        code = values["code"]
        direction = values["direction"]
        stored_code = mapping_code(profile, account.id, code)
        if (account.id, profile, code, direction) not in observed_codes(
            request.user
        ) and not StatementCounterpartyCode.objects.filter(
            user=request.user,
            account=account,
            profile=profile,
            code=stored_code,
            direction=direction,
        ).exists():
            raise serializers.ValidationError(
                {"code": "This identifier was not found in a saved statement."}
            )
        mapping, _ = StatementCounterpartyCode.objects.update_or_create(
            user=request.user,
            account=account,
            profile=profile,
            code=stored_code,
            direction=direction,
            defaults={
                "party_kind": values["party_kind"],
                "label": values["label"],
                "other_account": values.get("other_account")
                if values["party_kind"] == "owned"
                else None,
                "suggested_type": values.get("suggested_type", ""),
                "category": values.get("category"),
                "note_template": values.get("note_template", ""),
            },
        )
        return Response(CodeMappingOutputSerializer(mapping_data(mapping)).data)


class StatementCounterpartyCodeDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses={204: None}, tags=["Statements"])
    def delete(self, request, pk):
        mapping = get_object_or_404(StatementCounterpartyCode, pk=pk, user=request.user)
        mapping.delete()
        response = Response(status=204)
        response["Cache-Control"] = "no-store"
        return response
