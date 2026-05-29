from pathlib import Path

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, SenderRule
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "sms"


class SenderRuleApiTests(APITestCase):
    def test_authenticated_user_can_create_sender_rule(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01700000000",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("sender-rule-list"),
            {
                "account": str(account.id),
                "payment_method": str(payment_method.id),
                "name": "bKash sender",
                "provider": "bkash",
                "sender": "bKash",
                "match_type": "exact",
                "priority": 10,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["sender"], "bKash")

    def test_sender_rule_rejects_payment_method_from_different_account(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        other_account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=other_account,
            name="Bank card",
            provider=PaymentMethod.Provider.CARD,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("sender-rule-list"),
            {
                "account": str(account.id),
                "payment_method": str(payment_method.id),
                "name": "Mismatched rule",
                "provider": "card",
                "sender": "CITYBANK",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)


class RawMessageImportApiTests(APITestCase):
    def test_authenticated_user_can_import_raw_message(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        SenderRule.objects.create(
            user=user,
            account=account,
            name="bKash sender",
            provider="bkash",
            sender="bKash",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": "Cash Out Tk 500.00 from 01700000000 successful.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["is_duplicate"])
        self.assertEqual(response.data["message"]["sender"], "bKash")
        self.assertEqual(response.data["candidate"]["amount"], "500.00")
        self.assertEqual(response.data["candidate"]["status"], "needs_review")

    def test_bkash_cash_in_import_creates_transfer_aware_candidate(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01700000000",
        )
        SenderRule.objects.create(
            user=user,
            account=account,
            payment_method=payment_method,
            name="bKash sender",
            provider=SenderRule.Provider.BKASH,
            sender="bKash",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": (FIXTURE_DIR / "bkash" / "cash_in.txt").read_text(),
                "received_at": "2026-05-30T10:30:00+06:00",
                "device_message_id": "sms-bkash-cash-in-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "bkash")
        self.assertEqual(candidate["message_kind"], "cash_in")
        self.assertEqual(candidate["transaction_type"], "transfer")
        self.assertEqual(candidate["amount"], "1000.00")
        self.assertEqual(candidate["balance_after"], "1500.00")
        self.assertEqual(candidate["fee_amount"], "0.00")
        self.assertEqual(candidate["reference"], "ABC123XYZ")
        self.assertTrue(candidate["possible_internal_transfer"])

    def test_bkash_payment_import_creates_purchase_candidate(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        SenderRule.objects.create(
            user=user,
            account=account,
            name="bKash sender",
            provider=SenderRule.Provider.BKASH,
            sender="bKash",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": (FIXTURE_DIR / "bkash" / "payment.txt").read_text(),
                "received_at": "2026-05-30T11:30:00+06:00",
                "device_message_id": "sms-bkash-payment-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "bkash")
        self.assertEqual(candidate["message_kind"], "purchase")
        self.assertEqual(candidate["transaction_type"], "expense")
        self.assertEqual(candidate["amount"], "350.00")
        self.assertEqual(candidate["counterparty_text"], "SAMPLE MERCHANT successful")
        self.assertFalse(candidate["possible_internal_transfer"])

    def test_ebl_card_purchase_import_creates_card_purchase_candidate(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="EBL Card",
            type=Account.Type.CREDIT_CARD,
        )
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="EBL Visa",
            provider=PaymentMethod.Provider.EBL,
            identifier="****1234",
        )
        SenderRule.objects.create(
            user=user,
            account=account,
            payment_method=payment_method,
            name="EBL card sender",
            provider=SenderRule.Provider.EBL,
            sender="EBL",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "EBL",
                "body": (FIXTURE_DIR / "ebl" / "card_purchase.txt").read_text(),
                "received_at": "2026-05-30T12:30:00+06:00",
                "device_message_id": "sms-ebl-card-purchase-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "ebl")
        self.assertEqual(candidate["message_kind"], "card_purchase")
        self.assertEqual(candidate["transaction_type"], "expense")
        self.assertEqual(candidate["amount"], "750.00")
        self.assertEqual(candidate["counterparty_text"], "SAMPLE SHOP")
        self.assertEqual(candidate["reference"], "EBL123456")
        self.assertFalse(candidate["possible_internal_transfer"])

    def test_city_bank_card_purchase_import_creates_card_purchase_candidate(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="City Bank Card",
            type=Account.Type.CREDIT_CARD,
        )
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank sender",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": (FIXTURE_DIR / "city_bank" / "card_purchase.txt").read_text(),
                "received_at": "2026-05-30T13:30:00+06:00",
                "device_message_id": "sms-city-card-purchase-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "city_bank")
        self.assertEqual(candidate["message_kind"], "card_purchase")
        self.assertEqual(candidate["transaction_type"], "expense")
        self.assertEqual(candidate["amount"], "1200.00")
        self.assertEqual(candidate["counterparty_text"], "SAMPLE STORE")
        self.assertEqual(candidate["reference"], "CITY123456")
        self.assertFalse(candidate["possible_internal_transfer"])

    def test_duplicate_raw_message_returns_existing_message(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(user)
        payload = {
            "sender": "bKash",
            "body": "Cash Out Tk 500.00 from 01700000000 successful.",
            "received_at": "2026-05-29T10:30:00+06:00",
            "device_message_id": "sms-100",
        }

        first_response = self.client.post(reverse("raw-message-import"), payload, format="json")
        duplicate_response = self.client.post(reverse("raw-message-import"), payload, format="json")

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(duplicate_response.status_code, 200)
        self.assertTrue(duplicate_response.data["is_duplicate"])
        self.assertEqual(
            duplicate_response.data["message"]["id"],
            first_response.data["message"]["id"],
        )


class MessageReviewApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="himel", password="password")
        self.account = Account.objects.create(
            user=self.user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        self.payment_method = PaymentMethod.objects.create(
            user=self.user,
            account=self.account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
        )
        self.sender_rule = SenderRule.objects.create(
            user=self.user,
            account=self.account,
            payment_method=self.payment_method,
            name="bKash sender",
            provider="bkash",
            sender="bKash",
        )
        self.client.force_authenticate(self.user)

    def import_message(self):
        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": "Cash Out Tk 500.00 from 01700000000 successful.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-review-100",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        return response.data["candidate"]

    def test_review_inbox_lists_imported_candidates(self):
        candidate = self.import_message()

        response = self.client.get(reverse("message-review-list"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], candidate["id"])

    def test_user_can_confirm_candidate_as_transaction(self):
        candidate = self.import_message()

        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {"type": "expense", "note": "Confirmed from SMS"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "confirmed")
        transaction = Transaction.objects.get(id=response.data["transaction"])
        self.assertEqual(transaction.amount, ParsedMessageCandidate.objects.get(id=candidate["id"]).amount)
        self.assertEqual(transaction.source, Transaction.Source.SMS)

    def test_user_can_ignore_candidate(self):
        candidate = self.import_message()

        response = self.client.post(
            reverse("message-candidate-ignore", kwargs={"candidate_id": candidate["id"]}),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ignored")
