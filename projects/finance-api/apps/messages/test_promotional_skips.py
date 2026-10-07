from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, RawMessage, SenderRule, SmsCapturePreference
from apps.messages.parsers import classify_message_kind_for_capture
from apps.transactions.models import Transaction


class PromotionalSkipTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="promotion-test")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(user=self.user, name="Demo bank", type="bank")
        self.rule = SenderRule.objects.create(user=self.user, account=self.account, name="Demo SMS", sender="DEMO-BANK", provider="ebl")
        self.sequence = 0

    def imported(self, body):
        self.sequence += 1
        response = self.client.post(reverse("raw-message-import"), {
            "sender": "DEMO-BANK", "body": body, "received_at": "2026-10-08T12:00:00+06:00",
            "device_message_id": f"synthetic-promotion-{self.sequence}",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def allow_promotions(self):
        return SmsCapturePreference.objects.create(user=self.user, excluded_message_kinds=["otp_or_security"])

    def test_english_and_bangla_offers_with_numbers_are_excluded_before_body_storage(self):
        for body in (
            "Celebrate our 25th anniversary with special offers. Visit https://example.invalid/demo",
            "ডেমো ব্যাংকের ২৫তম বার্ষিকীতে বিশেষ অফার! বিস্তারিত https://example.invalid/demo",
            "Enjoy a BDT 200 discount offer this season.",
        ):
            result = self.imported(body)
            self.assertIsNone(result["candidate"])
            raw = RawMessage.objects.get(pk=result["message"]["id"])
            self.assertEqual(raw.message_kind, "promotional")
            self.assertEqual(raw.status, "ignored")
            self.assertEqual(raw.body, "[excluded before storage]")
        self.rule.refresh_from_db()
        self.assertTrue(self.rule.is_active)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_transaction_messages_with_offer_words_are_not_excluded(self):
        for body in (
            "Card ****1111 used for BDT 120 at OFFER STORE. Balance BDT 8000.",
            "BDT 120 credited as cashback for your anniversary offer. Balance BDT 8000.",
            "আপনার হিসাবে BDT 120 ক্রেডিট হয়েছে। অফার ক্যাশব্যাক।",
        ):
            self.assertIsNotNone(self.imported(body)["candidate"])
        self.assertEqual(classify_message_kind_for_capture("Available balance BDT 8000. Visit our offers page."), "balance_notice")

    def test_reject_can_remember_type_remove_matching_pending_and_preserve_transactions(self):
        preference = self.allow_promotions()
        first = self.imported("Anniversary offers: enjoy 20% savings.")["candidate"]
        pending = self.imported("Anniversary offers: enjoy 25% savings.")["candidate"]
        financial = self.imported("BDT 120 debited for a transfer. Balance BDT 8000.")["candidate"]
        response = self.client.post(reverse("message-candidate-reject", kwargs={"candidate_id": first["id"]}), {
            "reason": "not_transaction", "exclude_message_kind": True, "redact_raw_sms": True,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        preference.refresh_from_db()
        self.assertIn("promotional", preference.excluded_message_kinds)
        self.assertEqual(ParsedMessageCandidate.objects.get(pk=pending["id"]).status, "ignored")
        self.assertEqual(ParsedMessageCandidate.objects.get(pk=financial["id"]).status, "needs_review")
        self.assertIsNone(self.imported("Anniversary offers: enjoy 30% savings.")["candidate"])
        self.assertIsNotNone(self.imported("BDT 240 debited for a transfer. Balance BDT 7800.")["candidate"])
        self.rule.refresh_from_db()
        self.assertTrue(self.rule.is_active)
        response = self.client.patch(reverse("sms-capture-preferences"), {"excluded_message_kinds": ["otp_or_security"]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(self.imported("Anniversary offers: enjoy 35% savings.")["candidate"])

    def test_financial_or_unknown_types_cannot_be_learned_as_skip_types(self):
        for body in ("BDT 120 debited for a transfer.", "Account update 25 is ready."):
            item = self.imported(body)["candidate"]
            response = self.client.post(reverse("message-candidate-reject", kwargs={"candidate_id": item["id"]}), {
                "reason": "not_transaction", "exclude_message_kind": True,
            }, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(ParsedMessageCandidate.objects.get(pk=item["id"]).status, "needs_review")

    def test_reprocess_discards_legacy_unknown_promotions_without_changing_confirmed_records(self):
        body = "ডেমো ব্যাংকের ৩০তম বার্ষিকীতে বিশেষ অফার!"
        raw = RawMessage.objects.create(user=self.user, sender="DEMO-BANK", body=body, received_at=timezone.now(), body_hash="synthetic-legacy-promotion")
        candidate = ParsedMessageCandidate.objects.create(user=self.user, raw_message=raw, sender_rule=self.rule, account=self.account, provider="ebl", message_kind="unknown", transaction_type="expense")
        response = self.client.post(reverse("message-candidate-reprocess", kwargs={"candidate_id": candidate.pk}))
        self.assertEqual(response.status_code, 200, response.data)
        candidate.refresh_from_db()
        raw.refresh_from_db()
        self.assertEqual(candidate.status, "ignored")
        self.assertEqual(candidate.message_kind, "promotional")
        self.assertEqual(raw.body, "[excluded before storage]")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_promotional_metadata_can_be_skipped_after_raw_body_redaction(self):
        self.allow_promotions()
        first = self.imported("20th anniversary offers today.")["candidate"]
        data = self.imported("25th anniversary offers today.")["candidate"]
        candidate = ParsedMessageCandidate.objects.get(pk=data["id"])
        candidate.raw_message.redact()
        response = self.client.post(reverse("message-candidate-reject", kwargs={"candidate_id": first["id"]}), {
            "reason": "not_transaction", "exclude_message_kind": True,
        }, format="json")
        self.assertEqual(response.status_code, 200)
        candidate.refresh_from_db()
        self.assertEqual(candidate.status, "ignored")
