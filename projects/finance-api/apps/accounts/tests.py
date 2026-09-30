from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.transactions.models import Transaction

from .models import Account


class AccountApiTests(APITestCase):
    def test_authenticated_user_can_create_account(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("account-list"),
            {
                "name": "Bkash",
                "type": "mobile_wallet",
                "starting_balance": "1000.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Bkash")
        self.assertEqual(response.data["ledger_balance"], "1000.00")
        self.assertIsNone(response.data["latest_reported_balance"])

    def test_account_exposes_derived_ledger_and_latest_reported_balances(self):
        user = get_user_model().objects.create_user(
            username="himel", password="password"
        )
        self.client.force_authenticate(user)
        cash = Account.objects.create(
            user=user,
            name="Cash",
            type=Account.Type.CASH,
            starting_balance="1000.00",
        )
        bank = Account.objects.create(
            user=user,
            name="Bank",
            type=Account.Type.BANK,
            starting_balance="500.00",
        )
        Transaction.objects.create(
            user=user,
            account=cash,
            amount="200.00",
            balance_after="800.00",
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
        )
        income_transaction = Transaction.objects.create(
            user=user,
            account=cash,
            amount="50.00",
            balance_after="850.00",
            date="2026-05-02",
            type=Transaction.Type.INCOME,
        )
        Transaction.objects.create(
            user=user,
            account=cash,
            transfer_account=bank,
            amount="100.00",
            date="2026-05-03",
            type=Transaction.Type.TRANSFER,
        )
        Transaction.objects.create(
            user=user,
            account=cash,
            amount="25.00",
            date="2026-05-04",
            direction=Transaction.Direction.CREDIT,
            type=Transaction.Type.ADJUSTMENT,
        )

        cash_response = self.client.get(
            reverse("account-detail", kwargs={"pk": cash.id})
        )
        bank_response = self.client.get(
            reverse("account-detail", kwargs={"pk": bank.id})
        )

        self.assertEqual(cash_response.status_code, 200)
        self.assertEqual(cash_response.data["ledger_balance"], "775.00")
        self.assertEqual(cash_response.data["latest_reported_balance"], "850.00")
        self.assertEqual(
            cash_response.data["latest_reported_balance_date"], "2026-05-02"
        )
        self.assertEqual(bank_response.data["ledger_balance"], "600.00")

        update_response = self.client.patch(
            reverse("account-detail", kwargs={"pk": cash.id}),
            {"starting_balance": "1200.00"},
            format="json",
        )

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["ledger_balance"], "975.00")

        delete_response = self.client.delete(
            reverse("transaction-detail", kwargs={"pk": income_transaction.id})
        )
        refreshed_response = self.client.get(
            reverse("account-detail", kwargs={"pk": cash.id})
        )

        self.assertEqual(delete_response.status_code, 204)
        self.assertEqual(refreshed_response.data["ledger_balance"], "925.00")
        self.assertEqual(refreshed_response.data["latest_reported_balance"], "800.00")
        self.assertEqual(
            refreshed_response.data["latest_reported_balance_date"], "2026-05-01"
        )
