from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.payment_methods.models import PaymentMethod


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
