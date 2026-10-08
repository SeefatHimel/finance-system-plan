"""Reported balances belong to accounts, independently of ledger classification."""
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, RawMessage
from .models import Transaction, TransferEvidence
from .services import calculate_account_balance_summaries


class ReportedBalanceUpdateTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="demo-balance-updates")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(user=self.user, name="Demo A", type="bank", starting_balance="10000.00")
        self.b = Account.objects.create(user=self.user, name="Demo B", type="bank")
        self.c = Account.objects.create(user=self.user, name="Demo C", type="bank")
        self.record = Transaction.objects.create(user=self.user, account=self.a, type="expense", date=timezone.localdate(), amount="20.00", balance_after="1000.00")

    def patch(self, **payload):
        response = self.client.patch(reverse("transaction-detail", kwargs={"pk": self.record.pk}), payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def transfer(self, incoming=False, missing_root=False):
        self.record.type = "transfer"
        self.record.transfer_account = self.b
        self.record.external_key = "demo-primary"
        self.record.balance_after = None if missing_root else Decimal("1000.00")
        self.record.save()
        for account, direction in ((self.a, "debit"), (self.b, "credit")):
            primary = (direction == "credit") == incoming
            TransferEvidence.objects.create(user=self.user, transaction=self.record, account=account, direction=direction, date=self.record.date, balance_after="1000.00" if primary else "2000.00", external_key="demo-primary" if primary else "demo-secondary")

    def test_type_update_preserves_omitted_unchanged_zero_and_new_balance(self):
        for starting, payload, expected in (
            ("1000.00", {}, "1000.00"),
            ("1000.00", {"balance_after": "1000.00"}, "1000.00"),
            ("0.00", {}, "0.00"),
            ("1000.00", {"balance_after": "900.00"}, "900.00"),
            ("1000.00", {"balance_after": None}, None),
        ):
            with self.subTest(payload=payload, starting=starting):
                self.record.type, self.record.balance_after = "expense", Decimal(starting)
                self.record.save()
                self.assertEqual(self.patch(type="income", **payload)["balance_after"], expected)
                summary = calculate_account_balance_summaries(accounts=[self.a])[self.a.pk]
                self.assertEqual(summary.ledger_balance, Decimal("10020.00"))
                self.assertEqual(summary.latest_reported_balance, Decimal(expected) if expected is not None else None)

    def test_detail_and_amount_updates_preserve_the_report(self):
        self.assertEqual(self.patch(note="Demo correction", reference="DEMO", amount="30.00", date="2026-10-07")["balance_after"], "1000.00")

    def test_account_remap_clears_omitted_or_carried_balance_but_accepts_new_value(self):
        for payload, expected in (({}, None), ({"balance_after": "1000.00"}, None), ({"balance_after": "900.00"}, "900.00")):
            with self.subTest(payload=payload):
                self.record.account, self.record.balance_after = self.a, Decimal("1000.00")
                self.record.save()
                self.assertEqual(self.patch(account=str(self.b.pk), **payload)["balance_after"], expected)

    def test_outgoing_reclassification_keeps_primary_fallback_and_historical_secondary_unused(self):
        self.transfer(missing_root=True)
        data = self.patch(type="fee", transfer_account=None, allow_linked_correction=True)
        self.assertEqual(data["balance_after"], "1000.00")
        summary = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(summary[self.a.pk].latest_reported_balance, Decimal("1000.00"))
        self.assertIsNone(summary[self.b.pk].latest_reported_balance)
        self.assertEqual(len(data["transfer_evidence"]), 2)

    def test_receiving_reclassification_preserves_only_when_receiving_account_is_selected(self):
        self.transfer(incoming=True)
        data = self.patch(type="income", account=str(self.b.pk), transfer_account=None, allow_linked_correction=True)
        self.assertEqual(data["balance_after"], "1000.00")

    def test_receiving_reclassification_to_source_clears_carried_primary_fallback(self):
        self.transfer(incoming=True, missing_root=True)
        data = self.patch(type="expense", transfer_account=None, balance_after="1000.00", allow_linked_correction=True)
        self.assertIsNone(data["balance_after"])

    def test_changing_non_reporting_transfer_side_preserves_primary_and_clears_remapped_side(self):
        for incoming in (False, True):
            with self.subTest(incoming=incoming):
                self.record.transfer_evidence.all().delete()
                self.record.account = self.a
                self.transfer(incoming=incoming)
                payload = {"account": str(self.c.pk)} if incoming else {"transfer_account": str(self.c.pk)}
                data = self.patch(**payload, allow_linked_correction=True)
                self.assertEqual(data["balance_after"], "1000.00")
                self.assertEqual(next(item for item in data["transfer_evidence"] if item["is_primary"])["balance_after"], "1000.00")
                self.assertIsNone(next(item for item in data["transfer_evidence"] if not item["is_primary"])["balance_after"])

    def test_explicit_clear_is_not_restored_by_later_type_update(self):
        self.transfer(missing_root=True)
        self.assertIsNone(self.patch(balance_after=None)["balance_after"])
        self.assertIsNone(self.patch(type="fee", transfer_account=None, allow_linked_correction=True)["balance_after"])


class ReportedBalanceConfirmationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="demo-balance-confirm")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(user=self.user, name="Demo A", type="bank")
        self.b = Account.objects.create(user=self.user, name="Demo B", type="bank")
        self.c = Account.objects.create(user=self.user, name="Demo C", type="bank")

    def candidate(self, incoming=False, balance="1000.00"):
        raw = RawMessage.objects.create(user=self.user, sender="DEMO", body="Synthetic balance report", body_hash=str(uuid4()), received_at=timezone.now())
        return ParsedMessageCandidate.objects.create(user=self.user, raw_message=raw, account=self.a, destination_account=self.b if incoming else None, amount="20.00", transaction_type="transfer" if incoming else "expense", message_kind="bank_transfer_in" if incoming else "card_purchase", balance_after=balance)

    def confirm(self, candidate, **payload):
        response = self.client.post(reverse("message-candidate-confirm", kwargs={"candidate_id": candidate.pk}), {"type": "fee", "transfer_account": None, **payload}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return Transaction.objects.get(pk=response.data["transaction"])

    def test_same_account_type_correction_preserves_parser_balance_and_zero(self):
        for balance in ("1000.00", "0.00"):
            for explicit in (False, True):
                with self.subTest(balance=balance, explicit=explicit):
                    candidate = self.candidate(balance=balance)
                    record = self.confirm(candidate, **({"balance_after": balance} if explicit else {}))
                    self.assertEqual(record.balance_after, Decimal(balance))
                    self.assertEqual(record.raw_message_id, candidate.raw_message_id)

    def test_different_reporting_account_clears_parser_default_and_carried_value(self):
        for incoming in (False, True):
            for explicit in (False, True):
                with self.subTest(incoming=incoming, explicit=explicit):
                    record = self.confirm(self.candidate(incoming=incoming), account=str(self.c.pk), **({"balance_after": "1000.00"} if explicit else {}))
                    self.assertIsNone(record.balance_after)

    def test_incoming_reclassification_preserves_selected_receiving_accounts_report(self):
        record = self.confirm(self.candidate(incoming=True), account=str(self.b.pk), type="income", account_perspective=True)
        self.assertEqual(record.balance_after, Decimal("1000.00"))

    def test_explicit_clear_and_replacement_are_respected(self):
        self.assertIsNone(self.confirm(self.candidate(), balance_after=None).balance_after)
        self.assertEqual(self.confirm(self.candidate(), account=str(self.c.pk), balance_after="900.00").balance_after, Decimal("900.00"))

    def test_transfer_confirm_remaps_only_reporting_side_balance(self):
        for selected, expected in ((self.b, Decimal("1000.00")), (self.c, None)):
            candidate = self.candidate(incoming=True)
            record = self.confirm(candidate, type="transfer", account_perspective=True, account=str(selected.pk), transfer_account=str(self.a.pk), direction="credit")
            self.assertEqual(record.balance_after, expected)
            self.assertEqual(record.transfer_evidence.get().balance_after, expected)
