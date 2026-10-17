"""Synthetic evidence only; no live database or private PDF/SMS fixtures."""

import uuid
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import ParsedMessageCandidate, SmsCapturePreference
from apps.statements import test_unified
from apps.transactions.balance_reports import (
    reported_values,
    reviewed_account_report,
    select_effective_account_report,
)
from apps.transactions.models import Transaction
from apps.transactions.transfers import ensure_transfer_evidence

from .models import EvidenceProposal


class EvidenceProposalTests(APITestCase):
    candidate = test_unified.UnifiedReviewTests.candidate

    def setUp(self):
        test_unified.UnifiedReviewTests.setUp(self)
        self.sms.balance_after = self.row.balance_after
        self.sms.save()
        self.record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            direction="debit",
            amount=self.row.amount,
            date=self.row.date,
            time=self.row.time,
            balance_after=self.row.balance_after,
            source="web",
        )

    def ref(self, kind="sms", item=None):
        item = item or (self.sms if kind == "sms" else self.row)
        return {
            "kind": kind,
            "id": str(item.pk),
            "component": getattr(item, "component", "principal"),
        }

    def preview(self, kinds=("sms",), target=True):
        payload = {"sources": [self.ref(k) for k in kinds]}
        if target:
            payload["transaction"] = str(self.record.pk)
        response = self.client.post(
            reverse("evidence-proposal"), payload, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        return response.data

    def accept(self, preview, **fields):
        data = {
            "fingerprint": preview["fingerprint"],
            "idempotency_key": str(uuid.uuid4()),
            "acknowledge_match": True,
            "acknowledge_conflict": True,
            "acknowledge_issues": True,
            **fields,
        }
        return self.client.post(
            reverse("evidence-apply", args=[preview["id"]]), data, format="json"
        )

    def test_preview_is_read_only_and_does_not_store_raw_content(self):
        before = self.record.updated_at
        preview = self.preview(("sms", "statement"))
        self.assertEqual(preview["intent"], "attach")
        self.sms.refresh_from_db()
        self.row.refresh_from_db()
        self.record.refresh_from_db()
        self.assertEqual(self.sms.status, "needs_review")
        self.assertEqual(self.row.state, "pending")
        self.assertEqual(self.record.updated_at, before)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertFalse(AuditLogEntry.objects.exists())
        saved = EvidenceProposal.objects.get(pk=preview["id"])
        self.assertNotIn(self.sms.raw_message.body, str(saved.preview))
        self.assertEqual(preview["coverage_before"][0]["sms"], [])
        self.assertEqual(preview["coverage_after"][0]["statement"], [str(self.row.pk)])

    def test_late_sms_attaches_to_statement_first_purchase_without_ledger_change(self):
        self.row.transaction = self.record
        self.row.state = "posted"
        self.row.save()
        self.record.source = "import"
        self.record.save()
        before = (
            self.record.amount,
            self.record.type,
            self.record.account_id,
            self.record.balance_after,
        )
        result = self.accept(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.record.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(self.sms.transaction_id, self.record.pk)
        self.assertEqual(self.sms.status, "confirmed")
        self.assertEqual(
            (
                self.record.amount,
                self.record.type,
                self.record.account_id,
                self.record.balance_after,
            ),
            before,
        )
        self.assertIsNone(self.record.raw_message_id)
        self.assertEqual(result.data["coverage"][0]["sms"], [str(self.sms.pk)])
        self.assertEqual(result.data["coverage"][0]["statement"], [str(self.row.pk)])
        self.assertEqual(result.data["ledger_movements_added"], 0)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_late_statement_attaches_to_sms_first_purchase(self):
        self.sms.transaction = self.record
        self.sms.status = "confirmed"
        self.sms.save()
        result = self.accept(self.preview(("statement",)))
        self.assertEqual(result.status_code, 200, result.data)
        self.row.refresh_from_db()
        self.assertEqual(self.row.transaction_id, self.record.pk)
        self.assertEqual(self.row.state, "linked")
        self.assertEqual(len(result.data["coverage"][0]["sms"]), 1)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_both_sources_attach_without_copying_draft_classification(self):
        self.row.type = "income"
        self.row.save()
        result = self.accept(self.preview(("sms", "statement")))
        self.assertEqual(result.status_code, 200, result.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.type, "expense")
        self.assertEqual(len(result.data["coverage"][0]["sms"]), 1)
        self.assertEqual(len(result.data["coverage"][0]["statement"]), 1)

    def test_retries_return_receipt_without_duplicate_audit(self):
        preview = self.preview(("sms", "statement"))
        key = str(uuid.uuid4())
        first = self.accept(preview, idempotency_key=key)
        self.assertEqual(first.status_code, 200, first.data)
        count = AuditLogEntry.objects.count()
        second = self.accept(preview, idempotency_key=key)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertTrue(second.data["unchanged"])
        self.assertEqual(AuditLogEntry.objects.count(), count)
        self.assertEqual(self.accept(preview).status_code, 409)

    def test_stale_source_or_target_is_rejected(self):
        for model, item, changes in (
            (ParsedMessageCandidate, self.sms, {"balance_after": Decimal("12.00")}),
            (Transaction, self.record, {"note": "Synthetic correction"}),
        ):
            preview = self.preview()
            model.objects.filter(pk=item.pk).update(**changes)
            response = self.accept(preview)
            self.assertEqual(response.status_code, 409, response.data)
        self.sms.refresh_from_db()
        self.assertIsNone(self.sms.transaction_id)

    def test_new_competing_movement_invalidates_preview(self):
        preview = self.preview()
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            date=self.record.date,
            amount=self.record.amount,
            type="expense",
            direction="debit",
        )
        self.assertEqual(self.accept(preview).status_code, 409)

    def test_altered_policy_or_expiry_invalidates_preview(self):
        preview = self.preview()
        with patch("apps.reconciliation.proposals.POLICY_VERSION", "next-policy"):
            self.assertEqual(self.accept(preview).status_code, 409)
        EvidenceProposal.objects.filter(pk=preview["id"]).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.accept(preview).status_code, 409)

    def test_discovery_does_not_choose_or_auto_attach_equal_payments(self):
        preview = self.preview(target=False)
        self.assertEqual(preview["intent"], "blocked")
        self.assertEqual(preview["matches"][0]["id"], str(self.record.pk))
        self.assertEqual(self.accept(preview).status_code, 400)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_missing_acknowledgment_does_not_resolve_sources(self):
        response = self.accept(self.preview(), acknowledge_match=False)
        self.assertEqual(response.status_code, 400)
        self.sms.refresh_from_db()
        self.assertEqual(self.sms.status, "needs_review")

    def test_ownership_auth_and_components(self):
        preview = self.preview()
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.accept(preview).status_code, 404)
        response = self.client.post(
            reverse("evidence-proposal"), {"sources": [self.ref()]}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.user)
        response = self.client.post(
            reverse("evidence-proposal"),
            {"sources": [{**self.ref(), "component": "fee"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.accept(preview).status_code, 401)

    def test_wrong_amount_direction_currency_date_or_inactive_account_is_blocked(self):
        for changes in (
            {"amount": Decimal("102.00")},
            {"direction": "credit"},
            {"date": self.record.date - timedelta(days=4)},
        ):
            with transaction.atomic():
                Transaction.objects.filter(pk=self.record.pk).update(**changes)
                self.assertEqual(self.preview()["intent"], "blocked")
                transaction.set_rollback(True)
        self.account.is_active = False
        self.account.save()
        self.assertEqual(self.preview()["intent"], "blocked")

    def transfer(self, balance=None):
        self.record.type = "transfer"
        self.record.transfer_account = self.account
        self.record.account = self.wallet
        self.record.balance_after = balance
        self.record.source = "sms"
        self.record.save()
        self.sms.transaction_type = "income"
        self.sms.message_kind = "bank_transfer_in"
        self.sms.save()
        self.row.direction = "credit"
        self.row.save()

    def test_receiving_reports_fill_only_receiving_account(self):
        self.transfer(Decimal("3000.00"))
        result = self.accept(self.preview(("sms", "statement")))
        self.assertEqual(result.status_code, 200, result.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.balance_after, Decimal("3000.00"))
        self.assertEqual(
            reported_values(self.record)[self.account.pk], self.sms.balance_after
        )
        self.assertEqual(
            reported_values(self.record)[self.wallet.pk], Decimal("3000.00")
        )
        coverage = {r["account"]: r for r in result.data["coverage"]}
        self.assertEqual(coverage[str(self.wallet.pk)]["sms"], [])
        self.assertEqual(coverage[str(self.account.pk)]["sms"], [str(self.sms.pk)])

    def test_zero_balance_is_retained_and_conflict_requires_ack(self):
        self.transfer()
        ensure_transfer_evidence(self.record)
        report = reviewed_account_report(self.record, self.account, Decimal("0.00"))
        select_effective_account_report(self.record, report)
        preview = self.preview()
        self.assertFalse(preview["can_fill_missing_balance"])
        self.assertEqual(
            self.accept(preview, acknowledge_conflict=False).status_code, 400
        )
        self.assertEqual(self.accept(preview).status_code, 200)
        self.assertEqual(reported_values(self.record)[self.account.pk], Decimal("0.00"))

    def test_effective_null_is_protected(self):
        self.transfer()
        ensure_transfer_evidence(self.record)
        select_effective_account_report(
            self.record, reviewed_account_report(self.record, self.account, None)
        )
        preview = self.preview()
        self.assertFalse(preview["can_fill_missing_balance"])
        self.assertEqual(self.accept(preview).status_code, 200)
        self.assertIsNone(reported_values(self.record)[self.account.pk])

    def test_different_incoming_reports_require_explicit_choice(self):
        self.transfer()
        self.sms.balance_after = Decimal("5.00")
        self.sms.save()
        preview = self.preview(("sms", "statement"))
        self.assertIn("balance_source", preview["required_decisions"])
        self.assertEqual(self.accept(preview).status_code, 400)
        response = self.accept(preview, balance_source="sms")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(reported_values(self.record)[self.account.pk], Decimal("5.00"))

    def test_ordinary_null_is_not_automatically_replaced(self):
        self.record.balance_after = None
        self.record.save()
        result = self.accept(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.record.refresh_from_db()
        self.assertIsNone(self.record.balance_after)

    def test_retention_applies_without_losing_link(self):
        SmsCapturePreference.objects.create(user=self.user, raw_sms_retention_days=0)
        self.assertEqual(self.accept(self.preview()).status_code, 200)
        self.sms.refresh_from_db()
        self.sms.raw_message.refresh_from_db()
        self.assertEqual(self.sms.raw_message.status, "redacted")
        self.assertEqual(self.sms.transaction_id, self.record.pk)

    def test_atomic_rollback_when_second_source_fails(self):
        preview = self.preview(("sms", "statement"))
        with (
            patch(
                "apps.reconciliation.proposals.decide_locked",
                side_effect=ValueError("synthetic failure"),
            ),
            self.assertRaises(ValueError),
        ):
            self.accept(preview)
        self.sms.refresh_from_db()
        self.assertIsNone(self.sms.transaction_id)
        self.assertFalse(EvidenceProposal.objects.get(pk=preview["id"]).applied_at)
        self.assertFalse(AuditLogEntry.objects.exists())

    def test_already_linked_source_cannot_reassign(self):
        self.assertEqual(self.accept(self.preview()).status_code, 200)
        self.assertEqual(self.preview()["intent"], "blocked")

    def test_undo_or_later_edit_invalidates_accepted_receipt(self):
        preview = self.preview()
        key = str(uuid.uuid4())
        self.assertEqual(self.accept(preview, idempotency_key=key).status_code, 200)
        Transaction.objects.filter(pk=self.record.pk).update(
            note="Synthetic edit after link"
        )
        self.assertEqual(self.accept(preview, idempotency_key=key).status_code, 409)

    def test_idempotency_key_constraint_is_per_user(self):
        key = uuid.uuid4()
        preview = self.preview()
        self.assertEqual(
            self.accept(preview, idempotency_key=str(key)).status_code, 200
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            EvidenceProposal.objects.create(
                user=self.user,
                sources=[],
                fingerprint="x",
                preview={},
                expires_at=timezone.now(),
                idempotency_key=key,
            )
        EvidenceProposal.objects.create(
            user=self.other_user,
            sources=[],
            fingerprint="x",
            preview={},
            expires_at=timezone.now(),
            idempotency_key=key,
        )

    def test_history_limit_is_honest_and_blocks_apply(self):
        with patch("apps.reconciliation.proposals.MAX_HISTORY", 0):
            preview = self.preview()
            self.assertTrue(preview["truncated"])
            self.assertEqual(preview["intent"], "blocked")

    def test_signed_balance_does_not_need_positive_normalization(self):
        self.transfer()
        self.sms.balance_after = Decimal("-5.25")
        self.sms.save()
        result = self.accept(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(
            reported_values(self.record)[self.account.pk], Decimal("-5.25")
        )

    def test_primary_legacy_transfer_balance_is_not_lost_on_attachment(self):
        self.record.type = "transfer"
        self.record.transfer_account = self.wallet
        self.record.save()
        result = self.accept(self.preview(("statement",)))
        self.assertEqual(result.status_code, 200, result.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.balance_after, self.row.balance_after)
        self.assertEqual(
            reported_values(self.record)[self.account.pk], self.row.balance_after
        )

    def test_later_source_uses_attached_original_without_replacing_cleared_balance(
        self,
    ):
        # Ledger date and effective report were reviewed; original source remains
        # available as corroboration, including to the existing statement matcher.
        self.record.date = self.row.date - timedelta(days=10)
        self.record.balance_after = None
        self.record.save()
        self.sms.status = "confirmed"
        self.sms.transaction = self.record
        self.sms.save()
        preview = self.preview(("statement",))
        self.assertEqual(preview["intent"], "attach")
        self.assertTrue(preview["matches"][0]["signals"][0]["corroborated"])
        self.assertEqual(self.accept(preview).status_code, 200)
        self.record.refresh_from_db()
        self.assertIsNone(self.record.balance_after)
        self.assertEqual(self.record.date, self.row.date - timedelta(days=10))

    def test_new_link_invalidates_existing_latest_undo(self):
        from apps.transactions.recovery import ActionRecorder, describe

        with transaction.atomic():
            recorder = ActionRecorder(self.user, transaction_ids=[self.record.pk])
            self.record.note = "Synthetic reviewed change"
            self.record.save()
            action = recorder.finish(self.record, "update")
        self.assertTrue(describe(action, check=True)["can_undo"])
        self.assertEqual(self.accept(self.preview()).status_code, 200)
        self.assertFalse(describe(action, check=True)["can_undo"])

    def test_declared_response_schemas_validate_actual_preview_and_receipt(self):
        from .serializers import EvidenceProposalSerializer, EvidenceReceiptSerializer

        preview = self.preview(("sms", "statement"))
        schema = EvidenceProposalSerializer(data=preview)
        self.assertTrue(schema.is_valid(), schema.errors)
        result = self.accept(preview)
        self.assertEqual(result.status_code, 200, result.data)
        schema = EvidenceReceiptSerializer(data=result.data)
        self.assertTrue(schema.is_valid(), schema.errors)

    def test_latest_undo_restores_pending_sources_but_keeps_movement(self):
        result = self.accept(self.preview(("sms", "statement")))
        self.assertEqual(result.status_code, 200, result.data)
        self.assertTrue(result.data["undo_action"]["can_undo"])
        response = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(self.row.state, "pending")
        self.assertIsNone(self.row.transaction_id)
        self.assertEqual(self.sms.status, "needs_review")
        self.assertIsNone(self.sms.transaction_id)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_partial_failure_rolls_back_statement_link_and_sms(self):
        preview = self.preview(("sms", "statement"))
        from rest_framework.exceptions import ValidationError

        with patch(
            "apps.reconciliation.proposals.finish_sms_link",
            side_effect=ValidationError("Synthetic failure"),
        ):
            response = self.accept(preview)
        self.assertEqual(response.status_code, 400)
        self.row.refresh_from_db()
        self.assertEqual(self.row.state, "pending")
        self.assertIsNone(self.row.transaction_id)
        self.assertFalse(AuditLogEntry.objects.exists())

    def test_pruning_preview_metadata_is_bounded_and_keeps_source_links(self):
        from io import StringIO

        from django.core.management import call_command

        preview = self.preview()
        self.assertEqual(self.accept(preview).status_code, 200)
        EvidenceProposal.objects.filter(pk=preview["id"]).update(
            expires_at=timezone.now() - timedelta(days=31)
        )
        output = StringIO()
        call_command("purge_evidence_proposals", stdout=output)
        self.assertTrue(EvidenceProposal.objects.filter(pk=preview["id"]).exists())
        call_command("purge_evidence_proposals", apply=True, stdout=output)
        self.assertFalse(EvidenceProposal.objects.filter(pk=preview["id"]).exists())
        self.sms.refresh_from_db()
        self.assertEqual(self.sms.transaction_id, self.record.pk)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_missing_reporting_account_returns_blocked_preview(self):
        self.sms.account = None
        self.sms.save()
        preview = self.preview()
        self.assertEqual(preview["intent"], "blocked")
        self.assertEqual(self.accept(preview).status_code, 400)

    def test_supported_ordinary_types_keep_their_classification(self):
        for kind in ("expense", "income", "fee", "refund"):
            with self.subTest(kind=kind), transaction.atomic():
                direction = Transaction.default_direction_for_type(kind)
                self.record.type = kind
                self.record.direction = direction
                self.record.save()
                self.sms.transaction_type = kind
                self.sms.message_kind = (
                    "cash_in" if direction == "credit" else "card_purchase"
                )
                self.sms.save()
                response = self.accept(self.preview())
                self.assertEqual(response.status_code, 200, response.data)
                self.record.refresh_from_db()
                self.assertEqual(self.record.type, kind)
                self.assertEqual(Transaction.objects.count(), 1)
                transaction.set_rollback(True)

    def test_unknown_apply_fields_are_not_silently_ledger_edits(self):
        preview = self.preview()
        response = self.accept(preview, amount="123.00")
        self.assertEqual(response.status_code, 400)
        self.assertIn("amount", response.data)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_fee_inclusive_statement_balance_cannot_fill_principal(self):
        self.transfer()
        from apps.statements.models import StatementRow

        StatementRow.objects.create(
            batch=self.batch,
            position=self.row.position,
            component="fee",
            source_fingerprint="synthetic-fee-component",
            date=self.row.date,
            direction="debit",
            amount="1.00",
            type="fee",
            extracted={},
        )
        preview = self.preview(("statement",))
        self.assertEqual(
            preview["balance_choices"], [{"source": "existing", "value": None}]
        )
        result = self.accept(preview)
        self.assertEqual(result.status_code, 400, result.data)
        self.assertEqual(preview["intent"], "blocked")

    def test_differing_references_require_review_even_when_balances_agree(self):
        self.record.reference = "SYNTHETIC-REF-A"
        self.record.save()
        self.sms.reference = "SYNTHETIC-REF-B"
        self.sms.save()
        preview = self.preview()
        self.assertTrue(preview["matches"][0]["signals"][0]["corroborated"])
        self.assertTrue(preview["matches"][0]["signals"][0]["contradictions"])
        response = self.accept(preview, acknowledge_conflict=False)
        self.assertEqual(response.status_code, 400)

    def test_absent_incoming_reports_do_not_create_reviewed_null(self):
        from apps.transactions.balance_reports import can_fill_missing_transfer_balance

        self.transfer()
        self.row.balance_after = None
        self.row.save()
        self.sms.balance_after = None
        self.sms.save()
        result = self.accept(self.preview(("sms", "statement")))
        self.assertEqual(result.status_code, 200, result.data)
        self.assertTrue(can_fill_missing_transfer_balance(self.record, self.account.pk))
        self.assertFalse(
            self.record.transfer_evidence.filter(
                account=self.account, is_effective_balance=True
            ).exists()
        )
