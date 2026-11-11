import csv
from io import StringIO

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction
from .models import SavedReport


class ReportRuleTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-rule-owner")
        self.other = get_user_model().objects.create_user(username="synthetic-rule-other")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(user=self.user, name="Synthetic bank", type="bank")
        self.cash = Account.objects.create(user=self.user, name="Synthetic cash", type="cash")
        self.third = Account.objects.create(user=self.user, name="Synthetic other", type="cash")
        self.food = Category.objects.create(user=self.user, name="Synthetic food")
        self.travel = Category.objects.create(user=self.user, name="Synthetic travel")
        self.shopping = Category.objects.create(user=self.user, name="Synthetic shopping")
        self.a = self.entry(self.bank, self.food, "100.25", source="web", counterparty_text="Synthetic project")
        self.b = self.entry(self.cash, self.travel, "50.75", source="mobile", counterparty_text="Synthetic project")
        self.c = self.entry(self.third, self.food, "700")
        self.d = self.entry(self.bank, self.shopping, "40")
        self.uncategorized = self.entry(self.bank, None, "10")
        self.previous = self.entry(self.bank, self.food, "25", date="2026-09-10")
        self.input = {"name": "Synthetic multi-scope", "start_date": "2026-10-01", "end_date": "2026-10-31", "date_view": "monthly", "currency": "BDT", "account": None}
        response = self.client.post("/api/reports/saved/", self.input, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.id = response.data["id"]
        self.url = f"/api/reports/saved/{self.id}/"

    def entry(self, account, category, amount, **kwargs):
        return Transaction.objects.create(user=self.user, account=account, category=category, amount=amount,
                                          type=kwargs.pop("type", "expense"), direction=kwargs.pop("direction", "debit"),
                                          date=kwargs.pop("date", "2026-10-10"), **kwargs)

    def rules(self, **rules):
        response = self.client.patch(self.url, {"filters": rules}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def summary(self):
        response = self.client.get("/api/reports/monthly/", {"saved_report": self.id})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_multiple_accounts_and_categories_intersect_and_keep_comparison_rules(self):
        saved = self.rules(accounts=[str(self.bank.pk), str(self.cash.pk)], categories=[str(self.food.pk), str(self.travel.pk)])
        self.assertEqual(len(saved["filters"]["accounts"]), 2)
        report = self.summary()
        self.assertEqual(report["expense_total"], "151.00")
        self.assertEqual(report["transaction_count"], 2)
        self.assertEqual(report["previous"]["expense_total"], "25.00")
        self.client.patch(self.url, {"name": "Renamed"})
        self.assertEqual(self.summary()["expense_total"], "151.00")
        ids = {row["id"] for row in self.client.get(self.url + "transactions/").data["results"]}
        self.assertEqual(ids, {str(self.a.pk), str(self.b.pk)})
        drill = self.client.get("/api/transactions/activity/", {"saved_report": self.id}).data
        self.assertEqual({row["id"] for row in drill["results"]}, ids)
        totals = self.client.get("/api/transactions/totals/", {"saved_report": self.id}).data["currencies"][0]
        self.assertEqual(totals["spending"], report["expense_total"])
        exported = self.client.get("/api/transactions/export/", {"saved_report": self.id})
        rows = list(csv.DictReader(StringIO(exported.content.decode())))
        self.assertEqual(len(rows), 2)

    def test_exclusions_and_uncategorized_are_explicit(self):
        self.rules(excluded_accounts=[str(self.third.pk)], excluded_categories=[str(self.shopping.pk), "uncategorized"])
        self.assertEqual(self.summary()["expense_total"], "151.00")
        self.rules(categories=["uncategorized"])
        self.assertEqual(self.summary()["expense_total"], "10.00")
        self.rules(categories=[str(self.food.pk)], excluded_accounts=[str(self.third.pk)])
        self.assertEqual(self.summary()["expense_total"], "100.25")
        self.rules(excluded_categories=[str(self.food.pk)])
        self.assertEqual(self.summary()["previous"]["expense_total"], "0.00")

    def test_richer_rules_keep_both_periods_in_one_sql_statement(self):
        from datetime import date
        from unittest.mock import patch
        from .saved import report_records
        from .summary import period_summaries

        self.rules(accounts=[str(self.bank.pk), str(self.cash.pk)], excluded_categories=[str(self.shopping.pk), "uncategorized"], search="Synthetic")
        saved = SavedReport.objects.get(pk=self.id)
        current = report_records(saved)
        previous = report_records(saved, start=date(2026, 9, 1), end=date(2026, 9, 30), manual=False)
        with self.assertNumQueries(1), patch.object(Transaction, "from_db", wraps=Transaction.from_db) as materialized:
            reports = period_summaries(user=self.user, periods=[(date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 9, 1), date(2026, 9, 30))],
                                       record_sets=[current, previous], account_ids=saved.filters["accounts"])
        self.assertEqual(materialized.call_count, 0)
        self.assertEqual(reports[0]["expense_total"], "151.00")
        self.assertEqual(reports[1]["expense_total"], "25.00")

    def test_transaction_rules_amount_boundaries_and_manual_choices(self):
        self.rules(accounts=[str(self.bank.pk), str(self.cash.pk)], types=["expense", "fee"], sources=["web", "mobile"],
                   directions=["debit"], search="Synthetic project", min_amount="50.75", max_amount="100.25")
        self.assertEqual(self.summary()["expense_total"], "151.00")
        self.client.post(self.url + "membership/", {"transaction": str(self.b.pk), "action": "exclude"})
        self.client.post(self.url + "membership/", {"transaction": str(self.c.pk), "action": "include"})
        self.assertEqual(self.summary()["expense_total"], "800.25")
        self.rules(types=["income"])
        self.assertEqual(self.summary()["expense_total"], "700.00")

    def test_preview_is_read_only_and_uses_draft_rules_with_existing_overrides(self):
        self.client.post(self.url + "membership/", {"transaction": str(self.b.pk), "action": "exclude"})
        self.client.post(self.url + "membership/", {"transaction": str(self.c.pk), "action": "include"})
        payload = {**self.input, "saved_report": self.id, "filters": {"accounts": [str(self.bank.pk), str(self.cash.pk)], "categories": [str(self.food.pk), str(self.travel.pk)]}}
        response = self.client.post("/api/reports/saved/preview/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["expense_total"], "800.25")
        self.assertEqual(SavedReport.objects.get(pk=self.id).filters, {})
        self.assertEqual(SavedReport.objects.count(), 1)
        payload.pop("saved_report")
        response = self.client.post("/api/reports/saved/preview/", payload, format="json")
        self.assertEqual(response.data["expense_total"], "151.00")
        self.assertEqual(SavedReport.objects.count(), 1)

    def test_foreign_unknown_conflicting_and_wrong_currency_rules_are_rejected(self):
        foreign = Account.objects.create(user=self.other, name="Private synthetic", type="bank")
        category = Category.objects.create(user=self.other, name="Private synthetic category")
        usd = Account.objects.create(user=self.user, name="Synthetic USD", type="bank", currency="USD")
        cases = [
            {"accounts": [str(foreign.pk)]}, {"excluded_categories": [str(category.pk)]}, {"accounts": [str(usd.pk)]},
            {"accounts": [str(self.bank.pk)], "excluded_accounts": [str(self.bank.pk)]},
            {"categories": ["uncategorized"], "excluded_categories": ["uncategorized"]}, {"categories": ["invalid"]},
            {"types": ["invalid"]}, {"directions": ["invalid"]}, {"sources": ["invalid"]}, {"min_amount": "10", "max_amount": "1"},
            {"min_amount": "-1"}, {"max_amount": "1.001"}, {"unknown": []}, {"accounts": [str(self.bank.pk)] * 101},
        ]
        for rules in cases:
            with self.subTest(rules=rules):
                response = self.client.patch(self.url, {"filters": rules}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(SavedReport.objects.get(pk=self.id).filters, {})
        self.client.force_authenticate(self.other)
        response = self.client.post("/api/reports/saved/preview/", {**self.input, "saved_report": self.id}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_group_transfers_are_counted_once_and_cash_flow_matches_drillthrough(self):
        internal = self.entry(self.bank, None, "20", type="transfer", transfer_account=self.cash)
        outgoing = self.entry(self.bank, None, "30", type="transfer", transfer_account=self.third)
        incoming = self.entry(self.third, None, "40", type="transfer", transfer_account=self.cash)
        self.rules(accounts=[str(self.bank.pk), str(self.cash.pk)], types=["transfer"])
        report = self.summary()
        self.assertEqual(report["transaction_count"], 3)
        self.assertEqual(report["transfers_total"], "90.00")
        self.assertEqual(report["cash_in_total"], "40.00")
        self.assertEqual(report["cash_out_total"], "30.00")
        totals = self.client.get("/api/transactions/totals/", {"saved_report": self.id}).data["currencies"][0]
        self.assertEqual(totals["moneyIn"], report["cash_in_total"])
        self.assertEqual(totals["moneyOut"], report["cash_out_total"])
        self.rules(accounts=[str(self.bank.pk), str(self.cash.pk)], types=["transfer"], directions=["credit"])
        rows = self.client.get(self.url + "transactions/").data["results"]
        self.assertEqual({row["id"] for row in rows}, {str(internal.pk), str(incoming.pk)})
        self.assertNotIn(str(outgoing.pk), {row["id"] for row in rows})
