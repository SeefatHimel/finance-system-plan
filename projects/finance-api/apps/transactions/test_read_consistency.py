"""Committed concurrent writes must not split one financial read into snapshots."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from unittest import skipUnless
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, transaction
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from apps.accounts.models import Account
from apps.reports.summary import period_summary
from .balance_queries import ledger_totals
from .models import Transaction


@skipUnless(
    connection.vendor == "postgresql",
    "Committed concurrent snapshots require PostgreSQL",
)
class FinancialReadConsistencyTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-financial-read"
        )
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", starting_balance=1000
        )
        self.cash = Account.objects.create(
            user=self.user, name="Synthetic cash", type="cash"
        )

    def entry(self, **changes):
        return Transaction.objects.create(
            user_id=self.user.pk,
            account_id=self.bank.pk,
            date=date(2026, 1, 1),
            type="expense",
            direction="debit",
            amount=50,
            **changes,
        )

    def during_read(self, marker, writer, reader):
        written = False

        def external_write():
            close_old_connections()
            try:
                return writer()
            finally:
                close_old_connections()

        def interleave(execute, sql, params, many, context):
            nonlocal written
            result = execute(sql, params, many, context)
            if not written and "transactions_transaction" in sql and marker in sql:
                written = True
                with ThreadPoolExecutor(max_workers=1) as pool:
                    pool.submit(external_write).result(timeout=10)
            return result

        with connection.execute_wrapper(interleave):
            result = reader()
        self.assertTrue(written, "The committed writer must actually overlap the read")
        return result

    def test_transfer_keeps_both_sides_in_one_snapshot_inside_existing_transaction(
        self,
    ):
        def writer():
            Transaction.objects.create(
                user_id=self.user.pk,
                account_id=self.bank.pk,
                transfer_account_id=self.cash.pk,
                date=date(2026, 1, 1),
                type="transfer",
                direction="debit",
                amount=100,
            )

        with transaction.atomic():  # Default READ COMMITTED must also be safe.
            result = self.during_read(
                "SUM(", writer, lambda: ledger_totals([self.bank, self.cash])
            )
        self.assertEqual(
            result, {self.bank.pk: Decimal("1000"), self.cash.pk: Decimal("0")}
        )
        self.assertEqual(
            ledger_totals([self.bank, self.cash]),
            {self.bank.pk: Decimal("900"), self.cash.pk: Decimal("100")},
        )

    def test_report_totals_categories_merchants_and_days_share_a_snapshot(self):
        result = self.during_read(
            "COUNT(",
            self.entry,
            lambda: period_summary(
                user=self.user, start=date(2026, 1, 1), end=date(2026, 1, 31)
            ),
        )
        self.assertEqual(result["transaction_count"], 0)
        self.assertEqual(result["expense_total"], "0.00")
        self.assertEqual(result["categories"], [])
        self.assertEqual(result["merchants"], [])
        self.assertTrue(all(row["expense_total"] == "0.00" for row in result["daily"]))
        self.assertEqual(Transaction.objects.count(), 1)

    def test_current_and_previous_periods_do_not_double_count_a_moved_entry(self):
        record = self.entry()
        client = APIClient()
        client.force_authenticate(self.user)

        def move():
            Transaction.objects.filter(pk=record.pk).update(date=date(2025, 12, 31))

        response = self.during_read(
            "COUNT(", move, lambda: client.get("/api/reports/monthly/?month=2026-01")
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["expense_total"], "50.00")
        self.assertEqual(response.data["previous"]["expense_total"], "0.00")
        record.refresh_from_db()
        self.assertEqual(record.date, date(2025, 12, 31))
