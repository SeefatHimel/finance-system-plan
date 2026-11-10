from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction
from .models import SavedReport


class SavedReportTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-report-owner")
        self.other = get_user_model().objects.create_user(username="synthetic-report-other")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(user=self.user, name="Synthetic bank", type="bank")
        self.row = self.entry("2026-10-12", "100")
        self.outside = self.entry("2026-09-01", "30")
        response = self.client.post("/api/reports/saved/", {"name": "October review", "start_date": "2026-10-01", "end_date": "2026-10-31", "date_view": "monthly"})
        self.assertEqual(response.status_code, 201, response.data)
        self.report_id = response.data["id"]
        self.url = f"/api/reports/saved/{self.report_id}/"

    def entry(self, day, amount, **kwargs):
        return Transaction.objects.create(user=self.user, account=kwargs.pop("account", self.account), date=day, type="expense", amount=amount, **kwargs)

    def membership(self, row, action):
        return self.client.post(self.url + "membership/", {"transaction": str(row.pk), "action": action})

    def summary(self):
        response = self.client.get("/api/reports/monthly/", {"saved_report": self.report_id})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_filters_are_live_and_manual_choices_change_all_totals_without_ledger_edits(self):
        self.assertEqual(self.summary()["expense_total"], "100.00")
        self.entry("2026-10-15", "50")
        self.assertEqual(self.membership(self.row, "exclude").status_code, 200)
        self.assertEqual(self.membership(self.outside, "include").status_code, 200)
        self.assertEqual(self.membership(self.outside, "include").status_code, 200)
        report = self.summary()
        self.assertEqual(report["expense_total"], "80.00")
        self.assertEqual(report["transaction_count"], 2)
        self.assertEqual(report["categories"][0]["amount"], "80.00")
        self.assertEqual(sum(float(row["expense_total"]) for row in report["daily"]), 80)
        self.assertEqual(report["previous"]["expense_total"], "30.00")
        drill = self.client.get("/api/transactions/", {"saved_report": self.report_id})
        self.assertEqual(len(drill.data), 2)
        self.assertNotIn(str(self.row.pk), [item["id"] for item in drill.data])
        self.membership(self.row, "reset")
        self.assertEqual(self.summary()["expense_total"], "180.00")
        self.assertEqual(Transaction.objects.filter(user=self.user).count(), 3)

    def test_paginated_membership_picker_and_search(self):
        self.outside.counterparty_text = "Synthetic merchant"
        self.outside.save()
        available = self.client.get(self.url + "transactions/", {"scope": "available", "search": "merchant", "limit": 1})
        self.assertEqual(available.status_code, 200, available.data)
        self.assertEqual(available.data["count"], 1)
        self.assertEqual(available.data["results"][0]["id"], str(self.outside.pk))
        self.membership(self.row, "exclude")
        excluded = self.client.get(self.url + "transactions/", {"scope": "excluded"})
        self.assertEqual(excluded.data["count"], 1)
        self.assertEqual(self.client.get(self.url + "transactions/", {"offset": -1}).status_code, 400)

    def test_all_pages_are_reachable_and_choices_survive_filter_changes(self):
        for day in range(1, 28):
            self.entry(f"2026-10-{day:02}", "1")
        first = self.client.get(self.url + "transactions/", {"limit": 25}).data
        second = self.client.get(self.url + "transactions/", {"limit": 25, "offset": first["next_offset"]}).data
        self.assertEqual(first["count"], 28)
        self.assertEqual(len(first["results"]), 25)
        self.assertEqual(len(second["results"]), 3)
        self.assertIsNone(second["next_offset"])
        ids = [row["id"] for row in first["results"] + second["results"]]
        self.assertEqual(len(set(ids)), 28)
        self.membership(self.row, "exclude")
        self.membership(self.outside, "include")
        response = self.client.patch(self.url, {"start_date": "2026-10-12", "end_date": "2026-10-12", "date_view": "daily"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.summary()["expense_total"], "31.00")
        self.outside.delete()
        self.assertEqual(self.summary()["expense_total"], "1.00")

    def test_manual_additions_can_cross_accounts_but_not_currencies(self):
        cash = Account.objects.create(user=self.user, name="Synthetic cash", type="cash")
        added = self.entry("2026-09-03", "25", account=cash)
        self.client.patch(self.url, {"account": str(self.account.pk)})
        self.membership(added, "include")
        report = self.summary()
        self.assertEqual(report["expense_total"], "125.00")
        self.assertEqual({row["id"] for row in report["accounts"]}, {str(cash.pk), str(self.account.pk)})
        # A filter change keeps choices but does not mix currencies.
        self.client.patch(self.url, {"account": None, "currency": "USD"}, format="json")
        self.assertEqual(self.summary()["transaction_count"], 0)
        self.client.patch(self.url, {"currency": "BDT"})
        self.assertEqual(self.summary()["expense_total"], "125.00")

    def test_saved_membership_and_previous_period_share_one_sql_snapshot(self):
        from datetime import date
        from unittest.mock import patch
        from .saved import report_records
        from .summary import period_summaries

        self.membership(self.row, "exclude")
        self.membership(self.outside, "include")
        saved = SavedReport.objects.get(pk=self.report_id)
        with self.assertNumQueries(1), patch.object(Transaction, "from_db", wraps=Transaction.from_db) as materialized:
            current, previous = period_summaries(
                user=self.user,
                periods=[(date(2026, 10, 1), date(2026, 10, 31)), (date(2026, 9, 1), date(2026, 9, 30))],
                record_sets=[report_records(saved), None],
            )
        self.assertEqual(materialized.call_count, 0)
        self.assertEqual(current["expense_total"], "30.00")
        self.assertEqual(previous["expense_total"], "30.00")

    def test_currency_owner_and_auth_boundaries(self):
        usd = Account.objects.create(user=self.user, name="Synthetic USD", type="bank", currency="USD")
        usd_row = self.entry("2026-10-15", "999", account=usd)
        self.assertEqual(self.membership(usd_row, "include").status_code, 400)
        foreign_account = Account.objects.create(user=self.other, name="Synthetic private", type="cash")
        foreign_row = Transaction.objects.create(user=self.other, account=foreign_account, date="2026-10-12", type="expense", amount="999")
        self.assertEqual(self.membership(foreign_row, "include").status_code, 404)
        self.assertEqual(self.client.patch(self.url, {"account": str(foreign_account.pk)}).status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/reports/saved/").data, [])
        for suffix in ("", "transactions/"):
            self.assertEqual(self.client.get(self.url + suffix).status_code, 404)
        self.assertEqual(self.summary_status(), 404)
        self.assertEqual(self.client.get("/api/transactions/", {"saved_report": self.report_id}).status_code, 404)
        self.assertEqual(self.client.patch(self.url, {"name": "Changed"}).status_code, 404)
        self.assertEqual(self.client.delete(self.url).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/reports/saved/").status_code, 401)

    def summary_status(self):
        return self.client.get("/api/reports/monthly/", {"saved_report": self.report_id}).status_code

    def test_rename_filter_edits_validation_and_delete(self):
        for data in ({"name": "  "}, {"end_date": "2026-09-01"}, {"currency": "12!"}, {"start_date": "0001-01-01", "end_date": "0001-01-01"}, {"end_date": "2028-01-01"}):
            self.assertEqual(self.client.patch(self.url, data).status_code, 400)
        response = self.client.patch(self.url, {"name": "September", "start_date": "2026-09-01", "end_date": "2026-09-30"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.summary()["expense_total"], "30.00")
        self.membership(self.row, "include")
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(SavedReport.objects.exists())
        self.assertEqual(Transaction.objects.count(), 2)
