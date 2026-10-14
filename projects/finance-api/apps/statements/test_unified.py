"""Synthetic fixtures only; unified review never uses a live database."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SmsCapturePreference,
)
from apps.transactions.models import Transaction, TransferEvidence

from .models import StatementImport, StatementRow
from .unified import pair_signals


class UnifiedReviewTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-unified")
        self.other_user = get_user_model().objects.create_user(
            username="synthetic-other"
        )
        self.account = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.wallet = Account.objects.create(
            user=self.user,
            name="Synthetic wallet",
            type="mobile_wallet",
            currency="BDT",
        )
        self.batch = StatementImport.objects.create(
            user=self.user,
            account=self.account,
            file_digest="synthetic-unified",
            profile="city_bank",
            parser_version="1",
            currency="BDT",
            account_identity="verify",
            page_count=1,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 5),
            opening_balance="1000.07",
            closing_balance="900.07",
        )
        self.row = StatementRow.objects.create(
            batch=self.batch,
            position=1,
            component="principal",
            source_fingerprint="synthetic-row",
            date=date(2026, 1, 2),
            time=time(17, 54),
            direction="debit",
            type="expense",
            amount="100.00",
            balance_after="900.07",
            counterparty_text="Synthetic Cafe",
            note="Synthetic Cafe",
            classification_confirmed=True,
            extracted={
                "id": "synthetic",
                "page": 1,
                "row": 1,
                "date": "2026-01-02",
                "time": "17:54:00",
                "posting_date": None,
                "value_date": None,
                "amount": "100.00",
                "balance_after": "900.07",
                "signed_fee": "0.00",
                "direction": "debit",
                "provider_type": "Card purchase",
                "reference": "",
                "description": "Synthetic Cafe",
                "issues": [],
                "bounds": [],
            },
        )
        self.row.refresh_from_db()
        self.sms = self.candidate()
        self.client.force_authenticate(self.user)

    def candidate(
        self,
        account=None,
        amount="100.00",
        balance="900.00",
        day=2,
        kind="card_purchase",
        **fields,
    ):
        raw = RawMessage.objects.create(
            user=self.user,
            sender="SYNTHETIC",
            body="Synthetic BDT 100 notification",
            body_hash=f"synthetic-{RawMessage.objects.count()}",
            received_at=datetime(
                2026, 1, day, 17, 54, tzinfo=timezone.get_current_timezone()
            ),
        )
        candidate = ParsedMessageCandidate.objects.create(
            user=self.user,
            raw_message=raw,
            account=account or self.account,
            amount=amount,
            balance_after=balance,
            message_kind=kind,
            counterparty_text="Synthetic Cafe",
            **fields,
        )
        candidate.refresh_from_db()
        return candidate

    def payload(self, **overrides):
        return {
            "statement": str(self.row.pk),
            "sms": str(self.sms.pk),
            "statement_version": self.row.version,
            "sms_updated_at": self.sms.updated_at.isoformat(),
            "balance_source": "sms",
            "acknowledge_match": True,
            "acknowledge_conflict": True,
            "acknowledge_issues": True,
            "remember_choices": False,
            **overrides,
        }

    def confirm(self, **overrides):
        return self.client.post(
            reverse("unified-pair"), self.payload(**overrides), format="json"
        )

    def test_queue_filters_and_read_only_detail(self):
        response = self.client.get(reverse("unified-pending"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response.data["count"], 2)
        self.assertTrue(
            all(len(item["matches"]) == 1 for item in response.data["results"])
        )
        self.assertTrue(
            all(item["matches"][0]["conflict"] for item in response.data["results"])
        )
        response = self.client.get(
            reverse("unified-pending"),
            {"source": "sms", "condition": "matched", "limit": 1},
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            self.client.get(
                reverse("unified-pending"),
                {"start_date": "2026-01-03", "end_date": "2026-01-03"},
            ).data["count"],
            0,
        )
        response = self.client.get(
            reverse("unified-pair"), {"statement": self.row.pk, "sms": self.sms.pk}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["sms"]["raw_message"]["body"], self.sms.raw_message.body
        )
        self.assertEqual(
            response.data["row"]["extracted"]["description"], "Synthetic Cafe"
        )
        self.assertEqual(Transaction.objects.count(), 0)

    def test_pair_counts_once_keeps_sources_and_retries_are_idempotent(self):
        original = self.payload()
        response = self.confirm()
        self.assertEqual(response.status_code, 200, response.data)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        record = Transaction.objects.get()
        self.assertEqual(self.row.transaction_id, record.pk)
        self.assertEqual(self.sms.transaction_id, record.pk)
        self.assertEqual(self.sms.status, "confirmed")
        self.assertEqual(self.row.state, "linked")
        self.assertEqual(record.balance_after, Decimal("900.00"))
        self.assertEqual(self.row.balance_after, Decimal("900.07"))
        self.assertEqual(self.sms.balance_after, Decimal("900.00"))
        self.assertEqual(record.raw_message_id, self.sms.raw_message_id)
        response = self.client.post(reverse("unified-pair"), original, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["unchanged"])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(self.client.get(reverse("unified-pending")).data["count"], 0)

    def test_balance_choice_and_acknowledgments(self):
        for field in ("acknowledge_match", "acknowledge_conflict"):
            response = self.confirm(**{field: False})
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(Transaction.objects.count(), 0)
        response = self.confirm(balance_source="statement")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.get().balance_after, Decimal("900.07"))

    def test_stale_changed_resolved_sources_and_ownership(self):
        self.assertEqual(
            self.confirm(statement_version=self.row.version + 1).status_code, 409
        )
        self.assertEqual(
            self.confirm(
                sms_updated_at=(self.sms.updated_at - timedelta(seconds=1)).isoformat()
            ).status_code,
            409,
        )
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get(reverse("unified-pending")).data["count"], 0)
        self.assertEqual(self.confirm().status_code, 404)
        self.assertEqual(
            self.client.get(
                reverse("unified-pair"), {"statement": self.row.pk, "sms": self.sms.pk}
            ).status_code,
            404,
        )
        self.client.force_authenticate(self.user)
        self.sms.status = "ignored"
        self.sms.save()
        self.assertEqual(self.confirm().status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("unified-pending")).status_code, 401)

    def test_matching_checks_account_direction_amount_reference_and_date(self):
        self.assertIsNotNone(pair_signals(self.row, self.sms))
        for candidate in [
            self.candidate(account=self.wallet),
            self.candidate(amount="99.00"),
            self.candidate(day=6),
            self.candidate(kind="promotional"),
            self.candidate(kind="bank_transfer_in"),
        ]:
            self.assertIsNone(pair_signals(self.row, candidate))
        far = self.candidate(day=5)
        self.assertIsNone(pair_signals(self.row, far))
        far.balance_after = self.row.balance_after
        self.assertIsNotNone(pair_signals(self.row, far))
        self.row.reference = "SYNTH-A"
        self.sms.reference = "SYNTH-B"
        self.assertIsNone(pair_signals(self.row, self.sms))

    def test_shared_claims_remain_ambiguous(self):
        self.candidate()
        response = self.client.get(reverse("unified-pending"))
        self.assertEqual(response.data["count"], 3)
        self.assertTrue(all(item["ambiguous"] for item in response.data["results"]))
        self.assertTrue(
            all(
                match["strength"] == "possible"
                for item in response.data["results"]
                for match in item["matches"]
            )
        )

    def test_existing_ledger_prevents_duplicate_and_keeps_both_sms_sources(self):
        raw = RawMessage.objects.create(
            user=self.user,
            sender="SYNTHETIC",
            body="Synthetic older SMS",
            body_hash="older",
            received_at=self.sms.raw_message.received_at,
        )
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            amount="100.00",
            date=self.row.date,
            type="expense",
            direction="debit",
            balance_after="900.00",
            raw_message=raw,
            source="sms",
        )
        self.assertEqual(self.confirm().status_code, 400)
        self.assertEqual(Transaction.objects.count(), 1)
        response = self.confirm(transaction=str(record.pk), balance_source="existing")
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("900.00"))
        self.assertEqual(record.raw_message_id, raw.pk)
        evidence = self.client.get(
            reverse("transaction-source-messages", args=[record.pk])
        )
        self.assertEqual(len(evidence.data), 2)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_incoming_transfer_keeps_receiving_reports_from_both_sources(self):
        self.row.direction = "credit"
        self.row.type = "transfer"
        self.row.other_account = self.wallet
        self.row.save()
        self.sms.transaction_type = "transfer"
        self.sms.message_kind = "bank_transfer_in"
        self.sms.suggested_transfer_direction = "credit"
        self.sms.destination_account = self.account
        self.sms.account = self.wallet
        self.sms.save()
        response = self.confirm()
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.assertEqual(record.account_id, self.wallet.pk)
        self.assertEqual(record.transfer_account_id, self.account.pk)
        self.assertIsNone(record.balance_after)
        evidence = list(TransferEvidence.objects.filter(transaction=record))
        self.assertEqual(len(evidence), 2)
        self.assertEqual({item.direction for item in evidence}, {"credit"})
        self.assertEqual(
            {item.balance_after for item in evidence},
            {Decimal("900.00"), Decimal("900.07")},
        )

    def test_sms_ledger_balance_conflict_is_reviewed_when_statement_has_no_balance(
        self,
    ):
        self.row.balance_after = None
        self.row.save()
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            amount="100.00",
            date=self.row.date,
            type="expense",
            direction="debit",
            balance_after="899.00",
        )
        response = self.confirm(
            transaction=str(record.pk),
            balance_source="existing",
            acknowledge_conflict=False,
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("acknowledge_conflict", response.data)
        self.assertEqual(
            self.confirm(
                transaction=str(record.pk), balance_source="existing"
            ).status_code,
            200,
        )

    def test_known_transfer_counterpart_conflicts_are_not_suggested(self):
        extra = Account.objects.create(
            user=self.user, name="Synthetic extra", type="bank"
        )
        self.row.type = "transfer"
        self.row.other_account = extra
        self.row.save()
        self.sms.transaction_type = "transfer"
        self.sms.destination_account = self.wallet
        self.sms.save()
        self.assertIsNone(pair_signals(self.row, self.sms))

    def test_failure_rolls_back_all_writes(self):
        with patch(
            "apps.statements.unified.create_audit_log",
            side_effect=ValidationError("Synthetic failure"),
        ):
            self.assertEqual(self.confirm().status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(self.row.state, "pending")
        self.assertEqual(self.sms.status, "needs_review")
        self.assertIsNone(self.sms.transaction_id)

    def test_retention_redacts_text_without_losing_source_link(self):
        SmsCapturePreference.objects.create(user=self.user, raw_sms_retention_days=0)
        self.assertEqual(self.confirm().status_code, 200)
        self.sms.raw_message.refresh_from_db()
        self.assertEqual(self.sms.raw_message.status, "redacted")
        self.sms.refresh_from_db()
        self.assertIsNotNone(self.sms.transaction_id)
        evidence = self.client.get(
            reverse("transaction-source-messages", args=[self.sms.transaction_id])
        )
        self.assertEqual(evidence.data[0]["parsed"]["balance_after"], "900.00")
        self.assertIsNone(evidence.data[0]["body"])

    def test_invalid_dates_and_queue_limits_fail_explicitly(self):
        self.assertEqual(
            self.client.get(
                reverse("unified-pending"), {"start_date": "2026-01-01"}
            ).status_code,
            400,
        )
        with patch("apps.statements.unified.MAX_PENDING", 0):
            response = self.client.get(reverse("unified-pending"))
            self.assertEqual(response.status_code, 400)
            self.assertIn("queue", response.data)
