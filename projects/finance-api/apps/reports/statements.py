"""Read-only account statements; opening overrides belong to a report, never a ledger."""
import csv
import io
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Case, Count, F, Q, Sum, Value, When, Window, DecimalField
from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.models import Account
from apps.transactions.balance_queries import ledger_totals
from apps.transactions.models import Transaction
from apps.transactions.policy import CREDIT_TYPES, DEBIT_TYPES
from apps.transactions.services import calculate_account_balance_summaries

MONEY = DecimalField(max_digits=24, decimal_places=2)
ZERO = Decimal("0.00")


@contextmanager
def statement_snapshot():
    nested = connection.in_atomic_block
    with transaction.atomic():
        if connection.vendor == "postgresql" and not nested:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        yield


class OpeningBalanceSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=("ledger", "reported", "manual"))
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - {"mode", "amount"}:
            raise ValidationError("Unknown opening-balance option.")
        return super().to_internal_value(data)

    def validate(self, attrs):
        if "mode" not in attrs:
            raise ValidationError({"mode": "Choose an opening-balance basis."})
        if attrs["mode"] == "manual" and "amount" not in attrs:
            raise ValidationError({"amount": "Enter the signed opening balance."})
        if attrs["mode"] != "manual" and "amount" in attrs:
            raise ValidationError({"amount": "Amounts are only accepted for manual opening balances."})
        return attrs


class AccountStatementQuery(serializers.Serializer):
    account = serializers.UUIDField(required=False)
    offset = serializers.IntegerField(default=0, min_value=0, max_value=2147483647)
    limit = serializers.IntegerField(default=25, min_value=1, max_value=100)
    export = serializers.ChoiceField(choices=("csv",), required=False)


class AccountStatementSummarySerializer(serializers.Serializer):
    account = serializers.UUIDField()
    name = serializers.CharField()
    currency = serializers.CharField()
    opening_mode = serializers.ChoiceField(choices=("ledger", "reported", "manual"))
    opening_balance = serializers.DecimalField(max_digits=24, decimal_places=2, allow_null=True)
    closing_balance = serializers.DecimalField(max_digits=24, decimal_places=2, allow_null=True)
    ledger_opening_balance = serializers.DecimalField(max_digits=24, decimal_places=2)
    ledger_closing_balance = serializers.DecimalField(max_digits=24, decimal_places=2)
    money_in = serializers.DecimalField(max_digits=24, decimal_places=2)
    money_out = serializers.DecimalField(max_digits=24, decimal_places=2)
    transaction_count = serializers.IntegerField()
    reported_opening_balance = serializers.DecimalField(max_digits=24, decimal_places=2, allow_null=True)
    last_reported_balance = serializers.DecimalField(max_digits=24, decimal_places=2, allow_null=True)
    last_reported_date = serializers.DateField(allow_null=True)
    reported_unavailable_reason = serializers.CharField(allow_blank=True)


class AccountStatementEntrySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True)
    type = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    category = serializers.CharField(allow_null=True)
    money_in = serializers.DecimalField(max_digits=24, decimal_places=2)
    money_out = serializers.DecimalField(max_digits=24, decimal_places=2)
    running_balance = serializers.DecimalField(max_digits=24, decimal_places=2, allow_null=True)


class AccountStatementPageSerializer(serializers.Serializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    accounts = AccountStatementSummarySerializer(many=True)
    account = serializers.UUIDField(allow_null=True)
    count = serializers.IntegerField()
    offset = serializers.IntegerField()
    next_offset = serializers.IntegerField(allow_null=True)
    results = AccountStatementEntrySerializer(many=True)
    notice = serializers.CharField()


def money(value):
    return f"{value:.2f}" if value is not None else None


def csv_text(value):
    return "'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")) else value


def selected_accounts(report):
    rules = report.filters or {}
    rows = Account.objects.filter(user_id=report.user_id, currency=report.currency)
    included = rules.get("accounts") or ([str(report.account_id)] if report.account_id else [])
    if included:
        rows = rows.filter(pk__in=included)
    return list(rows.exclude(pk__in=rules.get("excluded_accounts", [])).order_by("display_order", "name", "pk"))


def period_movements(report, accounts):
    ids = [account.pk for account in accounts]
    rows = Transaction.objects.filter(user_id=report.user_id, date__gte=report.start_date, date__lte=report.end_date).order_by()
    credit = Q(type__in=CREDIT_TYPES) | Q(type="adjustment", direction="credit")
    debit = Q(type__in=DEBIT_TYPES | {"transfer"}) | Q(type="adjustment", direction="debit")
    sending = rows.filter(account_id__in=ids).values("account_id").annotate(
        money_in=Sum(Case(When(credit, then=F("amount")), default=Value(ZERO), output_field=MONEY)),
        money_out=Sum(Case(When(debit, then=F("amount")), default=Value(ZERO), output_field=MONEY)),
        count=Count("pk"),
    )
    receiving = rows.filter(type="transfer", transfer_account_id__in=ids).values("transfer_account_id").annotate(money_in=Sum("amount"), money_out=Value(ZERO, output_field=MONEY), count=Count("pk"))
    result = {account.pk: {"money_in": ZERO, "money_out": ZERO, "count": 0} for account in accounts}
    for row in sending.union(receiving, all=True):
        total = result[row["account_id"]]
        for key in ("money_in", "money_out", "count"):
            total[key] += row[key]
    return result


