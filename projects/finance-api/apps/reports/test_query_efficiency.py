"""Synthetic regressions for bounded report reads and selected query columns."""

from datetime import date, timedelta
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.statements.models import StatementImport
from apps.reconciliation.models import BalanceSnapshot
from apps.transactions.models import Transaction
from .summary import period_summary


class ReportQueryEfficiencyTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-report-query"
        )
        self.account = Account.objects.create(
            user=self.user, name="Synthetic report bank", type="bank"
        )
        self.client.force_authenticate(self.user)

    def test_overview_only_materializes_the_latest_import_and_snapshot(self):
        imports = StatementImport.objects.bulk_create(
            [
                StatementImport(
                    user=self.user,
                    account=self.account,
                    file_digest=f"synthetic-{n}",
                    profile="ebl_bank",
                    parser_version="1",
                    currency="BDT",
                    account_identity="synthetic",
                    period_start=date(2026, 1, 1),
                    period_end=date(2026, 1, 31),
                    page_count=1,
                )
                for n in range(60)
            ]
        )
        latest = imports[-1]
        StatementImport.objects.filter(pk=latest.pk).update(
            created_at=timezone.now() + timedelta(seconds=1)
        )
        BalanceSnapshot.objects.bulk_create(
            [
                BalanceSnapshot(
                    user=self.user,
                    account=self.account,
                    checked_at=timezone.now() + timedelta(seconds=n),
                    actual_balance=n,
                    expected_balance=0,
                    difference=n,
                    status="extra_money",
                )
                for n in range(60)
            ]
        )
        row_counts = {}

        def capture(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            for table in (
                "statements_statementimport",
                "reconciliation_balancesnapshot",
            ):
                if f'FROM "{table}"' in sql:
                    row_counts[table] = context["cursor"].rowcount
            return result

        with connection.execute_wrapper(capture):
            response = self.client.get("/api/reports/overview/")
        self.assertEqual(response.status_code, 200)
        coverage = response.data["coverage"][0]
        self.assertEqual(coverage["statement"]["id"], str(latest.pk))
        self.assertEqual(coverage["last_check"]["difference"], "59.00")
        if connection.vendor == "postgresql":
            self.assertEqual(
                row_counts,
                {"statements_statementimport": 1, "reconciliation_balancesnapshot": 1},
            )

    def test_period_summary_does_not_read_account_logos_or_original_entry_notes(self):
        from unittest.mock import patch

        Transaction.objects.create(
            user=self.user,
            account=self.account,
            date=date(2026, 1, 1),
            amount=10,
            type="expense",
            direction="debit",
            note="Synthetic private note",
        )
        with (
            CaptureQueriesContext(connection) as queries,
            patch.object(
                Transaction, "from_db", wraps=Transaction.from_db
            ) as materialized,
        ):
            report = period_summary(
                user=self.user, start=date(2026, 1, 1), end=date(2026, 1, 31)
            )
        self.assertEqual(report["expense_total"], "10.00")
        self.assertEqual(
            len(queries), 1, "Every report section must share one SQL snapshot"
        )
        self.assertEqual(materialized.call_count, 0)
        for query in queries:
            self.assertNotIn('"logo"', query["sql"])
            self.assertNotIn('"note"', query["sql"])

    def test_batched_empty_periods_share_one_statement_and_keep_zero_totals(self):
        from .summary import period_summaries

        with self.assertNumQueries(1):
            reports = period_summaries(
                user=self.user,
                periods=[
                    (date(2026, 1, 1), date(2026, 1, 31)),
                    (date(2025, 12, 1), date(2025, 12, 31)),
                ],
            )
        for report in reports:
            self.assertEqual(report["transaction_count"], 0)
            self.assertEqual(report["expense_total"], "0.00")
            self.assertEqual(report["accounts"], [])
            self.assertEqual(report["categories"], [])
            self.assertEqual(len(report["daily"]), 31)

    def test_equal_transfer_and_income_contributions_are_not_deduplicated(self):
        from decimal import Decimal
        from apps.transactions.balance_queries import ledger_totals

        cash = Account.objects.create(
            user=self.user, name="Synthetic cash", type="cash"
        )
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            transfer_account=cash,
            date="2026-01-01",
            type="transfer",
            direction="debit",
            amount=10,
        )
        Transaction.objects.create(
            user=self.user,
            account=cash,
            date="2026-01-01",
            type="income",
            direction="credit",
            amount=10,
        )
        with self.assertNumQueries(1):
            balances = ledger_totals([self.account, cash])
        self.assertEqual(balances[cash.pk], Decimal("20"))
        report = period_summary(
            user=self.user, start=date(2026, 1, 1), end=date(2026, 1, 31)
        )
        receiving = next(row for row in report["accounts"] if row["id"] == str(cash.pk))
        self.assertEqual(receiving["money_in"], "20.00")

    def test_postgres_json_money_projection_preserves_large_fractional_amounts(self):
        if connection.vendor != "postgresql":
            self.skipTest(
                "SQLite numeric storage is not an exact-decimal production backend"
            )
        Transaction.objects.bulk_create(
            [
                Transaction(
                    user=self.user,
                    account=self.account,
                    date="2026-01-01",
                    type="expense",
                    direction="debit",
                    amount="999999999999.99",
                    counterparty_text="Synthetic Vendor",
                )
                for _ in range(100)
            ]
            + [
                Transaction(
                    user=self.user,
                    account=self.account,
                    date="2026-01-01",
                    type="expense",
                    direction="debit",
                    amount="0.01",
                    counterparty_text=" synthetic vendor ",
                ),
            ]
        )
        report = period_summary(
            user=self.user, start=date(2026, 1, 1), end=date(2026, 1, 31)
        )
        for value in [
            report["expense_total"],
            report["categories"][0]["amount"],
            report["merchants"][0]["amount"],
            report["daily"][0]["expense_total"],
        ]:
            self.assertEqual(value, "99999999999999.01")
        self.assertEqual(report["categories"][0]["id"], None)
        self.assertEqual(report["merchants"][0]["count"], 101)
