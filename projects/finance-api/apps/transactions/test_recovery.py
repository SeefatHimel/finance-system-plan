"""Synthetic regression coverage for server-owned, version-checked undo."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SenderRule,
    SenderRuleMapping,
    SmsCapturePreference,
)

from .models import Transaction, TransactionAction, TransferEvidence
from .services import calculate_account_balance_summaries


class TransactionRecoveryTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-recovery")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(
            user=self.user, name="Synthetic A", type="bank", starting_balance="1000"
        )
        self.b = Account.objects.create(
            user=self.user, name="Synthetic B", type="bank", starting_balance="2000"
        )

    def create(self, **changes):
        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(self.a.pk),
                "type": "expense",
                "amount": "100.00",
                "date": "2026-10-12",
                **changes,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["undo_action"]["can_undo"])
        return response.data

    def undo(self, data):
        action = data.get("undo_action", data)
        return self.client.post(
            reverse("transaction-undo"), {"action": action["id"]}, format="json"
        )

    def candidate(self, **changes):
        raw = RawMessage.objects.create(
            user=self.user,
            sender="SYNTHETIC",
            body="Synthetic message only",
            body_hash=str(timezone.now()),
            received_at=timezone.now(),
        )
        return ParsedMessageCandidate.objects.create(
            user=self.user,
            raw_message=raw,
            account=self.a,
            amount="100.00",
            transaction_type="expense",
            message_kind="card_purchase",
            provider="bank",
            balance_after="0.00",
            **changes,
        )

    def test_create_undo_restores_balance_and_retry_has_no_second_effect(self):
        saved = self.create(balance_after="0.00")
        self.assertEqual(
            calculate_account_balance_summaries(accounts=[self.a])[
                self.a.pk
            ].ledger_balance,
            Decimal("900.00"),
        )
        response = self.undo(saved)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["undone"])
        self.assertFalse(response.data["can_undo"])
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(self.undo(saved).status_code, 200)
        self.assertEqual(
            calculate_account_balance_summaries(accounts=[self.a])[
                self.a.pk
            ].ledger_balance,
            Decimal("1000.00"),
        )

    def test_update_restores_all_details_and_two_account_reports(self):
        saved = self.create(
            type="transfer",
            transfer_account=str(self.b.pk),
            reported_balances=[
                {"account": str(self.a.pk), "balance_after": "900.00"},
                {"account": str(self.b.pk), "balance_after": "2100.00"},
            ],
        )
        created_at = Transaction.objects.get(pk=saved["id"]).created_at
        response = self.client.patch(
            reverse("transaction-detail", kwargs={"pk": saved["id"]}),
            {
                "note": "Synthetic edited note",
                "date": "2026-10-11",
                "reported_balances": [
                    {"account": str(self.a.pk), "balance_after": "0.00"},
                    {"account": str(self.b.pk), "balance_after": "2200.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.undo(response.data).status_code, 200)
        record = Transaction.objects.get(pk=saved["id"])
        self.assertEqual(record.created_at, created_at)
        self.assertEqual(record.note, "")
        self.assertEqual(str(record.date), "2026-10-12")
        self.assertEqual(record.balance_after, Decimal("900.00"))
        self.assertEqual(
            set(record.transfer_evidence.values_list("balance_after", flat=True)),
            {Decimal("900.00"), Decimal("2100.00")},
        )
        self.assertEqual(Transaction.objects.count(), 1)

    def test_newer_action_or_changed_record_blocks_undo(self):
        first = self.create()
        second = self.create()
        self.assertEqual(self.undo(first).status_code, 409)
        Transaction.objects.filter(pk=second["id"]).update(note="Another correction")
        self.assertEqual(self.undo(second).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertFalse(
            self.client.get(reverse("transaction-recent-action")).data["can_undo"]
        )

    def test_foreign_user_and_expired_actions_are_rejected(self):
        saved = self.create()
        other = get_user_model().objects.create_user(username="synthetic-other-owner")
        self.client.force_authenticate(other)
        self.assertEqual(self.undo(saved).status_code, 404)
        self.assertIsNone(self.client.get(reverse("transaction-recent-action")).data)
        self.client.force_authenticate(self.user)
        TransactionAction.objects.filter(pk=saved["undo_action"]["id"]).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.undo(saved).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_confirm_reopens_review_without_restoring_redacted_sms(self):
        candidate = self.candidate()
        SmsCapturePreference.objects.create(user=self.user, raw_sms_retention_days=0)
        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate.pk}),
            {"remember_mapping": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.undo(response.data).status_code, 200)
        candidate.refresh_from_db()
        candidate.raw_message.refresh_from_db()
        self.assertEqual(candidate.status, "needs_review")
        self.assertIsNone(candidate.transaction_id)
        self.assertEqual(candidate.balance_after, Decimal("0.00"))
        self.assertEqual(candidate.raw_message.body, "[redacted]")
        self.assertEqual(Transaction.objects.count(), 0)
        action = TransactionAction.objects.first()
        self.assertNotIn(
            "Synthetic message only", str(action.before) + str(action.after)
        )

    def test_confirm_undo_rolls_back_learned_rules_and_pending_choices(self):
        rule = SenderRule.objects.create(
            user=self.user,
            account=self.a,
            name="Synthetic sender",
            sender="DEMO",
            provider="bank",
        )
        candidate = self.candidate(sender_rule=rule)
        pending = self.candidate(sender_rule=rule)
        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate.pk}),
            {"account": str(self.b.pk), "remember_mapping": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        pending.refresh_from_db()
        self.assertEqual(pending.account_id, self.b.pk)
        self.assertEqual(SenderRuleMapping.objects.count(), 1)
        self.assertEqual(self.undo(response.data).status_code, 200)
        pending.refresh_from_db()
        self.assertEqual(pending.account_id, self.a.pk)
        self.assertEqual(SenderRuleMapping.objects.count(), 0)

    def test_link_undo_keeps_original_transfer_and_reopens_sms(self):
        original = self.create(
            type="transfer", transfer_account=str(self.b.pk), balance_after="900.00"
        )
        candidate = self.candidate()
        candidate.account = self.b
        candidate.destination_account = self.a
        candidate.transaction_type = "transfer"
        candidate.message_kind = "bank_transfer_in"
        candidate.balance_after = "2100.00"
        candidate.save()
        response = self.client.post(
            reverse("transaction-link-transfer"),
            {
                "candidate": str(candidate.pk),
                "match_transaction": original["id"],
                "draft": {
                    "account_perspective": True,
                    "account": str(self.b.pk),
                    "transfer_account": str(self.a.pk),
                    "direction": "credit",
                    "date": "2026-10-12",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TransferEvidence.objects.count(), 2)
        self.assertEqual(self.undo(response.data).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(TransferEvidence.objects.count(), 1)
        candidate.refresh_from_db()
        self.assertEqual(candidate.status, "needs_review")
        self.assertIsNone(candidate.transaction_id)
        self.assertEqual(Transaction.objects.first().balance_after, Decimal("900.00"))

    def test_merge_undo_restores_two_entries_and_original_evidence(self):
        first = self.create(
            type="transfer", transfer_account=str(self.b.pk), balance_after="900.00"
        )
        second = self.create(
            type="transfer",
            transfer_account=str(self.b.pk),
            balance_after="900.00",
            note="Synthetic second report",
        )
        response = self.client.post(
            reverse("transaction-merge-transfer", kwargs={"pk": first["id"]}),
            {"transaction": second["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(self.undo(response.data).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(
            Transaction.objects.get(pk=second["id"]).note, "Synthetic second report"
        )
        self.assertEqual(
            TransferEvidence.objects.filter(transaction_id=second["id"]).count(), 1
        )

    def test_new_evidence_blocks_create_undo_even_without_parent_timestamp_change(self):
        saved = self.create(type="transfer", transfer_account=str(self.b.pk))
        TransferEvidence.objects.create(
            user=self.user,
            transaction_id=saved["id"],
            account=self.b,
            date="2026-10-12",
            direction="credit",
            source="sms",
            balance_after="2100.00",
        )
        self.assertEqual(self.undo(saved).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(TransferEvidence.objects.count(), 2)

    def test_non_transfer_retry_reuses_record_and_undo_action(self):
        saved = self.create(external_key="synthetic-entry-key")
        retried = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(self.a.pk),
                "type": "expense",
                "amount": "100.00",
                "date": "2026-10-12",
                "external_key": "synthetic-entry-key",
            },
            format="json",
        )
        self.assertEqual(retried.status_code, 201, retried.data)
        self.assertEqual(retried.data["id"], saved["id"])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(TransactionAction.objects.count(), 1)

    def test_quick_entry_undo_keeps_retry_receipt_so_resync_cannot_recreate_it(self):
        import uuid

        payload = {
            "client_request_id": str(uuid.uuid4()),
            "account": str(self.a.pk),
            "category": None,
            "date": "2026-10-12",
            "time": None,
            "type": "expense",
            "amount": "100.00",
            "source": "web",
            "note": "Synthetic quick entry",
            "counterparty_text": "",
        }
        response = self.client.post(reverse("quick-add-entry"), payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.undo(response.data).status_code, 200)
        response = self.client.post(reverse("quick-add-entry"), payload, format="json")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_merge_undo_preserves_statement_observations_and_increments_versions(self):
        from apps.statements.models import StatementImport, StatementRow

        first = self.create(
            type="transfer", transfer_account=str(self.b.pk), balance_after="900.00"
        )
        second = self.create(
            type="transfer", transfer_account=str(self.b.pk), balance_after="900.00"
        )
        batch = StatementImport.objects.create(
            user=self.user,
            account=self.a,
            file_digest="synthetic-statement",
            profile="bank",
            parser_version="demo",
            currency="BDT",
            account_identity="verify",
            page_count=1,
            checks=[],
            warnings=[],
        )
        row = StatementRow.objects.create(
            batch=batch,
            position=1,
            component="principal",
            extracted={},
            source_fingerprint="synthetic-row",
            date="2026-10-12",
            direction="debit",
            amount="100.00",
            type="transfer",
            state="linked",
            transaction_id=second["id"],
        )
        response = self.client.post(
            reverse("transaction-merge-transfer", kwargs={"pk": first["id"]}),
            {"transaction": second["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        merged_version = row.version
        self.assertEqual(self.undo(response.data).status_code, 200)
        row.refresh_from_db()
        self.assertEqual(str(row.transaction_id), second["id"])
        self.assertGreater(row.version, merged_version)
        self.assertEqual(row.state, "linked")

    def test_superseded_action_keeps_metadata_but_discards_private_snapshots(self):
        first = self.create()
        self.create()
        old = TransactionAction.objects.get(pk=first["undo_action"]["id"])
        self.assertEqual(old.before, {})
        self.assertEqual(old.after, {})
        self.assertEqual(self.undo(first).status_code, 409)

    def test_new_payment_receipt_blocks_undo_without_a_parent_timestamp_change(self):
        import uuid

        from apps.quick_add.models import QuickEntryReceipt

        saved = self.create()
        QuickEntryReceipt.objects.create(
            user=self.user,
            client_request_id=uuid.uuid4(),
            fingerprint="synthetic-receipt",
            transaction_id=saved["id"],
        )
        self.assertEqual(self.undo(saved).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(QuickEntryReceipt.objects.count(), 1)

    def test_removed_original_account_blocks_edit_undo_without_server_error(self):
        saved = self.create()
        response = self.client.patch(
            reverse("transaction-detail", kwargs={"pk": saved["id"]}),
            {"account": str(self.b.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.a.delete()
        self.assertEqual(self.undo(response.data).status_code, 409)
        self.assertEqual(Transaction.objects.get(pk=saved["id"]).account_id, self.b.pk)

    def test_recovery_does_not_delete_a_concurrently_imported_pending_message(self):
        from django.db import transaction

        from .recovery import ActionRecorder

        rule = SenderRule.objects.create(
            user=self.user,
            account=self.a,
            name="Concurrent synthetic",
            sender="DEMO",
            provider="bank",
        )
        candidate = self.candidate(sender_rule=rule)
        with transaction.atomic():
            recorder = ActionRecorder(
                self.user, candidate_ids=(candidate.pk,), remember=True
            )
            incoming = self.candidate(sender_rule=rule)
            record = Transaction.objects.create(
                user=self.user,
                account=self.a,
                type="expense",
                amount="100.00",
                date="2026-10-12",
            )
            candidate.status = "confirmed"
            candidate.transaction = record
            candidate.save()
            recorder.finish(record, "confirm")
        response = self.undo(record.undo_action)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(ParsedMessageCandidate.objects.filter(pk=incoming.pk).exists())
