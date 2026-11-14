"""Batch/canonical parity, transaction rollback and source-preserving fallbacks."""

import json
from unittest.mock import patch

from django.db import IntegrityError
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import transaction_snapshot
from apps.categories.models import Category
from apps.messages.models import ParsedMessageCandidate, SmsCapturePreference
from apps.transactions.models import Transaction, TransactionAction, MergedLedgerEntry

from . import bulk_approval, bulk_writer, test_bulk_approval as fixtures
from .models import StatementRow, UnifiedApprovalBatch
from .services import row_snapshot


class BulkWriterTests(APITestCase):
    setUp = fixtures.BulkApprovalTests.setUp
    candidate = fixtures.BulkApprovalTests.candidate
    extra = fixtures.BulkApprovalTests.extra
    preview = fixtures.BulkApprovalTests.preview
    approve = fixtures.BulkApprovalTests.approve

    def undo(self, result):
        response = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_all_supported_ordinary_types_preserve_source_direction_and_balance(self):
        kinds = {
            "expense": ("expense", "debit"),
            "income": ("income", "credit"),
            "refund": ("income", "credit"),
            "lend": ("debt", "debit"),
            "borrow": ("debt", "credit"),
            "repayment_received": ("debt", "credit"),
            "repayment_paid": ("debt", "debit"),
        }
        for kind, (category_kind, direction) in kinds.items():
            with self.subTest(kind=kind):
                category = Category.objects.create(
                    user=self.user, name=f"Synthetic {kind}", kind=category_kind
                )
                balance = "900.00" if direction == "debit" else "1100.00"
                self.row.refresh_from_db()
                self.row.type, self.row.direction, self.row.category = (
                    kind,
                    direction,
                    category,
                )
                self.row.balance_after = balance
                self.row.extracted = {
                    **self.row.extracted,
                    "direction": direction,
                    "balance_after": balance,
                }
                self.row.save()
                self.batch.closing_balance = balance
                self.batch.save()
                self.sms.refresh_from_db()
                self.sms.transaction_type, self.sms.source_direction = kind, direction
                self.sms.category, self.sms.balance_after = category, balance
                self.sms.save()
                with patch.object(
                    bulk_approval, "confirm_pair", wraps=bulk_approval.confirm_pair
                ) as fallback:
                    result = self.approve(self.preview())
                self.assertEqual(result.status_code, 200, result.data)
                self.assertEqual(fallback.call_count, 0)
                record = Transaction.objects.get()
                self.assertEqual((record.type, record.direction), (kind, direction))
                self.assertEqual(str(record.balance_after), balance)
                self.row.refresh_from_db()
                self.assertEqual(self.row.extracted["direction"], direction)
                self.undo(result)

    def test_final_values_versions_sources_and_audits_match_canonical(self):
        pairs = [
            {
                **self.pairs[0],
                "edits": {
                    "description": "Synthetic reviewed merchant",
                    "note": "Synthetic edited note",
                },
            }
        ]
        snapshots = []
        for canonical in (True, False):
            self.row.refresh_from_db()
            starting_version = self.row.version
            existing = set(AuditLogEntry.objects.values_list("pk", flat=True))
            value = self.preview(pairs)
            if canonical:
                with patch.object(
                    bulk_approval, "write_ordinary_pairs", return_value={}
                ):
                    result = self.approve(value, pairs=pairs)
            else:
                result = self.approve(value, pairs=pairs)
            self.assertEqual(result.status_code, 200, result.data)
            record = Transaction.objects.get()
            self.row.refresh_from_db()
            self.sms.refresh_from_db()
            audits = []
            for entry in AuditLogEntry.objects.exclude(pk__in=existing).order_by(
                "created_at"
            ):
                metadata = {
                    k: v for k, v in entry.metadata.items() if k != "recorded_at"
                }
                audits.append(
                    (
                        entry.action,
                        entry.entity_type,
                        entry.before,
                        entry.after,
                        metadata,
                    )
                )
            snapshot = {
                "transaction": transaction_snapshot(record),
                "row": row_snapshot(self.row),
                "sms_status": self.sms.status,
                "extraction": self.row.extracted,
                "audits": audits,
            }

            def normalize_versions(value):
                if isinstance(value, dict):
                    return {
                        key: (
                            item - starting_version
                            if key == "version" and isinstance(item, int)
                            else normalize_versions(item)
                        )
                        for key, item in value.items()
                    }
                if isinstance(value, (list, tuple)):
                    return [normalize_versions(item) for item in value]
                return value

            snapshots.append(
                json.dumps(normalize_versions(snapshot), sort_keys=True).replace(
                    str(record.pk), "<record>"
                )
            )
            self.assertEqual(self.row.transaction_id, self.sms.transaction_id)
            self.undo(result)
            self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(snapshots[0], snapshots[1])

    def test_staged_cross_pair_conflict_rolls_back_every_write(self):
        self.extra()
        value = self.preview()
        create = Transaction.objects.bulk_create

        def introduce_conflict(records, *args, **kwargs):
            records = create(records, *args, **kwargs)
            record = records[0]
            record.amount = records[1].amount
            record.date = records[1].date
            record.reference = records[1].reference
            record.balance_after = records[1].balance_after
            record.counterparty_text = records[1].counterparty_text
            record.save()
            return records

        with patch.object(
            Transaction.objects, "bulk_create", side_effect=introduce_conflict
        ):
            result = self.approve(value)
        self.assertEqual(result.status_code, 409, result.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(UnifiedApprovalBatch.objects.count(), 0)
        self.assertEqual(TransactionAction.objects.count(), 0)
        self.assertEqual(StatementRow.objects.filter(state="pending").count(), 2)

    def test_late_integrity_failure_rolls_back_money_sources_and_audits(self):
        self.extra()
        value = self.preview()
        with patch.object(
            AuditLogEntry.objects,
            "bulk_create",
            side_effect=IntegrityError("synthetic failure"),
        ):
            result = self.approve(value)
        self.assertEqual(result.status_code, 409, result.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="needs_review").count(), 2
        )
        self.assertEqual(StatementRow.objects.filter(state="pending").count(), 2)
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(UnifiedApprovalBatch.objects.count(), 0)

    def test_retention_zero_uses_canonical_redaction(self):
        SmsCapturePreference.objects.create(user=self.user, raw_sms_retention_days=0)
        with patch.object(
            bulk_approval, "confirm_pair", wraps=bulk_approval.confirm_pair
        ) as confirm:
            result = self.approve(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(confirm.call_count, 1)
        self.sms.raw_message.refresh_from_db()
        self.assertIsNotNone(self.sms.raw_message.redacted_at)
        self.undo(result)
        self.sms.refresh_from_db()
        self.assertEqual(self.sms.status, "needs_review")
        self.assertIsNotNone(self.sms.raw_message.redacted_at)

    def test_legacy_identifier_uses_canonical_confirmation(self):
        self.sms.sender_account_identifier = " 1234 "
        self.sms.save()
        with patch.object(
            bulk_approval, "confirm_pair", wraps=bulk_approval.confirm_pair
        ) as confirm:
            result = self.approve(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(confirm.call_count, 1)
        self.assertEqual(Transaction.objects.get().sender_account_identifier, " 1234 ")
        self.undo(result)
        self.sms.refresh_from_db()
        self.assertEqual(self.sms.status, "needs_review")

    def test_mixed_ordinary_and_transfer_keep_reports_and_undo(self):
        self.extra()
        category = Category.objects.create(
            user=self.user, name="Synthetic transfer", kind="transfer"
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
        self.sms.save()
        with patch.object(
            bulk_approval, "confirm_pair", wraps=bulk_approval.confirm_pair
        ) as confirm:
            result = self.approve(self.preview())
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(confirm.call_count, 1)
        record = Transaction.objects.get(type="transfer")
        self.assertEqual(record.transfer_evidence.count(), 2)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(StatementRow.objects.filter(state="linked").count(), 2)
        self.undo(result)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(StatementRow.objects.filter(state="pending").count(), 2)

    def test_original_account_revision_change_aborts_before_writing(self):
        value = self.preview()
        write = bulk_approval.write_ordinary_pairs

        def change_account(**kwargs):
            self.account.name = "Synthetic changed account"
            self.account.save()
            return write(**kwargs)

        with patch.object(
            bulk_approval, "write_ordinary_pairs", side_effect=change_account
        ):
            result = self.approve(value)
        self.assertEqual(result.status_code, 409, result.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_existing_merge_archive_key_cannot_be_recorded_again(self):
        # Keep the archived surviving entry outside this statement's match window.
        from datetime import date

        survivor = Transaction.objects.create(
            user=self.user,
            account=self.account,
            amount="5.00",
            date=date(2025, 1, 1),
            type="expense",
            direction="debit",
        )
        from uuid import uuid4

        MergedLedgerEntry.objects.create(
            user=self.user,
            transaction=survivor,
            original_id=uuid4(),
            external_key=f"statement-row:{self.row.pk}",
            snapshot={},
        )
        result = self.approve(self.preview())
        self.assertEqual(result.status_code, 409, result.data)
        self.assertEqual(Transaction.objects.count(), 1)
