from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from apps.accounts.models import Account
from apps.accounts.serializers import AccountSerializer
from apps.transactions.services import calculate_account_balance_summaries
from apps.transactions.models import Transaction
from apps.messages.models import ParsedMessageCandidate
from apps.statements.models import StatementImport, StatementRow
from apps.reconciliation.models import BalanceSnapshot
from apps.debts.models import Debt
from apps.credit_cards.models import CreditCardBill
from apps.recurring_bills.models import RecurringBill
from .summary import money


class FinancialOverviewView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        user = request.user
        today = timezone.localdate()
        accounts = list(Account.objects.filter(user=user))
        summaries = calculate_account_balance_summaries(accounts=accounts)
        latest_import = {}
        for batch in StatementImport.objects.filter(user=user).order_by("-created_at").values("account_id", "period_start", "period_end", "id"):
            latest_import.setdefault(batch["account_id"], batch)
        last_checks = {}
        for check in BalanceSnapshot.objects.filter(user=user).order_by("-checked_at").values("account_id", "checked_at", "status", "difference"):
            last_checks.setdefault(check["account_id"], check)
        pending_sms = dict(ParsedMessageCandidate.objects.filter(user=user, status="needs_review").values("account_id").annotate(total=Count("pk")).values_list("account_id", "total"))
        pending_rows = dict(StatementRow.objects.filter(batch__user=user, state="pending").values("batch__account_id").annotate(total=Count("pk")).values_list("batch__account_id", "total"))
        buckets = defaultdict(lambda: defaultdict(lambda: Decimal("0.00")))
        coverage = []
        for account in accounts:
            summary = summaries[account.pk]
            bucket = buckets[account.currency]
            value = summary.ledger_balance
            bucket["account_balance"] += value
            if account.type == "credit_card":
                bucket["card_liability"] += max(-value, Decimal("0"))
                bucket["card_credit"] += max(value, Decimal("0"))
            else:
                bucket["cash_and_accounts"] += value
                if account.type == "savings":
                    bucket["savings"] += value
            batch = latest_import.get(account.pk)
            check = last_checks.get(account.pk)
            coverage.append({"account": str(account.pk), "comparison": summary.reported_balance_comparison,
                "last_report_date": str(summary.latest_reported_balance_date) if summary.latest_reported_balance_date else None,
                "last_check": {"date": check["checked_at"].isoformat(), "status": check["status"], "difference": money(check["difference"])} if check else None,
                "statement": {"id": str(batch["id"]), "start": str(batch["period_start"]) if batch["period_start"] else None, "end": str(batch["period_end"]) if batch["period_end"] else None} if batch else None,
                "pending_sms": pending_sms.get(account.pk, 0), "pending_rows": pending_rows.get(account.pk, 0)})
        upcoming = []
        for debt in Debt.objects.filter(user=user).exclude(status__in=("paid", "written_off")):
            buckets["BDT"]["receivable" if debt.direction == "lent_by_me" else "payable"] += debt.current_balance
            if debt.direction == "borrowed_by_me" and debt.due_date and debt.due_date <= today + timedelta(days=30):
                upcoming.append({"id": str(debt.pk), "kind": "debt", "name": debt.counterparty_name, "date": str(debt.due_date), "amount": money(debt.current_balance), "currency": "BDT", "href": "/debts"})
        for bill in CreditCardBill.objects.filter(user=user, due_date__lte=today + timedelta(days=30)).exclude(status__in=("paid", "waived")).select_related("account"):
            upcoming.append({"id": str(bill.pk), "kind": "card", "name": bill.account.name, "date": str(bill.due_date), "amount": money(bill.remaining_balance), "currency": bill.account.currency, "href": "/credit-cards"})
        for bill in RecurringBill.objects.filter(user=user, status="active", next_due_date__lte=today + timedelta(days=30)).select_related("account"):
            # Show the overdue occurrence once, then every scheduled occurrence in the next 30 days.
            due = bill.next_due_date
            first = True
            for _ in range(10000):
                if first or due >= today:
                    upcoming.append({"id": f"{bill.pk}:{due}", "kind": "recurring", "name": bill.name, "date": str(due), "amount": money(bill.amount), "currency": bill.account.currency, "href": "/recurring-bills"})
                first = False
                bill.next_due_date = due
                next_due = bill.following_due_date()
                if next_due > today + timedelta(days=30):
                    break
                due = next_due
        transactions = Transaction.objects.filter(user=user)
        currencies = []
        for currency, values in sorted(buckets.items()):
            fields = ("account_balance", "cash_and_accounts", "savings", "card_liability", "card_credit", "receivable", "payable")
            currencies.append({"currency": currency, **{key: money(values[key]) for key in fields}})
        return Response({"as_of": str(today), "currencies": currencies, "coverage": coverage,
            "accounts": AccountSerializer(accounts, many=True, context={"request": request, "account_balance_summaries": summaries}).data,
            "upcoming": sorted(upcoming, key=lambda row: (row["date"], row["name"])),
            "pending_sms": sum(pending_sms.values()), "unassigned_sms": pending_sms.get(None, 0), "pending_statement_rows": sum(pending_rows.values()),
            "needs_review": transactions.filter(needs_review=True).count(),
            "uncategorized_spending": transactions.filter(category__isnull=True, type__in=("expense", "fee", "refund")).count(),
            "transaction_count": transactions.count(), "has_statements": bool(latest_import),
            "notice": "Recorded activity only. A matching balance does not prove every transaction has been captured. Statement periods describe saved imports, not verified coverage."}, headers={"Cache-Control": "private, no-store"})
