from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import ParsedMessageCandidate, RawMessage, SenderRule

from .models import Transaction, TransferEvidence


class TransactionSourceMessagesTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="source-message-test")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(user=self.user, name="Demo bank A", type="bank")
        self.b = Account.objects.create(user=self.user, name="Demo bank B", type="bank")
        self.first = self.message("DEMO-A", "Synthetic transfer debit BDT 100.\nReference DEMO-OUT.", 2)
        self.second = self.message("DEMO-B", "Synthetic transfer credit BDT 100. Reference DEMO-IN.", 1)
        self.record = Transaction.objects.create(user=self.user, account=self.a, transfer_account=self.b, raw_message=self.first, date="2026-10-08", type="transfer", amount="100.00")
        for account, raw, direction in ((self.a, self.first, "debit"), (self.b, self.second, "credit")):
            TransferEvidence.objects.create(user=self.user, transaction=self.record, account=account, raw_message=raw, direction=direction, date=self.record.date, source="sms")

    def message(self, sender, body, minutes=0, user=None):
        return RawMessage.objects.create(user=user or self.user, sender=sender, body=body, body_hash=str(uuid4()), received_at=timezone.now() - timedelta(minutes=minutes))

    def get_messages(self, record=None):
        return self.client.get(reverse("transaction-source-messages", kwargs={"pk": (record or self.record).pk}))

    def test_original_and_linked_transfer_messages_are_full_text_deduplicated_and_read_only(self):
        stamp = self.record.updated_at
        response = self.get_messages()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["id"] for row in response.data], [str(self.first.pk), str(self.second.pk)])
        self.assertEqual(response.data[0]["body"], self.first.body)
        self.assertEqual(response.data[1]["body"], self.second.body)
        self.assertEqual(set(response.data[0]), {"id", "sender", "body", "received_at", "status", "redacted_at", "parsed"})
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.record.refresh_from_db()
        self.assertEqual(self.record.updated_at, stamp)
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        listing = self.client.get(reverse("transaction-list"))
        self.assertNotIn(self.first.body, str(listing.data))

    def test_primary_sms_is_available_without_transfer_evidence_and_manual_entries_are_empty(self):
        record = Transaction.objects.create(user=self.user, account=self.a, raw_message=self.first, date="2026-10-08", type="expense", amount="10.00")
        self.assertEqual(len(self.get_messages(record).data), 1)
        record.raw_message = None
        record.save()
        self.assertEqual(self.get_messages(record).data, [])

    def test_redacted_and_excluded_text_is_unavailable_without_losing_metadata(self):
        self.first.redact()
        self.second.exclusion_reason = "message_kind_excluded"
        self.second.save(update_fields=("exclusion_reason",))
        response = self.get_messages()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data[0]["body"])
        self.assertEqual(response.data[0]["status"], "redacted")
        self.assertIsNotNone(response.data[0]["redacted_at"])
        self.assertEqual(response.data[0]["sender"], "DEMO-A")
        self.assertIsNone(response.data[1]["body"])

    def test_other_users_transactions_and_missing_records_are_not_accessible(self):
        other = get_user_model().objects.create_user(username="other-source-message-test")
        self.client.force_authenticate(other)
        self.assertEqual(self.get_messages().status_code, 404)
        self.assertEqual(self.client.get(reverse("transaction-source-messages", kwargs={"pk": uuid4()})).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.get_messages().status_code, 401)

    def test_message_ownership_is_checked_even_if_a_link_has_inconsistent_ownership(self):
        other = get_user_model().objects.create_user(username="foreign-source-message-test")
        foreign = self.message("DEMO-OTHER", "Synthetic foreign message BDT 30.", user=other)
        self.record.raw_message = foreign
        self.record.save()
        self.first.user = other
        self.first.save(update_fields=("user",))
        self.assertEqual([row["id"] for row in self.get_messages().data], [str(self.second.pk)])

    def test_parsed_observation_requires_a_confirmed_candidate_for_this_owned_entry(self):
        candidate = ParsedMessageCandidate.objects.create(user=self.user, raw_message=self.first, account=self.a, amount="100.00", balance_after="500.00", transaction=self.record, status="needs_review")
        self.assertIsNone(self.get_messages().data[0]["parsed"])
        candidate.status = "confirmed"
        candidate.save()
        self.assertEqual(self.get_messages().data[0]["parsed"]["balance_after"], "500.00")
        self.assertEqual(self.get_messages().data[0]["parsed"]["candidate_id"], str(candidate.pk))
        self.assertFalse(self.get_messages().data[0]["parsed"]["can_remember_cash_route"])
        self.first.redact()
        self.assertEqual(self.get_messages().data[0]["parsed"]["amount"], "100.00")
        other = get_user_model().objects.create_user(username="foreign-parsed-owner")
        candidate.user = other
        candidate.save()
        self.assertIsNone(self.get_messages().data[0]["parsed"])

    def test_confirmed_cash_withdrawal_can_reopen_optional_learning_from_sources(self):
        self.b.type = Account.Type.HOME_CASH
        self.b.save(update_fields=["type"])
        self.first.body = "Cash WD BDT 100 from synthetic ATM. Balance BDT 500."
        self.first.save(update_fields=["body"])
        rule = SenderRule.objects.create(user=self.user, account=self.a, name="Demo SMS", sender="DEMO-A", provider="ebl")
        candidate = ParsedMessageCandidate.objects.create(
            user=self.user, raw_message=self.first, sender_rule=rule, account=self.a,
            amount="100.00", message_kind="cash_out", transaction_type="transfer",
            source_direction="debit", transaction=self.record, status="confirmed",
        )
        parsed = self.get_messages().data[0]["parsed"]
        self.assertEqual(parsed["candidate_id"], str(candidate.pk))
        self.assertTrue(parsed["can_remember_cash_route"])
        self.b.type = Account.Type.BANK
        self.b.save(update_fields=["type"])
        self.assertFalse(self.get_messages().data[0]["parsed"]["can_remember_cash_route"])

    def test_parsed_balance_metadata_identifies_the_reporting_account_without_writes(self):
        ParsedMessageCandidate.objects.create(user=self.user, raw_message=self.first, account=self.a,
            transaction=self.record, status="confirmed", transaction_type="transfer", message_kind="bank_transfer_in",
            destination_account=self.b, source_direction="credit", amount=100, balance_after=500)
        parsed = self.get_messages().data[0]["parsed"]
        self.assertEqual(parsed["account"], str(self.b.pk))
        self.assertEqual(parsed["currency"], "BDT")
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_foreign_reporting_account_is_never_exposed_as_balance_metadata(self):
        other = get_user_model().objects.create_user(username="foreign-report-account-owner")
        foreign = Account.objects.create(user=other, name="Foreign account", type="bank", currency="USD")
        ParsedMessageCandidate.objects.create(user=self.user, raw_message=self.first, account=foreign,
            transaction=self.record, status="confirmed", amount=100, balance_after=500)
        parsed = self.get_messages().data[0]["parsed"]
        self.assertIsNone(parsed["account"])
        self.assertIsNone(parsed["currency"])
