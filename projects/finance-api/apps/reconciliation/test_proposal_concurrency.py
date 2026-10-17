"""Real row-lock checks run only against an isolated PostgreSQL test database."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.transactions.models import Transaction


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locking")
class EvidenceProposalConcurrencyTests(TransactionTestCase):
    def test_concurrent_retries_attach_once(self):
        self.check_concurrency(separate=False)

    def test_competing_proposals_cannot_consume_same_source_twice(self):
        self.check_concurrency(separate=True)

    def check_concurrency(self, *, separate):
        user = get_user_model().objects.create_user(username="synthetic-evidence-race")
        account = Account.objects.create(user=user, name="Synthetic bank", type="bank")
        raw = RawMessage.objects.create(
            user=user,
            sender="SYNTHETIC",
            body="Synthetic notification",
            body_hash="synthetic-race",
            received_at=timezone.now(),
        )
        candidate = ParsedMessageCandidate.objects.create(
            user=user,
            raw_message=raw,
            account=account,
            amount="10.00",
            message_kind="card_purchase",
        )
        record = Transaction.objects.create(
            user=user,
            account=account,
            date=timezone.localdate(),
            amount="10.00",
            type="expense",
            direction="debit",
        )
        client = APIClient()
        client.force_authenticate(user)
        data = {
            "sources": [
                {"kind": "sms", "id": str(candidate.pk), "component": "principal"}
            ],
            "transaction": str(record.pk),
        }
        first = client.post(reverse("evidence-proposal"), data, format="json").data
        second = (
            client.post(reverse("evidence-proposal"), data, format="json").data
            if separate
            else first
        )
        key = str(uuid4())
        barrier = Barrier(2)

        def accept(preview):
            close_old_connections()
            try:
                local = APIClient()
                local.force_authenticate(user)
                barrier.wait(timeout=10)
                response = local.post(
                    reverse("evidence-apply", args=[preview["id"]]),
                    {
                        "fingerprint": preview["fingerprint"],
                        "idempotency_key": str(uuid4()) if separate else key,
                        "acknowledge_match": True,
                    },
                    format="json",
                )
                return response.status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(accept, [first, second]))
        self.assertEqual(sorted(results), [200, 409] if separate else [200, 200])
        self.assertEqual(Transaction.objects.filter(user=user).count(), 1)
        candidate.refresh_from_db()
        self.assertEqual(candidate.transaction_id, record.pk)
