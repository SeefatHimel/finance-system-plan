from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, RawMessage, SenderRule, TransferCounterpartyMapping
from apps.messages.parsers import parse_raw_message
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction


class TransferSuggestionTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="suggestion-test")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(user=self.user, name="Demo bank", type="bank")
        self.wallet = Account.objects.create(user=self.user, name="Pathao Pay", type="mobile_wallet")
        self.rule = SenderRule.objects.create(user=self.user, account=self.bank, name="Demo bank SMS", sender="DEMO-EBL", provider="ebl")
        self.sequence = 0

    def body(self, counterparty="PathaoPay DHAKA BD", wording="Fund Transfer", amount=120):
        return f"{wording} of BDT {amount} to {counterparty}. Balance BDT 8000."

    def raw(self, body=None):
        return RawMessage(user=self.user, sender="DEMO-EBL", body=body or self.body(), received_at=timezone.now())

    def imported(self, body=None):
        self.sequence += 1
        response = self.client.post(reverse("raw-message-import"), {
            "sender": "DEMO-EBL", "body": body or self.body(amount=self.sequence * 120),
            "received_at": "2026-01-15T12:00:00+06:00", "device_message_id": f"synthetic-suggestion-{self.sequence}",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return ParsedMessageCandidate.objects.get(pk=response.data["candidate"]["id"])

    def confirm(self, candidate, other=None, direction="debit", remember=True):
        response = self.client.post(reverse("message-candidate-confirm", kwargs={"candidate_id": candidate.pk}), {
            "account": str(self.bank.pk), "transfer_account": str((other or self.wallet).pk),
            "type": "transfer", "direction": direction, "account_perspective": True, "remember_mapping": remember,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return Transaction.objects.get(pk=response.data["transaction"])

    def test_name_alias_suggests_account_without_payment_method(self):
        for name in ("Pathao Pay", "Pathao", "Pathao wallet"):
            self.wallet.name = name
            self.wallet.save()
            parsed = parse_raw_message(self.raw())
            self.assertEqual(parsed["destination_account"], self.wallet)
            self.assertEqual(parsed["suggested_transfer_direction"], "debit")
            self.assertIn("name or provider alias", parsed["transfer_suggestion_reason"])
        self.assertEqual(Transaction.objects.count(), 0)

    def test_payment_method_name_can_suggest_plainly_named_account(self):
        self.wallet.name = "Demo wallet"
        self.wallet.save()
        PaymentMethod.objects.create(user=self.user, account=self.wallet, name="Pathao Pay wallet", provider="manual")
        parsed = parse_raw_message(self.raw())
        self.assertEqual(parsed["destination_account"], self.wallet)

    def test_bank_sms_from_wallet_wording_suggests_other_account_without_reversing_direction(self):
        PaymentMethod.objects.create(
            user=self.user, account=self.bank, name="Demo bank card",
            provider="ebl", identifier="****1111",
        )
        body = (
            "Fund Transfer of BDT 120 from PathaoPay DHAKA BD.Card ****1111 "
            "on 15-Jan-26 10:30:00 PM.Your A/C ****2222 Balance BDT 8000."
        )
        parsed = parse_raw_message(self.raw(body))
        self.assertEqual(parsed["account"], self.bank)
        self.assertEqual(parsed["destination_account"], self.wallet)
        self.assertEqual(parsed["suggested_transfer_direction"], "debit")
        self.assertIn("name or provider alias", parsed["transfer_suggestion_reason"])

    def test_confirmed_provider_path_survives_location_and_alias_variations(self):
        self.wallet.name = "Demo wallet"
        self.wallet.save()
        candidate = self.imported(self.body("PathaoPay DHAKA BD"))
        self.confirm(candidate, remember=False)
        parsed = parse_raw_message(self.raw(self.body("Pathao Pay")))
        self.assertEqual(parsed["destination_account"], self.wallet)
        self.assertIn("previously confirmed", parsed["transfer_suggestion_reason"])
        self.assertEqual(TransferCounterpartyMapping.objects.count(), 0)

    def test_provider_alias_suggests_unique_wallet_and_multiple_accounts_require_choice(self):
        self.wallet.name = "Demo wallet"
        self.wallet.save()
        PaymentMethod.objects.create(user=self.user, account=self.wallet, name="Primary", provider="pathao_pay")
        self.assertEqual(parse_raw_message(self.raw())["destination_account"], self.wallet)
        second = Account.objects.create(user=self.user, name="Second wallet", type="mobile_wallet")
        PaymentMethod.objects.create(user=self.user, account=second, name="Secondary", provider="pathao_pay")
        parsed = parse_raw_message(self.raw())
        self.assertIsNone(parsed["destination_account"])
        self.assertIn("Several saved accounts", parsed["transfer_suggestion_reason"])

    def test_similar_words_do_not_match_and_inactive_or_foreign_accounts_are_excluded(self):
        self.assertIsNone(parse_raw_message(self.raw(self.body("PathaoPayment Fake")))["destination_account"])
        other_user = get_user_model().objects.create_user(username="other-suggestion-test")
        Account.objects.create(user=other_user, name="Pathao Pay", type="mobile_wallet")
        self.wallet.is_active = False
        self.wallet.save()
        self.assertIsNone(parse_raw_message(self.raw())["destination_account"])

    def test_remembered_path_applies_to_pending_and_future_but_not_other_counterparties(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY", amount=120))
        pending = self.imported(self.body("DEMO COUNTERPARTY", amount=240))
        unrelated = self.imported(self.body("OTHER COUNTERPARTY", amount=360))
        self.confirm(candidate)
        self.assertEqual(TransferCounterpartyMapping.objects.count(), 1)
        pending.refresh_from_db()
        unrelated.refresh_from_db()
        self.assertEqual(pending.destination_account, self.wallet)
        self.assertIsNone(unrelated.destination_account)
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY")))
        self.assertEqual(parsed["destination_account"], self.wallet)
        self.assertIn("remembered", parsed["transfer_suggestion_reason"])
        self.assertEqual(Transaction.objects.count(), 1)

    def test_credit_correction_is_remembered_for_reporting_account(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY"))
        record = self.confirm(candidate, direction="credit")
        self.assertEqual(record.account, self.wallet)
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY")))
        self.assertEqual(parsed["account"], self.wallet)
        self.assertEqual(parsed["destination_account"], self.bank)
        self.assertEqual(parsed["suggested_transfer_direction"], "credit")
        future = self.imported(self.body("DEMO COUNTERPARTY", amount=240))
        # Default confirmation without a client perspective still preserves the path.
        response = self.client.post(reverse("message-candidate-confirm", kwargs={"candidate_id": future.pk}), {"type": "transfer"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        saved = Transaction.objects.get(pk=response.data["transaction"])
        self.assertEqual(saved.account, self.wallet)
        self.assertEqual(saved.transfer_account, self.bank)

    def test_incoming_text_and_remembered_path_keep_reporting_receiver(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY", wording="BDT credited transfer"))
        self.confirm(candidate, direction="credit")
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY", wording="BDT credited transfer")))
        self.assertEqual(parsed["destination_account"], self.bank)
        self.assertEqual(parsed["account"], self.wallet)

    def test_different_reporting_account_does_not_inherit_rule(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY"))
        self.confirm(candidate)
        second = Account.objects.create(user=self.user, name="Other bank", type="bank")
        self.rule.account = second
        self.rule.save()
        self.assertIsNone(parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY")))["destination_account"])

    def test_existing_confirmed_history_suggests_path_without_creating_rule(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY"))
        self.confirm(candidate, remember=False)
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY")))
        self.assertEqual(parsed["destination_account"], self.wallet)
        self.assertIn("previously confirmed", parsed["transfer_suggestion_reason"])
        self.assertEqual(TransferCounterpartyMapping.objects.count(), 0)

    def test_conflicting_confirmed_history_does_not_pick_latest_path(self):
        first = self.imported(self.body("DEMO COUNTERPARTY", amount=120))
        self.confirm(first, remember=False)
        second = self.imported(self.body("DEMO COUNTERPARTY", amount=240))
        other = Account.objects.create(user=self.user, name="Other destination", type="bank")
        self.confirm(second, other=other, remember=False)
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY")))
        self.assertIsNone(parsed["destination_account"])
        self.assertIn("different paths", parsed["transfer_suggestion_reason"])

    def test_masked_endpoint_evidence_beats_remembered_path_and_alias(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY"))
        self.confirm(candidate)
        other = Account.objects.create(user=self.user, name="Identifier destination", type="bank")
        PaymentMethod.objects.create(user=self.user, account=other, name="Demo identifier", provider="bank", identifier="****3333")
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY") + " To A/C ****3333."))
        self.assertEqual(parsed["destination_account"], other)
        self.assertIn("identifiers", parsed["transfer_suggestion_reason"])

    def test_link_confirmation_remembers_path(self):
        record = Transaction.objects.create(user=self.user, account=self.bank, transfer_account=self.wallet, type="transfer", direction="debit", amount="120", date="2026-01-15")
        candidate = self.imported(self.body("DEMO COUNTERPARTY"))
        response = self.client.post(reverse("transaction-link-transfer"), {
            "candidate": str(candidate.pk), "match_transaction": str(record.pk),
            "draft": {"account": str(self.bank.pk), "transfer_account": str(self.wallet.pk), "account_perspective": True, "direction": "debit", "remember_mapping": True},
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TransferCounterpartyMapping.objects.count(), 1)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_changed_remembered_choice_updates_existing_name_suggestion(self):
        first = self.imported()
        pending = self.imported()
        other = Account.objects.create(user=self.user, name="Preferred destination", type="mobile_wallet")
        self.confirm(first, other=other)
        pending.refresh_from_db()
        self.assertEqual(pending.destination_account, other)
        self.assertEqual(parse_raw_message(self.raw())["destination_account"], other)

    def test_pending_identified_destination_is_not_replaced_by_learning(self):
        candidate = self.imported(self.body("DEMO COUNTERPARTY"))
        other = Account.objects.create(user=self.user, name="Identified destination", type="bank")
        PaymentMethod.objects.create(user=self.user, account=other, name="Identified", provider="bank", identifier="****3333")
        pending = self.imported(self.body("DEMO COUNTERPARTY", amount=240) + " To A/C ****3333.")
        self.confirm(candidate)
        pending.refresh_from_db()
        self.assertEqual(pending.destination_account, other)

    def test_duplicate_masked_identifiers_do_not_pick_first_account(self):
        second = Account.objects.create(user=self.user, name="Other wallet", type="bank")
        for account, name in ((self.wallet, "First"), (second, "Second")):
            PaymentMethod.objects.create(user=self.user, account=account, name=name, provider="bank", identifier="****3333")
        parsed = parse_raw_message(self.raw(self.body("DEMO COUNTERPARTY") + " To A/C ****3333."))
        self.assertIsNone(parsed["destination_account"])
