from django.db import transaction
from django.db.models import F, Q, Window
from django.db.models.functions import Lag
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.bulk_imports.sources import digest
from apps.bulk_imports.views import PrivateView
from apps.transactions.models import Transaction
from apps.transactions.policy import CREDIT_TYPES
from apps.transactions.transfers import lock_transfer_user

from .cash_counts import count_values, preview, record
from .cash_math import period, predicate, project, snapshot_point, snapshots
from .cash_serializers import (
    CashCountComparisonResponse,
    CashCountHistoryResponse,
    CashCountInput,
    CashCountPreviewResponse,
    CashCountReceiptResponse,
)


def offset_of(request):
    raw = request.query_params.get("offset", "0")
    if not raw.isascii() or not raw.isdigit() or int(raw) > 100000:
        raise ValidationError({"offset": "Use an offset between 0 and 100,000."})
    return int(raw)


class CashCountsView(PrivateView):
    @extend_schema(
        operation_id="cash_counts_list",
        responses=CashCountHistoryResponse,
        parameters=[
            OpenApiParameter("account", OpenApiTypes.UUID),
            OpenApiParameter("offset", OpenApiTypes.INT),
        ],
    )
    def get(self, request):
        rows = snapshots(request.user)
        account = request.query_params.get("account")
        if account:
            from uuid import UUID

            try:
                UUID(account)
            except ValueError:
                raise ValidationError({"account": "Choose a cash account."}) from None
            rows = rows.filter(account_id=account)
        count = rows.count()
        # Window is evaluated before pagination, so the predecessor can be on a
        # different page. Partitioning prevents mixing currencies/accounts.
        rows = rows.annotate(
            previous_difference=Window(
                Lag("difference"),
                partition_by=[F("account_id")],
                order_by=[
                    F("count_day").asc(),
                    F("count_time").asc(),
                    F("created_at").asc(),
                    F("pk").asc(),
                ],
            )
        )
        offset = offset_of(request)
        results = []
        for item in rows.select_related("account").order_by(
            "-count_day", "-count_time", "-created_at", "-pk"
        )[offset : offset + 50]:
            value = count_values(item)
            value.update(
                account_name=item.account.name,
                currency=item.account.currency,
                previous_difference=str(item.previous_difference)
                if item.previous_difference is not None
                else None,
                same_recorded_difference=item.previous_difference is not None
                and item.previous_difference == item.difference
                and item.difference != 0,
            )
            results.append(value)
        return Response(
            {
                "results": results,
                "count": count,
                "next_offset": offset + 50 if count > offset + 50 else None,
            }
        )

    @extend_schema(
        operation_id="cash_counts_record",
        request=CashCountInput,
        responses=CashCountReceiptResponse,
    )
    def post(self, request):
        serializer = CashCountInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(record(request.user, serializer.validated_data))


class CashCountsPreviewView(PrivateView):
    @extend_schema(
        operation_id="cash_counts_preview",
        request=CashCountInput,
        responses=CashCountPreviewResponse,
    )
    def post(self, request):
        serializer = CashCountInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(preview(request.user, serializer.validated_data))


class CashCountComparisonView(PrivateView):
    @extend_schema(
        operation_id="cash_counts_compare",
        responses=CashCountComparisonResponse,
        parameters=[OpenApiParameter("offset", OpenApiTypes.INT)],
    )
    @transaction.atomic
    def get(self, request, pk):
        lock_transfer_user(request.user)
        item = get_object_or_404(
            snapshots(request.user).select_related("account"), pk=pk
        )
        point = snapshot_point(item)
        previous = (
            snapshots(request.user)
            .filter(period(point, earlier=True), account=item.account)
            .select_related("account")
            .order_by("-count_day", "-count_time", "-created_at", "-pk")
            .first()
        )
        prior = snapshot_point(previous) if previous else None
        project(request.user, [point] + ([prior] if prior else []))
        errors = point["errors"] + (prior["errors"] if prior else [])
        expected = point.get("expected")
        current = count_values(item)
        current.update(
            current_expected=str(expected) if expected is not None else None,
            current_difference=str(point["difference"])
            if "difference" in point
            else None,
            ledger_changed=expected is not None and expected != item.expected_balance,
        )
        previous_value = count_values(previous) if previous else None
        if prior:
            previous_value["current_difference"] = (
                str(prior["difference"]) if "difference" in prior else None
            )
        records = []
        movement_count = 0
        offset = offset_of(request)
        if not errors:
            rows = (
                Transaction.objects.filter(user=request.user)
                .filter(account_path(item.account_id))
                .filter(predicate(point))
            )
            if prior:
                rows = rows.exclude(predicate(prior))
            movement_count = rows.count()
            for row in rows.order_by("date", F("time").asc(nulls_last=True), "pk")[
                offset : offset + 25
            ]:
                credit = (
                    row.type in CREDIT_TYPES
                    or row.type == "adjustment"
                    and row.direction == "credit"
                    or row.type == "transfer"
                    and row.transfer_account_id == item.account_id
                )
                records.append(
                    {
                        "id": str(row.pk),
                        "date": str(row.date),
                        "time": str(row.time) if row.time else None,
                        "description": row.counterparty_text or row.note or row.type,
                        "amount": str(row.amount),
                        "direction": "credit" if credit else "debit",
                    }
                )
        return Response(
            {
                "count": current,
                "previous": previous_value,
                "difference_change": str(point["difference"] - prior["difference"])
                if prior and not errors
                else None,
                "movements": records,
                "movement_count": movement_count,
                "next_offset": offset + 25 if movement_count > offset + 25 else None,
                "errors": errors,
                "revision": digest(
                    {
                        "count": current,
                        "previous": previous_value,
                        "ledger": [p.get("revision") for p in [point, prior] if p],
                    }
                ),
            }
        )


def account_path(account_id):
    return Q(account_id=account_id) | Q(type="transfer", transfer_account_id=account_id)
