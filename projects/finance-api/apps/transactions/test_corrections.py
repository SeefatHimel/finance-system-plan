from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import RawMessage
from apps.payment_methods.models import PaymentMethod

from .models import Transaction, TransferEvidence
from .services import calculate_account_balance_summaries


class TransactionCorrectionTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="correction-test")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(user=self.user, name="Demo A", type="bank", starting_balance="10000.00")
        self.b = Account.objects.create(user=self.user, name="Demo B", type="bank", starting_balance="2000.00")
        self.c = Account.objects.create(user=self.user, name="Demo C", type="bank", starting_balance="500.00")
        self.raws = [RawMessage.objects.create(user=self.user, sender=sender, body="Synthetic transfer BDT 1000.", body_hash=str(uuid4()), received_at=timezone.now()) for sender in ("DEMO-A", "DEMO-B")]
        self.record = Transaction.objects.create(user=self.user, account=self.a, transfer_account=self.b, raw_message=self.raws[0], date=timezone.localdate(), type="transfer", amount="1000.00", balance_after="9000.00", source="sms")
        for account, raw, direction, balance in ((self.a, self.raws[0], "debit", "9000.00"), (self.b, self.raws[1], "credit", "3000.00")):
            TransferEvidence.objects.create(user=self.user, transaction=self.record, account=account, raw_message=raw, direction=direction, date=self.record.date, balance_after=balance, fee_amount="5.00", source="sms")

    def patch(self, **payload):
        return self.client.patch(reverse("transaction-detail", kwargs={"pk": self.record.pk}), payload, format="json")

    def balances(self):
        return calculate_account_balance_summaries(accounts=[self.a, self.b, self.c])

    def test_primary_balance_metadata_tracks_original_sms_and_keeps_other_side_separate(self):
        self.record.balance_after = None
        self.record.save()
        response = self.client.get(reverse("transaction-detail", kwargs={"pk": self.record.pk}))
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["balance_after"])
        primary = [item for item in response.data["transfer_evidence"] if item["is_primary"]]
        self.assertEqual(len(primary), 1)
        self.assertEqual(str(primary[0]["account"]), str(self.a.pk))
        self.assertEqual(primary[0]["balance_after"], "9000.00")
        self.record.raw_message = self.raws[1]
        self.record.save()
        response = self.client.get(reverse("transaction-detail", kwargs={"pk": self.record.pk}))
        primary = [item for item in response.data["transfer_evidence"] if item["is_primary"]]
        self.assertEqual(len(primary), 1)
        self.assertEqual(str(primary[0]["account"]), str(self.b.pk))
        self.assertEqual(primary[0]["balance_after"], "3000.00")

    def test_primary_balance_metadata_uses_manual_entry_key_without_extra_queries(self):
        from .serializers import TransferEvidenceSerializer
        self.record.raw_message = None
        self.record.external_key = "demo-manual-primary"
        self.record.save()
        rows = list(self.record.transfer_evidence.order_by("created_at"))
        for item in rows:
            item.raw_message = None
            item.save()
        rows[1].external_key = self.record.external_key
        rows[1].save()
        record = Transaction.objects.prefetch_related("transfer_evidence").get(pk=self.record.pk)
        with self.assertNumQueries(0):
            data = TransferEvidenceSerializer(record.transfer_evidence.all(), many=True).data
        self.assertEqual([str(item["account"]) for item in data if item["is_primary"]], [str(self.b.pk)])

    def test_acknowledged_amount_correction_posts_once_preserves_sms_and_is_audited(self):
        created_at = self.record.created_at
        response = self.patch(amount="1250.00", allow_linked_correction=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("allow_linked_correction", response.data)
        balances = self.balances()
        self.assertEqual(balances[self.a.pk].ledger_balance, Decimal("8750.00"))
        self.assertEqual(balances[self.b.pk].ledger_balance, Decimal("3250.00"))
        self.assertEqual(Transaction.objects.count(), 1)
        self.record.refresh_from_db()
        self.assertEqual(self.record.created_at, created_at)
        self.assertEqual(self.record.transfer_evidence.count(), 2)
        self.assertEqual(list(RawMessage.objects.values_list("body", flat=True)), ["Synthetic transfer BDT 1000."] * 2)
        audit = AuditLogEntry.objects.get(action="updated")
        self.assertEqual(audit.before["amount"], "1000.00")
        self.assertEqual(audit.after["amount"], "1250.00")
        self.assertTrue(audit.metadata["linked_correction_acknowledged"])

    def test_account_correction_remaps_both_sides_and_clears_obsolete_reported_values(self):
        response = self.patch(account=str(self.b.pk), transfer_account=str(self.c.pk), balance_after="9000.00", allow_linked_correction=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["balance_after"])
        by_direction = {row["direction"]: row for row in response.data["transfer_evidence"]}
        self.assertEqual(str(by_direction["debit"]["account"]), str(self.b.pk))
        self.assertEqual(str(by_direction["credit"]["account"]), str(self.c.pk))
        for row in by_direction.values():
            self.assertIsNone(row["balance_after"])
            self.assertIsNone(row["fee_amount"])
        balances = self.balances()
        self.assertEqual(balances[self.a.pk].ledger_balance, Decimal("10000.00"))
        self.assertEqual(balances[self.b.pk].ledger_balance, Decimal("1000.00"))
        self.assertEqual(balances[self.c.pk].ledger_balance, Decimal("1500.00"))
        self.assertTrue(all(summary.latest_reported_balance is None for summary in balances.values()))
        self.assertEqual(len(AuditLogEntry.objects.get().before["transfer_evidence"]), 2)

    def test_reclassification_preserves_messages_without_using_historical_transfer_balances(self):
        response = self.patch(type="expense", transfer_account=None, balance_after="9000.00", allow_linked_correction=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["transfer_evidence"]), 2)
        balances = self.balances()
        self.assertEqual(balances[self.a.pk].ledger_balance, Decimal("9000.00"))
        self.assertEqual(balances[self.b.pk].ledger_balance, Decimal("2000.00"))
        self.assertIsNone(balances[self.b.pk].latest_reported_balance)
        sources = self.client.get(reverse("transaction-source-messages", kwargs={"pk": self.record.pk}))
        self.assertEqual(len(sources.data), 2)
        denied = self.patch(type="transfer", transfer_account=str(self.c.pk))
        self.assertEqual(denied.status_code, 400)
        restored = self.patch(type="transfer", transfer_account=str(self.c.pk), allow_linked_correction=True)
        self.assertEqual(restored.status_code, 200, restored.data)

    def test_receiving_sms_balance_is_cleared_when_only_destination_changes(self):
        self.record.raw_message = self.raws[1]
        self.record.balance_after = Decimal("3000.00")
        self.record.save()
        response = self.patch(transfer_account=str(self.c.pk), allow_linked_correction=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["balance_after"])
        balances = self.balances()
        self.assertEqual(balances[self.a.pk].latest_reported_balance, Decimal("9000.00"))
        self.assertIsNone(balances[self.b.pk].latest_reported_balance)
        self.assertIsNone(balances[self.c.pk].latest_reported_balance)

    def test_reclassified_receiving_message_does_not_clear_a_new_expense_balance_on_later_edits(self):
        self.record.raw_message = self.raws[1]
        self.record.balance_after = Decimal("3000.00")
        self.record.save()
        corrected = self.patch(
            type="expense", transfer_account=None, balance_after="8500.00",
            allow_linked_correction=True,
        )
        self.assertEqual(corrected.status_code, 200, corrected.data)
        response = self.patch(note="Checked synthetic expense")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["balance_after"], "8500.00")
        self.assertEqual(
            self.balances()[self.a.pk].latest_reported_balance, Decimal("8500.00")
        )

    def test_all_other_details_are_editable_and_identifiers_remain_masked(self):
        method = PaymentMethod.objects.create(user=self.user, account=self.a, name="Demo card", provider="card")
        response = self.patch(payment_method=str(method.pk), source="import", needs_review=True, sender_account_identifier="123456789012", sender_card_identifier="****1111", receiver_account_identifier="****2222", receiver_card_identifier="****3333", counterparty_text="Corrected demo", note="Corrected demo note", reference="DEMO-CORRECTED", time="14:25:00")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(str(response.data["payment_method"]), str(method.pk))
        self.assertEqual(response.data["source"], "import")
        self.assertTrue(response.data["needs_review"])
        self.assertEqual(response.data["sender_account_identifier"], "9012")
        self.assertEqual(response.data["receiver_card_identifier"], "****3333")
        self.assertEqual(AuditLogEntry.objects.get().before["source"], "sms")

    def test_acknowledgement_does_not_bypass_ownership_or_invalid_account_checks(self):
        other = get_user_model().objects.create_user(username="foreign-correction-test")
        foreign = Account.objects.create(user=other, name="Foreign demo", type="bank")
        for payload in ({"account": str(foreign.pk)}, {"account": str(self.a.pk), "transfer_account": str(self.a.pk)}):
            self.assertEqual(self.patch(**payload, allow_linked_correction=True).status_code, 400)
        wrong_method = PaymentMethod.objects.create(user=self.user, account=self.b, name="Wrong side card", provider="card")
        self.assertEqual(self.patch(payment_method=str(wrong_method.pk), allow_linked_correction=True).status_code, 400)
        self.record.refresh_from_db()
        self.assertEqual(self.record.account_id, self.a.pk)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_correcting_a_manual_transfers_primary_balance_does_not_overwrite_the_other_side(self):
        self.record.raw_message = None
        self.record.external_key = "synthetic-primary-key"
        self.record.save()
        primary, secondary = list(self.record.transfer_evidence.order_by("created_at"))
        primary.raw_message = None
        primary.external_key = self.record.external_key
        primary.save()
        secondary.raw_message = None
        secondary.save()
        response = self.patch(balance_after="8500.00", reference="DEMO-PRIMARY")
        self.assertEqual(response.status_code, 200, response.data)
        primary.refresh_from_db()
        secondary.refresh_from_db()
        self.assertEqual(primary.balance_after, Decimal("8500.00"))
        self.assertEqual(secondary.balance_after, Decimal("3000.00"))
        self.assertNotEqual(secondary.reference, "DEMO-PRIMARY")
