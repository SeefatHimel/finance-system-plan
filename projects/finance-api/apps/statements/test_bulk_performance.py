"""Synthetic endpoint query budgets; no production data or timing assertions."""

import json
import os
from datetime import timedelta
from decimal import Decimal
from time import perf_counter

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from .models import StatementRow
from . import test_bulk_approval as fixtures


class BulkApprovalPerformanceTests(APITestCase):
    setUp = fixtures.BulkApprovalTests.setUp
    candidate = fixtures.BulkApprovalTests.candidate
    preview = fixtures.BulkApprovalTests.preview
    approve = fixtures.BulkApprovalTests.approve

    def populate(self, count):
        total = Decimal("100.00")
        for offset in range(1, count):
            amount = Decimal(100 + offset * 10)
            total += amount
            balance = Decimal(1000) - total
            day = self.row.date + timedelta(days=offset)
            reference = f"SYNTH-PROBE-{offset}"
            row = StatementRow.objects.create(
                batch=self.batch,
                position=offset + 1,
                component="principal",
                source_fingerprint=f"synthetic-probe-{offset}",
                date=day,
                time=self.row.time,
                direction="debit",
                type="expense",
                amount=amount,
                balance_after=balance,
                category=self.category,
                classification_confirmed=True,
                counterparty_text=self.row.counterparty_text,
                reference=reference,
                extracted={
                    **self.row.extracted,
                    "id": f"synthetic-probe-{offset}",
                    "row": offset + 1,
                    "date": day.isoformat(),
                    "amount": str(amount),
                    "balance_after": str(balance),
                    "reference": reference,
                },
            )
            sms = self.candidate(
                amount=str(amount),
                balance=str(balance),
                day=day.day,
                source_direction="debit",
                transaction_type="expense",
                category=self.category,
                reference=reference,
            )
            self.pairs.append({"statement": str(row.pk), "sms": str(sms.pk)})
        self.batch.closing_balance = Decimal(1000) - total
        self.batch.period_end = self.row.date + timedelta(days=count)
        self.batch.save()

    def measure(self, label, callback):
        with CaptureQueriesContext(connection) as captured:
            started = perf_counter()
            result = callback()
            seconds = perf_counter() - started
        if os.getenv("FINANCE_QUERY_BENCHMARK"):
            print(
                "BULK_QUERY_BENCHMARK "
                + json.dumps(
                    {
                        "database": connection.vendor,
                        "pairs": len(self.pairs),
                        "phase": label,
                        "queries": len(captured),
                        "seconds": round(seconds, 3),
                    }
                ),
                flush=True,
            )
        return result, len(captured)

    def check_budget(self, count, *, edited=False):
        self.populate(count)
        pairs = [
            (
                {**pair, "edits": {"description": "Synthetic payment service"}}
                if edited
                else pair
            )
            for pair in self.pairs
        ]
        value, preview_queries = self.measure("preview", lambda: self.preview(pairs))
        self.assertEqual(value["ready_count"], count, value)
        # Read-only discovery should stay bounded per import rather than pair.
        self.assertLessEqual(preview_queries, 25 if not edited else 35)
        result, approval_queries = self.measure(
            "approval", lambda: self.approve(value, pairs=pairs)
        )
        self.assertEqual(result.status_code, 200, result.data)
        # Writes/audits remain per movement. This fails the pre-optimization
        # 25-pair baseline (1,334 SQLite statements) while allowing PG savepoints.
        self.assertLessEqual(approval_queries, 90 + 40 * count)
        self.assertEqual(len(result.data["approved"]), count)

    def test_one_pair(self):
        self.check_budget(1)

    def test_five_pairs(self):
        self.check_budget(5)

    def test_twenty_five_pairs(self):
        self.check_budget(25)

    def test_shared_merchant_edit_does_not_scan_history_per_pair(self):
        self.check_budget(25, edited=True)
