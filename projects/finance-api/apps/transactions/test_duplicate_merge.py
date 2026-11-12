"""Synthetic source-preserving financial merge regression coverage."""

import uuid
from datetime import date, time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.bulk_imports.models import BulkImport, BulkImportRow
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.messages.references import preferred_reference
from apps.quick_add.models import QuickEntryReceipt
from apps.statements.models import StatementImport, StatementRow

from .duplicate_merge import apply, preview
from .models import MergedLedgerEntry, Transaction, TransactionAction
from .recovery import UndoConflict, undo_action


class DuplicateMergeTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-merge")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(
            user=self.user, name="Synthetic wallet", type="mobile_wallet"
        )
        self.first = self.entry(source="import")
        self.second = self.entry(source="sms", reference="thanks")
        raw = RawMessage.objects.create(
            user=self.user,
            sender="SYNTHETIC",
            body="Received Tk 100. Ref: thanks. TrxID: TESTABC123. Balance Tk 800.",
            body_hash="synthetic",
            received_at=timezone.now(),
        )
        self.second.raw_message = raw
        self.second.save()
        self.sms = ParsedMessageCandidate.objects.create(
            user=self.user,
            raw_message=raw,
            account=self.account,
            amount="100",
            balance_after="800",
            reference="thanks",
            transaction_type="repayment_received",
            source_direction="credit",
            transaction=self.second,
            status="confirmed",
        )
        self.bulk = BulkImport.objects.create(
            user=self.user,
            account=self.account,
            source_hash="synthetic",
            original=b"synthetic encrypted fixture",
        )
        self.bulkrow = BulkImportRow.objects.create(
            batch=self.bulk,
            number=1,
            transaction=self.first,
            ledger_identity=self.first.pk,
            normalized={
                "reference": "TESTABC123",
                "note": "Synthetic spreadsheet note",
            },
        )
        self.row = self.statement_row()
        self.data = {
            "transactions": [self.first.pk, self.second.pk],
            "keep": self.first.pk,
            "statement_row": self.row.pk,
        }

    def entry(self, **changes):
        return Transaction.objects.create(
            user=self.user,
            account=self.account,
            date=date(2026, 10, 1),
            time=time(14),
            type="repayment_received",
            direction="credit",
            amount="100",
            balance_after="800",
            **{"reference": "TESTABC123", **changes},
        )

    def statement_row(self, **changes):
        batch = StatementImport.objects.create(
            user=self.user,
            account=self.account,
            file_digest=str(uuid.uuid4()),
            profile="bkash",
            parser_version="test",
            currency="BDT",
            account_identity="test",
            page_count=1,
        )
        return StatementRow.objects.create(
            batch=batch,
            position=1,
            component="principal",
            source_fingerprint=str(uuid.uuid4()),
            extracted={
                "reference": "TESTABC123",
                "description": "TRX ID: TESTABC123",
                "amount": "100",
                "direction": "credit",
                "balance_after": "800",
            },
            date=date(2026, 10, 1),
            time=time(14),
            direction="credit",
            type="repayment_received",
            amount="100",
            balance_after="800",
            **{"reference": "TESTABC123", **changes},
        )

    def save(self, data=None):
        data = data or self.data
        result = preview(self.user, data)
        self.assertEqual(result["blockers"], [])
        return apply(
            self.user,
            {
                **data,
                "preview_token": result["preview_token"],
                "request_id": uuid.uuid4(),
                "confirmed": True,
            },
        )

    def test_merge_keeps_all_sources_and_undo_restores_links_and_money(self):
        self.bulkrow.transaction = self.second
        self.bulkrow.ledger_identity = self.second.pk
        self.bulkrow.save()
        quick = QuickEntryReceipt.objects.create(
            user=self.user,
            client_request_id=uuid.uuid4(),
            fingerprint="test",
            transaction=self.second,
        )
        result = self.save()
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(Transaction.objects.first().amount, Decimal(100))
        self.sms.refresh_from_db()
        self.row.refresh_from_db()
        self.bulkrow.refresh_from_db()
        quick.refresh_from_db()
        for item in (self.sms, self.row, self.bulkrow, quick):
            self.assertEqual(item.transaction_id, self.first.pk)
        self.assertEqual(self.sms.reference, "thanks")
        self.assertEqual(
            self.sms.raw_message.body,
            "Received Tk 100. Ref: thanks. TrxID: TESTABC123. Balance Tk 800.",
        )
        self.assertEqual(self.row.extracted["reference"], "TESTABC123")
        self.assertEqual(self.bulkrow.normalized["note"], "Synthetic spreadsheet note")
        self.assertEqual(
            MergedLedgerEntry.objects.get().snapshot["reference"], "thanks"
        )
        response = self.client.get(
            reverse("transaction-source-messages", kwargs={"pk": self.first.pk})
        )
        self.assertEqual(len(response.data), 1)
        undo_action(user=self.user, action_id=result["undo_action"]["id"])
        self.assertEqual(Transaction.objects.count(), 2)
        self.sms.refresh_from_db()
        self.row.refresh_from_db()
        self.bulkrow.refresh_from_db()
        quick.refresh_from_db()
        self.assertEqual(self.sms.transaction_id, self.second.pk)
        self.assertEqual(self.bulkrow.ledger_identity, self.second.pk)
        self.assertEqual(quick.transaction_id, self.second.pk)
        self.assertIsNone(self.row.transaction_id)
        self.assertEqual(self.row.state, "pending")
        self.assertFalse(MergedLedgerEntry.objects.exists())

    def test_receipt_retries_are_idempotent_and_undo_cannot_be_replayed(self):
        p = preview(self.user, self.data)
        payload = {
            **self.data,
            "preview_token": p["preview_token"],
            "request_id": uuid.uuid4(),
            "confirmed": True,
        }
        first = apply(self.user, payload)
        self.assertEqual(apply(self.user, payload)["transaction"], first["transaction"])
        self.assertEqual(MergedLedgerEntry.objects.count(), 1)
        undo_action(user=self.user, action_id=first["undo_action"]["id"])
        from .duplicate_merge import MergeConflict

        with self.assertRaises(MergeConflict):
            apply(self.user, payload)

    def test_stale_preview_or_changed_source_never_changes_money(self):
        p = preview(self.user, self.data)
        self.sms.raw_message.body = "Received Tk 100. TrxID: OTHER123"
        self.sms.raw_message.save()
        from .duplicate_merge import MergeConflict

        with self.assertRaises(MergeConflict):
            apply(
                self.user,
                {
                    **self.data,
                    "preview_token": p["preview_token"],
                    "request_id": uuid.uuid4(),
                    "confirmed": True,
                },
            )
        self.assertEqual(Transaction.objects.count(), 2)

    def test_true_transaction_id_conflict_blocks_but_message_reference_does_not(self):
        self.assertEqual(preview(self.user, self.data)["blockers"], [])
        self.sms.raw_message.body = "Received Tk 100. TrxID: OTHER123"
        self.sms.raw_message.save()
        self.assertIn(
            "different transaction IDs",
            " ".join(preview(self.user, self.data)["blockers"]),
        )

    def test_owner_direction_amount_path_and_date_guards(self):
        for field, value in (
            ("direction", "debit"),
            ("amount", "101"),
            ("date", date(2026, 9, 1)),
        ):
            original = getattr(self.second, field)
            setattr(self.second, field, value)
            self.second.save()
            self.assertTrue(preview(self.user, self.data)["blockers"])
            setattr(self.second, field, original)
            self.second.save()
        outsider = get_user_model().objects.create_user(username="outsider")
        self.second.user = outsider
        self.second.save()
        response = self.client.post(
            reverse("transaction-merge-preview"), self.data, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_same_statement_batch_collision_blocks(self):
        other = self.statement_row(transaction=self.second, state="linked")
        other.batch = self.row.batch
        other.position = 2
        other.save()
        self.assertIn(
            "same statement", " ".join(preview(self.user, self.data)["blockers"])
        )

    def test_changed_related_source_blocks_undo(self):
        saved = self.save()
        self.bulkrow.normalized = {"note": "Changed after merge"}
        self.bulkrow.save()
        with self.assertRaises(UndoConflict):
            undo_action(user=self.user, action_id=saved["undo_action"]["id"])

    def test_legacy_sms_without_candidate_is_still_readable(self):
        self.sms.delete()
        saved = self.save()
        response = self.client.get(
            reverse("transaction-source-messages", kwargs={"pk": saved["transaction"]})
        )
        self.assertEqual(len(response.data), 1)
        self.assertIn("TESTABC123", response.data[0]["body"])

    def test_parser_prioritizes_transaction_id_over_earlier_message_reference(self):
        self.assertEqual(
            preferred_reference("Ref: thanks TrxID: TESTABC123"), "TESTABC123"
        )
        self.assertEqual(
            preferred_reference("Trx ID: TESTABC123 Ref: thanks"), "TESTABC123"
        )
        self.assertEqual(preferred_reference("Reference: gift"), "gift")

    def test_invalid_requests_and_unconfirmed_apply_are_rejected(self):
        for changes in (
            {"transactions": [self.first.pk, self.first.pk]},
            {"keep": uuid.uuid4()},
        ):
            response = self.client.post(
                reverse("transaction-merge-preview"),
                {**self.data, **changes},
                format="json",
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.post(
            reverse("transaction-merge-duplicates"),
            {
                **self.data,
                "confirmed": False,
                "preview_token": "invalid",
                "request_id": uuid.uuid4(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_balances_and_notes_remain_as_reviewed_keeper_and_archive(self):
        self.second.balance_after = Decimal(900)
        self.second.note = "Synthetic alternate note"
        self.second.save()
        self.save()
        self.first.refresh_from_db()
        self.assertEqual(self.first.balance_after, Decimal(800))
        self.assertEqual(
            MergedLedgerEntry.objects.get().snapshot["balance_after"], "900.00"
        )

    def test_old_action_shape_can_be_undone(self):
        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(self.account.pk),
                "date": "2026-10-01",
                "type": "expense",
                "direction": "debit",
                "amount": "15",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        action = TransactionAction.objects.get(pk=response.data["undo_action"]["id"])
        for key in ("bulk_rows", "quick_receipts", "memberships", "merge_archives"):
            action.before.pop(key)
            action.after.pop(key)
        action.save()
        undo_action(user=self.user, action_id=action.pk)
        self.assertFalse(Transaction.objects.filter(pk=response.data["id"]).exists())

    def test_three_duplicates_merge_and_all_versions_remain(self):
        third = self.entry(source="web")
        saved = self.save(
            {**self.data, "transactions": [self.first.pk, self.second.pk, third.pk]}
        )
        self.assertEqual(len(saved["removed"]), 2)
        self.assertEqual(MergedLedgerEntry.objects.count(), 2)
        undo_action(user=self.user, action_id=saved["undo_action"]["id"])
        self.assertEqual(Transaction.objects.count(), 3)

    def test_redacted_sms_does_not_invent_a_transaction_id(self):
        from .duplicate_merge import sources_for

        self.sms.raw_message.redact(reason="manual")
        sms = next(
            source for source in sources_for(self.second) if source["kind"] == "SMS"
        )
        self.assertEqual(sms["transaction_id"], "")
        self.assertEqual(sms["message_reference"], "")
        self.assertNotIn("Received Tk", sms["text"])
        self.save()
        self.sms.raw_message.refresh_from_db()
        self.assertEqual(self.sms.raw_message.body, "[redacted]")

    def test_preview_expiration_and_unexpected_ownership_fail_closed(self):
        from unittest.mock import patch

        from django.core.signing import SignatureExpired

        from .duplicate_merge import MergeConflict

        p = preview(self.user, self.data)
        with (
            patch(
                "apps.transactions.duplicate_merge.signing.loads",
                side_effect=SignatureExpired(),
            ),
            self.assertRaises(MergeConflict),
        ):
            apply(
                self.user,
                {
                    **self.data,
                    "preview_token": p["preview_token"],
                    "request_id": uuid.uuid4(),
                    "confirmed": True,
                },
            )
        self.assertEqual(Transaction.objects.count(), 2)
        other = get_user_model().objects.create_user(username="foreign-source")
        self.bulk.user = other
        self.bulk.save()
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            preview(self.user, self.data)

    def test_protected_payment_link_is_never_deleted(self):
        from apps.debts.models import Debt

        Debt.objects.create(
            user=self.user,
            opened_transaction=self.second,
            counterparty_name="Synthetic borrower",
            direction="lent_by_me",
            principal_amount="100",
            current_balance="100",
            opened_at="2026-10-01",
        )
        self.assertIn(
            "protected link", " ".join(preview(self.user, self.data)["blockers"])
        )
        self.assertEqual(Transaction.objects.count(), 2)

    def test_report_membership_moves_and_undo_restores_it(self):
        from apps.reports.models import ReportMembership, SavedReport

        report = SavedReport.objects.create(
            user=self.user,
            name="Synthetic report",
            start_date="2026-10-01",
            end_date="2026-10-31",
        )
        membership = ReportMembership.objects.create(
            report=report, transaction=self.second, included=True
        )
        saved = self.save()
        membership.refresh_from_db()
        self.assertEqual(membership.transaction_id, self.first.pk)
        undo_action(user=self.user, action_id=saved["undo_action"]["id"])
        membership.refresh_from_db()
        self.assertEqual(membership.transaction_id, self.second.pk)

    def test_transfer_effective_balance_and_both_accounts_remain_unchanged(self):
        from .models import TransferEvidence

        other = Account.objects.create(
            user=self.user, name="Synthetic destination", type="cash"
        )
        for entry in (self.first, self.second):
            entry.type = "transfer"
            entry.direction = "debit"
            entry.transfer_account = other
            entry.raw_message = None
            entry.save()
        self.sms.delete()
        self.data.pop("statement_row")
        for entry, value in ((self.first, "800"), (self.second, "900")):
            TransferEvidence.objects.create(
                user=self.user,
                transaction=entry,
                account=self.account,
                direction="debit",
                date=entry.date,
                source="import",
                balance_after=value,
                is_effective_balance=True,
            )
        saved = self.save()
        self.assertEqual(TransferEvidence.objects.count(), 2)
        self.assertEqual(
            TransferEvidence.objects.get(is_effective_balance=True).balance_after,
            Decimal(800),
        )
        undo_action(user=self.user, action_id=saved["undo_action"]["id"])
        self.assertEqual(
            TransferEvidence.objects.filter(is_effective_balance=True).count(), 2
        )

    def test_source_badges_reflect_merged_sources(self):
        saved = self.save()
        response = self.client.get(
            reverse("transaction-detail", kwargs={"pk": saved["transaction"]})
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["source_labels"], ["SMS", "PDF", "Spreadsheet"])

    def test_statement_comparison_uses_original_transaction_id_without_rewriting_reference(
        self,
    ):
        from .reference_comparison import observation_references

        self.assertEqual(
            observation_references(self.second, self.second)["transaction_id"],
            "TESTABC123",
        )
        self.second.refresh_from_db()
        self.assertEqual(self.second.reference, "thanks")

    def test_removed_external_key_cannot_create_the_duplicate_again(self):
        self.second.external_key = "synthetic-retry-key"
        self.second.save()
        self.save()
        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(self.account.pk),
                "date": "2026-10-01",
                "type": "repayment_received",
                "direction": "credit",
                "amount": "100",
                "external_key": "synthetic-retry-key",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_import_batch_undo_cannot_delete_a_merged_legacy_sms(self):
        from rest_framework.exceptions import APIException

        from apps.bulk_imports.services import record_fingerprint, undo_batch

        self.sms.delete()
        self.bulk.state = "committed"
        self.bulk.save()
        self.bulkrow.created_entry = True
        self.bulkrow.saved_fingerprint = record_fingerprint(self.first)
        self.bulkrow.save()
        self.save(
            {key: value for key, value in self.data.items() if key != "statement_row"}
        )
        with self.assertRaises(APIException):
            undo_batch(self.user, self.bulk.pk)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertTrue(MergedLedgerEntry.objects.exists())

    def test_deleted_entry_after_preview_returns_a_refreshable_conflict(self):
        from .duplicate_merge import MergeConflict

        p = preview(self.user, self.data)
        self.second.delete()
        with self.assertRaises(MergeConflict):
            apply(
                self.user,
                {
                    **self.data,
                    "preview_token": p["preview_token"],
                    "request_id": uuid.uuid4(),
                    "confirmed": True,
                },
            )
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertFalse(MergedLedgerEntry.objects.exists())

    def test_legacy_reference_reads_are_batched_without_observation_queries(self):
        from .reference_comparison import (
            observation_references,
            prepare_reference_messages,
        )

        self.sms.delete()
        records = list(
            Transaction.objects.filter(pk=self.second.pk).prefetch_related(
                "transfer_evidence", "parsed_message_candidates"
            )
        )
        with self.assertNumQueries(1):
            prepare_reference_messages(records, self.user.pk)
        with self.assertNumQueries(0):
            facts = observation_references(records[0], records[0])
        self.assertEqual(facts["transaction_id"], "TESTABC123")
