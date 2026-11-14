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
        sms.category = None
        sms.save()
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

        # Exercise the retained canonical fallback. The batch-writer rollback
        # and late-conflict cases are covered separately below.
        with patch.object(bulk_approval, "write_ordinary_pairs", return_value={}), patch.object(
            bulk_approval, "confirm_pair", side_effect=fail_second
        ):
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
        self.assertEqual(
            self.preview(
                [
                    {
                        **self.pairs[0],
                        "edits": {"description": "Synthetic edited fee source"},
                    }
                ]
            )["ready_count"],
            0,
        )

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

    def test_missing_category_uses_same_sms_hint_and_is_undone_with_draft(self):
        self.row.category = None
        self.row.save()
        original = deepcopy(self.row.extracted)
        value = self.preview()
        self.assertEqual(value["ready_count"], 1, value)
        self.assertEqual(value["items"][0]["final"]["category"], str(self.category.pk))
        self.assertEqual(value["items"][0]["category_origin"], "suggested")
        self.row.refresh_from_db()
        self.assertIsNone(self.row.category_id)
        result = self.approve(value)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.get().category_id, self.category.pk)
        undo = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        self.row.refresh_from_db()
        self.assertIsNone(self.row.category_id)
        self.assertEqual(self.row.extracted, original)

    def test_explicit_metadata_is_previewed_signed_applied_and_undoable(self):
        from django.core import signing

        category = Category.objects.create(
            user=self.user, name="Synthetic travel", kind="expense"
        )
        original = deepcopy(self.row.extracted)
        pair = {
            **self.pairs[0],
            "edits": {
                "category": str(category.pk),
                "description": "Synthetic edited description",
                "note": "Private synthetic review note",
            },
        }
        value = self.preview([pair])
        self.assertEqual(value["ready_count"], 1, value)
        self.assertEqual(value["items"][0]["final"], pair["edits"])
        signed = signing.loads(value["token"], salt=bulk_approval.SALT)
        self.assertNotIn("Private synthetic", str(signed))
        self.assertEqual(Transaction.objects.count(), 0)
        # A client cannot swap metadata after reviewing the signed preview.
        self.assertEqual(self.approve(value, pairs=self.pairs).status_code, 409)
        result = self.approve(value, pairs=[pair])
        self.assertEqual(result.status_code, 200, result.data)
        record = Transaction.objects.get()
        self.assertEqual(record.category_id, category.pk)
        self.assertEqual(record.counterparty_text, pair["edits"]["description"])
        self.assertEqual(record.note, pair["edits"]["note"])
        self.assertEqual(str(record.amount), "100.00")
        self.sms.refresh_from_db()
        self.assertEqual(self.sms.category_id, self.category.pk)
        self.row.refresh_from_db()
        self.assertEqual(self.row.extracted, original)
        undone = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undone.status_code, 200, undone.data)
        self.row.refresh_from_db()
        self.assertEqual(self.row.category_id, self.category.pk)
        self.assertEqual(self.row.counterparty_text, "Synthetic Cafe")
        self.assertEqual(self.row.note, "Synthetic Cafe")

    def test_metadata_cannot_resolve_financial_or_identity_conflicts(self):
        pair = {
            **self.pairs[0],
            "edits": {
                "category": str(self.category.pk),
                "description": "Synthetic Cafe",
                "note": "Reviewed",
            },
        }
        self.sms.balance_after = "901.00"
        self.sms.save()
        value = self.preview([pair])
        self.assertEqual(value["ready_count"], 0, value)
        self.assertTrue(
            any("balances differ" in reason for reason in value["items"][0]["blockers"])
        )
        self.sms.balance_after = "900.00"
        self.sms.counterparty_text = "Synthetic different merchant"
        self.sms.save()
        value = self.preview([pair])
        self.assertEqual(value["ready_count"], 0, value)
        self.assertTrue(
            any("wording differ" in reason for reason in value["items"][0]["blockers"])
        )

    def test_category_ownership_activity_kind_and_input_limits(self):
        for category in (
            Category.objects.create(user=self.other_user, name="Synthetic foreign"),
            Category.objects.create(
                user=self.user, name="Synthetic inactive", is_active=False
            ),
            Category.objects.create(
                user=self.user, name="Synthetic salary", kind="income"
            ),
        ):
            value = self.preview(
                [{**self.pairs[0], "edits": {"category": str(category.pk)}}]
            )
            self.assertEqual(value["ready_count"], 0, value)
        for edits in (
            {"amount": "1"},
            {"description": "x" * 256},
            {"note": "x" * 4001},
        ):
            response = self.client.post(
                reverse("unified-bulk-preview"),
                {"pairs": [{**self.pairs[0], "edits": edits}]},
                format="json",
            )
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post(
            reverse("unified-bulk-preview"),
            {"pairs": [{**self.pairs[0], "direction": "credit"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_selected_category_revision_and_detailed_blockers(self):
        chosen = Category.objects.create(
            user=self.user, name="Synthetic chosen", kind="expense"
        )
        pair = {**self.pairs[0], "edits": {"category": str(chosen.pk)}}
        value = self.preview([pair])
        chosen.is_active = False
        chosen.save()
        self.assertEqual(self.approve(value, pairs=[pair]).status_code, 409)
        self.batch.checks = [
            {
                "label": "Synthetic closing balance",
                "expected": "900.00",
                "observed": "899.00",
                "passed": False,
            }
        ]
        self.batch.save()
        reasons = self.preview()["items"][0]["blockers"]
        self.assertTrue(
            any(
                "Synthetic closing balance" in reason
                and "900.00" in reason
                and "899.00" in reason
                for reason in reasons
            )
        )

    def pathao_pair(self):
        from .account_verification import ACCOUNT_WARNING

        self.batch.profile = "pathao_pay"
        self.batch.account_hint = "1234"
        self.batch.warnings = [ACCOUNT_WARNING]
        self.batch.save()
        self.row.counterparty_text = "Make Payment · Pathao Bike"
        self.row.extracted = {
            **self.row.extracted,
            "description": "Make Payment · Pathao Bike",
            "provider_type": "Make Payment",
        }
        self.row.save()
        self.sms.provider = "pathao_pay"
        self.sms.message_kind = "purchase"
        self.sms.counterparty_text = "Pathao Bike"
        self.sms.save()

    def test_bulk_checks_detect_a_ledger_match_created_during_approval(self):
        self.extra()
        value = self.preview()
        original = bulk_approval.confirm_pair
        calls = []

        def introduce_conflict(**kwargs):
            result = original(**kwargs)
            calls.append(1)
            if len(calls) == 1:
                # Simulate an in-batch financial side effect. A cached empty
                # ledger result would incorrectly approve the next pair.
                record = result[0]
                record.amount = "200.00"
                record.date = self.row.date + timedelta(days=1)
                record.reference = "SYNTH-TWO"
                record.balance_after = "700.00"
                record.counterparty_text = "Synthetic Market"
                record.save()
            return result

        with patch.object(bulk_approval, "write_ordinary_pairs", return_value={}), patch.object(
            bulk_approval, "confirm_pair", side_effect=introduce_conflict
        ):
            result = self.approve(value)
        self.assertEqual(result.status_code, 400, result.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(UnifiedApprovalBatch.objects.count(), 0)
        self.assertEqual(StatementRow.objects.filter(state="pending").count(), 2)

    def test_request_arithmetic_reuse_invalidates_on_financial_changes(self):
        from .services import CheckedStatementMatches, ReviewConflict, row_snapshot

        rows, _, _ = bulk_approval.prepare(self.user, self.pairs)
        row = rows[str(self.row.pk)]
        siblings = row._bulk_statement_rows
        checked = row._bulk_arithmetic
        self.assertEqual(checked.for_row(row, siblings), ())
        row.note = "Synthetic changed note"
        self.assertEqual(checked.for_row(row, siblings), ())
        row.amount += 1
        self.assertIsNone(checked.for_row(row, siblings))
        row.amount -= 1
        row.extracted["signed_fee"] = "-1.00"
        self.assertIsNone(checked.for_row(row, siblings))
        row.extracted["signed_fee"] = "0.00"
        self.assertEqual(checked.for_row(row, siblings), ())
        row.batch.closing_balance += 1
        self.assertIsNone(checked.for_row(row, siblings))
        matches = CheckedStatementMatches(row_snapshot(row), {row.pk: []}, False)
        row.reference = "SYNTH-CHANGED"
        with self.assertRaises(ReviewConflict):
            matches.for_row(row)

    def test_batched_competitors_agree_with_canonical_discovery(self):
        from .bulk_source_checks import competing_pairs
        from .unified import has_competing_sources

        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        rival = self.candidate(reference="SYNTH-ONE", source_direction="debit")
        for reference, amount, status, user in (
            ("SYNTH-ONE", "100.00", "needs_review", self.user),
            ("SYNTH-OTHER", "100.00", "needs_review", self.user),
            ("SYNTH-ONE", "99.50", "needs_review", self.user),
            ("SYNTH-ONE", "100.00", "confirmed", self.user),
            ("SYNTH-ONE", "100.00", "needs_review", self.other_user),
        ):
            with self.subTest(reference=reference, amount=amount, status=status, user=user.pk):
                rival.reference, rival.amount, rival.status, rival.user = reference, amount, status, user
                rival.save()
                actual = competing_pairs(self.user, [(self.row, self.sms)])
                self.assertEqual(
                    actual[(str(self.row.pk), str(self.sms.pk))],
                    has_competing_sources(self.row, self.sms),
                )

    def test_batched_recorded_sms_keeps_legacy_and_evidence_protection(self):
        from .bulk_source_checks import recorded_sms
        from apps.transactions.transfers import sms_recorded_elsewhere, sms_external_key

        record = Transaction.objects.create(
            user=self.user, account=self.account, type="expense", direction="debit",
            amount="100.00", date=self.row.date, external_key=sms_external_key(self.sms),
        )
        self.assertTrue(sms_recorded_elsewhere(self.sms))
        self.assertEqual(recorded_sms(self.user, [self.sms]), {str(self.sms.pk)})
        record.external_key = "synthetic-legacy"
        record.raw_message = self.sms.raw_message
        record.save()
        self.assertEqual(recorded_sms(self.user, [self.sms]), {str(self.sms.pk)})
        record.raw_message = None
        record.save()
        evidence = TransferEvidence.objects.create(
            user=self.user, transaction=record, account=self.account,
            raw_message=self.sms.raw_message, direction="debit", date=self.row.date,
            source="sms", external_key="synthetic-evidence",
        )
        self.assertTrue(sms_recorded_elsewhere(self.sms))
        self.assertEqual(recorded_sms(self.user, [self.sms]), {str(self.sms.pk)})
        evidence.delete()
        self.assertFalse(sms_recorded_elsewhere(self.sms))
        self.assertEqual(recorded_sms(self.user, [self.sms]), set())

    def test_batched_statement_rivals_include_value_dates_and_other_imports(self):
        from copy import copy
        from .bulk_source_checks import competing_pairs
        from .unified import has_competing_sources

        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        batch = copy(self.row.batch)
        batch.pk = None
        batch.file_digest = "synthetic-other-import"
        batch.save()
        rival = copy(self.row)
        rival.pk, rival.batch = None, batch
        rival.date += timedelta(days=10)
        rival.value_date = self.row.date
        rival.save()
        key = (str(self.row.pk), str(self.sms.pk))
        self.assertTrue(has_competing_sources(self.row, self.sms))
        self.assertTrue(competing_pairs(self.user, [(self.row, self.sms)])[key])
        batch.account = self.wallet
        batch.save()
        self.assertFalse(has_competing_sources(self.row, self.sms))
        self.assertFalse(competing_pairs(self.user, [(self.row, self.sms)])[key])
        with patch("apps.statements.bulk_source_checks.MAX_SOURCES", 0):
            self.assertEqual(
                competing_pairs(self.user, [(self.row, self.sms)])[key],
                has_competing_sources(self.row, self.sms),
            )

    def confirm_account(self, value, **fields):
        return self.client.post(
            reverse("statement-account-review"),
            {"token": value["imports"][0]["token"], "confirmed": True, **fields},
            format="json",
        )

    def test_realistic_pathao_prefix_and_account_review_enable_bulk(self):
        from .account_verification import ACCOUNT_WARNING

        self.extra()
        self.pathao_pair()
        value = self.preview()
        self.assertEqual(value["ready_count"], 0, value)
        self.assertEqual(len(value["imports"]), 1)
        self.assertFalse(value["imports"][0]["verified"])
        self.assertEqual(value["imports"][0]["account_hint"], "•••• 1234")
        self.assertEqual(
            value["items"][0]["blockers"],
            [
                "Confirm the reporting account once for this statement in the account review above."
            ],
        )
        reviewed = self.confirm_account(value)
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        self.assertTrue(reviewed.data["verified"])
        self.assertEqual(self.confirm_account(value).status_code, 200)
        self.assertEqual(
            AuditLogEntry.objects.filter(
                metadata__decision="statement_account_review"
            ).count(),
            1,
        )
        self.assertEqual(Transaction.objects.count(), 0)
        fresh = self.preview()
        self.assertEqual(fresh["ready_count"], 2, fresh)
        self.assertTrue(fresh["imports"][0]["verified"])
        result = self.approve(fresh)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 2)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.batch.refresh_from_db()
        self.assertEqual(self.batch.warnings, [ACCOUNT_WARNING])
        self.assertEqual(
            self.row.extracted["description"], "Make Payment · Pathao Bike"
        )
        self.assertEqual(self.sms.counterparty_text, "Pathao Bike")
        undo = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertTrue(self.preview()["imports"][0]["verified"])

    def test_account_review_does_not_waive_other_warnings_or_conflicts(self):
        self.pathao_pair()
        self.assertEqual(self.confirm_account(self.preview()).status_code, 200)
        self.batch.warnings += ["Synthetic missing page warning"]
        self.batch.save()
        value = self.preview()
        self.assertEqual(value["ready_count"], 0, value)
        self.assertIn(
            "Statement warning: Synthetic missing page warning",
            value["items"][0]["blockers"],
        )
        self.batch.warnings = self.batch.warnings[:1]
        self.batch.save()
        self.sms.counterparty_text = "Pathao Car"
        self.sms.save()
        pair = {**self.pairs[0], "edits": {"description": "Pathao Pay"}}
        self.assertEqual(self.preview([pair])["ready_count"], 0)
        self.sms.counterparty_text = "Pathao Bike"
        self.sms.balance_after = "899.00"
        self.sms.save()
        self.assertEqual(self.preview([pair])["ready_count"], 0)

    def test_account_review_requires_confirmation_owner_and_fresh_context(self):
        self.pathao_pair()
        value = self.preview()
        self.assertEqual(self.confirm_account(value, confirmed=False).status_code, 400)
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.confirm_account(value).status_code, 404)
        self.client.force_authenticate(self.user)
        with patch(
            "django.core.signing.time.time",
            return_value=timezone.now().timestamp() + 1000,
        ):
            self.assertEqual(self.confirm_account(value).status_code, 409)
        self.account.name = "Synthetic renamed bank"
        self.account.save()
        self.assertEqual(self.confirm_account(value).status_code, 409)
        self.batch.refresh_from_db()
        self.assertIsNone(self.batch.account_verified_at)
        self.assertEqual(self.confirm_account(self.preview()).status_code, 200)
        self.batch.account_hint = "5678"
        self.batch.save()
        self.assertFalse(self.preview()["imports"][0]["verified"])

    def test_pathao_operation_normalization_is_narrow(self):
        from .unified import pair_signals

        self.pathao_pair()
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(pair_signals(self.row, self.sms)["strength"], "strong")
        self.batch.profile = "city_bank"
        self.batch.save()
        self.row.refresh_from_db()
        self.assertEqual(pair_signals(self.row, self.sms)["strength"], "possible")


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
