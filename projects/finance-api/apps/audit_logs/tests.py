from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.transactions.models import Transaction


class AuditLogApiTests(APITestCase):
    def test_transaction_changes_create_user_scoped_audit_entries(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        other_account = Account.objects.create(user=other_user, name="Other Cash", type=Account.Type.CASH)
        Transaction.objects.create(
            user=other_user,
            account=other_account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="999.00",
            note="Private transaction",
        )
        self.client.force_authenticate(user)

        create_response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(account.id),
                "date": "2026-05-01",
                "type": "expense",
                "amount": "250.00",
                "note": "Lunch",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        transaction_id = create_response.data["id"]

        patch_response = self.client.patch(
            reverse("transaction-detail", kwargs={"pk": transaction_id}),
            {"note": "Lunch updated"},
            format="json",
        )
        self.assertEqual(patch_response.status_code, 200)

        delete_response = self.client.delete(reverse("transaction-detail", kwargs={"pk": transaction_id}))
        self.assertEqual(delete_response.status_code, 204)

        response = self.client.get(reverse("audit-log-list"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 3)
        self.assertEqual([entry["action"] for entry in response.data], ["deleted", "updated", "created"])
        self.assertTrue(all(entry["entity_type"] == "transactions.transaction" for entry in response.data))
        self.assertTrue(all(entry["entity_id"] == transaction_id for entry in response.data))
        self.assertIsNone(response.data[2]["before"])
        self.assertEqual(response.data[2]["after"]["note"], "Lunch")
        self.assertEqual(response.data[1]["before"]["note"], "Lunch")
        self.assertEqual(response.data[1]["after"]["note"], "Lunch updated")
        self.assertEqual(response.data[0]["before"]["note"], "Lunch updated")
        self.assertIsNone(response.data[0]["after"])

    def test_audit_log_filters_by_entity_type_and_action(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        transaction = Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="250.00",
            note="Lunch",
        )
        AuditLogEntry.objects.create(
            user=user,
            action=AuditLogEntry.Action.CREATED,
            entity_type="transactions.transaction",
            entity_id=str(transaction.id),
            after={"note": "Lunch"},
        )
        AuditLogEntry.objects.create(
            user=user,
            action=AuditLogEntry.Action.UPDATED,
            entity_type="accounts.account",
            entity_id=str(account.id),
            after={"name": "Cash"},
        )
        self.client.force_authenticate(user)

        response = self.client.get(
            reverse("audit-log-list"),
            {"action": "created", "entity_type": "transactions.transaction"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["entity_id"], str(transaction.id))

    def test_audit_log_api_is_read_only_and_user_scoped(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        other_entry = AuditLogEntry.objects.create(
            user=other_user,
            action=AuditLogEntry.Action.CREATED,
            entity_type="transactions.transaction",
            entity_id="11111111-1111-1111-1111-111111111111",
            after={"note": "Private"},
        )
        self.client.force_authenticate(user)

        create_response = self.client.post(
            reverse("audit-log-list"),
            {
                "action": "created",
                "entity_type": "transactions.transaction",
                "entity_id": "22222222-2222-2222-2222-222222222222",
            },
            format="json",
        )
        detail_response = self.client.get(reverse("audit-log-detail", kwargs={"pk": other_entry.id}))

        self.assertEqual(create_response.status_code, 405)
        self.assertEqual(detail_response.status_code, 404)
