import re
from datetime import date, timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.db.models import Count
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions.models import Transaction
from apps.transactions.serializers import TransactionSerializer
from apps.messages.models import ParsedMessageCandidate
from apps.messages.serializers import ParsedMessageCandidateSerializer

from .periods import custom_bounds

def month_bounds(month: str | None) -> tuple[date, date, str]:
    if not month:
        today = timezone.localdate()
        month = today.strftime("%Y-%m")

    try:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise ValueError
        year_text, month_text = month.split("-", maxsplit=1)
        year = int(year_text)
        month_number = int(month_text)
        start = date(year, month_number, 1)
        end = (
            date(year + 1, 1, 1)
            if month_number == 12
            else date(year, month_number + 1, 1)
        )
    except ValueError as exc:
        raise ValidationError({"month": "Use YYYY-MM format."}) from exc

    return start, end, month


def period_report_summary(*, user, start, end, currency="BDT", account=None, month=None, saved=None):
    from .summary import period_summaries
    from .saved import report_records

    duration = end - start + timedelta(days=1)
    if start.toordinal() <= duration.days:
        raise ValidationError({"start_date": "Choose a date with a complete preceding comparison period."})
    previous_end = start - timedelta(days=1)
    _, next_month, _ = month_bounds(start.strftime("%Y-%m"))
    previous_start = previous_end.replace(day=1) if start.day == 1 and end == next_month-timedelta(days=1) else start-duration
    report, previous = period_summaries(
        user=user, periods=[(start, end), (previous_start, previous_end)], currency=currency, account=account,
        record_sets=[report_records(saved), report_records(saved, start=previous_start, end=previous_end, manual=False)] if saved else None,
        account_ids=saved.filters.get("accounts") if saved else None,
    )
    for collection, key in (("categories", "id"), ("merchants", "search")):
        prior = {str(item[key]).casefold(): item["amount"] for item in previous[collection]}
        for item in report[collection]:
            item["previous_amount"] = prior.get(str(item[key]).casefold(), "0.00")
    report["month"] = month
    report["previous"] = {field: previous[field] for field in ("start_date", "end_date", "income_total", "expense_total", "net_total")}
    return report


def saved_report_summary(report):
    return period_report_summary(user=report.user_id, start=report.start_date, end=report.end_date,
                                 currency=report.currency, account=report.account, saved=report)


@extend_schema(responses=OpenApiTypes.OBJECT)
class DashboardSummaryView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        bounds = custom_bounds(request.query_params)
        if bounds is None:
            start, end, _ = month_bounds(request.query_params.get("month"))
            bounds = (start, end - timedelta(days=1))
        pending = ParsedMessageCandidate.objects.filter(
            user=request.user, status=ParsedMessageCandidate.Status.NEEDS_REVIEW,
        )
        recent_candidates = pending.select_related(
            "raw_message", "sender_rule", "account", "payment_method", "category",
            "destination_account", "destination_payment_method", "possible_related_candidate", "transaction",
        ).order_by("-raw_message__received_at", "-id")[:3]
        transactions = Transaction.objects.filter(user=request.user, date__range=bounds)
        recent_transactions = transactions.annotate(statement_count=Count("statement_rows", distinct=True)).select_related(
            "account", "transfer_account", "category", "payment_method", "raw_message",
        ).prefetch_related("transfer_evidence").order_by("-date", "-time", "-created_at", "-id")[:4]
        return Response({
            "pending_count": pending.count(),
            "recent_candidates": ParsedMessageCandidateSerializer(recent_candidates, many=True).data,
            "automated_count": transactions.filter(source__in=("sms", "mobile")).count(),
            "recent_transactions": TransactionSerializer(recent_transactions, many=True, context={"request": request}).data,
        }, headers={"Cache-Control": "private, no-store"})


@extend_schema(responses=OpenApiTypes.OBJECT, parameters=[OpenApiParameter("saved_report", OpenApiTypes.UUID, description="Use a named report's saved filters and manual membership choices.")])
class MonthlyReportView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        from .models import SavedReport
        from django.shortcuts import get_object_or_404

        saved = None
        if request.query_params.get("saved_report"):
            try:
                saved = get_object_or_404(SavedReport.objects.select_related("account"), user=request.user, pk=request.query_params["saved_report"])
            except (ValueError, DjangoValidationError) as exc:
                raise ValidationError({"saved_report": "Choose one of your saved reports."}) from exc
        if saved:
            return Response(saved_report_summary(saved), headers={"Cache-Control": "private, no-store"})
        bounds = custom_bounds(request.query_params)
        if bounds:
            start, inclusive_end = bounds
            month = None
        else:
            start, end, month = month_bounds(request.query_params.get("month"))
            inclusive_end = end - timedelta(days=1)
        from apps.accounts.models import Account

        currency = request.query_params.get("currency", "BDT").upper()
        if not re.fullmatch(r"[A-Z]{3}", currency):
            raise ValidationError({"currency": "Choose a three-letter currency."})
        account = None
        account_id = request.query_params.get("account")
        if account_id:
            try:
                account = get_object_or_404(Account, user=request.user, pk=account_id)
            except (ValueError, DjangoValidationError) as exc:
                raise ValidationError({"account": "Choose one of your accounts."}) from exc
            currency = account.currency
        return Response(period_report_summary(user=request.user, start=start, end=inclusive_end,
                                              currency=currency, account=account, month=month),
                        headers={"Cache-Control": "private, no-store"})
