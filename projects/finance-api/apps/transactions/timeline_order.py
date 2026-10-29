"""Conservative balance chains and explicitly approved order, without invented clock times."""
import hashlib
import json
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import MethodNotAllowed, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, inline_serializer
from drf_spectacular.types import OpenApiTypes
from rest_framework import serializers

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from .models import Transaction, TimelineDayOrder
from .transfers import account_reports, lock_transfer_user


def account_records(user, start, end):
    return Transaction.objects.filter(user=user, date__range=(start, end)).select_related("account", "transfer_account").prefetch_related("transfer_evidence", "statement_rows__batch").order_by("date", "time", "id")


def day_rows(records, account):
    result = []
    for entry in records:
        if entry.account_id != account.pk and not (entry.type == "transfer" and entry.transfer_account_id == account.pk):
            continue
        direction = "credit" if entry.type == "transfer" and entry.transfer_account_id == account.pk else "debit" if entry.type == "transfer" else entry.direction
        balance = entry.balance_after if entry.account_id == account.pk else None
        reports, primary = account_reports(entry) if entry.type == "transfer" else ({}, None)
        if entry.type == "transfer" and not reports:
            # A legacy scalar cannot reliably identify which account reported it.
            balance = None
        if reports:
            balance = reports[account.pk].balance_after if account.pk in reports else None
        observations = [item for item in entry.transfer_evidence.all() if item.account_id == account.pk]
        source_rows = list(entry.statement_rows.all())
        context_changed = any(item.date != entry.date or item.time != entry.time for item in observations)
        posting = any(item.batch.profile == "ebl_bank" or (item.value_date and item.value_date != entry.date) or item.date != entry.date for item in source_rows)
        result.append({"id": str(entry.pk), "time": entry.time.isoformat() if entry.time else None, "amount": f"{entry.amount:.2f}", "direction": direction,
            "balance_after": f"{balance:.2f}" if balance is not None else None,
            "label": entry.counterparty_text or entry.note or entry.type.replace("_", " "), "type": entry.type,
            "updated_at": entry.updated_at.isoformat(), "context_changed": context_changed, "posting_context": posting,
            "source_versions": [(str(item.pk), item.version, str(item.updated_at)) for item in source_rows],
            "observation_versions": [(str(item.pk), str(item.date), str(item.time), str(item.balance_after), item.direction, item.is_effective_balance, str(item.fee_amount), item.reference, item.note, item.source, item.provider, item.external_key, str(item.raw_message_id)) for item in observations]})
    return sorted(result, key=lambda row: (row["time"] is None, row["time"] or "", row["id"]))


def fingerprint(rows, account, day):
    # Label edits also invalidate: a preview must describe the exact current records.
    payload = [str(account.pk), account.type, str(day), rows]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def balance_order(rows, account_type):
    if not any(row["time"] is None for row in rows):
        return None, "Every movement already has a reported time."
    if not rows or len(rows) > 80:
        return None, "Review this day manually; too many movements for a reliable balance-chain suggestion."
    if account_type == "credit_card":
        return None, "Card reference balances may represent available credit or statement dues. Choose an order manually."
    if any(row["posting_context"] or row["context_changed"] for row in rows):
        return None, "Posting dates or source observation times differ from the ledger. A balance chain cannot establish the actual event time. Review the statement and place manually."
    if any(row["balance_after"] is None for row in rows):
        return None, "Some movements have no balance report. There is not enough evidence for a unique suggestion."
    ends = [Decimal(row["balance_after"]) for row in rows]
    starts = [ends[index] - Decimal(row["amount"]) * (1 if row["direction"] == "credit" else -1) for index, row in enumerate(rows)]
    edges = {index: [other for other in range(len(rows)) if index != other and ends[index] == starts[other]] for index in range(len(rows))}
    anchors = [index for index, row in enumerate(rows) if row["time"]]
    found = []
    visits = 0
    exhausted = False
    def visit(path, used):
        nonlocal visits, exhausted
        visits += 1
        if visits > 4000:
            exhausted = True
            return
        if len(found) >= 2:
            return
        if len(path) == len(rows):
            found.append([rows[index]["id"] for index in path])
            return
        candidates = edges[path[-1]] if path else range(len(rows))
        next_anchor = next((anchor for anchor in anchors if anchor not in used), None)
        for index in candidates:
            if index in used or (rows[index]["time"] and index != next_anchor):
                continue
            visit(path + [index], used | {index})
            if exhausted or len(found) >= 2:
                return
    visit([], set())
    if exhausted or len(found) > 1:
        return None, "More than one order could fit these balances. Choose a position after reviewing the sources."
    if not found:
        return None, "The reports do not form one continuous balance chain consistent with known times. Missing activity or posting order may explain it."
    return found[0], "One balance chain fits all recorded movements and preserves the known time order. This suggests an order, not an actual time or proof of complete capture."


