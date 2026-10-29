"""Synthetic bank/card reports must never be compared across transfer sides."""

from decimal import Decimal

from django.urls import reverse
from rest_framework.test import APITestCase

from apps.transactions.balance_reports import reported_values
from apps.transactions.models import Transaction
from apps.transactions.transfers import ensure_transfer_evidence

from . import test_unified as fixtures


class TransferReportAccountTests(APITestCase):
    candidate = fixtures.UnifiedReviewTests.candidate
    payload = fixtures.UnifiedReviewTests.payload
    confirm = fixtures.UnifiedReviewTests.confirm

    def setUp(self):
        fixtures.UnifiedReviewTests.setUp(self)
        self.wallet.type = "credit_card"
        self.wallet.save()
        self.row.type = "transfer"
        self.row.other_account = self.wallet
        self.row.save()
        self.sms.transaction_type = "transfer"
        self.sms.message_kind = "bank_transfer_out"
        self.sms.source_direction = "debit"
        self.sms.destination_account = self.wallet
        self.sms.balance_after = self.row.balance_after
        self.sms.save()
        self.card_sms = self.candidate(
            kind="bank_transfer_in", balance="250.00",
            source_direction="credit", suggested_transfer_direction="credit",
            destination_account=self.wallet, transaction_type="transfer",
        )
        self.record = Transaction.objects.create(
            user=self.user, account=self.account, transfer_account=self.wallet,
            amount="100.00", date=self.row.date, type="transfer", direction="debit",
            source="sms", raw_message=self.card_sms.raw_message, balance_after="250.00",
        )
        self.card_sms.transaction = self.record
        self.card_sms.status = "confirmed"
        self.card_sms.save()
        self.record.refresh_from_db()

    def preview_match(self):
        response = self.client.get(reverse("unified-pair"), {
            "statement": str(self.row.pk), "sms": str(self.sms.pk),
        })
        self.assertEqual(response.status_code, 200, response.data)
        return next(item for item in response.data["ledger_matches"] if item["id"] == str(self.record.pk))

    def test_read_only_preview_does_not_borrow_receiving_card_balance(self):
        match = self.preview_match()
        self.assertFalse(match["conflict"], match["reasons"])
        self.assertIsNone(match["effective_balance_after"])
        self.assertIsNone(match["ledger_source_balance_after"])
        self.assertTrue(match["can_fill_missing_balance"])
        self.assertTrue(match["reporting_observation_is_fallback"])
        self.assertEqual(reported_values(self.record), {self.wallet.pk: Decimal("250.00")})
        self.assertFalse(self.record.transfer_evidence.exists())

    def test_link_keeps_card_and_bank_balances_separate_without_conflict_ack(self):
        response = self.confirm(transaction=str(self.record.pk), acknowledge_conflict=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        self.assertEqual(reported_values(self.record), {
            self.wallet.pk: Decimal("250.00"), self.account.pk: Decimal("900.07"),
        })
        self.assertEqual(self.record.balance_after, Decimal("250.00"))
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(self.record.transfer_evidence.count(), 3)
        self.card_sms.refresh_from_db()
        self.assertEqual(self.card_sms.balance_after, Decimal("250.00"))

    def test_materialized_card_report_and_legacy_preview_agree(self):
        before = self.preview_match()
        ensure_transfer_evidence(self.record)
        self.record.refresh_from_db()
        after = self.preview_match()
        for key in ("conflict", "effective_balance_after", "can_fill_missing_balance"):
            self.assertEqual(before[key], after[key], key)
        self.assertEqual(self.record.transfer_evidence.get().account_id, self.wallet.pk)

    def test_transaction_details_and_note_edit_keep_the_legacy_card_balance_owner(self):
        url = reverse("transaction-detail", args=[self.record.pk])
        for response in (
            self.client.get(url),
            self.client.patch(url, {"note": "Synthetic reviewed note"}, format="json"),
        ):
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["balance_reporting_account"], str(self.wallet.pk))
            self.assertEqual(response.data["reported_balances"], [
                {"account": str(self.account.pk), "balance_after": None},
                {"account": str(self.wallet.pk), "balance_after": "250.00"},
            ])

    def test_prefetched_legacy_reports_do_not_fetch_accounts_per_balance_read(self):
        record = Transaction.objects.prefetch_related(
            "transfer_evidence", "parsed_message_candidates"
        ).get(pk=self.record.pk)
        with self.assertNumQueries(0):
            self.assertEqual(reported_values(record), {self.wallet.pk: Decimal("250.00")})

    def test_saved_credit_perspective_is_respected_even_with_generic_message_kind(self):
        self.card_sms.message_kind = "unknown"
        self.card_sms.save()
        self.assertFalse(self.preview_match()["conflict"])
        ensure_transfer_evidence(self.record)
        self.assertEqual(self.record.transfer_evidence.get().account_id, self.wallet.pk)

    def test_real_same_bank_balance_difference_still_requires_review(self):
        ensure_transfer_evidence(self.record)
        self.record.transfer_evidence.create(
            user=self.user, account=self.account, direction="debit",
            date=self.row.date, source="sms", balance_after="800.00",
        )
        match = self.preview_match()
        self.assertTrue(match["conflict"])
        self.assertTrue(any(self.account.name in reason for reason in match["reasons"] if "balances differ" in reason))
        response = self.confirm(transaction=str(self.record.pk), acknowledge_conflict=False)
        self.assertEqual(response.status_code, 400, response.data)
        self.row.refresh_from_db()
        self.assertIsNone(self.row.transaction_id)

    def test_unidentified_legacy_source_balance_stays_unassigned_until_review(self):
        self.card_sms.account = None
        self.card_sms.destination_account = None
        self.card_sms.message_kind = "unknown"
        self.card_sms.source_direction = ""
        self.card_sms.suggested_transfer_direction = ""
        self.card_sms.save()
        self.assertEqual(reported_values(self.record), {})
        match = self.preview_match()
        self.assertFalse(match["conflict"])
        self.assertFalse(match["can_fill_missing_balance"])
        response = self.confirm(transaction=str(self.record.pk), acknowledge_conflict=False)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(self.record.transfer_evidence.exists())
