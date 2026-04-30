from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction


class MonthlyReportApiTests(APITestCase):
    def test_monthly_report_summarizes_income_and_expenses(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        self.client.force_authenticate(user)
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        food = Category.objects.create(user=user, name="Food", kind=Category.Kind.EXPENSE)
        salary = Category.objects.create(user=user, name="Salary", kind=Category.Kind.INCOME)
        Transaction.objects.create(
            user=user,
            account=account,
            category=salary,
            date="2026-05-01",
            type=Transaction.Type.INCOME,
            amount="50000.00",
        )
        Transaction.objects.create(
            user=user,
            account=account,
            category=food,
            date="2026-05-02",
            type=Transaction.Type.EXPENSE,
            amount="250.00",
        )

        response = self.client.get(reverse("monthly-report"), {"month": "2026-05"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["income_total"], "50000.00")
        self.assertEqual(response.data["expense_total"], "250.00")
        self.assertEqual(response.data["net_total"], "49750.00")

