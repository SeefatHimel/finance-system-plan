"""Spending and earned income are distinct from financing and account cash flow."""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Q

from apps.transactions.models import Transaction


ZERO = Decimal("0.00")
CREDIT = {"income", "refund", "borrow", "repayment_received"}
DEBIT = {"expense", "fee", "lend", "repayment_paid"}
SPENDING = {"expense", "fee"}
FINANCING = {"borrow", "lend", "repayment_received", "repayment_paid"}


def money(value):
    return f"{value.quantize(Decimal('0.01'))}"


def period_summary(*, user, start, end, currency="BDT", account=None):
    records = Transaction.objects.filter(user=user, date__range=(start, end), account__currency=currency)
    if account:
        records = records.filter(Q(account=account) | Q(type="transfer", transfer_account=account))
    records = records.select_related("account", "transfer_account", "category")
    totals = defaultdict(lambda: ZERO)
    categories = {}
    merchants = {}
    accounts = {}
    daily = defaultdict(lambda: defaultdict(lambda: ZERO))
    count = 0
    for row in records.iterator(chunk_size=1000):
        count += 1
        account_id = str(row.account_id)
        accounts.setdefault(account_id, {"id": account_id, "name": row.account.name, "money_in": ZERO, "money_out": ZERO})
        if row.type == "transfer" and row.transfer_account_id:
            if row.transfer_account.currency != currency:
                continue  # Cross-currency movements must never be added as like units.
            other_id = str(row.transfer_account_id)
            accounts.setdefault(other_id, {"id": other_id, "name": row.transfer_account.name, "money_in": ZERO, "money_out": ZERO})
            accounts[account_id]["money_out"] += row.amount
            accounts[other_id]["money_in"] += row.amount
            totals["transfers_total"] += row.amount
            if account:
                field = "cash_out_total" if row.account_id == account.pk else "cash_in_total"
                totals[field] += row.amount
                daily[row.date][field] += row.amount
            continue
        credit = row.type in CREDIT or (row.type == "adjustment" and row.direction == "credit")
        if row.type in CREDIT | DEBIT | {"adjustment"}:
            field = "money_in" if credit else "money_out"
            cash_field = "cash_in_total" if credit else "cash_out_total"
            accounts[account_id][field] += row.amount
            totals[cash_field] += row.amount
            daily[row.date][cash_field] += row.amount
        if row.type == "income":
            totals["income_total"] += row.amount
            daily[row.date]["income_total"] += row.amount
        elif row.type in FINANCING:
            totals["financing_in_total" if credit else "financing_out_total"] += row.amount
        elif row.type == "adjustment":
            totals["adjustments_total"] += row.amount if credit else -row.amount
        if row.type not in SPENDING | {"refund"}:
            continue
        is_refund = row.type == "refund"
        delta = -row.amount if is_refund else row.amount
        totals["refund_total" if is_refund else "gross_spending_total"] += row.amount
        totals["expense_total"] += delta
        daily[row.date]["expense_total"] += delta
        category_id = str(row.category_id) if row.category_id else None
        category = categories.setdefault(category_id, {"id": category_id, "name": row.category.name if row.category else "Uncategorized", "amount": ZERO})
        category["amount"] += delta
        merchant_name = row.counterparty_text.strip()
        merchant = merchants.setdefault(merchant_name.casefold(), {"name": merchant_name or "Unspecified merchant", "search": merchant_name, "amount": ZERO, "count": 0})
        merchant["amount"] += delta
        merchant["count"] += 1
    category_rows = [{**row, "amount": money(row["amount"])} for row in sorted(categories.values(), key=lambda item: (-item["amount"], item["name"]))]
    return {
        "policy": "spending-v2", "currency": currency, "start_date": start.isoformat(), "end_date": end.isoformat(), "transaction_count": count,
        **{field: money(totals[field]) for field in ("income_total", "expense_total", "gross_spending_total", "refund_total", "financing_in_total", "financing_out_total", "transfers_total", "adjustments_total", "cash_in_total", "cash_out_total")},
        "net_total": money(totals["income_total"] - totals["expense_total"]),
        "cash_net_total": money(totals["cash_in_total"] - totals["cash_out_total"]),
        "categories": category_rows, "spending_categories": category_rows,
        "merchants": [{**row, "amount": money(row["amount"])} for row in sorted(merchants.values(), key=lambda item: (-item["amount"], item["name"]))],
        "accounts": [{**row, "money_in": money(row["money_in"]), "money_out": money(row["money_out"])} for row in accounts.values() if not account or row["id"] == str(account.pk)],
        "daily": [{"date": (start + timedelta(days=n)).isoformat(), **{field: money(daily[start + timedelta(days=n)][field]) for field in ("income_total", "expense_total", "cash_in_total", "cash_out_total")}} for n in range((end - start).days + 1)],
    }
