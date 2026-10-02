from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SenderRule,
    SmsCapturePreference,
    SmsDeviceStatus,
)
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

    def test_sender_rule_rejects_duplicate_sender_and_match_type(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank primary",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
            match_type=SenderRule.MatchType.EXACT,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("sender-rule-list"),
            {
                "account": str(account.id),
                "name": "City Bank duplicate",
                "provider": SenderRule.Provider.CITY_BANK,
                "sender": "citybank",
                "match_type": SenderRule.MatchType.EXACT,
                "priority": 100,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data["sender"][0],
            "A sender rule with this sender and match type already exists.",
        )

    def test_sender_rule_rejects_invalid_regular_expression(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("sender-rule-list"),
            {
                "account": str(account.id),
                "name": "Broken regex",
                "provider": SenderRule.Provider.BANK,
                "sender": "CITYBANK",
                "match_type": SenderRule.MatchType.REGEX,
                "pattern": "[unclosed",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Enter a valid regular expression", response.data["pattern"][0])


class RawMessageImportApiTests(APITestCase):
    def test_capture_preferences_default_to_excluding_security_messages(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(user)

        response = self.client.get(reverse("sms-capture-preferences"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["excluded_providers"], [])
        self.assertEqual(response.data["excluded_message_kinds"], ["otp_or_security"])
        self.assertEqual(response.data["raw_sms_retention_days"], 30)

    def test_capture_preferences_can_be_updated_and_validate_supported_values(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(user)

        response = self.client.patch(
            reverse("sms-capture-preferences"),
            {
                "excluded_providers": ["city_bank", "city_bank"],
                "excluded_message_kinds": ["otp_or_security", "balance_notice"],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["excluded_providers"], ["city_bank"])
        self.assertEqual(
            response.data["excluded_message_kinds"],
            ["otp_or_security", "balance_notice"],
        )

        invalid_response = self.client.patch(
            reverse("sms-capture-preferences"),
            {"excluded_providers": ["unsupported-bank"]},
            format="json",
        )

        self.assertEqual(invalid_response.status_code, 400)
        self.assertIn("excluded_providers", invalid_response.data)

    def test_excluded_provider_stores_tombstone_without_sms_body(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        SmsCapturePreference.objects.create(
            user=user,
            excluded_providers=[SenderRule.Provider.CITY_BANK],
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": "Tk. 500.00 withdrawn from account.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-provider-excluded-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["candidate"])
        message = RawMessage.objects.get(user=user)
        self.assertEqual(message.body, "[excluded before storage]")
        self.assertEqual(message.status, RawMessage.Status.IGNORED)
        self.assertEqual(message.exclusion_reason, "provider_excluded")

    def test_security_message_is_excluded_before_body_storage_by_default(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": "Your OTP is 123456. Do not share this verification code.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-security-excluded-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["candidate"])
        message = RawMessage.objects.get(user=user)
        self.assertEqual(message.message_kind, "otp_or_security")
        self.assertEqual(message.body, "[excluded before storage]")
        self.assertEqual(message.exclusion_reason, "message_kind_excluded")

    def test_balance_notice_can_be_excluded_before_body_storage(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        SmsCapturePreference.objects.create(
            user=user,
            excluded_message_kinds=["otp_or_security", "balance_notice"],
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": "Your available balance is Tk. 4,500.00.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-balance-excluded-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["candidate"])
        message = RawMessage.objects.get(user=user)
        self.assertEqual(message.message_kind, "balance_notice")
        self.assertEqual(message.body, "[excluded before storage]")

    def test_withdrawal_with_balance_text_is_not_treated_as_balance_notice(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": "Tk. 4,000 withdrawn at ATM. Available balance Tk. 5,000.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-withdrawal-balance-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIsNotNone(response.data["candidate"])
        self.assertEqual(response.data["candidate"]["message_kind"], "cash_out")
        self.assertEqual(response.data["candidate"]["amount"], "4000.00")

    def test_import_rejects_sender_without_active_trusted_rule(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="Inactive City Bank sender",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
            is_active=False,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": "Tk. 500.00 withdrawn from account.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-untrusted-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["sender"], "No active trusted sender rule matches this message.")
        self.assertFalse(RawMessage.objects.filter(user=user).exists())

    def test_import_accepts_sender_matching_active_contains_rule(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank variants",
            provider=SenderRule.Provider.CITY_BANK,
            sender="Bank alerts",
            match_type=SenderRule.MatchType.CONTAINS,
            pattern="CITYBANK",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "ACME-CITYBANK-ALERT",
                "body": "Tk. 500.00 withdrawn from account.",
                "received_at": "2026-05-29T10:30:00+06:00",
                "device_message_id": "sms-trusted-contains-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(RawMessage.objects.filter(user=user).exists())

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
        bank_account = Account.objects.create(
            user=user,
            name="Bank Account",
            type=Account.Type.BANK,
        )
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01700000000",
        )
        bank_payment_method = PaymentMethod.objects.create(
            user=user,
            account=bank_account,
            name="Source Bank",
            provider=PaymentMethod.Provider.BANK,
            identifier="****1234",
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
        self.assertEqual(str(candidate["account"]), str(bank_account.id))
        self.assertEqual(str(candidate["payment_method"]), str(bank_payment_method.id))
        self.assertEqual(str(candidate["destination_account"]), str(account.id))
        self.assertEqual(str(candidate["destination_payment_method"]), str(payment_method.id))
        self.assertTrue(candidate["possible_internal_transfer"])

    def test_bkash_send_money_to_known_wallet_creates_transfer_candidate(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        source_account = Account.objects.create(
            user=user,
            name="Personal bKash",
            type=Account.Type.MOBILE_WALLET,
        )
        destination_account = Account.objects.create(
            user=user,
            name="Family bKash",
            type=Account.Type.MOBILE_WALLET,
        )
        source_method = PaymentMethod.objects.create(
            user=user,
            account=source_account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01700000000",
        )
        destination_method = PaymentMethod.objects.create(
            user=user,
            account=destination_account,
            name="Family bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01800000000",
        )
        SenderRule.objects.create(
            user=user,
            account=source_account,
            payment_method=source_method,
            name="bKash sender",
            provider=SenderRule.Provider.BKASH,
            sender="bKash",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "bKash",
                "body": (FIXTURE_DIR / "bkash" / "send_money.txt").read_text(),
                "received_at": "2026-05-30T11:00:00+06:00",
                "device_message_id": "sms-bkash-send-money-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["message_kind"], "send_money")
        self.assertEqual(candidate["transaction_type"], "transfer")
        self.assertEqual(candidate["amount"], "250.00")
        self.assertEqual(candidate["fee_amount"], "5.00")
        self.assertEqual(str(candidate["account"]), str(source_account.id))
        self.assertEqual(str(candidate["payment_method"]), str(source_method.id))
        self.assertEqual(str(candidate["destination_account"]), str(destination_account.id))
        self.assertEqual(str(candidate["destination_payment_method"]), str(destination_method.id))
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
        self.assertEqual(candidate["counterparty_text"], "SAMPLE MERCHANT")
        self.assertFalse(candidate["possible_internal_transfer"])

    def test_bkash_payment_extracts_till_counter_and_provider_timestamp_notes(self):
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
                "body": (FIXTURE_DIR / "bkash" / "payment_with_till.txt").read_text(),
                "received_at": "2026-05-30T11:30:00+06:00",
                "device_message_id": "sms-bkash-payment-till-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["counterparty_text"], "SAMPLE MERCHANT")
        self.assertEqual(candidate["reference"], "DEF456XYZ")
        self.assertIn("Detected bKash till/counter: Counter: C-01; Till: 123456", candidate["parser_notes"])
        self.assertIn("Detected provider timestamp: 30/05/2026 11:29 PM", candidate["parser_notes"])

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

    def test_city_bank_atm_withdrawal_accepts_dotted_taka_prefix(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="City Bank Account",
            type=Account.Type.BANK,
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
                "body": (FIXTURE_DIR / "city_bank" / "atm_withdrawal.txt").read_text(),
                "received_at": "2026-08-06T22:46:00+06:00",
                "device_message_id": "sms-city-atm-withdrawal-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "city_bank")
        self.assertEqual(candidate["message_kind"], "cash_out")
        self.assertEqual(candidate["transaction_type"], "expense")
        self.assertEqual(candidate["amount"], "40000.00")
        self.assertEqual(candidate["account"], account.id)
        self.assertFalse(candidate["possible_internal_transfer"])

    def test_city_bank_deposit_does_not_treat_date_year_as_amount(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(
            user=user,
            name="City Bank Account",
            type=Account.Type.BANK,
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
                "body": (
                    FIXTURE_DIR / "city_bank" / "deposit_with_trailing_balance.txt"
                ).read_text(),
                "received_at": "2026-05-16T10:30:00+06:00",
                "device_message_id": "sms-city-deposit-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "city_bank")
        self.assertEqual(candidate["message_kind"], "bank_transfer_in")
        self.assertEqual(candidate["transaction_type"], "income")
        self.assertEqual(candidate["amount"], "3250.00")
        self.assertEqual(candidate["balance_after"], "233319.00")
        self.assertEqual(candidate["account"], account.id)

    def test_city_bank_ecommerce_purchase_extracts_trailing_balance(self):
        user = get_user_model().objects.create_user(username="testuser", password="password")
        account = Account.objects.create(
            user=user,
            name="City Bank Account",
            type=Account.Type.BANK,
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
                "body": (
                    FIXTURE_DIR
                    / "city_bank"
                    / "ecommerce_purchase_with_trailing_balance.txt"
                ).read_text(),
                "received_at": "2026-10-01T10:30:00+06:00",
                "device_message_id": "sms-city-ecommerce-purchase-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["provider"], "city_bank")
        self.assertEqual(candidate["message_kind"], "card_purchase")
        self.assertEqual(candidate["transaction_type"], "expense")
        self.assertEqual(candidate["amount"], "180.00")
        self.assertEqual(candidate["balance_after"], "72308.00")
        self.assertEqual(candidate["account"], account.id)

    def test_bank_card_followup_messages_create_specific_candidates(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        ebl_account = Account.objects.create(
            user=user,
            name="EBL Card",
            type=Account.Type.CREDIT_CARD,
        )
        city_account = Account.objects.create(
            user=user,
            name="City Bank Card",
            type=Account.Type.CREDIT_CARD,
        )
        SenderRule.objects.create(
            user=user,
            account=ebl_account,
            name="EBL card sender",
            provider=SenderRule.Provider.EBL,
            sender="EBL",
        )
        SenderRule.objects.create(
            user=user,
            account=city_account,
            name="City Bank sender",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)

        cases = (
            {
                "amount": "5000.00",
                "device_message_id": "sms-ebl-card-payment-100",
                "fixture": FIXTURE_DIR / "ebl" / "card_bill_payment.txt",
                "message_kind": "card_payment",
                "possible_internal_transfer": True,
                "reference": "EBLPAY5000",
                "sender": "EBL",
                "transaction_type": "transfer",
            },
            {
                "amount": "1500.00",
                "device_message_id": "sms-ebl-card-fee-100",
                "fixture": FIXTURE_DIR / "ebl" / "card_fee.txt",
                "message_kind": "fee",
                "possible_internal_transfer": False,
                "reference": "EBLFEE1500",
                "sender": "EBL",
                "transaction_type": "fee",
            },
            {
                "amount": "850.00",
                "device_message_id": "sms-city-card-refund-100",
                "fixture": FIXTURE_DIR / "city_bank" / "card_refund.txt",
                "message_kind": "refund",
                "possible_internal_transfer": False,
                "reference": "CITYREF850",
                "sender": "CITYBANK",
                "transaction_type": "refund",
            },
            {
                "amount": "1200.00",
                "device_message_id": "sms-city-card-reversal-100",
                "fixture": FIXTURE_DIR / "city_bank" / "card_reversal.txt",
                "message_kind": "reversal",
                "possible_internal_transfer": False,
                "reference": "CITYREV1200",
                "sender": "CITYBANK",
                "transaction_type": "refund",
            },
        )

        for case in cases:
            with self.subTest(fixture=case["fixture"].name):
                response = self.client.post(
                    reverse("raw-message-import"),
                    {
                        "sender": case["sender"],
                        "body": case["fixture"].read_text(),
                        "received_at": "2026-05-30T13:45:00+06:00",
                        "device_message_id": case["device_message_id"],
                    },
                    format="json",
                )

                self.assertEqual(response.status_code, 201)
                candidate = response.data["candidate"]
                self.assertEqual(candidate["message_kind"], case["message_kind"])
                self.assertEqual(candidate["transaction_type"], case["transaction_type"])
                self.assertEqual(candidate["amount"], case["amount"])
                self.assertEqual(candidate["reference"], case["reference"])
                self.assertEqual(candidate["possible_internal_transfer"], case["possible_internal_transfer"])

    def test_bank_to_wallet_transfer_prefills_known_destination_method(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        bank_account = Account.objects.create(
            user=user,
            name="EBL Account",
            type=Account.Type.BANK,
        )
        wallet_account = Account.objects.create(
            user=user,
            name="bKash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        bank_method = PaymentMethod.objects.create(
            user=user,
            account=bank_account,
            name="EBL Account",
            provider=PaymentMethod.Provider.EBL,
            identifier="****1234",
        )
        wallet_method = PaymentMethod.objects.create(
            user=user,
            account=wallet_account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
            identifier="01700000000",
        )
        SenderRule.objects.create(
            user=user,
            account=bank_account,
            payment_method=bank_method,
            name="EBL bank sender",
            provider=SenderRule.Provider.EBL,
            sender="EBL",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "EBL",
                "body": (FIXTURE_DIR / "ebl" / "bank_to_bkash.txt").read_text(),
                "received_at": "2026-05-30T14:00:00+06:00",
                "device_message_id": "sms-ebl-bank-to-bkash-prefill-100",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        candidate = response.data["candidate"]
        self.assertEqual(candidate["message_kind"], "bank_transfer_out")
        self.assertEqual(candidate["transaction_type"], "transfer")
        self.assertEqual(candidate["amount"], "1000.00")
        self.assertEqual(candidate["reference"], "EBLBKASH100")
        self.assertEqual(str(candidate["account"]), str(bank_account.id))
        self.assertEqual(str(candidate["payment_method"]), str(bank_method.id))
        self.assertEqual(str(candidate["destination_account"]), str(wallet_account.id))
        self.assertEqual(str(candidate["destination_payment_method"]), str(wallet_method.id))
        self.assertTrue(candidate["possible_internal_transfer"])

    def test_city_bank_account_transfers_prefill_known_source_and_destination_methods(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        primary_account = Account.objects.create(
            user=user,
            name="City Bank Primary",
            type=Account.Type.BANK,
        )
        savings_account = Account.objects.create(
            user=user,
            name="City Bank Savings",
            type=Account.Type.BANK,
        )
        primary_method = PaymentMethod.objects.create(
            user=user,
            account=primary_account,
            name="City Bank Primary",
            provider=PaymentMethod.Provider.CITY_BANK,
            identifier="****5678",
        )
        savings_method = PaymentMethod.objects.create(
            user=user,
            account=savings_account,
            name="City Bank Savings",
            provider=PaymentMethod.Provider.CITY_BANK,
            identifier="****9012",
        )
        SenderRule.objects.create(
            user=user,
            account=primary_account,
            payment_method=primary_method,
            name="City Bank bank sender",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)

        cases = (
            {
                "balance_after": "80000.00",
                "device_message_id": "sms-city-bank-transfer-out-100",
                "fixture": "account_transfer_out.txt",
                "message_kind": "bank_transfer_out",
                "reference": "CITYTRF2000",
                "source_account": primary_account,
                "source_method": primary_method,
                "destination_account": savings_account,
                "destination_method": savings_method,
            },
            {
                "balance_after": "82000.00",
                "device_message_id": "sms-city-bank-transfer-in-100",
                "fixture": "account_transfer_in.txt",
                "message_kind": "bank_transfer_in",
                "reference": "CITYTRFIN2000",
                "source_account": savings_account,
                "source_method": savings_method,
                "destination_account": primary_account,
                "destination_method": primary_method,
            },
        )

        for case in cases:
            with self.subTest(fixture=case["fixture"]):
                response = self.client.post(
                    reverse("raw-message-import"),
                    {
                        "sender": "CITYBANK",
                        "body": (FIXTURE_DIR / "city_bank" / case["fixture"]).read_text(),
                        "received_at": "2026-05-30T14:30:00+06:00",
                        "device_message_id": case["device_message_id"],
                    },
                    format="json",
                )

                self.assertEqual(response.status_code, 201)
                candidate = response.data["candidate"]
                self.assertEqual(candidate["message_kind"], case["message_kind"])
                self.assertEqual(candidate["transaction_type"], "transfer")
                self.assertEqual(candidate["amount"], "2000.00")
                self.assertEqual(candidate["balance_after"], case["balance_after"])
                self.assertEqual(candidate["reference"], case["reference"])
                self.assertEqual(str(candidate["account"]), str(case["source_account"].id))
                self.assertEqual(str(candidate["payment_method"]), str(case["source_method"].id))
                self.assertEqual(str(candidate["destination_account"]), str(case["destination_account"].id))
                self.assertEqual(str(candidate["destination_payment_method"]), str(case["destination_method"].id))
                self.assertTrue(candidate["possible_internal_transfer"])

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
                "counterparty_text": "SAMPLE MERCHANT",
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
                "counterparty_text": "SAMPLE USER",
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
                "counterparty_text": "SAMPLE BANK",
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
        account = Account.objects.create(user=user, name="bKash", type=Account.Type.MOBILE_WALLET)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="bKash sender",
            provider=SenderRule.Provider.BKASH,
            sender="bKash",
        )
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

    def test_duplicate_raw_message_can_reprocess_pending_candidate(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="City Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank sender",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)
        payload = {
            "sender": "CITYBANK",
            "body": (FIXTURE_DIR / "city_bank" / "atm_withdrawal.txt").read_text(),
            "received_at": "2026-08-06T22:46:00+06:00",
            "device_message_id": "sms-city-atm-reprocess-100",
        }

        first_response = self.client.post(reverse("raw-message-import"), payload, format="json")
        candidate = ParsedMessageCandidate.objects.get(id=first_response.data["candidate"]["id"])
        candidate.amount = None
        candidate.message_kind = ParsedMessageCandidate.MessageKind.UNKNOWN
        candidate.confidence = "0.42"
        candidate.save(update_fields=("amount", "message_kind", "confidence", "updated_at"))

        duplicate_response = self.client.post(
            reverse("raw-message-import"),
            {**payload, "reprocess_existing": True},
            format="json",
        )

        self.assertEqual(duplicate_response.status_code, 200)
        self.assertTrue(duplicate_response.data["is_duplicate"])
        self.assertTrue(duplicate_response.data["was_reprocessed"])
        self.assertEqual(duplicate_response.data["candidate"]["amount"], "40000.00")
        self.assertEqual(duplicate_response.data["candidate"]["message_kind"], "cash_out")

        candidate.refresh_from_db()
        candidate.status = ParsedMessageCandidate.Status.CONFIRMED
        candidate.amount = "1.00"
        candidate.save(update_fields=("status", "amount", "updated_at"))
        confirmed_response = self.client.post(
            reverse("raw-message-import"),
            {**payload, "reprocess_existing": True},
            format="json",
        )

        self.assertFalse(confirmed_response.data["was_reprocessed"])
        self.assertEqual(confirmed_response.data["candidate"]["amount"], "1.00")

    def test_pending_candidate_can_be_reprocessed_from_review(self):
        user = get_user_model().objects.create_user(username="testuser", password="password")
        account = Account.objects.create(user=user, name="City Bank", type=Account.Type.BANK)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="City Bank sender",
            provider=SenderRule.Provider.CITY_BANK,
            sender="CITYBANK",
        )
        self.client.force_authenticate(user)
        import_response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "CITYBANK",
                "body": (
                    FIXTURE_DIR
                    / "city_bank"
                    / "ecommerce_purchase_with_trailing_balance.txt"
                ).read_text(),
                "received_at": "2026-10-01T10:30:00+06:00",
                "device_message_id": "sms-city-review-reprocess-100",
            },
            format="json",
        )
        candidate = ParsedMessageCandidate.objects.get(id=import_response.data["candidate"]["id"])
        candidate.balance_after = None
        candidate.save(update_fields=("balance_after", "updated_at"))

        response = self.client.post(
            reverse("message-candidate-reprocess", kwargs={"candidate_id": candidate.id}),
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["amount"], "180.00")
        self.assertEqual(response.data["balance_after"], "72308.00")

    @override_settings(DEBUG=True)
    def test_development_reset_clears_only_authenticated_users_sms_data(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        account = Account.objects.create(user=user, name="bKash", type=Account.Type.MOBILE_WALLET)
        SenderRule.objects.create(
            user=user,
            account=account,
            name="bKash sender",
            provider=SenderRule.Provider.BKASH,
            sender="bKash",
        )
        self.client.force_authenticate(user)
        payload = {
            "sender": "bKash",
            "body": "Cash Out Tk 500.00 successful.",
            "received_at": "2026-05-29T10:30:00+06:00",
            "device_message_id": "sms-reset-100",
        }
        self.client.post(reverse("raw-message-import"), payload, format="json")
        RawMessage.objects.create(
            user=other_user,
            sender="bKash",
            body="Cash Out Tk 100.00 successful.",
            received_at="2026-05-29T10:30:00+06:00",
            device_message_id="sms-other-100",
            body_hash="other-user-message-hash",
        )

        response = self.client.post(reverse("sms-development-reset"), format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted_messages"], 1)
        self.assertFalse(RawMessage.objects.filter(user=user).exists())
        self.assertTrue(RawMessage.objects.filter(user=other_user).exists())

    @override_settings(DEBUG=False)
    def test_development_reset_is_unavailable_outside_debug(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(user)

        response = self.client.post(reverse("sms-development-reset"), format="json")

        self.assertEqual(response.status_code, 404)


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
        self.assertEqual(transaction.date.isoformat(), "2026-05-29")
        self.assertEqual(transaction.time.isoformat(), "10:30:00")
        self.assertEqual(transaction.source, Transaction.Source.SMS)

    def test_user_can_override_candidate_transaction_time(self):
        candidate = self.import_message()

        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {"time": "09:15:00", "type": "expense"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        transaction = Transaction.objects.get(id=response.data["transaction"])
        self.assertEqual(transaction.time.isoformat(), "09:15:00")

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
        self.assertEqual(transaction.counterparty_text, "SAMPLE MERCHANT")
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
        self.assertEqual(response.data["rejection_reason"], "not_transaction")
        raw_message = RawMessage.objects.get(id=candidate["raw_message"]["id"])
        self.assertEqual(raw_message.status, RawMessage.Status.IGNORED)

    def test_user_can_reject_redact_and_exclude_sender_and_provider(self):
        candidate = self.import_message()

        response = self.client.post(
            reverse("message-candidate-reject", kwargs={"candidate_id": candidate["id"]}),
            {
                "reason": "unsupported_format",
                "note": "This sender format is not useful.",
                "redact_raw_sms": True,
                "exclude_sender": True,
                "exclude_provider": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ignored")
        self.assertEqual(response.data["rejection_reason"], "unsupported_format")
        self.assertEqual(response.data["rejection_note"], "This sender format is not useful.")
        self.assertIsNotNone(response.data["rejected_at"])
        self.assertEqual(response.data["raw_message"]["body"], "[redacted]")
        self.sender_rule.refresh_from_db()
        self.assertFalse(self.sender_rule.is_active)
        preference = SmsCapturePreference.objects.get(user=self.user)
        self.assertIn(SenderRule.Provider.BKASH, preference.excluded_providers)

    def test_user_can_redact_raw_sms_body(self):
        candidate = self.import_payment_message()
        raw_message_id = candidate["raw_message"]["id"]

        response = self.client.post(
            reverse("raw-message-redact", kwargs={"message_id": raw_message_id}),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        raw_message = RawMessage.objects.get(id=raw_message_id)
        self.assertEqual(raw_message.body, "[redacted]")
        self.assertEqual(raw_message.status, RawMessage.Status.REDACTED)
        self.assertEqual(raw_message.device_message_id, "")
        self.assertIsNotNone(raw_message.redacted_at)
        self.assertEqual(response.data["message"]["body"], "[redacted]")
        self.assertEqual(response.data["candidate"]["raw_message"]["body"], "[redacted]")

    def test_confirmed_transaction_uses_safe_normalized_note(self):
        candidate = self.import_payment_message()
        raw_message_id = candidate["raw_message"]["id"]

        confirm_response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {},
            format="json",
        )
        self.assertEqual(confirm_response.status_code, 200)
        transaction = Transaction.objects.get(id=confirm_response.data["transaction"])
        self.assertEqual(transaction.note, "Purchase · SAMPLE MERCHANT")
        self.assertNotIn("successful", transaction.note.lower())

        response = self.client.post(
            reverse("raw-message-redact", kwargs={"message_id": raw_message_id}),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        transaction.refresh_from_db()
        self.assertEqual(transaction.note, "Purchase · SAMPLE MERCHANT")
        self.assertEqual(transaction.reference, "DEF456XYZ")
        self.assertEqual(transaction.raw_message_id, RawMessage.objects.get(id=raw_message_id).id)

    def test_immediate_retention_redacts_raw_sms_after_confirmation(self):
        SmsCapturePreference.objects.create(user=self.user, raw_sms_retention_days=0)
        candidate = self.import_payment_message()

        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        message = RawMessage.objects.get(id=candidate["raw_message"]["id"])
        self.assertEqual(message.body, "[redacted]")

    def test_confirm_can_remember_sender_mapping(self):
        category = Category.objects.create(user=self.user, name="Shopping", kind=Category.Kind.EXPENSE)
        candidate = self.import_payment_message()

        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}),
            {
                "category": str(category.id),
                "type": "expense",
                "remember_mapping": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.sender_rule.refresh_from_db()
        self.assertEqual(self.sender_rule.category, category)
        self.assertEqual(self.sender_rule.default_transaction_type, "expense")


class SmsDeviceStatusApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(self.user)

    def test_status_starts_disconnected(self):
        response = self.client.get(reverse("sms-device-status"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["health_state"], "not_connected")
        self.assertIsNone(response.data["last_seen_at"])

    def test_mobile_heartbeat_reports_real_sync_health(self):
        response = self.client.post(
            reverse("sms-device-status"),
            {
                "device_id": "android-primary",
                "platform": "android",
                "app_version": "0.1.0",
                "sms_permission_state": "granted",
                "background_state": "success",
                "pending_upload_count": 0,
                "failed_upload_count": 0,
                "last_scan_at": "2026-10-01T08:00:00+06:00",
                "last_successful_sync_at": "2026-10-01T08:00:00+06:00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["health_state"], "healthy")
        self.assertTrue(SmsDeviceStatus.objects.filter(user=self.user).exists())

    def test_disabled_background_sync_needs_attention(self):
        response = self.client.post(
            reverse("sms-device-status"),
            {
                "sms_permission_state": "granted",
                "background_state": "disabled",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["health_state"], "background_disabled")
        self.assertEqual(response.data["health_label"], "Background sync is disabled")
