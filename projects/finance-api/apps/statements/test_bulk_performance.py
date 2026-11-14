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
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.transactions.models import Transaction


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
        # Ordinary writes/audit transitions are batched. This must fail the
        # previous 25-pair baseline of 914 queries (993 with merchant edits).
        self.assertLessEqual(approval_queries, 120)
        self.assertEqual(len(result.data["approved"]), count)

    def test_one_pair(self):
        self.check_budget(1)

    def test_five_pairs(self):
        self.check_budget(5)

    def test_twenty_five_pairs(self):
        self.check_budget(25)

    def test_shared_merchant_edit_does_not_scan_history_per_pair(self):
        self.check_budget(25, edited=True)

    def test_budget_with_existing_history_and_source_links_preserved(self):
        self.populate(25)
        Transaction.objects.bulk_create(
            [
                Transaction(
                    user=self.user,
                    account=self.account,
                    amount=100 + (i % 25) * 10,
                    date=self.row.date,
                    type="income",
                    direction="credit",
                    reference=f"SYNTH-HISTORY-{i}",
                )
                for i in range(200)
            ]
        )
        value = self.preview()
        self.assertEqual(value["ready_count"], 25)
        result, queries = self.measure(
            "approval-with-history", lambda: self.approve(value)
        )
        self.assertEqual(result.status_code, 200, result.data)
        self.assertLessEqual(queries, 140)
        self.assertEqual(Transaction.objects.count(), 225)
        self.assertEqual(StatementRow.objects.filter(state="linked").count(), 25)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="confirmed").count(), 25
        )

    def test_pathao_provider_ids_keep_source_checks_with_bounded_queries(self):
        self.populate(25)
        self.batch.profile = "pathao_pay"
        self.batch.save()
        for index, pair in enumerate(self.pairs):
            row = StatementRow.objects.get(pk=pair["statement"])
            row.counterparty_text = "Make Payment · Pathao Bike"
            row.save()
            candidate = ParsedMessageCandidate.objects.get(pk=pair["sms"])
            candidate.provider, candidate.message_kind = "pathao_pay", "purchase"
            candidate.counterparty_text = "Pathao Bike"
            candidate.source_transaction_id = f"synthetic-pathao-{index}"
            candidate.save()
            RawMessage.objects.filter(pk=candidate.raw_message_id).update(
                sender="PathaoPay"
            )
        value = self.preview()
        self.assertEqual(value["ready_count"], 25, value)
        result, queries = self.measure("approval-pathao", lambda: self.approve(value))
        self.assertEqual(result.status_code, 200, result.data)
        self.assertLessEqual(queries, 250)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="confirmed").count(), 25
        )
