"""Validated, owner-scoped report rules shared by previews and saved membership."""

from uuid import UUID

from django.db.models import Q
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction
from apps.transactions.search import filter_transaction_search


# Keep report-only choice arrays from renaming existing transaction schema enums.
@extend_schema_field({"type": "string", "pattern": "^(expense|income|transfer|adjustment|fee|refund|lend|borrow|repayment_received|repayment_paid)$"})
class ReportTypeChoice(serializers.ChoiceField):
    pass


@extend_schema_field({"type": "string", "pattern": "^(debit|credit)$"})
class ReportDirectionChoice(serializers.ChoiceField):
    pass


@extend_schema_field({"type": "string", "pattern": "^(web|mobile|sms|import|system)$"})
class ReportSourceChoice(serializers.ChoiceField):
    pass


class CategoryRuleField(serializers.CharField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if value == "uncategorized":
            return value
        try:
            return str(UUID(value))
        except ValueError as exc:
            raise serializers.ValidationError("Choose a category or uncategorized.") from exc


class ReportRulesSerializer(serializers.Serializer):
    accounts = serializers.ListField(child=serializers.UUIDField(), max_length=100, required=False, default=list)
    excluded_accounts = serializers.ListField(child=serializers.UUIDField(), max_length=100, required=False, default=list)
    categories = serializers.ListField(child=CategoryRuleField(), max_length=200, required=False, default=list)
    excluded_categories = serializers.ListField(child=CategoryRuleField(), max_length=200, required=False, default=list)
    types = serializers.ListField(child=ReportTypeChoice(choices=Transaction.Type.choices), max_length=10, required=False, default=list)
    directions = serializers.ListField(child=ReportDirectionChoice(choices=Transaction.Direction.choices), max_length=2, required=False, default=list)
    sources = serializers.ListField(child=ReportSourceChoice(choices=Transaction.Source.choices), max_length=5, required=False, default=list)
    search = serializers.CharField(max_length=256, allow_blank=True, required=False, default="")
    min_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, allow_null=True, required=False, default=None)
    max_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0, allow_null=True, required=False, default=None)

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError("Provide a report filter object.")
        unknown = data.keys() - self.fields.keys()
        if unknown:
            raise serializers.ValidationError({key: "Unsupported report filter." for key in unknown})
        return super().to_internal_value(data)

    def validate(self, attrs):
        for field in ("accounts", "excluded_accounts", "categories", "excluded_categories", "types", "directions", "sources"):
            attrs[field] = sorted({str(value) for value in attrs.get(field, [])})
        for field in ("accounts", "categories"):
            if set(attrs[field]) & set(attrs[f"excluded_{field}"]):
                raise serializers.ValidationError({field: "An item cannot be both included and excluded."})
        user = self.context["request"].user
        for field, model in (("accounts", Account), ("categories", Category)):
            ids = (set(attrs[field]) | set(attrs[f"excluded_{field}"])) - {"uncategorized"}
            if ids and model.objects.filter(user=user, pk__in=ids).count() != len(ids):
                raise serializers.ValidationError({field: "Choose only your own saved items."})
        minimum, maximum = attrs.get("min_amount"), attrs.get("max_amount")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise serializers.ValidationError({"max_amount": "Maximum must be at least the minimum amount."})
        for field in ("min_amount", "max_amount"):
            attrs[field] = str(attrs[field]) if attrs.get(field) is not None else None
        filter_transaction_search(Transaction.objects.none(), attrs.get("search", ""), user=user)
        return attrs


def category_predicate(values):
    predicate = Q(category_id__in=[value for value in values if value != "uncategorized"])
    if "uncategorized" in values:
        predicate |= Q(category__isnull=True)
    return predicate


def filter_report_records(report, *, start=None, end=None):
    rules = report.filters
    rows = Transaction.objects.filter(user_id=report.user_id, account__currency=report.currency,
                                      date__range=(start or report.start_date, end or report.end_date))
    accounts = rules.get("accounts") or ([str(report.account_id)] if report.account_id else [])
    if accounts:
        rows = rows.filter(Q(account_id__in=accounts) | Q(type="transfer", transfer_account_id__in=accounts))
    excluded = rules.get("excluded_accounts", [])
    if excluded:
        rows = rows.exclude(Q(account_id__in=excluded) | Q(type="transfer", transfer_account_id__in=excluded))
    if rules.get("categories"):
        rows = rows.filter(category_predicate(rules["categories"]))
    if rules.get("excluded_categories"):
        rows = rows.exclude(category_predicate(rules["excluded_categories"]))
    for field, model_field in (("types", "type"), ("sources", "source"), ("directions", "direction")):
        if rules.get(field):
            predicate = Q(**{f"{model_field}__in": rules[field]})
            # Transfer direction is relative to any selected account.
            if field == "directions" and accounts:
                predicate &= ~Q(type="transfer")
                if "credit" in rules[field]:
                    predicate |= Q(type="transfer", transfer_account_id__in=accounts)
                if "debit" in rules[field]:
                    predicate |= Q(type="transfer", account_id__in=accounts)
            rows = rows.filter(predicate)
    if rules.get("min_amount") is not None:
        rows = rows.filter(amount__gte=rules["min_amount"])
    if rules.get("max_amount") is not None:
        rows = rows.filter(amount__lte=rules["max_amount"])
    return filter_transaction_search(rows, rules.get("search", ""), user=report.user_id)
