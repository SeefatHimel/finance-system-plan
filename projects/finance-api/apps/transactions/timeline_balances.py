"""Exact, source-linked principal/inline-fee allocation, never a balance adjustment."""
import hashlib
import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q, Exists, OuterRef
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework import serializers
from drf_spectacular.types import OpenApiTypes

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.statements.models import StatementRow
from .models import Transaction, TimelineBalanceAllocation
from .timeline_order import account_records, day_rows, parse_day
from .transfers import lock_transfer_user


class SharedBalanceSerializer(serializers.Serializer):
    principal = serializers.UUIDField()
    account = serializers.UUIDField()
    date = serializers.DateField()
    currency = serializers.CharField(allow_blank=True)
    status = serializers.ChoiceField(choices=("suggested", "confirmed", "stale"))
    fingerprint = serializers.CharField(allow_blank=True)
    revision = serializers.IntegerField(min_value=0)
    anchor_balance = serializers.CharField(allow_blank=True)
    reported_final = serializers.CharField(allow_blank=True)
    balances = serializers.DictField(child=serializers.CharField())
    amounts = serializers.DictField(child=serializers.CharField())
    ordered_ids = serializers.ListField(child=serializers.UUIDField())


class SharedBalanceListSerializer(serializers.Serializer):
    results = SharedBalanceSerializer(many=True)


class SharedBalanceDecisionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=("apply", "undo"))
    revision = serializers.IntegerField(min_value=0)
    fingerprint = serializers.CharField(allow_blank=True)


class SharedBalanceDecisionResultSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=0)
    active = serializers.BooleanField()


def lookback(day):
    return day - timedelta(days=min(31, (day - date.min).days))


