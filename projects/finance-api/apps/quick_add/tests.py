import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction
from apps.audit_logs.models import AuditLogEntry


class QuickAddTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="quick-demo")
        self.other = get_user_model().objects.create_user(username="other-demo")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(user=self.user, name="Demo cash", type="cash")
        self.category = Category.objects.create(user=self.user, name="Demo expense", kind="expense")
        self.input = {"client_request_id": str(uuid.uuid4()), "account": str(self.account.pk), "category": str(self.category.pk), "type": "expense", "source": "mobile", "amount": "120.00", "date": "2026-10-12", "time": "13:07", "note": "Synthetic entry"}

    def test_presets_are_owned_and_allow_only_valid_defaults(self):
        url = reverse("quick-add-preset-list")
        response = self.client.post(url, {"name": "Lunch", "account": str(self.account.pk), "category": str(self.category.pk)}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["available"])
        self.assertIsNone(response.data["amount"])
        detail = reverse("quick-add-preset-detail", args=[response.data["id"]])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(url).data, [])
        self.assertEqual(self.client.patch(detail, {"name": "Stolen"}, format="json").status_code, 404)
        self.assertEqual(self.client.post(url, {"name": "Foreign", "account": str(self.account.pk)}, format="json").status_code, 400)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.patch(detail, {"type": "income"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(detail, {"amount": "0"}, format="json").status_code, 400)
        self.account.is_active = False
        self.account.save()
        self.assertFalse(self.client.get(detail).data["available"])
        self.assertEqual(self.client.patch(detail, {"is_enabled": False}, format="json").status_code, 200)

    def test_retry_creates_one_transaction_and_one_audit(self):
        url = reverse("quick-add-entry")
        first = self.client.post(url, self.input, format="json")
        second = self.client.post(url, self.input, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["transaction"], second.data["transaction"])
        self.assertTrue(second.data["replayed"])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(AuditLogEntry.objects.count(), 1)
        record = Transaction.objects.get()
        self.assertEqual(record.direction, "debit")
        self.assertIsNone(record.balance_after)
        self.assertIsNone(record.raw_message_id)
        self.assertEqual(str(record.time), "13:07:00")
        self.assertEqual(self.client.post(url, {**self.input, "amount": "121"}, format="json").status_code, 409)
        distinct = {**self.input, "client_request_id": str(uuid.uuid4())}
        self.assertEqual(self.client.post(url, distinct, format="json").status_code, 201)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_retry_preserves_edits_and_never_recreates_deleted_entries(self):
        url = reverse("quick-add-entry")
        self.client.post(url, self.input, format="json")
        record = Transaction.objects.get()
        record.amount = "130.00"
        record.save()
        self.assertEqual(self.client.post(url, self.input, format="json").status_code, 200)
        record.refresh_from_db()
        self.assertEqual(str(record.amount), "130.00")
        record.category = None
        record.save()
        self.category.delete()
        self.assertEqual(self.client.post(url, self.input, format="json").status_code, 200)
        self.assertEqual(Transaction.objects.count(), 1)
        record.delete()
        self.assertEqual(self.client.post(url, self.input, format="json").status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_entry_rejects_foreign_inactive_and_incompatible_choices(self):
        url = reverse("quick-add-entry")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(url, self.input, format="json").status_code, 400)
        self.client.force_authenticate(self.user)
        self.account.is_active = False
        self.account.save()
        self.assertEqual(self.client.post(url, self.input, format="json").status_code, 400)
        self.account.is_active = True
        self.account.save()
        self.assertEqual(self.client.post(url, {**self.input, "type": "income"}, format="json").status_code, 400)
        income = {**self.input, "type": "income", "category": None, "time": None}
        self.assertEqual(self.client.post(url, income, format="json").status_code, 201)
        self.assertEqual(Transaction.objects.get().direction, "credit")
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("quick-add-preset-list")).status_code, 401)
        self.assertEqual(self.client.post(url, self.input, format="json").status_code, 401)

    def test_reordering_requires_the_complete_owned_set_and_keeps_disabled_items(self):
        from .models import QuickAddPreset
        a = QuickAddPreset.objects.create(user=self.user, name="A")
        b = QuickAddPreset.objects.create(user=self.user, name="B", is_enabled=False)
        foreign = QuickAddPreset.objects.create(user=self.other, name="Other")
        url = reverse("quick-add-preset-reorder")
        self.assertEqual(self.client.post(url, {"ids": [str(a.pk), str(foreign.pk)]}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"ids": [str(a.pk), str(a.pk)]}, format="json").status_code, 400)
        response = self.client.post(url, {"ids": [str(b.pk), str(a.pk)]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([str(row["id"]) for row in response.data], [str(b.pk), str(a.pk)])
        self.assertFalse(response.data[0]["is_enabled"])


@skipUnless(connection.vendor == "postgresql", "Row-lock concurrency requires PostgreSQL")
class ConcurrentQuickEntryTests(TransactionTestCase):
    def test_simultaneous_identical_retries_post_once(self):
        user = get_user_model().objects.create_user(username="concurrent-quick-demo")
        account = Account.objects.create(user=user, name="Demo cash", type="cash")
        payload = {
            "client_request_id": str(uuid.uuid4()), "account": str(account.pk),
            "amount": "50.00", "date": "2026-10-12", "source": "mobile",
        }
        barrier = Barrier(2)

        def submit(_index):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(user)
            try:
                barrier.wait(timeout=10)
                return client.post(reverse("quick-add-entry"), payload, format="json").status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(submit, [0, 1]))
        self.assertEqual(sorted(statuses), [200, 201])
        self.assertEqual(Transaction.objects.filter(user=user).count(), 1)
        self.assertEqual(AuditLogEntry.objects.filter(user=user).count(), 1)
