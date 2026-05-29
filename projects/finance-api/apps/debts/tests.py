from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction

from .models import Debt


class DebtApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="himel", password="password")
        self.account = Account.objects.create(
            user=self.user,
            name="Cash",
            type=Account.Type.CASH,
        )
        self.client.force_authenticate(self.user)

    def test_user_can_create_lent_debt(self):
        transaction = Transaction.objects.create(
            user=self.user,
            account=self.account,
            amount="500.00",
            date="2026-05-30",
            type=Transaction.Type.LEND,
        )

        response = self.client.post(
            reverse("debt-list"),
            {
                "counterparty_name": "Friend",
                "direction": Debt.Direction.LENT_BY_ME,
                "opened_transaction": str(transaction.id),
                "principal_amount": "500.00",
                "opened_at": "2026-05-30",
                "due_date": "2026-06-30",
                "note": "Lunch loan",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["counterparty_name"], "Friend")
        self.assertEqual(response.data["current_balance"], "500.00")
        self.assertEqual(response.data["status"], Debt.Status.OPEN)

    def test_payment_reduces_debt_balance_and_sets_partial_status(self):
        debt = Debt.objects.create(
            user=self.user,
            counterparty_name="Friend",
            direction=Debt.Direction.LENT_BY_ME,
            principal_amount="500.00",
            current_balance="500.00",
            opened_at="2026-05-30",
        )
        transaction = Transaction.objects.create(
            user=self.user,
            account=self.account,
            amount="200.00",
            date="2026-06-01",
            type=Transaction.Type.REPAYMENT_RECEIVED,
        )

        response = self.client.post(
            reverse("debt-payment-create", kwargs={"debt_id": debt.id}),
            {
                "amount": "200.00",
                "paid_at": "2026-06-01",
                "transaction": str(transaction.id),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        debt.refresh_from_db()
        self.assertEqual(debt.current_balance, 300)
        self.assertEqual(debt.status, Debt.Status.PARTIALLY_PAID)

    def test_final_payment_marks_debt_paid(self):
        debt = Debt.objects.create(
            user=self.user,
            counterparty_name="Friend",
            direction=Debt.Direction.BORROWED_BY_ME,
            principal_amount="300.00",
            current_balance="300.00",
            opened_at="2026-05-30",
        )

        response = self.client.post(
            reverse("debt-payment-create", kwargs={"debt_id": debt.id}),
            {
                "amount": "300.00",
                "paid_at": "2026-06-02",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        debt.refresh_from_db()
        self.assertEqual(debt.current_balance, 0)
        self.assertEqual(debt.status, Debt.Status.PAID)

    def test_payment_cannot_exceed_current_balance(self):
        debt = Debt.objects.create(
            user=self.user,
            counterparty_name="Friend",
            direction=Debt.Direction.LENT_BY_ME,
            principal_amount="300.00",
            current_balance="300.00",
            opened_at="2026-05-30",
        )

        response = self.client.post(
            reverse("debt-payment-create", kwargs={"debt_id": debt.id}),
            {
                "amount": "301.00",
                "paid_at": "2026-06-02",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_user_cannot_link_other_users_transaction(self):
        other_user = get_user_model().objects.create_user(username="other", password="password")
        other_account = Account.objects.create(user=other_user, name="Other cash", type=Account.Type.CASH)
        other_transaction = Transaction.objects.create(
            user=other_user,
            account=other_account,
            amount="500.00",
            date="2026-05-30",
            type=Transaction.Type.LEND,
        )

        response = self.client.post(
            reverse("debt-list"),
            {
                "counterparty_name": "Friend",
                "direction": Debt.Direction.LENT_BY_ME,
                "opened_transaction": str(other_transaction.id),
                "principal_amount": "500.00",
                "opened_at": "2026-05-30",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
