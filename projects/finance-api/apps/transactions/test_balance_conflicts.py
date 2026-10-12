"""Explicit account-bound balance choices when linking or merging evidence."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, RawMessage

from .models import Transaction, TransferEvidence
from .services import calculate_account_balance_summaries


class TransferBalanceConflictTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="balance-conflict-test"
        )
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(user=self.user, name="Synthetic A", type="bank")
        self.b = Account.objects.create(user=self.user, name="Synthetic B", type="bank")

    def record(self, a=None, b=None):
        record = Transaction.objects.create(
            user=self.user,
            account=self.a,
            transfer_account=self.b,
            type="transfer",
            direction="debit",
            amount="100.00",
            date="2026-10-12",
            balance_after=a,
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=record,
            account=self.a,
            direction="debit",
            date=record.date,
            balance_after=a,
        )
        if b is not None:
            TransferEvidence.objects.create(
                user=self.user,
                transaction=record,
                account=self.b,
                direction="credit",
                date=record.date,
                balance_after=b,
            )
        return record

    def choice(self, account, existing, incoming, keep="incoming"):
        return {
            "account": str(account.pk),
            "keep": keep,
            "existing_balance_after": existing,
            "incoming_balance_after": incoming,
        }

    def merge(self, retained, incoming, choices=()):
        return self.client.post(
            reverse("transaction-merge-transfer", kwargs={"pk": retained.pk}),
            {"transaction": str(incoming.pk), "balance_choices": list(choices)},
            format="json",
        )

    def values(self, response):
        return {
            item["account"]: item["balance_after"]
            for item in response.data["reported_balances"]
        }

    def test_merge_requires_all_choices_and_rolls_back(self):
        retained, incoming = (
            self.record("0.00", "300.00"),
            self.record("10.00", "301.00"),
        )
        count = TransferEvidence.objects.count()
        for choices in ([], [self.choice(self.a, "0.00", "10.00")]):
            response = self.merge(retained, incoming, choices)
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn("balance_choices", response.data)
            self.assertEqual(Transaction.objects.count(), 2)
            self.assertEqual(TransferEvidence.objects.count(), count)
        response = self.merge(
            retained,
            incoming,
            [
                self.choice(self.a, "0.00", "10.00", "existing"),
                self.choice(self.b, "300.00", "301.00"),
            ],
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            self.values(response), {str(self.a.pk): "0.00", str(self.b.pk): "301.00"}
        )
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(TransferEvidence.objects.count(), count)
        retained.refresh_from_db()
        self.assertEqual(retained.balance_after, Decimal("0.00"))
        summary = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(summary[self.a.pk].latest_reported_balance, Decimal("0.00"))
        self.assertEqual(summary[self.b.pk].latest_reported_balance, Decimal("301.00"))
        self.assertEqual(summary[self.a.pk].ledger_balance, Decimal("-100.00"))
        self.assertEqual(summary[self.b.pk].ledger_balance, Decimal("100.00"))

    def test_stale_or_unrelated_choices_do_not_merge(self):
        retained, incoming = self.record("900.00"), self.record("899.00")
        for choice in (
            self.choice(self.a, "901.00", "899.00"),
            self.choice(self.a, "900.00", "898.00"),
            self.choice(self.b, "900.00", "899.00"),
        ):
            response = self.merge(retained, incoming, [choice])
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(Transaction.objects.count(), 2)

    def test_known_balance_survives_unknown_and_other_account_is_not_a_conflict(self):
        retained, incoming = self.record("900.00"), self.record(None, "300.00")
        response = self.merge(retained, incoming)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            self.values(response), {str(self.a.pk): "900.00", str(self.b.pk): "300.00"}
        )

    def test_preview_displays_effective_balances_without_hiding_conflicting_matches(
        self,
    ):
        retained = self.record("900.00", "300.00")
        response = self.client.post(
            reverse("transaction-transfer-matches"),
            {
                "draft": {
                    "account": str(self.a.pk),
                    "transfer_account": str(self.b.pk),
                    "type": "transfer",
                    "amount": "100.00",
                    "date": "2026-10-12",
                    "balance_after": "899.00",
                }
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data[0]["id"], str(retained.pk))
        self.assertEqual(
            {
                item["account"]: item["balance_after"]
                for item in response.data[0]["reported_balances"]
            },
            {str(self.a.pk): "900.00", str(self.b.pk): "300.00"},
        )

    def test_link_manual_secondary_report_requires_a_choice(self):
        retained = self.record("900.00", "300.00")
        payload = {
            "match_transaction": str(retained.pk),
            "draft": {
                "account": str(self.a.pk),
                "transfer_account": str(self.b.pk),
                "type": "transfer",
                "amount": "100.00",
                "date": "2026-10-12",
                "reported_balances": [
                    {"account": str(self.a.pk), "balance_after": None},
                    {"account": str(self.b.pk), "balance_after": "301.00"},
                ],
            },
        }
        response = self.client.post(
            reverse("transaction-link-transfer"), payload, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(retained.transfer_evidence.count(), 2)
        payload["balance_choices"] = [
            self.choice(self.b, "300.00", "301.00", "existing")
        ]
        response = self.client.post(
            reverse("transaction-link-transfer"), payload, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            self.values(response), {str(self.a.pk): "900.00", str(self.b.pk): "300.00"}
        )

    def test_sms_link_requires_choice_and_preserves_original_message(self):
        retained = self.record("900.00")
        raw = RawMessage.objects.create(
            user=self.user,
            sender="DEMO",
            body="Synthetic report only",
            body_hash="conflict-demo",
            received_at=timezone.now(),
        )
        candidate = ParsedMessageCandidate.objects.create(
            user=self.user,
            raw_message=raw,
            provider="city_bank",
            account=self.a,
            destination_account=self.b,
            amount="100.00",
            transaction_type="transfer",
            possible_internal_transfer=True,
            message_kind="bank_transfer_out",
            balance_after="899.00",
        )
        payload = {
            "match_transaction": str(retained.pk),
            "candidate": str(candidate.pk),
            "draft": {"date": "2026-10-12"},
        }
        response = self.client.post(
            reverse("transaction-link-transfer"), payload, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        candidate.refresh_from_db()
        self.assertNotEqual(candidate.status, "confirmed")
        payload["balance_choices"] = [self.choice(self.a, "900.00", "899.00")]
        response = self.client.post(
            reverse("transaction-link-transfer"), payload, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.values(response)[str(self.a.pk)], "899.00")
        raw.refresh_from_db()
        self.assertEqual(raw.body, "Synthetic report only")
