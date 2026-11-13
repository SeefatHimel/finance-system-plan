"""Synthetic-only bulk preview, fresh approval, source retention and batch undo."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.urls import reverse
from django.db import connections
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase
from rest_framework.test import APIClient

from apps.audit_logs.models import AuditLogEntry
from apps.categories.models import Category
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.transactions.models import Transaction, TransactionAction, TransferEvidence

from . import bulk_approval
from .models import StatementRow, UnifiedApprovalBatch
from . import test_unified as fixtures


class BulkApprovalTests(APITestCase):
    candidate = fixtures.UnifiedReviewTests.candidate

    def setUp(self):
        fixtures.UnifiedReviewTests.setUp(self)
        self.category = Category.objects.create(
            user=self.user, name="Synthetic groceries", kind="expense"
        )
        self.batch.opening_balance = "1000.00"
        self.batch.closing_balance = "900.00"
        self.batch.save()
        self.row.category = self.category
        self.row.balance_after = "900.00"
        self.row.reference = "SYNTH-ONE"
        self.row.extracted = {**self.row.extracted, "balance_after": "900.00"}
        self.row.save()
        self.sms.source_direction = "debit"
        self.sms.transaction_type = "expense"
        self.sms.category = self.category
        self.sms.balance_after = "900.00"
        self.sms.reference = "SYNTH-ONE"
        self.sms.save()
        self.pairs = [{"statement": str(self.row.pk), "sms": str(self.sms.pk)}]

    def extra(self):
        self.batch.closing_balance = "700.00"
        self.batch.save()
        row = StatementRow.objects.create(
            batch=self.batch,
            position=2,
            component="principal",
            source_fingerprint="synthetic-bulk-two",
            date=self.row.date + timedelta(days=1),
            time=self.row.time,
            direction="debit",
            type="expense",
            amount="200.00",
            balance_after="700.00",
            category=self.category,
            classification_confirmed=True,
            counterparty_text="Synthetic Market",
            reference="SYNTH-TWO",
            extracted={
                **self.row.extracted,
                "date": "2026-01-03",
                "amount": "200.00",
                "balance_after": "700.00",
                "description": "Synthetic Market",
            },
        )
        sms = self.candidate(
            amount="200.00",
            balance="700.00",
            day=3,
            source_direction="debit",
            transaction_type="expense",
            category=self.category,
            counterparty_text="Synthetic Market",
            reference="SYNTH-TWO",
        )
        self.pairs.append({"statement": str(row.pk), "sms": str(sms.pk)})
        return row, sms

    def preview(self, pairs=None):
        response = self.client.post(
            reverse("unified-bulk-preview"),
            {"pairs": pairs or self.pairs},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def approve(self, value, request_id=None, **fields):
        return self.client.post(
            reverse("unified-bulk-approve"),
            {
                "token": value["token"],
                "request_id": str(request_id or uuid4()),
                "confirmed": True,
                **fields,
            },
            format="json",
        )

    def test_preview_is_read_only_and_separates_totals(self):
        self.extra()
        value = self.preview()
        self.assertEqual(value["ready_count"], 2, value)
        self.assertEqual(value["needs_review"], 0)
        self.assertEqual(
            value["totals"],
            {"BDT": {"debit": "300.00", "credit": "0", "transfer": "0"}},
        )
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(UnifiedApprovalBatch.objects.count(), 0)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_approve_preserves_every_source_and_undo_reopens_whole_batch(self):
        self.extra()
        before = list(RawMessage.objects.values_list("body_hash", flat=True))
        original = deepcopy(self.row.extracted)
        result = self.approve(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="confirmed").count(), 2
        )
        self.assertEqual(StatementRow.objects.filter(state="linked").count(), 2)
        self.assertEqual(TransactionAction.objects.count(), 1)
        self.assertEqual(result.data["undo_action"]["kind"], "bulk_approve")
        self.row.refresh_from_db()
        self.assertEqual(self.row.extracted, original)
        for pair in result.data["approved"]:
            self.assertEqual(
                str(ParsedMessageCandidate.objects.get(pk=pair["sms"]).transaction_id),
                pair["transaction"],
            )
            self.assertEqual(
                str(StatementRow.objects.get(pk=pair["statement"]).transaction_id),
                pair["transaction"],
            )
        undo = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="needs_review").count(), 2
        )
        self.assertEqual(StatementRow.objects.filter(state="pending").count(), 2)
        self.assertEqual(
            list(RawMessage.objects.values_list("body_hash", flat=True)), before
        )

    def test_retry_and_retry_after_undo_do_not_create_entries_again(self):
        value, request_id = self.preview(), uuid4()
        first = self.approve(value, request_id)
        self.assertEqual(first.status_code, 200, first.data)
        again = self.approve(value, request_id)
        self.assertTrue(again.data["replayed"])
        self.assertEqual(first.data["approved"], again.data["approved"])
        self.assertEqual(Transaction.objects.count(), 1)
        self.client.post(
            reverse("transaction-undo"),
            {"action": first.data["undo_action"]["id"]},
            format="json",
        )
        again = self.approve(value, request_id)
        self.assertTrue(again.data["undo_action"]["undone"])
        self.assertEqual(Transaction.objects.count(), 0)

    def test_undo_conflict_rolls_back_entire_recovery(self):
        self.extra()
        result = self.approve(self.preview())
        Transaction.objects.filter(pk=result.data["approved"][0]["transaction"]).update(
            note="Synthetic later edit"
        )
        undo = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undo.status_code, 409)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(StatementRow.objects.filter(state="linked").count(), 2)

    def test_blocked_items_stay_pending_while_ready_group_is_approved(self):
        other, sms = self.extra()
        other.category = None
        other.save()
        value = self.preview()
        self.assertEqual(value["ready_count"], 1, value)
        self.assertEqual(value["needs_review"], 1)
        self.assertIsNone(value["items"][1]["category"])
        result = self.approve(value)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(len(result.data["approved"]), 1)
        other.refresh_from_db()
        sms.refresh_from_db()
        self.assertEqual(other.state, "pending")
        self.assertEqual(sms.status, "needs_review")

    def test_stale_source_or_category_requires_fresh_preview(self):
        for change in ("sms", "category"):
            with self.subTest(change=change):
                value = self.preview()
                if change == "sms":
                    self.sms.parser_notes = "Synthetic revised parser notes"
                    self.sms.save()
                else:
                    self.category.name = "Synthetic groceries renamed"
                    self.category.save()
                response = self.approve(value)
                self.assertEqual(response.status_code, 409, response.data)
                self.assertEqual(Transaction.objects.count(), 0)

    def test_competing_source_arriving_after_preview_blocks_approval(self):
        value = self.preview()
        self.candidate(
            balance="900.00",
            source_direction="debit",
            transaction_type="expense",
            reference="SYNTH-ONE",
        )
        response = self.approve(value)
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_new_ledger_match_blocks_duplicate_creation(self):
        value = self.preview()
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            date=self.row.date,
            type="expense",
            direction="debit",
            amount="100.00",
            balance_after="900.00",
            reference="SYNTH-ONE",
            source="manual",
        )
        response = self.approve(value)
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_any_failure_rolls_back_earlier_pairs_and_recovery_receipts(self):
        self.extra()
        value = self.preview()
        original = bulk_approval.confirm_pair
        calls = []

        def fail_second(**kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise ValidationError("Synthetic late conflict")
            return original(**kwargs)

        with patch.object(bulk_approval, "confirm_pair", side_effect=fail_second):
            response = self.approve(value)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(TransactionAction.objects.count(), 0)
        self.assertEqual(UnifiedApprovalBatch.objects.count(), 0)
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(StatementRow.objects.filter(state="pending").count(), 2)

    def test_amount_direction_type_balance_fee_and_date_differences_are_blocked(self):
        changes = {
            "amount": "100.01",
            "direction": "credit",
            "type": "income",
            "balance_after": "900.01",
            "date": self.row.date + timedelta(days=1),
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                old = getattr(self.row, field)
                setattr(self.row, field, value)
                self.row.save()
                preview = self.preview()
                self.assertEqual(preview["ready_count"], 0, preview)
                self.assertIsNone(preview["token"])
                setattr(self.row, field, old)
                self.row.save()
        self.sms.fee_amount = "1.00"
        self.sms.save()
        self.assertEqual(self.preview()["ready_count"], 0)

    def test_source_direction_and_statement_checks_cannot_be_bypassed(self):
        self.sms.source_direction = ""
        self.sms.save()
        self.assertEqual(self.preview()["ready_count"], 0)
        self.sms.source_direction = "debit"
        self.sms.save()
        self.batch.checks = [{"name": "Synthetic failed check", "passed": False}]
        self.batch.save()
        self.assertEqual(self.preview()["ready_count"], 0)

    def test_shared_sources_are_blocked_even_if_only_some_pairs_are_selected(self):
        other_sms = self.candidate(
            balance="900.00", source_direction="debit", transaction_type="expense"
        )
        self.pairs.append({"statement": str(self.row.pk), "sms": str(other_sms.pk)})
        self.assertEqual(self.preview()["ready_count"], 0)
        self.assertEqual(self.preview(self.pairs[:1])["ready_count"], 0)

    def test_confirmation_idempotency_owner_and_expiry_checks(self):
        value = self.preview()
        self.assertEqual(self.approve(value, confirmed=False).status_code, 400)
        self.assertEqual(
            self.approve({"token": value["token"] + "tampered"}).status_code, 409
        )
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.approve(value).status_code, 409)
        response = self.client.post(
            reverse("unified-bulk-preview"), {"pairs": self.pairs}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.user)
        with patch(
            "django.core.signing.time.time",
            return_value=timezone.now().timestamp() + 901,
        ):
            self.assertEqual(self.approve(value).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_selection_limits_and_duplicate_items(self):
        for pairs in ([], self.pairs * 2, self.pairs * 26):
            response = self.client.post(
                reverse("unified-bulk-preview"), {"pairs": pairs}, format="json"
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.post(
            reverse("unified-bulk-preview"), {"pairs": self.pairs}, format="json"
        )
        self.assertIn("no-store", response["Cache-Control"])

    def test_transfer_retains_both_account_reports_and_undo_removes_only_new_records(
        self,
    ):
        category = Category.objects.create(
            user=self.user, name="Synthetic internal transfer", kind="transfer"
        )
        self.row.type, self.row.other_account, self.row.category = (
            "transfer",
            self.wallet,
            category,
        )
        self.row.save()
        self.sms.transaction_type, self.sms.destination_account = (
            "transfer",
            self.wallet,
        )
        self.sms.message_kind, self.sms.category = "bank_transfer_out", category
        self.sms.save()
        value = self.preview()
        self.assertEqual(value["ready_count"], 1, value)
        self.assertEqual(value["totals"]["BDT"]["transfer"], "100.00")
        result = self.approve(value)
        self.assertEqual(result.status_code, 200, result.data)
        record = Transaction.objects.get()
        self.assertEqual(record.account_id, self.account.pk)
        self.assertEqual(record.transfer_account_id, self.wallet.pk)
        self.assertGreaterEqual(
            TransferEvidence.objects.filter(transaction=record).count(), 2
        )
        undo = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        self.assertEqual(TransferEvidence.objects.count(), 0)
        self.assertEqual(RawMessage.objects.count(), 1)
        self.assertEqual(StatementRow.objects.count(), 1)

    def test_retry_survives_later_action_and_request_id_cannot_be_reused(self):
        value, request_id = self.preview(), uuid4()
        result = self.approve(value, request_id)
        self.assertEqual(result.status_code, 200, result.data)
        from apps.transactions.recovery import ActionRecorder
        from django.db import transaction

        with transaction.atomic():
            record = Transaction.objects.get()
            recorder = ActionRecorder(self.user, transaction_ids=[record.pk])
            record.note = "Synthetic later edit"
            record.save()
            later = recorder.finish(record, "update")
        retry = self.approve(value, request_id)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertTrue(retry.data["replayed"])
        self.assertFalse(retry.data["undo_action"]["can_undo"])
        self.assertEqual(TransactionAction.objects.first().pk, later.pk)
        self.assertEqual(
            self.approve({"token": value["token"] + "other"}, request_id).status_code,
            409,
        )
        self.assertEqual(Transaction.objects.count(), 1)

    def test_fee_components_and_unrecognized_fee_evidence_stay_individual(self):
        self.row.extracted = {**self.row.extracted, "signed_fee": "unrecognized"}
        self.row.save()
        self.assertEqual(self.preview()["ready_count"], 0)
        self.sms.amount = "100.25"
        self.sms.save()
        self.assertEqual(self.preview()["ready_count"], 0)

    def test_missing_source_balance_is_not_replaced_with_zero(self):
        self.sms.balance_after = None
        self.sms.save()
        value = self.preview()
        self.assertEqual(value["ready_count"], 1, value)
        result = self.approve(value)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(str(Transaction.objects.get().balance_after), "900.00")
        self.sms.refresh_from_db()
        self.assertIsNone(self.sms.balance_after)


class ConcurrentBulkApprovalTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_concurrent_retry_creates_one_batch_and_one_undo_action(self):
        case = BulkApprovalTests()
        case.client = APIClient()
        case.setUp()
        case.extra()
        value, request_id = case.preview(), uuid4()

        def apply(_):
            connections.close_all()
            try:
                client = APIClient()
                client.force_authenticate(case.user)
                response = client.post(
                    reverse("unified-bulk-approve"),
                    {
                        "token": value["token"],
                        "request_id": str(request_id),
                        "confirmed": True,
                    },
                    format="json",
                )
                return response.status_code, response.data
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(apply, range(2)))
        self.assertEqual([status for status, _ in results], [200, 200], results)
        self.assertEqual(
            {data["batch"] for _, data in results},
            {str(UnifiedApprovalBatch.objects.get().pk)},
        )
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(TransactionAction.objects.count(), 1)
