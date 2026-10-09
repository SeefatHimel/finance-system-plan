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
        food = Category.objects.create(
            user=user, name="Food", kind=Category.Kind.EXPENSE
        )
        salary = Category.objects.create(
            user=user, name="Salary", kind=Category.Kind.INCOME
        )
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


class DateRangeReportTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-period-user"
        )
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.other = Account.objects.create(
            user=self.user,
            name="Synthetic wallet",
            type="mobile_wallet",
            currency="BDT",
        )
        for day, kind, amount in (
            ("2026-01-31", "income", "100"),
            ("2026-02-01", "expense", "20"),
            ("2026-02-02", "expense", "30"),
        ):
            Transaction.objects.create(
                user=self.user, account=self.bank, date=day, type=kind, amount=amount
            )
        Transaction.objects.create(
            user=self.user,
            account=self.bank,
            transfer_account=self.other,
            date="2026-02-01",
            type="transfer",
            amount="50",
        )
        foreign = Account.objects.create(
            user=self.user, name="Synthetic USD", type="bank", currency="USD"
        )
        Transaction.objects.create(
            user=self.user,
            account=foreign,
            date="2026-02-01",
            type="expense",
            amount="1000",
        )

    def test_custom_range_crosses_months_and_includes_both_endpoints(self):
        response = self.client.get(
            reverse("monthly-report"),
            {"start_date": "2026-01-31", "end_date": "2026-02-01"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["income_total"], "100.00")
        self.assertEqual(response.data["expense_total"], "20.00")
        self.assertEqual(len(response.data["daily"]), 2)
        self.assertEqual(response.data["daily"][1]["expense_total"], "20.00")
        self.assertEqual(
            response.data["spending_categories"],
            [{"name": "Uncategorized", "amount": "20.00"}],
        )
        self.assertIsNone(response.data["month"])

    def test_daily_view_zero_days_and_transaction_range(self):
        params = {"start_date": "2026-02-01", "end_date": "2026-02-01"}
        response = self.client.get(reverse("monthly-report"), params)
        self.assertEqual(response.data["net_total"], "-20.00")
        self.assertEqual(len(response.data["daily"]), 1)
        result = self.client.get("/api/transactions/", params)
        data = result.data if isinstance(result.data, list) else result.data["results"]
        self.assertTrue(data)
        self.assertTrue(all(str(row["date"]) == "2026-02-01" for row in data))
        empty = self.client.get(
            reverse("monthly-report"),
            {"start_date": "2026-02-03", "end_date": "2026-02-03"},
        )
        self.assertEqual(empty.data["daily"][0]["income_total"], "0.00")
        self.assertEqual(empty.data["daily"][0]["expense_total"], "0.00")

    def test_invalid_ranges_return_useful_errors_on_both_endpoints(self):
        for params in (
            {"start_date": "2026-01-01"},
            {"start_date": "2026-02-30", "end_date": "2026-03-01"},
            {"start_date": "2026-02-02", "end_date": "2026-02-01"},
            {"start_date": "2025-01-01", "end_date": "2026-02-01"},
            {"month": "2026-02", "start_date": "2026-02-01", "end_date": "2026-02-01"},
        ):
            for url in (reverse("monthly-report"), "/api/transactions/"):
                with self.subTest(params=params, url=url):
                    response = self.client.get(url, params)
                    self.assertEqual(response.status_code, 400, response.data)

    def test_report_and_transaction_range_are_user_scoped(self):
        other_user = get_user_model().objects.create_user(
            username="synthetic-other-period"
        )
        other_account = Account.objects.create(
            user=other_user, name="Other synthetic", type="cash"
        )
        Transaction.objects.create(
            user=other_user,
            account=other_account,
            date="2026-02-01",
            type="income",
            amount="9999",
        )
        response = self.client.get(
            reverse("monthly-report"),
            {"start_date": "2026-02-01", "end_date": "2026-02-01"},
        )
        self.assertEqual(response.data["income_total"], "0.00")
