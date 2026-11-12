"""Synthetic bank purposes populate editable notes without copying raw evidence."""

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction

from .models import ParsedMessageCandidate, SenderRule
from .notes import bank_purpose


class PurposeExtractionTests(SimpleTestCase):
    def test_only_the_bounded_purpose_is_extracted(self):
        self.assertEqual(bank_purpose("AC ***1234 is debited with BDT 45 as Account Maintenance Service Charges on 02-JAN-26 09:12 AM Balance is BDT 955.00 Thanks."), "Account Maintenance Service Charges")
        for text in ["[redacted]", "Transfer successful. Charges 0.00", "as a helpful reminder", "is debited with BDT 45 as no dated boundary"]:
            self.assertEqual(bank_purpose(text), "")
        self.assertEqual(bank_purpose("is credited with BDT 20 as Refund 01234567890 on 02-JAN-26"), "Refund ***7890")
        self.assertEqual(bank_purpose("is debited with BDT 25 as Monthly\nAccount Fees on 02-JAN-26"), "Monthly Account Fees")
        self.assertEqual(bank_purpose("is debited with BDT 25 as " + "x" * 181 + " on 02-JAN-26"), "")


class PurposeNoteApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-purpose")
        self.account = Account.objects.create(user=self.user, name="Synthetic bank", type="bank")
        SenderRule.objects.create(user=self.user, account=self.account, name="Synthetic EBL", provider="ebl", sender="EBL")
        self.client.force_authenticate(self.user)

    def import_charge(self):
        response = self.client.post(reverse("raw-message-import"), {
            "sender": "EBL", "body": "AC ***1234 is debited with BDT 45 as Account Maintenance Service Charges on 02-JAN-26 09:12:00 AM Balance is BDT 955.00 Thanks.",
            "received_at": "2026-01-02T09:13:00+06:00", "device_message_id": "synthetic-purpose-1",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["candidate"]

    def test_plural_charges_are_fee_and_auto_note_survives_confirmation(self):
        candidate = self.import_charge()
        self.assertEqual(candidate["transaction_type"], "fee")
        self.assertEqual(candidate["source_direction"], "debit")
        self.assertEqual(candidate["counterparty_text"], "Account Maintenance Service Charges")
        self.assertEqual(candidate["suggested_note"], "Account Maintenance Service Charges")
        result = self.client.post(reverse("message-candidate-confirm", args=[candidate["id"]]), {}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        transaction = Transaction.objects.get(pk=result.data["transaction"])
        self.assertEqual(transaction.note, "Account Maintenance Service Charges")
        self.assertEqual(transaction.direction, "debit")
        self.assertNotIn("Balance", transaction.note)

    def test_manual_note_is_retained(self):
        candidate = self.import_charge()
        result = self.client.post(reverse("message-candidate-confirm", args=[candidate["id"]]), {"note": "My edited charge note"}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.get(pk=result.data["transaction"]).note, "My edited charge note")

    def test_informational_plural_charges_do_not_reclassify_a_transfer(self):
        response = self.client.post(reverse("raw-message-import"), {
            "sender": "EBL", "body": "AC ***1234 is debited with BDT 50 as Bank Transfer Out on 02-JAN-26 09:12:00 AM Balance is BDT 950.00 Charges BDT 0.00.",
            "received_at": "2026-01-02T09:13:00+06:00", "device_message_id": "synthetic-transfer-zero-charges",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["candidate"]["transaction_type"], "transfer")
        self.assertEqual(response.data["candidate"]["suggested_note"], "Bank Transfer Out")

    def test_older_pending_candidate_receives_hint_without_rewriting_saved_values(self):
        candidate = self.import_charge()
        saved = ParsedMessageCandidate.objects.get(pk=candidate["id"])
        saved.message_kind = "bank_transfer_out"
        saved.transaction_type = "transfer"
        saved.counterparty_text = ""
        saved.save()
        from .serializers import ParsedMessageCandidateSerializer

        self.assertEqual(ParsedMessageCandidateSerializer(saved).data["suggested_note"], "Account Maintenance Service Charges")
        saved.refresh_from_db()
        self.assertEqual(saved.transaction_type, "transfer")
        self.assertEqual(Transaction.objects.count(), 0)
        saved.raw_message.redact(reason="manual")
        self.assertEqual(ParsedMessageCandidateSerializer(saved).data["suggested_note"], "Bank transfer out")
