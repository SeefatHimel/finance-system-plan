from calendar import monthrange

from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.accounts.models import Account
from apps.transactions.models import Transaction
from apps.transactions.search import filter_transaction_search
from apps.transactions.serializers import TransactionSerializer
from .models import ReportMembership, SavedReport
from .periods import custom_bounds
from .rules import ReportRulesSerializer, filter_report_records
from .statements import AccountStatementQuery, AccountStatementPageSerializer, OpeningBalanceSerializer


def report_records(report, *, start=None, end=None, manual=True):
    """Manual choices override rules; currency and ownership always apply."""
    matches = filter_report_records(report, start=start, end=end)
    if not manual:
        return matches
    choices = ReportMembership.objects.filter(report_id=report.pk)
    return Transaction.objects.filter(user_id=report.user_id, account__currency=report.currency).filter(
        Q(pk__in=matches.order_by().values("pk")) | Q(pk__in=choices.filter(included=True).values("transaction_id"))
    ).exclude(pk__in=choices.filter(included=False).values("transaction_id"))


class SavedReportSerializer(serializers.ModelSerializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.none(), allow_null=True, required=False)
    filters = ReportRulesSerializer(required=False, default=dict)
    opening_balances = serializers.DictField(child=OpeningBalanceSerializer(), required=False, default=dict)

    class Meta:
        model = SavedReport
        fields = ("id", "name", "start_date", "end_date", "date_view", "account", "currency", "filters", "report_view", "opening_balances", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["account"].queryset = Account.objects.filter(user=request.user)

    def validate(self, attrs):
        def value(key, default=None):
            return attrs.get(key, getattr(self.instance, key, default))
        start, end = value("start_date"), value("end_date")
        custom_bounds({"start_date": str(start), "end_date": str(end)})
        # The report includes a complete preceding comparison period.
        if start.toordinal() <= (end - start).days + 1:
            raise serializers.ValidationError({"start_date": "Choose a date with a complete preceding comparison period."})
        mode = value("date_view", "custom")
        if mode == "daily" and start != end:
            raise serializers.ValidationError({"date_view": "A daily report must start and end on the same day."})
        if mode == "monthly" and (start.day != 1 or end != start.replace(day=monthrange(start.year, start.month)[1])):
            raise serializers.ValidationError({"date_view": "A monthly report must cover one complete calendar month."})
        currency = value("currency", "BDT").upper()
        if len(currency) != 3 or not currency.isascii() or not currency.isalpha():
            raise serializers.ValidationError({"currency": "Choose a three-letter currency."})
        account = value("account")
        attrs["currency"] = account.currency if account else currency
        rules = value("filters", {})
        if account and rules.get("accounts"):
            raise serializers.ValidationError({"account": "Use the accounts filter instead of combining it with a single account."})
        ids = rules.get("accounts", []) + rules.get("excluded_accounts", [])
        if Account.objects.filter(user=self.context["request"].user, pk__in=ids).exclude(currency=attrs["currency"]).exists():
            raise serializers.ValidationError({"filters": "All selected accounts must use the report currency."})
        openings = value("opening_balances", {})
        if Account.objects.filter(user=self.context["request"].user, pk__in=openings).exclude(currency=attrs["currency"]).exists():
            raise serializers.ValidationError({"opening_balances": "Opening balances must use the report currency."})
        return attrs

    def validate_opening_balances(self, values):
        from uuid import UUID
        from .statements import OpeningBalanceSerializer
        if len(values) > 100:
            raise serializers.ValidationError("Set opening balances for at most 100 accounts.")
        result = {}
        for key, value in values.items():
            try:
                account_id = str(UUID(key))
            except (ValueError, TypeError, AttributeError) as exc:
                raise serializers.ValidationError("Opening balances must reference your account IDs.") from exc
            if account_id in result:
                raise serializers.ValidationError("Do not repeat an account with different ID formatting.")
            serializer = OpeningBalanceSerializer(data=value)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            result[account_id] = {"mode": data["mode"], **({"amount": f'{data["amount"]:.2f}'} if data["mode"] == "manual" else {})}
        accounts = Account.objects.filter(user=self.context["request"].user, pk__in=result)
        if accounts.count() != len(result):
            raise serializers.ValidationError("Choose your own accounts for opening balances.")
        return result


class ReportPreviewSerializer(SavedReportSerializer):
    saved_report = serializers.UUIDField(required=False, write_only=True)

    class Meta(SavedReportSerializer.Meta):
        fields = (*SavedReportSerializer.Meta.fields, "saved_report")


class MembershipSerializer(serializers.Serializer):
    transaction = serializers.UUIDField()
    action = serializers.ChoiceField(choices=("include", "exclude", "reset"))


class ReportTransactionQuery(serializers.Serializer):
    scope = serializers.ChoiceField(choices=("included", "available", "excluded"), default="included")
    search = serializers.CharField(required=False, default="", allow_blank=True, max_length=256)
    offset = serializers.IntegerField(default=0, min_value=0, max_value=2147483647)
    limit = serializers.IntegerField(default=25, min_value=1, max_value=100)


class ReportTransactionPage(serializers.Serializer):
    count = serializers.IntegerField()
    next_offset = serializers.IntegerField(allow_null=True)
    results = TransactionSerializer(many=True)


@extend_schema_view(list=extend_schema(responses=SavedReportSerializer(many=True)))
class SavedReportViewSet(ModelViewSet):
    queryset = SavedReport.objects.none()
    permission_classes = (IsAuthenticated,)
    serializer_class = SavedReportSerializer
    http_method_names = ("get", "post", "patch", "delete", "head", "options")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return SavedReport.objects.none()
        return SavedReport.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=ReportPreviewSerializer, responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=("post",))
    def preview(self, request):
        from .views import saved_report_summary

        serializer = ReportPreviewSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        report_id = values.pop("saved_report", None)
        if report_id:
            get_object_or_404(SavedReport, user=request.user, pk=report_id)
        report = SavedReport(user=request.user, **values)
        if report_id:
            report.pk = report_id
        return Response(saved_report_summary(report))

    @extend_schema(parameters=[ReportTransactionQuery], responses=ReportTransactionPage)
    @action(detail=True, methods=("get",))
    def transactions(self, request, pk=None):
        report = self.get_object()
        query = ReportTransactionQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        values = query.validated_data
        rows = Transaction.objects.filter(user=request.user, account__currency=report.currency)
        if values["scope"] == "included":
            rows = report_records(report)
        elif values["scope"] == "available":
            rows = rows.exclude(pk__in=report_records(report).values("pk"))
        else:
            rows = rows.filter(pk__in=report.overrides.filter(included=False).values("transaction_id"))
        rows = filter_transaction_search(rows, values["search"], user=request.user)
        from apps.transactions.balance_provenance import sms_queryset, statement_queryset, LIMIT
        rows = rows.annotate(statement_count=Count("statement_rows", distinct=True)).select_related(
            "account", "transfer_account", "category", "payment_method", "raw_message",
        ).prefetch_related("transfer_evidence", "parsed_message_candidates",
            Prefetch("parsed_message_candidates", queryset=sms_queryset(request.user)[:LIMIT + 1], to_attr="balance_sms_sources"),
            Prefetch("statement_rows", queryset=statement_queryset(request.user)[:LIMIT + 1], to_attr="balance_statement_sources"),
        ).order_by("-date", "-time", "-created_at", "-id")
        count = rows.count()
        offset, limit = values["offset"], values["limit"]
        page = list(rows[offset:offset + limit])
        return Response({"count": count, "next_offset": offset + len(page) if page and offset + len(page) < count else None,
                         "results": TransactionSerializer(page, many=True, context={"request": request}).data})

    @extend_schema(request=MembershipSerializer, responses=SavedReportSerializer)
    @action(detail=True, methods=("post",))
    def membership(self, request, pk=None):
        report = self.get_object()
        serializer = MembershipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        record = get_object_or_404(Transaction, user=request.user, pk=values["transaction"])
        if values["action"] == "reset":
            report.overrides.filter(transaction=record).delete()
        else:
            if record.account.currency != report.currency:
                raise serializers.ValidationError({"transaction": "Choose a transaction in the report currency."})
            ReportMembership.objects.update_or_create(report=report, transaction=record, defaults={"included": values["action"] == "include"})
        return Response(self.get_serializer(report).data)

    @extend_schema(parameters=[AccountStatementQuery], responses=AccountStatementPageSerializer)
    @action(detail=True, methods=("get",), url_path="account-statements")
    def account_statements(self, request, pk=None):
        from .statements import statement_response, statement_snapshot
        with statement_snapshot():
            return statement_response(self.get_object(), request.query_params)
