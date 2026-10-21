"""Synthetic EBL posting delays keep source balances in their own timelines."""

from datetime import date, time
from decimal import Decimal

from django.urls import reverse
from rest_framework.test import APITestCase

from apps.messages.models import ParsedMessageCandidate
from apps.transactions.models import Transaction
from apps.transactions.services import calculate_account_balance_summaries

from .services import delayed_ebl_posting
from . import test_unified as unified_fixtures


class DelayedEblPostingTests(APITestCase):
    setUp = unified_fixtures.UnifiedReviewTests.setUp
    candidate = unified_fixtures.UnifiedReviewTests.candidate
    payload = unified_fixtures.UnifiedReviewTests.payload
    confirm = unified_fixtures.UnifiedReviewTests.confirm

    def make_late(self):
        self.batch.profile = "ebl_bank"
        self.batch.save(update_fields=("profile", "updated_at"))
        self.row.date = date(2026, 1, 7)
        self.row.time = time(10, 0)
        self.row.value_date = date(2026, 1, 2)
        self.row.balance_after = Decimal("830.00")
        self.row.save(update_fields=("date", "time", "value_date", "balance_after", "updated_at"))
        self.row.refresh_from_db()

    def test_late_posting_requires_ebl_and_value_date(self):
        self.assertFalse(delayed_ebl_posting(self.row, date(2026, 1, 2)))
        self.make_late()
        self.assertTrue(delayed_ebl_posting(self.row, date(2026, 1, 2)))
        self.assertFalse(delayed_ebl_posting(self.row, date(2026, 1, 2), "import"))
        self.assertFalse(delayed_ebl_posting(self.row, date(2026, 1, 5)))

    def test_pending_pair_uses_sms_balance_and_retains_posting_report(self):
        self.make_late()
        response = self.client.get(reverse("statement-row-detail", args=[self.row.id]))
        self.assertEqual(response.status_code, 200, response.data)
        pending = response.data["review"]["pending_sms_matches"]
        self.assertEqual(len(pending), 1)
        self.assertTrue(pending[0]["late_posting"])
        refused = self.client.post(reverse("statement-row-decide", args=[self.row.id]), {
            "action": "combine_sms", "version": self.row.version,
            "candidate": str(self.sms.id),
            "balance_choice": {"keep": "statement", "existing_balance_after": "900.00", "statement_balance_after": "830.00"},
        }, format="json")
        self.assertEqual(refused.status_code, 400, refused.data)
        result = self.client.post(reverse("statement-row-decide", args=[self.row.id]), {
            "action": "combine_sms", "version": self.row.version,
            "candidate": str(self.sms.id),
            "acknowledge_issues": True,
        }, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        record = self.row.transaction
        self.assertEqual(record.balance_after, Decimal("900.00"))
        self.assertEqual(self.row.balance_after, Decimal("830.00"))
        self.assertEqual(self.sms.balance_after, Decimal("900.00"))
        self.assertEqual(self.sms.transaction_id, record.pk)
        self.assertEqual(Transaction.objects.count(), 1)
        current = calculate_account_balance_summaries(accounts=[self.account])[self.account.pk]
        self.assertEqual(current.latest_reported_balance, Decimal("830.00"))
        self.assertEqual(current.latest_reported_balance_date, date(2026, 1, 7))
        self.assertEqual(current.reported_balance_comparison, "timing_unknown")
        earlier = calculate_account_balance_summaries(accounts=[self.account], as_of_date=date(2026, 1, 3))[self.account.pk]
        self.assertEqual(earlier.latest_reported_balance, Decimal("900.00"))

    def test_unified_pair_does_not_choose_higher_posting_balance(self):
        self.make_late()
        self.row.balance_after = Decimal("990.00")
        self.row.save(update_fields=("balance_after", "updated_at"))
        pair = self.client.get(reverse("unified-pair"), {
            "statement": str(self.row.id), "sms": str(self.sms.id),
        })
        self.assertEqual(pair.status_code, 200, pair.data)
        self.assertTrue(pair.data["match"]["late_posting"])
        rejected = self.confirm(balance_source="statement")
        self.assertEqual(rejected.status_code, 400, rejected.data)
        result = self.confirm(balance_source="sms")
        self.assertEqual(result.status_code, 200, result.data)
        self.row.refresh_from_db()
        self.assertEqual(self.row.transaction.balance_after, Decimal("900.00"))

    def test_missing_sms_balance_is_not_replaced_with_later_posting_balance(self):
        self.make_late()
        self.sms.balance_after = None
        self.sms.save(update_fields=("balance_after", "updated_at"))
        result = self.client.post(reverse("statement-row-decide", args=[self.row.id]), {
            "action": "combine_sms", "version": self.row.version,
            "candidate": str(self.sms.id), "acknowledge_issues": True,
        }, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.row.refresh_from_db()
        self.assertIsNone(self.row.transaction.balance_after)
        self.assertEqual(self.row.balance_after, Decimal("830.00"))

    def test_existing_sms_link_keeps_earlier_balance(self):
        self.make_late()
        record = Transaction.objects.create(
            user=self.user, account=self.account, type="expense", direction="debit",
            amount="100.00", date=date(2026, 1, 2), time=time(17, 54),
            balance_after="900.00", counterparty_text="Synthetic Cafe",
            note="Synthetic Cafe", source="sms", raw_message=self.sms.raw_message,
        )
        self.sms.status = ParsedMessageCandidate.Status.CONFIRMED
        self.sms.transaction = record
        self.sms.save(update_fields=("status", "transaction", "updated_at"))
        detail = self.client.get(reverse("statement-row-detail", args=[self.row.id]))
        self.assertEqual(detail.status_code, 200, detail.data)
        match = next(item for item in detail.data["review"]["matches"] if item["id"] == str(record.id))
        self.assertTrue(match["late_posting"])
        self.assertFalse(match["conflict"])
        rejected = self.client.post(reverse("statement-row-decide", args=[self.row.id]), {
            "action": "link", "version": self.row.version, "transaction": str(record.id),
            "balance_choice": {"keep": "statement", "existing_balance_after": "900.00", "statement_balance_after": "830.00"},
        }, format="json")
        self.assertEqual(rejected.status_code, 400, rejected.data)
        result = self.client.post(reverse("statement-row-decide", args=[self.row.id]), {
            "action": "link", "version": self.row.version, "transaction": str(record.id),
            "acknowledge_issues": True,
        }, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        record.refresh_from_db()
        self.row.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("900.00"))
        self.assertEqual(self.row.balance_after, Decimal("830.00"))
        self.assertEqual(self.row.transaction_id, record.pk)
