"""Synthetic sub-taka SMS/PDF reconciliation uses higher exact source values."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from apps.transactions.models import Transaction

from . import test_unified as fixtures
from .link_validation import accepted_link_issues
from .pending_sms import pending_sms_match_counts, pending_sms_matches
from .unified import pair_signals, unique_pending_pairs_for_rows


class SourceRoundingTests(APITestCase):
    setUp = fixtures.UnifiedReviewTests.setUp
    candidate = fixtures.UnifiedReviewTests.candidate
    payload = fixtures.UnifiedReviewTests.payload
    confirm = fixtures.UnifiedReviewTests.confirm
    incoming_pair_and_existing_transfer = (
        fixtures.UnifiedReviewTests.incoming_pair_and_existing_transfer
    )

    def assert_pair_uses_higher(self, sms_amount, expected):
        self.sms.amount = Decimal(sms_amount)
        self.sms.save()
        original = self.row.extracted.copy()
        self.assertIsNotNone(pair_signals(self.row, self.sms))
        for filters in ({}, {"source": "sms"}, {"source": "statement"}):
            queue = self.client.get(reverse("unified-pending"), filters)
            self.assertEqual(queue.status_code, 200, queue.data)
            self.assertEqual(queue.data["count"], 1)
        self.assertEqual(pending_sms_match_counts([self.row])[self.row.pk], 1)
        self.assertEqual(len(pending_sms_matches(self.row)), 1)
        self.assertEqual(
            unique_pending_pairs_for_rows([self.row])[self.row.pk], str(self.sms.pk)
        )
        response = self.confirm(
            acknowledge_conflict=False, acknowledge_issues=False, balance_source="sms"
        )
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(record.amount, Decimal(expected))
        self.assertEqual(record.balance_after, Decimal("900.07"))
        self.assertEqual(self.row.amount, Decimal("100.00"))
        self.assertEqual(self.sms.amount, Decimal(sms_amount))
        self.assertEqual(self.row.extracted, original)
        self.assertEqual(accepted_link_issues(self.row), [])
        self.assertEqual(self.confirm(acknowledge_conflict=False).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_sms_higher_uses_same_pair_in_every_discovery_route(self):
        self.assert_pair_uses_higher("100.37", "100.37")

    def test_statement_higher_preserves_lower_original_sms(self):
        self.assert_pair_uses_higher("99.63", "100.00")

    def test_exact_one_taka_other_currency_and_contradictory_balance_do_not_match(self):
        self.sms.amount = Decimal("101.00")
        self.sms.save()
        self.assertIsNone(pair_signals(self.row, self.sms))
        self.sms.amount = Decimal("100.99")
        self.sms.balance_after = Decimal("899.07")
        self.sms.save()
        self.assertIsNone(pair_signals(self.row, self.sms))
        self.sms.balance_after = self.row.balance_after
        self.sms.save()
        self.account.currency = self.batch.currency = "USD"
        self.account.save()
        self.batch.save()
        self.sms.refresh_from_db()
        self.row.refresh_from_db()
        self.assertIsNone(pair_signals(self.row, self.sms))

    def test_nearby_competing_sms_keeps_queue_ambiguous(self):
        self.candidate(amount="100.37")
        response = self.client.get(reverse("unified-pending"))
        # The queue now exposes both contested options for explicit review.
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["overview"]["ambiguous"], 3)
        self.assertEqual(
            unique_pending_pairs_for_rows([self.row])[self.row.pk], "ambiguous"
        )
        self.assertEqual(self.confirm().status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_legacy_combine_route_has_same_higher_policy_and_no_extra_balance_choice(
        self,
    ):
        self.sms.amount = Decimal("100.37")
        self.sms.save()
        response = self.client.post(
            reverse("statement-row-decide", args=[self.row.pk]),
            {
                "action": "combine_sms",
                "candidate": str(self.sms.pk),
                "version": self.row.version,
                "acknowledge_issues": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.assertEqual(record.amount, Decimal("100.37"))
        self.assertEqual(record.balance_after, Decimal("900.07"))

    def test_legacy_combine_preserves_sms_time_when_posting_dates_differ(self):
        self.sms.amount = Decimal("100.37")
        self.sms.save()
        raw = self.sms.raw_message
        raw.received_at += timedelta(days=3)
        raw.save()
        response = self.client.post(
            reverse("statement-row-decide", args=[self.row.pk]),
            {
                "action": "combine_sms",
                "candidate": str(self.sms.pk),
                "version": self.row.version,
                "acknowledge_issues": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.assertEqual(record.amount, Decimal("100.37"))
        self.assertEqual(record.date, self.row.date + timedelta(days=3))

    def test_legacy_combine_near_amount_uses_merchant_when_balances_are_absent(self):
        self.row.balance_after = None
        self.row.save()
        self.sms.amount = Decimal("100.37")
        self.sms.balance_after = None
        self.sms.save()
        raw = self.sms.raw_message
        raw.received_at += timedelta(hours=4)
        raw.save()
        response = self.client.post(
            reverse("statement-row-decide", args=[self.row.pk]),
            {
                "action": "combine_sms",
                "candidate": str(self.sms.pk),
                "version": self.row.version,
                "acknowledge_issues": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.get().amount, Decimal("100.37"))

    def test_missing_receiving_report_selects_higher_without_touching_sender(self):
        from apps.transactions.balance_reports import reported_values

        record = self.incoming_pair_and_existing_transfer()
        self.sms.amount = Decimal("100.37")
        self.sms.save()
        self.row.balance_after = Decimal("450.14")
        self.row.save()
        response = self.confirm(
            transaction=str(record.pk),
            balance_source="existing",
            acknowledge_conflict=False,
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("100.37"))
        self.assertEqual(record.balance_after, Decimal("1200.00"))
        self.assertEqual(reported_values(record)[self.account.pk], Decimal("450.14"))

    def test_three_source_span_cannot_chain_two_sub_taka_differences(self):
        self.sms.amount = Decimal("99.40")
        self.sms.save()
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            direction="debit",
            amount="100.60",
            date=self.row.date,
            balance_after=self.row.balance_after,
        )
        response = self.confirm(transaction=str(record.pk), balance_source="existing")
        self.assertEqual(response.status_code, 400, response.data)
        record.refresh_from_db()
        self.row.refresh_from_db()
        self.assertEqual(record.amount, Decimal("100.60"))
        self.assertIsNone(self.row.transaction_id)

    def test_a_known_separate_fee_is_not_mistaken_for_amount_rounding(self):
        from .models import StatementRow

        self.sms.amount = Decimal("100.37")
        self.sms.save()
        StatementRow.objects.create(
            batch=self.batch,
            position=self.row.position,
            component="fee",
            source_fingerprint="synthetic-fee",
            amount="0.37",
            date=self.row.date,
            direction="debit",
            type="fee",
            extracted=self.row.extracted,
        )
        self.assertIsNone(pair_signals(self.row, self.sms))
        self.assertEqual(self.confirm().status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locks")
class SourceRoundingConcurrencyTests(TransactionTestCase):
    client_class = APIClient
    setUp = fixtures.UnifiedReviewTests.setUp
    candidate = fixtures.UnifiedReviewTests.candidate
    payload = fixtures.UnifiedReviewTests.payload

    def test_simultaneous_pair_submissions_keep_one_higher_value_transaction(self):
        self.sms.amount = Decimal("100.37")
        self.sms.save()
        payload = self.payload(acknowledge_conflict=False, acknowledge_issues=False)
        start = Barrier(2)

        def submit(_):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=self.user.pk))
                start.wait(timeout=10)
                return client.post(
                    reverse("unified-pair"), payload, format="json"
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(list(executor.map(submit, range(2))), [200, 200])
        record = Transaction.objects.get()
        self.assertEqual(record.amount, Decimal("100.37"))
        self.assertEqual(record.balance_after, Decimal("900.07"))
