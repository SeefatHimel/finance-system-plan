import csv
import io
from decimal import Decimal
from threading import Thread
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase
from rest_framework.test import APITestCase, APIClient

from apps.accounts.models import Account
from apps.transactions.models import Transaction, TransferEvidence
from .models import SavedReport, ReportMembership


class AccountStatementTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-statement-owner")
        self.other = get_user_model().objects.create_user(username="synthetic-statement-other")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(user=self.user, name="Synthetic bank", type="bank", starting_balance=1000)
        self.cash = Account.objects.create(user=self.user, name="Synthetic cash", type="cash", starting_balance=200)
        self.entry("2026-10-30", "expense", "100", balance_after="700")
        self.entry("2026-10-31", "income", "50")
        self.expense = self.entry("2026-11-01", "expense", "100")
        self.entry("2026-11-02", "transfer", "200", transfer_account=self.cash)
        self.entry("2026-11-03", "refund", "20")
        self.entry("2026-11-04", "income", "500")
        self.entry("2026-11-05", "adjustment", "10", direction="credit")
        self.entry("2026-11-06", "income", "9000", balance_after="99999")
        self.report = SavedReport.objects.create(user=self.user, name="Synthetic statement", start_date="2026-11-01", end_date="2026-11-05", report_view="account_statement", filters={"accounts": [str(self.bank.pk), str(self.cash.pk)], "types": ["expense"]})
        self.url = f"/api/reports/saved/{self.report.pk}/"

    def entry(self, day, kind, amount, **kwargs):
        return Transaction.objects.create(user=self.user, account=kwargs.pop("account", self.bank), date=day, type=kind, amount=amount, **kwargs)

    def statement(self, **params):
        response = self.client.get(self.url + "account-statements/", {"account": str(self.bank.pk), **params})
        self.assertEqual(response.status_code, 200, getattr(response, "data", response.content))
        return response.data

    def opening(self, mode, amount=None):
        value = {"mode": mode, **({"amount": amount} if amount is not None else {})}
        response = self.client.patch(self.url, {"opening_balances": {str(self.bank.pk): value}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def summary(self, data, account=None):
        return next(row for row in data["accounts"] if row["account"] == str((account or self.bank).pk))

    def test_opening_precedes_range_closing_includes_last_day_and_both_transfer_sides(self):
        data = self.statement()
        bank, cash = self.summary(data), self.summary(data, self.cash)
        self.assertEqual((bank["opening_balance"], bank["money_in"], bank["money_out"], bank["closing_balance"]), ("950.00", "530.00", "300.00", "1180.00"))
        self.assertEqual((cash["opening_balance"], cash["money_in"], cash["money_out"], cash["closing_balance"]), ("200.00", "200.00", "0.00", "400.00"))
        self.assertEqual(data["count"], 5)
        self.assertEqual(data["results"][0]["running_balance"], "850.00")
        self.assertEqual(data["results"][-1]["running_balance"], bank["closing_balance"])

    def test_last_known_report_is_carried_forward_and_future_reports_are_never_used(self):
        self.opening("reported")
        row = self.summary(self.statement())
        self.assertEqual(row["last_reported_date"], "2026-10-30")
        self.assertEqual(row["last_reported_balance"], "700.00")
        self.assertEqual(row["reported_opening_balance"], "750.00")
        self.assertEqual(row["opening_balance"], "750.00")
        self.assertEqual(row["closing_balance"], "980.00")
        self.assertEqual(row["ledger_closing_balance"], "1180.00")

    def test_manual_negative_and_zero_opening_do_not_edit_accounts_or_transactions(self):
        original = list(Transaction.objects.values_list("id", "amount", "balance_after"))
        self.opening("manual", "-25.50")
        self.assertEqual(self.summary(self.statement())["closing_balance"], "204.50")
        self.opening("manual", "0")
        row = self.summary(self.statement())
        self.assertEqual((row["opening_balance"], row["closing_balance"]), ("0.00", "230.00"))
        self.bank.refresh_from_db()
        self.assertEqual(self.bank.starting_balance, Decimal("1000"))
        self.assertEqual(list(Transaction.objects.values_list("id", "amount", "balance_after")), original)

    def test_statement_balances_ignore_analysis_filters_and_manual_report_membership(self):
        ReportMembership.objects.create(report=self.report, transaction=self.expense, included=False)
        outside = Transaction.objects.filter(account=self.bank, date="2026-10-30").get()
        ReportMembership.objects.create(report=self.report, transaction=outside, included=True)
        self.assertEqual(self.statement()["count"], 5)
        self.assertEqual(self.summary(self.statement())["closing_balance"], "1180.00")

    def test_statement_account_selection_honors_exclusions_and_currency(self):
        usd = Account.objects.create(user=self.user, name="Synthetic USD", type="bank", currency="USD")
        self.report.filters = {"excluded_accounts": [str(self.cash.pk)]}; self.report.save()
        data = self.statement()
        self.assertEqual([row["account"] for row in data["accounts"]], [str(self.bank.pk)])
        self.assertEqual(self.client.get(self.url + "account-statements/", {"account": str(usd.pk)}).status_code, 400)

    def test_pagination_preserves_running_balances_from_preceding_pages(self):
        for _ in range(27): self.entry("2026-11-01", "expense", "0.10")
        full = self.statement(limit=100)
        first, second = self.statement(limit=2), self.statement(limit=2, offset=2)
        self.assertEqual(first["results"] + second["results"], full["results"][:4])
        self.assertEqual(first["next_offset"], 2)
        self.assertEqual(full["results"][-1]["running_balance"], "1177.30")
        self.assertEqual(full["results"][-1]["running_balance"], self.summary(full)["closing_balance"])

    def test_ambiguous_reported_timing_requires_manual_opening_instead_of_fallback(self):
        self.entry("2026-10-30", "expense", "5")
        self.opening("reported")
        row = self.summary(self.statement())
        self.assertIsNone(row["reported_opening_balance"])
        self.assertIsNone(row["opening_balance"])
        self.assertIsNone(row["closing_balance"])
        self.assertIn("uncertain timing", row["reported_unavailable_reason"])

    def test_credit_card_reference_is_not_assumed_to_be_signed_ledger_balance(self):
        self.bank.type = "credit_card"; self.bank.save()
        row = self.summary(self.statement())
        self.assertIsNone(row["reported_opening_balance"])
        self.assertIn("signed ledger", row["reported_unavailable_reason"])

    def test_receiving_account_uses_its_own_transfer_report(self):
        transfer = self.entry("2026-10-31", "transfer", "25", transfer_account=self.cash)
        TransferEvidence.objects.create(user=self.user, transaction=transfer, account=self.cash, direction="credit", date="2026-10-31", balance_after="325", external_key="synthetic-receiving-report", source="web")
        self.report.opening_balances = {str(self.cash.pk): {"mode": "reported"}}; self.report.save()
        data = self.statement(account=str(self.cash.pk))
        cash = self.summary(data, self.cash)
        self.assertEqual((cash["opening_balance"], cash["closing_balance"]), ("325.00", "525.00"))

    def test_owner_auth_validation_and_read_only_cache_boundaries(self):
        foreign = Account.objects.create(user=self.other, name="Synthetic private", type="bank")
        for opening in ({str(foreign.pk): {"mode": "manual", "amount": "100"}}, {"bad": {"mode": "ledger"}}, {str(self.bank.pk): {"mode": "manual"}}, {str(self.bank.pk): {"mode": "ledger", "amount": "100"}}, {str(self.bank.pk): {"mode": "manual", "amount": "NaN"}}):
            self.assertEqual(self.client.patch(self.url, {"opening_balances": opening}, format="json").status_code, 400)
        for query in ({"offset": -1}, {"limit": 101}, {"account": str(foreign.pk)}):
            self.assertEqual(self.client.get(self.url + "account-statements/", query).status_code, 400)
        response = self.client.get(self.url + "account-statements/")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url + "account-statements/").status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url + "account-statements/").status_code, 401)

    def test_csv_matches_running_balances_and_escapes_spreadsheet_formulas(self):
        self.expense.counterparty_text = "=DANGEROUS()"; self.expense.save()
        self.opening("manual", "0")
        response = self.client.get(self.url + "account-statements/", {"account": str(self.bank.pk), "export": "csv"})
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.content.decode())))
        self.assertEqual(rows[1][-2:], ["0.00", "230.00"])
        self.assertEqual(rows[3][3], "'=DANGEROUS()")
        self.assertEqual(rows[-1][-1], "230.00")

    def test_empty_range_has_unchanged_opening_and_closing(self):
        self.report.start_date = "2026-12-01"; self.report.end_date = "2026-12-31"; self.report.save()
        data = self.statement()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])
        self.assertEqual(self.summary(data)["opening_balance"], self.summary(data)["closing_balance"])

    def test_opening_settings_reject_mixed_currencies(self):
        usd = Account.objects.create(user=self.user, name="Synthetic USD", type="bank", currency="USD")
        response = self.client.patch(self.url, {"opening_balances": {str(usd.pk): {"mode": "manual", "amount": "100"}}}, format="json")
        self.assertEqual(response.status_code, 400)