def suggestion(user, account, principal, records=None, source_groups=None):
    # Deliberately bounded: do not infer a card's available credit/dues semantics.
    if account.type not in {"bank", "savings", "mobile_wallet"} or principal.type == "transfer" or not principal.time:
        return None
    sources = list(principal.statement_rows.all())
    if len(sources) != 1:
        return None
    source = sources[0]
    if source.component != "principal" or source.batch.user_id != user.pk or source.batch.account_id != account.pk or source.batch.currency != account.currency:
        return None
    siblings = source_groups.get((source.batch_id, source.position), []) if source_groups is not None else list(StatementRow.objects.filter(batch=source.batch, position=source.position).select_related("transaction").prefetch_related("transaction__statement_rows"))
    if len(siblings) != 2 or {row.component for row in siblings} != {"principal", "fee"}:
        return None
    fee_source = next(row for row in siblings if row.component == "fee")
    fee = fee_source.transaction
    if fee is None or fee.pk == principal.pk or fee.user_id != user.pk or fee.account_id != account.pk or fee.type == "transfer":
        return None
    if fee.statement_rows.count() != 1 or any(row.state not in {"posted", "linked"} for row in siblings):
        return None
    if fee.date != principal.date or fee.time != principal.time or fee.needs_review or principal.needs_review:
        return None
    # Only genuine immutable extraction of ONE row establishes the relationship.
    original = source.extracted
    if original != fee_source.extracted or source.date != principal.date or fee_source.date != principal.date:
        return None
    try:
        final = Decimal(str(original["balance_after"]))
        amount = Decimal(str(original["amount"]))
        signed_fee = Decimal(str(original["signed_fee"]))
    except (KeyError, InvalidOperation, TypeError, ValueError):
        return None
    if not all(value.is_finite() for value in (final, amount, signed_fee)) or not signed_fee or amount != principal.amount or abs(signed_fee) != fee.amount:
        return None
    expected_direction = "credit" if signed_fee > 0 else "debit"
    if fee.direction != expected_direction or original.get("direction") != principal.direction:
        return None
    if any(row.amount != entry.amount or row.direction != entry.direction or row.balance_after != final or entry.balance_after != final for row, entry in ((source, principal), (fee_source, fee))):
        return None
    if records is None:
        records = list(account_records(user, lookback(principal.date), principal.date).filter(Q(account=account) | Q(type="transfer", transfer_account=account))[:2001])
    records = [entry for entry in records if lookback(principal.date) <= entry.date <= principal.date]
    if len(records) > 2000:
        return None
    # Unknown times on a boundary day could conceal a movement inside the interval.
    moment = (principal.date, principal.time)
    earlier = [entry for entry in records if entry.time and (entry.date, entry.time) < moment]
    if not earlier:
        return None
    anchor = max(earlier, key=lambda entry: (entry.date, entry.time))
    if sum(entry.date == anchor.date and entry.time == anchor.time for entry in earlier) != 1:
        return None
    interval = [entry for entry in records if anchor.date <= entry.date <= principal.date and (not entry.time or (anchor.date, anchor.time) <= (entry.date, entry.time) <= moment)]
    if {entry.pk for entry in interval} != {anchor.pk, principal.pk, fee.pk} or any(not entry.time for entry in interval):
        return None
    # Do not use a changed transfer observation or a posting-date reinterpretation.
    for entry in interval:
        report = day_rows([entry], account)[0]["balance_after"]
        if any(item.account_id == account.pk and (item.date != entry.date or item.time != entry.time or (item.balance_after is not None and report is not None and item.balance_after != Decimal(report))) for item in entry.transfer_evidence.all()):
            return None
        if any(item.date != entry.date for item in entry.statement_rows.all()):
            return None
    if anchor.needs_review:
        return None
    anchor_row = day_rows([anchor], account)[0]
    if anchor_row["balance_after"] is None:
        return None
    before = Decimal(anchor_row["balance_after"])
    intermediate = before + principal.amount * (1 if principal.direction == "credit" else -1)
    if intermediate + signed_fee != final or intermediate == final:
        return None
    ordered = [anchor, principal, fee]
    versions = [day_rows([entry], account) for entry in ordered]
    raw = json.dumps([str(account.pk), account.type, account.currency, versions, original], sort_keys=True, default=str)
    fingerprint = hashlib.sha256(raw.encode()).hexdigest()
    return {"principal": str(principal.pk), "account": str(account.pk), "date": str(principal.date), "currency": account.currency,
        "fingerprint": fingerprint, "anchor_balance": f"{before:.2f}", "reported_final": f"{final:.2f}",
        "balances": {str(principal.pk): f"{intermediate:.2f}", str(fee.pk): f"{final:.2f}"},
        "ordered_ids": [str(principal.pk), str(fee.pk)], "amounts": {str(principal.pk): f"{principal.amount:.2f}", str(fee.pk): f"{fee.amount:.2f}"}}


def decorated(candidate, saved):
    valid = bool(candidate and saved and saved.active and saved.fingerprint == candidate["fingerprint"])
    return {**candidate, "status": "confirmed" if valid else "stale" if saved and saved.active else "suggested", "revision": saved.revision if saved else 0}


