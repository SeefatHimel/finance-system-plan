from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category


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