@skipUnless(connection.vendor == "postgresql", "Snapshot isolation requires PostgreSQL")
class AccountStatementSnapshotTests(TransactionTestCase):
    def test_concurrent_write_cannot_split_opening_movements_closing_and_running_rows(self):
        from . import statements
        user = get_user_model().objects.create_user(username="synthetic-statement-snapshot")
        account = Account.objects.create(user=user, name="Synthetic snapshot account", type="bank", starting_balance=1000)
        report = SavedReport.objects.create(user=user, name="Synthetic snapshot", start_date="2026-11-01", end_date="2026-11-30")
        Transaction.objects.create(user=user, account=account, date="2026-11-01", type="expense", amount="100")
        errors = []
        def writer():
            try:
                Transaction.objects.create(user_id=user.pk, account_id=account.pk, date="2026-11-02", type="expense", amount="200")
            except Exception as exc:
                errors.append(exc)
            finally:
                connections.close_all()
        original = statements.ledger_totals
        def write_between_reads(*args, **kwargs):
            thread = Thread(target=writer); thread.start(); thread.join(timeout=10)
            self.assertFalse(thread.is_alive()); self.assertEqual(errors, [])
            return original(*args, **kwargs)
        client = APIClient(); client.force_authenticate(user)
        with patch.object(statements, "ledger_totals", side_effect=write_between_reads):
            response = client.get(f"/api/reports/saved/{report.pk}/account-statements/")
        self.assertEqual(response.status_code, 200)
        summary = response.data["accounts"][0]
        self.assertEqual((summary["ledger_closing_balance"], summary["closing_balance"]), ("900.00", "900.00"))
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][-1]["running_balance"], "900.00")
        next_read = client.get(f"/api/reports/saved/{report.pk}/account-statements/")
        self.assertEqual(next_read.data["accounts"][0]["closing_balance"], "700.00")
