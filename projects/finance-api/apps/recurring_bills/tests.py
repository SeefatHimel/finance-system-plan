from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .models import RecurringBill


class RecurringBillApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="himel", password="password")
        self.account = Account.objects.create(user=self.user, name="Bank", type=Account.Type.BANK)
        self.category = Category.objects.create(user=self.user, name="Internet", kind=Category.Kind.EXPENSE)
        self.client.force_authenticate(self.user)

    def test_user_can_create_recurring_bill(self):
        response = self.client.post(
            reverse("recurring-bill-list"),
            {
                "account": str(self.account.id),
                "category": str(self.category.id),
                "name": "Internet",
                "amount": "1200.00",
                "frequency": RecurringBill.Frequency.MONTHLY,
                "next_due_date": "2026-06-10",
                "reminder_days_before": 5,
                "note": "Home broadband",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Internet")
        self.assertEqual(response.data["amount"], "1200.00")
        self.assertEqual(response.data["status"], RecurringBill.Status.ACTIVE)

    def test_recording_payment_advances_monthly_due_date(self):
        bill = RecurringBill.objects.create(
            user=self.user,
            account=self.account,
            category=self.category,
            name="Internet",
            amount="1200.00",
            frequency=RecurringBill.Frequency.MONTHLY,
            next_due_date="2026-01-31",
        )
        payment_transaction = Transaction.objects.create(
            user=self.user,
            account=self.account,
            category=self.category,
            amount="1200.00",
            date="2026-01-31",
            type=Transaction.Type.EXPENSE,
        )

        response = self.client.post(
            reverse("recurring-bill-payment-create", kwargs={"bill_id": bill.id}),
            {
                "amount": "1200.00",
                "paid_at": "2026-01-31",
                "transaction": str(payment_transaction.id),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["due_date"], "2026-01-31")
        bill.refresh_from_db()
        self.assertEqual(str(bill.next_due_date), "2026-02-28")

    def test_recording_payment_advances_weekly_due_date(self):
        bill = RecurringBill.objects.create(
            user=self.user,
            account=self.account,
            name="Gym",
            amount="500.00",
            frequency=RecurringBill.Frequency.WEEKLY,
            next_due_date="2026-06-01",
        )

        response = self.client.post(
            reverse("recurring-bill-payment-create", kwargs={"bill_id": bill.id}),
            {
                "amount": "500.00",
                "paid_at": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        bill.refresh_from_db()
        self.assertEqual(str(bill.next_due_date), "2026-06-08")

    def test_user_cannot_link_other_users_account(self):
        other_user = get_user_model().objects.create_user(username="other", password="password")
        other_account = Account.objects.create(user=other_user, name="Other bank", type=Account.Type.BANK)

        response = self.client.post(
            reverse("recurring-bill-list"),
            {
                "account": str(other_account.id),
                "name": "Bad bill",
                "amount": "100.00",
                "frequency": RecurringBill.Frequency.MONTHLY,
                "next_due_date": "2026-06-10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_payment_transaction_must_use_bill_account(self):
        other_account = Account.objects.create(user=self.user, name="Cash", type=Account.Type.CASH)
        bill = RecurringBill.objects.create(
            user=self.user,
            account=self.account,
            name="Internet",
            amount="1200.00",
            frequency=RecurringBill.Frequency.MONTHLY,
            next_due_date="2026-06-10",
        )
        wrong_transaction = Transaction.objects.create(
            user=self.user,
            account=other_account,
            amount="1200.00",
            date="2026-06-10",
            type=Transaction.Type.EXPENSE,
        )

        response = self.client.post(
            reverse("recurring-bill-payment-create", kwargs={"bill_id": bill.id}),
            {
                "amount": "1200.00",
                "paid_at": "2026-06-10",
                "transaction": str(wrong_transaction.id),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
