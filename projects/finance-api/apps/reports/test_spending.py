from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction


class SpendingDefinitionTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-spending-review")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(user=self.user, name="Synthetic bank", type="bank")
        self.wallet = Account.objects.create(user=self.user, name="Synthetic wallet", type="cash")
        self.category = Category.objects.create(user=self.user, name="Synthetic shopping", kind="expense")
        for kind, amount, category in (("income", "100000", None), ("expense", "4500", self.category), ("refund", "400", self.category), ("fee", "50", None), ("expense", "650", None), ("lend", "5000", None), ("repayment_received", "1000", None), ("borrow", "2000", None), ("repayment_paid", "200", None)):
            Transaction.objects.create(user=self.user, account=self.bank, date="2026-10-12", type=kind, amount=amount, category=category, counterparty_text="Synthetic merchant" if category else "")
        Transaction.objects.create(user=self.user, account=self.bank, transfer_account=self.wallet, date="2026-10-12", type="transfer", amount="3000")

    def report(self, **params):
        response = self.client.get("/api/reports/monthly/", {"month": "2026-10", **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_financing_and_refunds_are_not_earned_income_or_gross_spending(self):
        report = self.report()
        self.assertEqual(report["income_total"], "100000.00")
        self.assertEqual(report["gross_spending_total"], "5200.00")
        self.assertEqual(report["refund_total"], "400.00")
        self.assertEqual(report["expense_total"], "4800.00")
        self.assertEqual(report["financing_in_total"], "3000.00")
        self.assertEqual(report["financing_out_total"], "5200.00")
        self.assertEqual(report["cash_net_total"], "93000.00")
        self.assertEqual(report["net_total"], "95200.00")
        self.assertEqual(sum(Decimal(row["amount"]) for row in report["categories"]), Decimal("4800"))
        self.assertEqual(next(row for row in report["categories"] if row["name"] == "Uncategorized")["amount"], "700.00")
        self.assertEqual(report["merchants"][0]["amount"], "4100.00")
        self.assertEqual(report["previous"]["expense_total"], "0.00")

    def test_account_cash_flow_includes_its_transfer_without_counting_it_as_spending(self):
        bank = self.report(account=str(self.bank.pk))
        wallet = self.report(account=str(self.wallet.pk))
        self.assertEqual(bank["cash_net_total"], "90000.00")
        self.assertEqual(wallet["cash_net_total"], "3000.00")
        self.assertEqual(wallet["expense_total"], "0.00")

    def test_refund_only_period_is_a_credit_and_never_clamped_to_zero(self):
        Transaction.objects.create(user=self.user, account=self.bank, date="2026-11-01", type="refund", amount="100", category=self.category)
        response = self.client.get("/api/reports/monthly/", {"month": "2026-11"})
        self.assertEqual(response.data["expense_total"], "-100.00")
        self.assertEqual(response.data["income_total"], "0.00")

    def test_currency_and_owner_are_isolated(self):
        usd = Account.objects.create(user=self.user, name="Synthetic USD", type="bank", currency="USD")
        Transaction.objects.create(user=self.user, account=usd, date="2026-10-12", type="expense", amount="99")
        self.assertEqual(self.report(currency="USD")["expense_total"], "99.00")
        self.assertEqual(self.report()["expense_total"], "4800.00")
        other = get_user_model().objects.create_user(username="synthetic-other-spending")
        foreign = Account.objects.create(user=other, name="Private", type="cash")
        self.assertEqual(self.client.get("/api/reports/monthly/", {"month": "2026-10", "account": str(foreign.pk)}).status_code, 404)

    def test_category_and_merchant_drillthrough_match_contributing_entries(self):
        merchant = self.client.get("/api/transactions/", {"month": "2026-10", "search": 'merchant:"Synthetic merchant"'})
        self.assertEqual(len(merchant.data), 2)
        uncategorized = self.client.get("/api/transactions/", {"month": "2026-10", "category": "uncategorized"})
        self.assertTrue(uncategorized.data)
        self.assertTrue(all(row["category"] is None for row in uncategorized.data))

    def test_category_comparison_uses_the_previous_calendar_month(self):
        Transaction.objects.create(user=self.user, account=self.bank, date="2026-09-15", type="expense", amount="800", category=self.category, counterparty_text="Synthetic merchant")
        report = self.report()
        category = next(row for row in report["categories"] if row["id"] == str(self.category.pk))
        self.assertEqual(category["previous_amount"], "800.00")
        merchant = next(row for row in report["merchants"] if row["search"] == "Synthetic merchant")
        self.assertEqual(merchant["previous_amount"], "800.00")
        self.assertEqual(report["previous"]["start_date"], "2026-09-01")
        self.assertEqual(report["previous"]["end_date"], "2026-09-30")
