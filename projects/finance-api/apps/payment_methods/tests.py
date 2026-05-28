from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account


class PaymentMethodApiTests(APITestCase):
    def test_authenticated_user_can_create_payment_method(self):
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
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("payment-method-list"),
            {
                "account": str(account.id),
                "name": "Personal bKash",
                "provider": "bkash",
                "identifier": "01700000000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Personal bKash")

    def test_user_cannot_attach_payment_method_to_another_users_account(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        other_account = Account.objects.create(
            user=other_user,
            name="Other Bank",
            type=Account.Type.BANK,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("payment-method-list"),
            {
                "account": str(other_account.id),
                "name": "Blocked Bank",
                "provider": "bank",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
