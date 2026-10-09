"""Synthetic date-filter checks across ledger activity and paginated statements."""

from datetime import datetime, timezone

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.statements.models import StatementImport
from apps.transactions.models import Transaction


class ActivityDateFilterTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-date-filter")
        self.account = Account.objects.create(user=self.user, name="Synthetic cash", type="cash")
        self.client.force_authenticate(self.user)
        self.entry = Transaction.objects.create(user=self.user, account=self.account, date="2025-08-01", type="expense", amount="20")
        # Jan 1 at 18:00 UTC is Jan 2 midnight in the API's Asia/Dhaka timezone.
        Transaction.objects.filter(pk=self.entry.pk).update(
            created_at=datetime(2026, 1, 1, 18, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 4, 18, tzinfo=timezone.utc),
        )

    def test_activity_dates_are_independent_of_transaction_date_and_csv_agrees(self):
        params = {"start_date": "2026-01-02", "end_date": "2026-01-02", "date_field": "created_at"}
        result = self.client.get("/api/transactions/", params)
        self.assertEqual(result.status_code, 200)
        self.assertEqual([row["id"] for row in result.data], [str(self.entry.pk)])
        exported = self.client.get("/api/transactions/export/", params)
        self.assertEqual(exported.status_code, 200)
        self.assertIn(str(self.entry.pk), exported.content.decode())
        self.assertEqual(self.client.get("/api/transactions/", {**params, "date_field": "date"}).data, [])
        self.assertEqual(self.client.get("/api/transactions/", {**params, "date_field": "updated_at"}).data, [])
        result = self.client.get("/api/transactions/", {"month": "2026-01", "date_field": "updated_at"})
        self.assertEqual([row["id"] for row in result.data], [str(self.entry.pk)])

    def test_bad_fields_months_and_mixed_ranges_return_validation_errors(self):
        for params in ({"date_field": "user__password"}, {"month": "2026-13"}, {"month": "2026-00"}, {"month": "no-date"}, {"month": "2026-01", "start_date": "2026-01-01", "end_date": "2026-01-02"}):
            for url in ("/api/transactions/", "/api/transactions/export/"):
                with self.subTest(params=params, url=url):
                    self.assertEqual(self.client.get(url, params).status_code, 400)

    def test_filtering_remains_user_scoped_and_includes_end_of_day(self):
        other = get_user_model().objects.create_user(username="synthetic-other-date-filter")
        account = Account.objects.create(user=other, name="Other synthetic", type="cash")
        foreign = Transaction.objects.create(user=other, account=account, date="2026-01-02", type="expense", amount="99")
        Transaction.objects.filter(pk=foreign.pk).update(created_at=datetime(2026, 1, 2, 17, 59, 59, tzinfo=timezone.utc))
        params = {"start_date": "2026-01-02", "end_date": "2026-01-02", "date_field": "created_at"}
        self.assertEqual(len(self.client.get("/api/transactions/", params).data), 1)
        Transaction.objects.filter(pk=self.entry.pk).update(created_at=datetime(2026, 1, 2, 17, 59, 59, tzinfo=timezone.utc))
        self.assertEqual(len(self.client.get("/api/transactions/", params).data), 1)
        Transaction.objects.filter(pk=self.entry.pk).update(created_at=datetime(2026, 1, 2, 18, tzinfo=timezone.utc))
        self.assertEqual(self.client.get("/api/transactions/", params).data, [])

    def test_import_history_filters_before_pagination_and_details_remain_accessible(self):
        imports = []
        for index in range(3):
            batch = StatementImport.objects.create(user=self.user, account=self.account, file_digest=str(index).zfill(64), profile="city_bank", parser_version="test", currency="BDT", account_identity="synthetic", page_count=1)
            StatementImport.objects.filter(pk=batch.pk).update(
                created_at=datetime(2026, 1, index + 1, 18, tzinfo=timezone.utc),
                updated_at=datetime(2026, 2, index + 1, 18, tzinfo=timezone.utc),
            )
            imports.append(batch)
        params = {"date_field": "created_at", "start_date": "2026-01-02", "end_date": "2026-01-03", "limit": 1, "offset": 1}
        result = self.client.get(reverse("statement-import-list"), params)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data["count"], 2)
        self.assertEqual(result.data["results"][0]["id"], str(imports[0].id))
        # List filters do not hide an explicitly opened saved statement.
        detail = self.client.get(reverse("statement-import-detail", args=[imports[2].id]), params)
        self.assertEqual(detail.status_code, 200, detail.data)
        result = self.client.get(reverse("statement-import-list"), {"date_field": "updated_at", "month": "2026-02"})
        self.assertEqual(result.data["count"], 3)
        self.assertEqual(self.client.get(reverse("statement-import-list"), {"date_field": "period_start"}).status_code, 400)
