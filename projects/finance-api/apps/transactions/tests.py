from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.payment_methods.models import PaymentMethod


class TransactionApiTests(APITestCase):
    def test_authenticated_user_can_create_transaction(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        self.client.force_authenticate(user)
        account = Account.objects.create(
            user=user,
            name="Cash",
            type=Account.Type.CASH,
        )
        category = Category.objects.create(
            user=user,
            name="Food",
            kind=Category.Kind.EXPENSE,
        )

        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(account.id),
                "category": str(category.id),
                "date": "2026-05-01",
                "type": "expense",
                "amount": "250.00",
                "note": "Lunch",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["amount"], "250.00")
        self.assertEqual(response.data["direction"], "debit")

    def test_authenticated_user_can_create_transaction_with_ledger_fields(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(user)
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
        )

        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(account.id),
                "payment_method": str(payment_method.id),
                "date": "2026-05-01",
                "type": "expense",
                "direction": "debit",
                "amount": "350.00",
                "balance_after": "1150.00",
                "reference": "DEF456XYZ",
                "counterparty_text": "SAMPLE MERCHANT",
                "external_key": "sms:bkash:def456xyz",
                "note": "Payment SMS",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["reference"], "DEF456XYZ")
        self.assertEqual(response.data["counterparty_text"], "SAMPLE MERCHANT")
        self.assertEqual(response.data["balance_after"], "1150.00")
        self.assertEqual(str(response.data["payment_method"]), str(payment_method.id))
