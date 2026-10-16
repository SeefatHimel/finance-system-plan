from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction

from .models import ParsedMessageCandidate, RawMessage, SenderRule, SmsCapturePreference
from .views import RawMessageImportView


class BatchSmsImportTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-batch-user"
        )
        self.account = Account.objects.create(
            user=self.user, name="Demo bank", type="bank"
        )
        SenderRule.objects.create(
            user=self.user,
            name="Demo rule",
            sender="TESTBANK",
            provider="bank",
            account=self.account,
        )
        self.client.force_authenticate(self.user)
        self.url = reverse("raw-message-batch-import")

    def item(self, index=0, **overrides):
        return {
            "client_id": f"queued-{index}",
            "device_message_id": f"device-{index}",
            "sender": "TESTBANK",
            "body": f"BDT 100 debited. Ref DEMO-{index}. Balance BDT 900.",
            "received_at": f"2026-10-01T00:{index // 60:02d}:{index % 60:02d}Z",
            **overrides,
        }

    def post(self, *items):
        return self.client.post(self.url, {"messages": list(items)}, format="json")

    def test_25_messages_and_lost_response_retry_are_idempotent_and_compact(self):
        items = [self.item(i) for i in range(25)]
        first = self.post(*items)
        self.assertEqual(first.status_code, 200)
        self.assertEqual([r["status"] for r in first.data["results"]], [201] * 25)
        replay = self.post(*reversed(items))
        self.assertTrue(all(r["is_duplicate"] for r in replay.data["results"]))
        self.assertEqual(
            {r["message_id"] for r in first.data["results"]},
            {r["message_id"] for r in replay.data["results"]},
        )
        self.assertEqual(RawMessage.objects.count(), 25)
        self.assertEqual(ParsedMessageCandidate.objects.count(), 25)
        self.assertEqual(Transaction.objects.count(), 0)
        for result in first.data["results"]:
            self.assertNotIn("body", result)
            self.assertNotIn("message", result)
            self.assertNotIn("candidate", result)
            self.assertNotIn("identity_suggestions", result)

    def test_body_hash_deduplication_is_preserved_with_a_different_device_id(self):
        a = self.item()
        response = self.post(
            a, {**a, "client_id": "second", "device_message_id": "different-device-id"}
        )
        first, second = response.data["results"]
        self.assertEqual(first["message_id"], second["message_id"])
        self.assertTrue(second["is_duplicate"])
        self.assertEqual(RawMessage.objects.count(), 1)

    def test_invalid_message_and_untrusted_sender_do_not_block_valid_items(self):
        response = self.post(
            self.item(0, body=""),
            self.item(1),
            self.item(2, sender="UNTRUSTED"),
            self.item(3),
        )
        self.assertEqual(
            [r["status"] for r in response.data["results"]], [400, 201, 400, 201]
        )
        self.assertEqual(RawMessage.objects.count(), 2)

    def test_failure_rolls_back_only_its_item_and_later_messages_commit(self):
        original = RawMessageImportView._create_candidate

        def create(view, message, **kwargs):
            if message.device_message_id == "device-1":
                raise RuntimeError("Synthetic private exception that must not escape")
            return original(view, message, **kwargs)

        with patch.object(RawMessageImportView, "_create_candidate", create):
            response = self.post(*(self.item(i) for i in range(3)))
        self.assertEqual(
            [r["status"] for r in response.data["results"]], [201, 500, 201]
        )
        self.assertNotIn("private exception", str(response.data))
        self.assertFalse(
            RawMessage.objects.filter(device_message_id="device-1").exists()
        )
        replay = self.post(*(self.item(i) for i in range(3)))
        self.assertEqual([r["status"] for r in replay.data["results"]], [200, 201, 200])
        self.assertEqual(RawMessage.objects.count(), 3)

    def test_bad_envelopes_cannot_partially_import_any_messages(self):
        for items in [
            [],
            [self.item()] * 2,
            [self.item(client_id="")],
            [self.item(client_id=123)],
            [self.item(i) for i in range(26)],
        ]:
            with self.subTest(items=len(items)):
                response = self.post(*items)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(RawMessage.objects.count(), 0)

    def test_user_scope_applies_even_when_device_ids_and_bodies_are_identical(self):
        first = self.post(self.item()).data["results"][0]
        other = get_user_model().objects.create_user(username="different-batch-user")
        account = Account.objects.create(
            user=other, name="Other demo bank", type="bank"
        )
        SenderRule.objects.create(
            user=other,
            name="Other rule",
            sender="TESTBANK",
            provider="bank",
            account=account,
        )
        self.client.force_authenticate(other)
        second = self.post(self.item()).data["results"][0]
        self.assertNotEqual(first["message_id"], second["message_id"])
        self.assertEqual(
            ParsedMessageCandidate.objects.get(pk=second["candidate_id"]).user, other
        )

    def test_rule_and_preference_queries_are_shared_without_loading_identity_suggestions(
        self,
    ):
        with CaptureQueriesContext(connection) as queries:
            response = self.post(*(self.item(i) for i in range(5)))
        self.assertEqual(response.status_code, 200)
        for model in [SenderRule, SmsCapturePreference]:
            table = model._meta.db_table
            self.assertEqual(
                sum(
                    f'FROM "{table}"' in q["sql"] and q["sql"].startswith("SELECT")
                    for q in queries
                ),
                1,
            )
        self.assertFalse(
            any('FROM "payment_methods_paymentmethod"' in q["sql"] for q in queries)
        )

    def test_excluded_messages_are_acknowledged_without_storing_original_text(self):
        text = "Your OTP is 123456. Synthetic security notification."
        result = self.post(self.item(body=text)).data["results"][0]
        self.assertEqual(result["status"], 201)
        self.assertTrue(result["exclusion_reason"])
        self.assertIsNone(result["candidate_id"])
        self.assertNotEqual(RawMessage.objects.get().body, text)

    def test_manual_redaction_requires_explicit_restoration_even_on_batch_reprocessing(
        self,
    ):
        self.post(self.item())
        message = RawMessage.objects.get()
        message.body = "[redacted]"
        message.status = RawMessage.Status.REDACTED
        message.redaction_reason = RawMessage.RedactionReason.MANUAL
        message.save()
        SmsCapturePreference.objects.update_or_create(
            user=self.user, defaults={"raw_sms_retention_days": None}
        )
        result = self.post(self.item(reprocess_existing=True)).data["results"][0]
        self.assertFalse(result["was_restored"])
        message.refresh_from_db()
        self.assertEqual(message.body, "[redacted]")
        result = self.post(
            self.item(reprocess_existing=True, restore_redacted=True)
        ).data["results"][0]
        self.assertTrue(result["was_restored"])
        self.assertEqual(RawMessage.objects.count(), 1)

    def test_batch_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.post(self.item()).status_code, 401)

    def test_validation_exception_rolls_back_item_and_returns_an_errors_object(self):
        original = RawMessageImportView._create_candidate

        def create(view, message, **kwargs):
            if message.device_message_id == "device-0":
                raise ValidationError("Synthetic invalid message")
            return original(view, message, **kwargs)

        with patch.object(RawMessageImportView, "_create_candidate", create):
            response = self.post(self.item(), self.item(1))
        self.assertEqual([r["status"] for r in response.data["results"]], [400, 201])
        self.assertIsInstance(response.data["results"][0]["errors"], dict)
        self.assertEqual(RawMessage.objects.count(), 1)


class ConcurrentBatchSmsImportTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_single_and_batch_imports_serialize_device_id_deduplication(
        self,
    ):
        user = get_user_model().objects.create_user(username="concurrent-demo")
        account = Account.objects.create(user=user, name="Demo bank", type="bank")
        SenderRule.objects.create(
            user=user,
            account=account,
            name="Demo rule",
            sender="TESTBANK",
            provider="bank",
        )
        start = Barrier(2)

        def upload(batch):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=user.pk))
                payload = {
                    "client_id": "demo-attempt",
                    "device_message_id": "same-demo-device-id",
                    "sender": "TESTBANK",
                    "body": f"BDT {100 if batch else 101} debited",
                    "received_at": "2026-10-01T00:00:00Z",
                }
                start.wait(timeout=10)
                if batch:
                    response = client.post(
                        reverse("raw-message-batch-import"),
                        {"messages": [payload]},
                        format="json",
                    )
                    return response.data["results"][0]["status"]
                return client.post(
                    reverse("raw-message-import"), payload, format="json"
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(upload, [True, False]))
        self.assertEqual(sorted(results), [200, 201])
        self.assertEqual(RawMessage.objects.filter(user=user).count(), 1)
        self.assertEqual(ParsedMessageCandidate.objects.filter(user=user).count(), 1)
        self.assertEqual(Transaction.objects.filter(user=user).count(), 0)
