from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction

from .models import CreditCardBill


class CreditCardBillApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="himel", password="password")
        self.card = Account.objects.create(
            user=self.user,
            name="City Bank credit card",
            type=Account.Type.CREDIT_CARD,
        )
        self.cash = Account.objects.create(
            user=self.user,
            name="Cash",
            type=Account.Type.CASH,
        )
        self.client.force_authenticate(self.user)

    def test_user_can_create_credit_card_bill(self):
        response = self.client.post(
            reverse("credit-card-bill-list"),
            {
                "account": str(self.card.id),
                "statement_balance": "12500.00",
                "minimum_due": "1500.00",
                "statement_date": "2026-05-25",
                "due_date": "2026-06-15",
                "reference": "MAY-2026",
                "note": "May statement",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(str(response.data["account"]), str(self.card.id))
        self.assertEqual(response.data["remaining_balance"], "12500.00")
        self.assertEqual(response.data["paid_amount"], "0.00")
        self.assertEqual(response.data["status"], CreditCardBill.Status.UNPAID)

    def test_bill_requires_credit_card_account(self):
        response = self.client.post(
            reverse("credit-card-bill-list"),
            {
                "account": str(self.cash.id),
                "statement_balance": "1200.00",
                "statement_date": "2026-05-25",
                "due_date": "2026-06-15",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_payment_reduces_bill_balance_and_sets_partial_status(self):
        bill = CreditCardBill.objects.create(
            user=self.user,
            account=self.card,
            statement_balance="12500.00",
            minimum_due="1500.00",
            paid_amount="0.00",
            remaining_balance="12500.00",
            statement_date="2026-05-25",
            due_date="2026-06-15",
        )
        payment_transaction = Transaction.objects.create(
            user=self.user,
            account=self.cash,
            transfer_account=self.card,
            amount="5000.00",
            date="2026-06-01",
            type=Transaction.Type.TRANSFER,
        )

        response = self.client.post(
            reverse("credit-card-payment-create", kwargs={"bill_id": bill.id}),
            {
                "amount": "5000.00",
                "paid_at": "2026-06-01",
                "transaction": str(payment_transaction.id),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        bill.refresh_from_db()
        self.assertEqual(bill.paid_amount, 5000)
        self.assertEqual(bill.remaining_balance, 7500)
        self.assertEqual(bill.status, CreditCardBill.Status.PARTIALLY_PAID)

    def test_final_payment_marks_bill_paid(self):
        bill = CreditCardBill.objects.create(
            user=self.user,
            account=self.card,
            statement_balance="1200.00",
            minimum_due="500.00",
            paid_amount="0.00",
            remaining_balance="1200.00",
            statement_date="2026-05-25",
            due_date="2026-06-15",
        )

        response = self.client.post(
            reverse("credit-card-payment-create", kwargs={"bill_id": bill.id}),
            {
                "amount": "1200.00",
                "paid_at": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        bill.refresh_from_db()
        self.assertEqual(bill.remaining_balance, 0)
        self.assertEqual(bill.status, CreditCardBill.Status.PAID)

    def test_payment_cannot_exceed_remaining_balance(self):
        bill = CreditCardBill.objects.create(
            user=self.user,
            account=self.card,
            statement_balance="1200.00",
            minimum_due="500.00",
            paid_amount="0.00",
            remaining_balance="1200.00",
            statement_date="2026-05-25",
            due_date="2026-06-15",
        )

        response = self.client.post(
            reverse("credit-card-payment-create", kwargs={"bill_id": bill.id}),
            {
                "amount": "1200.01",
                "paid_at": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_statement_balance_update_recalculates_remaining_balance(self):
        bill = CreditCardBill.objects.create(
            user=self.user,
            account=self.card,
            statement_balance="1200.00",
            minimum_due="500.00",
            paid_amount="200.00",
            remaining_balance="1000.00",
            status=CreditCardBill.Status.PARTIALLY_PAID,
            statement_date="2026-05-25",
            due_date="2026-06-15",
        )

        response = self.client.patch(
            reverse("credit-card-bill-detail", kwargs={"pk": bill.id}),
            {
                "statement_balance": "1500.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        bill.refresh_from_db()
        self.assertEqual(bill.remaining_balance, 1300)
        self.assertEqual(bill.status, CreditCardBill.Status.PARTIALLY_PAID)

    def test_user_cannot_link_other_users_transaction(self):
        other_user = get_user_model().objects.create_user(username="other", password="password")
        other_card = Account.objects.create(user=other_user, name="Other card", type=Account.Type.CREDIT_CARD)
        other_transaction = Transaction.objects.create(
            user=other_user,
            account=other_card,
            amount="1200.00",
            date="2026-05-25",
            type=Transaction.Type.EXPENSE,
        )

        response = self.client.post(
            reverse("credit-card-bill-list"),
            {
                "account": str(self.card.id),
                "statement_transaction": str(other_transaction.id),
                "statement_balance": "1200.00",
                "statement_date": "2026-05-25",
                "due_date": "2026-06-15",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
