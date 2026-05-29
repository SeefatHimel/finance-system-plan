from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction

from .models import BalanceSnapshot


class ReconciliationApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="himel", password="password")
        self.cash = Account.objects.create(
            user=self.user,
            name="Cash",
            starting_balance="1000.00",
            type=Account.Type.CASH,
        )
        self.bank = Account.objects.create(
            user=self.user,
            name="Bank",
            starting_balance="500.00",
            type=Account.Type.BANK,
        )
        self.client.force_authenticate(self.user)

    def test_user_can_create_balance_snapshot_with_expected_difference(self):
        Transaction.objects.create(
            user=self.user,
            account=self.cash,
            amount="200.00",
            date="2026-05-29",
            type=Transaction.Type.EXPENSE,
        )
        Transaction.objects.create(
            user=self.user,
            account=self.cash,
            amount="300.00",
            date="2026-05-29",
            type=Transaction.Type.INCOME,
        )
        Transaction.objects.create(
            user=self.user,
            account=self.cash,
            transfer_account=self.bank,
            amount="100.00",
            date="2026-05-29",
            type=Transaction.Type.TRANSFER,
        )

        response = self.client.post(
            reverse("balance-snapshot-list"),
            {
                "account": str(self.cash.id),
                "actual_balance": "980.00",
                "checked_at": "2026-05-30T10:00:00+06:00",
                "note": "Cash drawer check",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["expected_balance"], "1000.00")
        self.assertEqual(response.data["difference"], "-20.00")
        self.assertEqual(response.data["status"], BalanceSnapshot.Status.MISSING_MONEY)

    def test_user_can_fetch_latest_account_reconciliation(self):
        BalanceSnapshot.objects.create(
            user=self.user,
            account=self.bank,
            actual_balance="600.00",
            expected_balance="600.00",
            difference="0.00",
            status=BalanceSnapshot.Status.MATCHED,
            checked_at="2026-05-30T10:00:00+06:00",
        )

        response = self.client.get(
            reverse("account-reconciliation", kwargs={"account_id": self.bank.id})
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["account"], str(self.bank.id))
        self.assertEqual(response.data["account_name"], "Bank")
        self.assertEqual(response.data["expected_balance"], "500.00")
        self.assertEqual(response.data["latest_snapshot"]["status"], BalanceSnapshot.Status.MATCHED)

    def test_user_cannot_snapshot_another_users_account(self):
        other_user = get_user_model().objects.create_user(username="other", password="password")
        other_account = Account.objects.create(
            user=other_user,
            name="Other cash",
            type=Account.Type.CASH,
        )

        response = self.client.post(
            reverse("balance-snapshot-list"),
            {
                "account": str(other_account.id),
                "actual_balance": "100.00",
                "checked_at": "2026-05-30T10:00:00+06:00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