def account_summaries(report, accounts):
    opening = calculate_account_balance_summaries(accounts=accounts, as_of_date=report.start_date - timedelta(days=1))
    closing = ledger_totals(accounts, as_of_date=report.end_date)
    movements = period_movements(report, accounts)
    summaries = []
    for account in accounts:
        base = opening[account.pk]
        reported = None
        if base.ledger_balance_at_latest_report is not None:
            reported = base.ledger_balance + base.latest_reported_balance - base.ledger_balance_at_latest_report
        reason = ""
        if reported is None:
            reason = {
                "credit_card_reference": "The reported card figure is a reference, not a signed ledger balance. Enter a manual opening balance after checking its meaning.",
                "timing_unknown": "The last report has uncertain timing. Enter a confirmed opening balance manually.",
                "report_precedes_movement": "The report predates its movement. Enter a confirmed opening balance manually.",
            }.get(base.reported_balance_comparison, "No usable reported balance exists before the start date.")
        choice = (report.opening_balances or {}).get(str(account.pk), {"mode": "ledger"})
        mode = choice["mode"]
        start = Decimal(choice["amount"]) if mode == "manual" else reported if mode == "reported" else base.ledger_balance
        movement = movements[account.pk]
        end = start + movement["money_in"] - movement["money_out"] if start is not None else None
        summaries.append({
            "account": str(account.pk), "name": account.name, "currency": account.currency,
            "opening_mode": mode, "opening_balance": money(start), "closing_balance": money(end),
            "ledger_opening_balance": money(base.ledger_balance), "ledger_closing_balance": money(closing[account.pk]),
            "money_in": money(movement["money_in"]), "money_out": money(movement["money_out"]), "transaction_count": movement["count"],
            "reported_opening_balance": money(reported), "last_reported_balance": money(base.latest_reported_balance),
            "last_reported_date": base.latest_reported_balance_date.isoformat() if base.latest_reported_balance_date else None,
            "reported_unavailable_reason": reason,
        })
    return summaries


def statement_entries(report, account):
    rows = Transaction.objects.filter(user_id=report.user_id, date__gte=report.start_date, date__lte=report.end_date).filter(Q(account_id=account.pk) | Q(type="transfer", transfer_account_id=account.pk))
    delta = Case(
        When(type="transfer", transfer_account_id=account.pk, then=F("amount")),
        When(Q(type__in=CREDIT_TYPES) | Q(type="adjustment", direction="credit"), then=F("amount")),
        default=-F("amount"), output_field=MONEY,
    )
    order = [F("date").asc(), F("time").asc(nulls_last=True), F("created_at").asc(), F("pk").asc()]
    return rows.annotate(statement_delta=delta, running_delta=Window(Sum(delta), order_by=order)).select_related("category").order_by(*order)


def entry_data(row, opening):
    delta = row.statement_delta
    return {"id": str(row.pk), "date": row.date.isoformat(), "time": row.time.isoformat() if row.time else None,
            "type": row.type, "description": row.counterparty_text or row.note or row.get_type_display(),
            "category": row.category.name if row.category_id else None, "money_in": money(max(delta, ZERO)),
            "money_out": money(max(-delta, ZERO)), "running_balance": money(opening + row.running_delta) if opening is not None else None}


def statement_response(report, params):
    query = AccountStatementQuery(data=params)
    query.is_valid(raise_exception=True)
    values = query.validated_data
    accounts = selected_accounts(report)
    chosen = next((account for account in accounts if account.pk == values.get("account")), None) if values.get("account") else next(iter(accounts), None)
    if values.get("account") and chosen is None:
        raise ValidationError({"account": "Choose an account included in this report."})
    summaries = account_summaries(report, accounts)
    summary = next((row for row in summaries if chosen and row["account"] == str(chosen.pk)), None)
    count = summary["transaction_count"] if summary else 0
    opening = Decimal(summary["opening_balance"]) if summary and summary["opening_balance"] is not None else None
    rows = statement_entries(report, chosen) if chosen else Transaction.objects.none()
    if values.get("export") == "csv":
        if count > 50000:
            raise ValidationError({"export": "Narrow the statement range to at most 50,000 transactions for CSV export."})
        output = io.StringIO(); writer = csv.writer(output)
        writer.writerow(["Account", "Currency", "Start date", "End date", "Opening basis", "Opening balance", "Closing balance"])
        writer.writerow([csv_text(chosen.name) if chosen else "", report.currency, report.start_date, report.end_date, summary["opening_mode"] if summary else "", money(opening), summary["closing_balance"] if summary else ""])
        writer.writerow(["Date", "Time", "Type", "Description", "Category", "Money in", "Money out", "Running balance"])
        for row in rows.iterator(chunk_size=1000):
            data = entry_data(row, opening)
            # Spreadsheet formulas must remain inert when a report is opened.
            writer.writerow([data["date"], data["time"], data["type"], csv_text(data["description"]), csv_text(data["category"]), data["money_in"], data["money_out"], data["running_balance"]])
        response = HttpResponse(output.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="account-statement.csv"'
        return response
    offset, limit = values["offset"], values["limit"]
    page = [entry_data(row, opening) for row in rows[offset:offset + limit]]
    return Response({"start_date": report.start_date.isoformat(), "end_date": report.end_date.isoformat(), "accounts": summaries,
                     "account": str(chosen.pk) if chosen else None, "count": count, "offset": offset,
                     "next_offset": offset + len(page) if page and offset + len(page) < count else None, "results": page,
                     "notice": "Statements include every recorded movement for these accounts and dates. Analysis category filters and manual report membership do not change statement balances. Unknown times are listed last within a day; intermediate balances follow that display order."})