class TimelineBalanceListView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(parameters=[OpenApiParameter("start_date", OpenApiTypes.DATE, required=True), OpenApiParameter("end_date", OpenApiTypes.DATE, required=True)], responses=SharedBalanceListSerializer)
    def get(self, request):
        start, end = parse_day(request.query_params.get("start_date")), parse_day(request.query_params.get("end_date"))
        if end < start or (end - start).days > 366:
            raise ValidationError({"date": "Choose a range of up to 366 days."})
        saved = {row.principal_id: row for row in TimelineBalanceAllocation.objects.filter(user=request.user).filter(Q(date__range=(start, end)) | Q(principal__date__range=(start, end)))}
        fee_sibling = StatementRow.objects.filter(batch_id=OuterRef("batch_id"), position=OuterRef("position"), component="fee", transaction__isnull=False)
        source_ids = StatementRow.objects.filter(batch__user=request.user, component="principal", transaction__date__range=(start, end)).annotate(has_fee=Exists(fee_sibling)).filter(has_fee=True).values("transaction_id")
        principals = list(Transaction.objects.filter(user=request.user, pk__in=source_ids).select_related("account").prefetch_related("statement_rows__batch")[:501])
        # A large range is explicitly refused rather than publishing an incomplete scan.
        if len(principals) > 500:
            raise ValidationError({"date": "Choose a smaller range to check shared statement balances."})
        # Fetch candidate sibling groups together rather than once per movement.
        source_pairs = {(row.batch_id, row.position) for principal in principals for row in principal.statement_rows.all()}
        source_groups = {}
        if source_pairs:
            siblings = StatementRow.objects.filter(batch_id__in={key[0] for key in source_pairs}, position__in={key[1] for key in source_pairs}).select_related("transaction").prefetch_related("transaction__statement_rows")
            for row in siblings:
                if (row.batch_id, row.position) in source_pairs:
                    source_groups.setdefault((row.batch_id, row.position), []).append(row)
        result = []
        seen = set()
        cached = {}
        for principal in principals:
            if principal.account_id not in cached:
                cached[principal.account_id] = list(account_records(request.user, lookback(start), end).filter(Q(account=principal.account) | Q(type="transfer", transfer_account=principal.account))[:2001])
            account_rows = cached[principal.account_id]
            candidate = suggestion(request.user, principal.account, principal, account_rows, source_groups) if len(account_rows) <= 2000 else None
            if candidate:
                result.append(decorated(candidate, saved.get(principal.pk)))
                seen.add(principal.pk)
        for key, row in saved.items():
            if row.active and key not in seen:
                result.append({"principal": str(key), "account": str(row.account_id), "date": str(row.date), "status": "stale", "revision": row.revision,
                    "balances": {}, "ordered_ids": [], "fingerprint": "", "currency": "", "amounts": {}, "anchor_balance": "", "reported_final": ""})
        return Response({"results": result}, headers={"Cache-Control": "private, no-store"})


class TimelineBalanceDecisionView(APIView):
    permission_classes = (IsAuthenticated,)

    @transaction.atomic
    @extend_schema(request=SharedBalanceDecisionSerializer, responses=SharedBalanceDecisionResultSerializer)
    def post(self, request, principal_id):
        payload = SharedBalanceDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        lock_transfer_user(request.user)
        principal = get_object_or_404(Transaction.objects.select_related("account"), user=request.user, pk=principal_id)
        saved = TimelineBalanceAllocation.objects.select_for_update().filter(user=request.user, principal=principal).first()
        if type(request.data.get("revision")) is not int or request.data["revision"] != (saved.revision if saved else 0):
            raise ValidationError({"detail": "This confirmation changed. Refresh the timeline and try again."})
        action = request.data.get("action")
        if action not in {"apply", "undo"}:
            raise ValidationError({"action": "Choose apply or undo."})
        before = {"active": saved.active, "balances": saved.balances} if saved else {}
        if action == "undo":
            if not saved or not saved.active:
                raise ValidationError({"detail": "There is no confirmed allocation to undo."})
            saved.active = False
        else:
            candidate = suggestion(request.user, principal.account, principal)
            if not candidate or candidate["fingerprint"] != request.data.get("fingerprint"):
                raise ValidationError({"detail": "These sources no longer establish an exact shared balance. Refresh the timeline."})
            if saved is None:
                saved = TimelineBalanceAllocation(user=request.user, principal=principal, account=principal.account, date=principal.date)
            saved.active = True
            saved.date = principal.date
            saved.account = principal.account
            saved.fingerprint = candidate["fingerprint"]
            saved.balances = candidate["balances"]
        saved.revision += 1
        saved.save()
        create_audit_log(user=request.user, action=AuditLogEntry.Action.UPDATED, entity=saved, before=before,
            after={"active": saved.active, "balances": saved.balances}, metadata={"action": action, "display_balances_only": True, "principal": str(principal.pk)})
        return Response({"revision": saved.revision, "active": saved.active})
