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

    def test_pathao_pay_import_creates_provider_specific_candidates(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="Pathao Pay Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="Pathao Pay",
            provider=PaymentMethod.Provider.PATHAO_PAY,
        )
        SenderRule.objects.create(
            user=user,
            account=account,
            payment_method=payment_method,
            name="Pathao Pay sender",
            provider=SenderRule.Provider.PATHAO_PAY,
            sender="PATHAOPAY",
        )
        self.client.force_authenticate(user)

        cases = (
            {
                "amount": "500.00",
                "balance_after": "800.00",
                "counterparty_text": "SAMPLE BANK",
                "device_message_id": "sms-pathao-top-up-100",
                "fee_amount": None,
                "fixture": "top_up.txt",
                "message_kind": "cash_in",
                "possible_internal_transfer": True,
                "reference": "PATHAO123",
                "transaction_type": "transfer",
            },
            {
                "amount": "220.00",
                "balance_after": "580.00",
                "counterparty_text": "SAMPLE MERCHANT successful",
                "device_message_id": "sms-pathao-payment-100",
                "fee_amount": None,
                "fixture": "payment.txt",
                "message_kind": "purchase",
                "possible_internal_transfer": False,
                "reference": "PATHPAY456",
                "transaction_type": "expense",
            },
            {
                "amount": "300.00",
                "balance_after": "280.00",
                "counterparty_text": "SAMPLE USER successful",
                "device_message_id": "sms-pathao-send-money-100",
                "fee_amount": None,
                "fixture": "send_money.txt",
                "message_kind": "send_money",
                "possible_internal_transfer": False,
                "reference": "PATHSEND789",
                "transaction_type": "expense",
            },
            {
                "amount": "400.00",
                "balance_after": "174.00",
                "counterparty_text": "SAMPLE BANK successful",
                "device_message_id": "sms-pathao-withdraw-100",
                "fee_amount": "6.00",
                "fixture": "withdraw.txt",
                "message_kind": "cash_out",
                "possible_internal_transfer": True,
                "reference": "PATHWD321",
                "transaction_type": "transfer",
            },
        )

        for case in cases:
            with self.subTest(fixture=case["fixture"]):
                response = self.client.post(
                    reverse("raw-message-import"),
                    {
                        "sender": "PATHAOPAY",
                        "body": (FIXTURE_DIR / "pathao_pay" / case["fixture"]).read_text(),
                        "received_at": "2026-05-30T15:30:00+06:00",
                        "device_message_id": case["device_message_id"],
                    },
                    format="json",
                )

                self.assertEqual(response.status_code, 201)
                candidate = response.data["candidate"]
                self.assertEqual(candidate["provider"], "pathao_pay")
                self.assertEqual(candidate["message_kind"], case["message_kind"])
                self.assertEqual(candidate["transaction_type"], case["transaction_type"])
                self.assertEqual(candidate["amount"], case["amount"])
                self.assertEqual(candidate["balance_after"], case["balance_after"])
                self.assertEqual(candidate["counterparty_text"], case["counterparty_text"])
                self.assertEqual(candidate["fee_amount"], case["fee_amount"])
                self.assertEqual(candidate["reference"], case["reference"])
                self.assertEqual(
                    candidate["possible_internal_transfer"],
                    case["possible_internal_transfer"],
                )

    def test_internal_transfer_candidates_link_possible_related_message(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        bank_account = Account.objects.create(
            user=user,
            name="EBL Account",
            type=Account.Type.BANK,
        )
        wallet_account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        ebl_method = PaymentMethod.objects.create(
            user=user,
            account=bank_account,
            name="EBL Bank",
            provider=PaymentMethod.Provider.EBL,
            identifier="****1234",
        )
        bkash_method = PaymentMethod.objects.create(
            user=user,
            account=wallet_account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01700000000",
        )
        SenderRule.objects.create(
            user=user,
            account=bank_account,
            payment_method=ebl_method,
            name="EBL sender",
            provider=SenderRule.Provider.EBL,
            sender="EBL",
        )
        SenderRule.objects.create(
            user=user,
            account=wallet_account,
            payment_method=bkash_method,
            name="bKash sender",
            provider=SenderRule.Provider.BKASH,
            sender="bKash",
        )
        self.client.force_authenticate(user)

        bank_response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "EBL",
                "body": (FIXTURE_DIR / "ebl" / "bank_to_bkash.txt").read_text(),
                "received_at": "2026-05-30T14:00:00+06:00",
                "device_message_id": "sms-ebl-to-bkash-100",
            },
            format="json",
        )
        wallet_response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": (FIXTURE_DIR / "bkash" / "cash_in.txt").read_text(),
                "received_at": "2026-05-30T14:04:00+06:00",
                "device_message_id": "sms-bkash-cash-in-related-100",
            },
            format="json",
        )

        self.assertEqual(bank_response.status_code, 201)
        self.assertEqual(wallet_response.status_code, 201)
        bank_candidate = ParsedMessageCandidate.objects.get(id=bank_response.data["candidate"]["id"])
        wallet_candidate = wallet_response.data["candidate"]
        self.assertEqual(bank_candidate.message_kind, ParsedMessageCandidate.MessageKind.BANK_TRANSFER_OUT)
        self.assertTrue(bank_candidate.possible_internal_transfer)
        self.assertEqual(str(wallet_candidate["possible_related_candidate"]), str(bank_candidate.id))
        self.assertEqual(
            wallet_candidate["related_match_reason"],
            "Same amount, close timestamp, and different provider.",
        )
        bank_candidate.refresh_from_db()
        self.assertEqual(str(bank_candidate.possible_related_candidate_id), str(wallet_candidate["id"]))

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

    def import_payment_message(self):
        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": (FIXTURE_DIR / "bkash" / "payment.txt").read_text(),
                "received_at": "2026-05-29T11:30:00+06:00",
                "device_message_id": "sms-review-payment-100",
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

    def test_confirm_candidate_copies_sms_ledger_fields(self):
        candidate = self.import_payment_message()

        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {"note": "Confirmed purchase"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        transaction = Transaction.objects.get(id=response.data["transaction"])
        parsed_candidate = ParsedMessageCandidate.objects.get(id=candidate["id"])
        self.assertEqual(transaction.direction, Transaction.Direction.DEBIT)
        self.assertEqual(transaction.balance_after, parsed_candidate.balance_after)
        self.assertEqual(transaction.reference, "DEF456XYZ")
        self.assertEqual(transaction.counterparty_text, "SAMPLE MERCHANT successful")
        self.assertEqual(transaction.payment_method, self.payment_method)
        self.assertEqual(transaction.raw_message_id, parsed_candidate.raw_message_id)
        self.assertEqual(transaction.external_key, "sms:bkash:def456xyz")

    def test_transfer_candidate_requires_destination_account_on_confirm(self):
        candidate = self.import_message()

        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("transfer_account", response.data)

    def test_user_can_ignore_candidate(self):
        candidate = self.import_message()

        response = self.client.post(
            reverse("message-candidate-ignore", kwargs={"candidate_id": candidate["id"]}),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ignored")
