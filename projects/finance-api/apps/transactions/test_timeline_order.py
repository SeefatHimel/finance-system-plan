from datetime import time
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from .models import Transaction
from .timeline_order import balance_order

class TimelineOrderTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="order-owner")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(user=self.user, name="Example bank", type="bank")
        self.first = self.row(100, 900, time(10))
        self.middle = self.row(50, 850, None)
        self.last = self.row(200, 1050, time(12), "credit")
        self.url = f"/api/timeline-order/{self.account.pk}/2026-06-01/"
    def row(self, amount, balance, at, direction="debit"):
        return Transaction.objects.create(user=self.user, account=self.account, date="2026-06-01", time=at, amount=amount, balance_after=balance, type="income" if direction == "credit" else "expense", direction=direction)
    def preview(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data
    def apply(self, preview, action="apply", ids=None):
        return self.client.post(self.url, {"fingerprint": preview["fingerprint"], "revision": preview["revision"], "action": action, "ordered_ids": ids if ids is not None else preview["suggested_ids"]}, format="json")
    def test_unique_chain_apply_clear_undo_preserves_times_and_money(self):
        original = list(Transaction.objects.values("id", "date", "time", "amount", "balance_after"))
        preview = self.preview()
        expected = [str(row.pk) for row in [self.first, self.middle, self.last]]
        self.assertEqual(preview["suggested_ids"], expected)
        result = self.apply(preview)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["basis"], "balance")
        clear = self.apply(result.data, "clear")
        self.assertEqual(clear.status_code, 200)
        undo = self.apply(clear.data, "undo")
        self.assertEqual(undo.status_code, 200)
        self.assertEqual(undo.data["ordered_ids"], expected)
        self.assertEqual(original, list(Transaction.objects.values("id", "date", "time", "amount", "balance_after")))
    def test_stale_revision_and_activity_changes_cannot_apply(self):
        preview = self.preview()
        self.assertEqual(self.apply(preview).status_code, 200)
        self.assertEqual(self.apply(preview).status_code, 400)
        Transaction.objects.filter(pk=self.middle.pk).update(amount=51)
        self.assertEqual(self.preview()["saved_status"], "stale")
        rows = self.client.get("/api/timeline-order/?start_date=2026-06-01&end_date=2026-06-01").data["results"]
        self.assertEqual(rows[0]["status"], "stale")
        self.assertEqual(rows[0]["ordered_ids"], [])
    def test_manual_placement_preserves_known_anchor_order_and_complete_set(self):
        preview = self.preview()
        ids = [str(self.last.pk), str(self.middle.pk), str(self.first.pk)]
        self.assertEqual(self.apply(preview, ids=ids).status_code, 400)
        self.assertEqual(self.apply(preview, ids=ids[:2]).status_code, 400)
        ids = [str(self.middle.pk), str(self.first.pk), str(self.last.pk)]
        result = self.apply(preview, ids=ids)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["basis"], "manual")
    def test_missing_balance_and_contradictory_times_decline_suggestion(self):
        self.middle.balance_after = None
        self.middle.save()
        self.assertIsNone(self.preview()["suggested_ids"])
        self.middle.balance_after = 850
        self.middle.save()
        self.first.time = time(13)
        self.first.save()
        self.assertIsNone(self.preview()["suggested_ids"])
    def test_ambiguous_balances_card_and_large_days_decline_suggestion(self):
        rows = [{"id": "a", "time": None, "amount": "100", "direction": "debit", "balance_after": "900", "posting_context": False, "context_changed": False}, {"id": "b", "time": None, "amount": "100", "direction": "credit", "balance_after": "1000", "posting_context": False, "context_changed": False}]
        self.assertIsNone(balance_order(rows, "bank")[0])
        self.assertIsNone(balance_order(rows, "credit_card")[0])
        self.assertIsNone(balance_order(rows * 50, "bank")[0])
        rows[0]["posting_context"] = True
        self.assertIsNone(balance_order(rows, "bank")[0])
    def test_owner_isolation_and_date_validation(self):
        other = get_user_model().objects.create_user(username="foreign-order")
        account = Account.objects.create(user=other, name="Other", type="cash")
        self.assertEqual(self.client.get(f"/api/timeline-order/{account.pk}/2026-06-01/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/timeline-order/{self.account.pk}/bad-date/").status_code, 400)
        self.assertEqual(self.client.get("/api/timeline-order/?start_date=2026-06-01&end_date=2025-06-01").status_code, 400)

    def test_changed_transfer_observation_invalidates_manual_placement(self):
        from .models import TransferEvidence
        other = Account.objects.create(user=self.user, name="Other own account", type="cash")
        movement = Transaction.objects.create(user=self.user, account=self.account, transfer_account=other, date="2026-06-01", type="transfer", direction="debit", amount=100)
        observation = TransferEvidence.objects.create(user=self.user, transaction=movement, account=self.account, direction="debit", date="2026-06-01", balance_after=750)
        preview = self.preview()
        saved = self.apply(preview, ids=preview["ordered_ids"])
        self.assertEqual(saved.status_code, 200, saved.data)
        observation.note = "Reviewed source context changed"
        observation.save()
        self.assertEqual(self.preview()["saved_status"], "stale")