def parse_day(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError({"date": "Use YYYY-MM-DD."}) from exc


def state(order):
    return {"ordered_ids": order.ordered_ids, "basis_fingerprint": order.basis_fingerprint, "basis": order.basis}


class TimelineOrderView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, account_id=None, day=None):
        if account_id is None:
            start, end = parse_day(request.query_params.get("start_date")), parse_day(request.query_params.get("end_date"))
            if end < start or (end - start).days > 366:
                raise ValidationError({"date": "Choose a range of up to 366 days."})
            orders = list(TimelineDayOrder.objects.filter(user=request.user, date__range=(start, end)).select_related("account"))
            records = list(account_records(request.user, start, end))
            grouped = {}
            for entry in records:
                grouped.setdefault(entry.date, []).append(entry)
            results = []
            for order in orders:
                rows = day_rows(grouped.get(order.date, []), order.account)
                valid = order.basis_fingerprint == fingerprint(rows, order.account, order.date)
                results.append({"account": str(order.account_id), "date": str(order.date), "ordered_ids": order.ordered_ids if valid else [], "status": "valid" if valid else "stale", "basis": order.basis, "revision": order.revision})
            return Response({"results": results}, headers={"Cache-Control": "private, no-store"})
        account = get_object_or_404(Account, user=request.user, pk=account_id)
        parsed = parse_day(day)
        records = list(account_records(request.user, parsed, parsed).filter(Q(account=account) | Q(type="transfer", transfer_account=account)))
        rows = day_rows(records, account)
        basis = fingerprint(rows, account, parsed)
        order = TimelineDayOrder.objects.filter(user=request.user, account=account, date=parsed).first()
        suggested, reason = balance_order(rows, account.type)
        valid = bool(order and order.basis_fingerprint == basis)
        return Response({"account": str(account.pk), "date": str(parsed), "currency": account.currency, "rows": [{key: value for key, value in row.items() if key not in {"updated_at", "source_versions", "observation_versions"}} for row in rows],
            "fingerprint": basis, "revision": order.revision if order else 0, "saved_status": "valid" if valid else "stale" if order else "none",
            "ordered_ids": order.ordered_ids if valid else [row["id"] for row in rows], "basis": order.basis if valid else "", "can_undo": bool(order and order.history),
            "suggested_ids": suggested, "reason": reason}, headers={"Cache-Control": "private, no-store"})

    @transaction.atomic
    @extend_schema(request=inline_serializer(name="TimelineOrderDecision", fields={"fingerprint": serializers.CharField(max_length=64), "revision": serializers.IntegerField(min_value=0), "action": serializers.ChoiceField(choices=("apply", "clear", "undo")), "ordered_ids": serializers.ListField(child=serializers.UUIDField(), required=False)}), responses=OpenApiTypes.OBJECT)
    def post(self, request, account_id=None, day=None):
        if account_id is None:
            raise MethodNotAllowed("POST")
        lock_transfer_user(request.user)
        account = get_object_or_404(Account, user=request.user, pk=account_id)
        parsed = parse_day(day)
        records = list(account_records(request.user, parsed, parsed).filter(Q(account=account) | Q(type="transfer", transfer_account=account)))
        rows = day_rows(records, account)
        current = fingerprint(rows, account, parsed)
        order = TimelineDayOrder.objects.select_for_update().filter(user=request.user, account=account, date=parsed).first()
        if request.data.get("fingerprint") != current or request.data.get("revision") != (order.revision if order else 0):
            raise ValidationError({"detail": "This day changed. Refresh the placement preview before applying it."})
        mode = request.data.get("action", "apply")
        if mode not in {"apply", "clear", "undo"}:
            raise ValidationError({"action": "Choose apply, clear or undo."})
        before = state(order) if order else {"ordered_ids": [], "basis_fingerprint": "", "basis": ""}
        if order is None:
            order = TimelineDayOrder(user=request.user, account=account, date=parsed)
        if mode == "undo":
            if not order.history:
                raise ValidationError({"detail": "No earlier placement is available."})
            previous = order.history[-1]
            if previous["ordered_ids"] and previous["basis_fingerprint"] != current:
                raise ValidationError({"detail": "The earlier placement is stale. Clear it or review a new order."})
            order.history = order.history[:-1]
            for key, value in previous.items():
                setattr(order, key, value)
        else:
            ids = request.data.get("ordered_ids", []) if mode == "apply" else []
            if mode == "apply":
                if not isinstance(ids, list) or any(not isinstance(value, str) for value in ids) or len(ids) != len(rows) or set(ids) != {row["id"] for row in rows}:
                    raise ValidationError({"ordered_ids": "Include every current movement exactly once."})
                timed = [row["id"] for row in rows if row["time"]]
                if [value for value in ids if value in timed] != timed:
                    raise ValidationError({"ordered_ids": "Known times stay in their existing order. Move only untimed movements."})
                if not any(row["time"] is None for row in rows):
                    raise ValidationError({"ordered_ids": "There are no untimed movements to place."})
            order.history = (order.history + [before])[-20:]
            suggestion, _ = balance_order(rows, account.type)
            order.ordered_ids = ids
            order.basis_fingerprint = current
            order.basis = "balance" if ids and ids == suggestion else "manual" if ids else ""
        order.revision += 1
        order.save()
        create_audit_log(user=request.user, action=AuditLogEntry.Action.UPDATED, entity=order, before=before, after=state(order), metadata={"display_order_only": True, "action": mode})
        return self.get(request, account_id, day)


class TimelineOrderListView(TimelineOrderView):
    http_method_names = ("get", "head", "options")
