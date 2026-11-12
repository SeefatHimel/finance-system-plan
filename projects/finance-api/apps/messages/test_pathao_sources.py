"""Synthetic Pathao alias notifications; originals are never collapsed/deleted."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.transactions.models import Transaction

from .models import ParsedMessageCandidate, RawMessage, SenderRule, SmsCapturePreference
from .pathao_sources import source_plan
from .sender_groups import PATHAO_SENDERS


class PathaoSourceTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username="synthetic-pathao-source"
        )
        self.wallet = Account.objects.create(
            user=self.user,
            name="Synthetic Pathao wallet",
            type="mobile_wallet",
            currency="BDT",
        )
        self.client.force_authenticate(self.user)
        self.rules = [
            SenderRule.objects.create(
                user=self.user,
                account=self.wallet,
                provider="pathao_pay",
                sender=sender,
                name=f"Synthetic rule {index}",
            )
            for index, sender in enumerate(PATHAO_SENDERS)
        ]

    def sms(
        self, index=0, *, ref="SYNTH123456", amount="100.00", balance="900.00", minute=0
    ):
        local = datetime(2026, 1, 2, 12, minute, tzinfo=ZoneInfo("Asia/Dhaka"))
        result = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": PATHAO_SENDERS[index],
                "body": f"Pathao Pay payment BDT {amount} to SYNTHETIC MERCHANT successful. Balance BDT {balance}. Ref {ref}.",
                "received_at": local.isoformat(),
                "device_message_id": f"synthetic-{index}-{ref}-{minute}-{amount}",
            },
            format="json",
        )
        self.assertIn(result.status_code, (200, 201), result.data)
        return ParsedMessageCandidate.objects.get(pk=result.data["candidate"]["id"])

    def confirm(self, sms, **fields):
        return self.client.post(
            reverse("message-candidate-confirm", args=[sms.pk]),
            {"account": str(self.wallet.pk), "remember_mapping": False, **fields},
            format="json",
        )

    def review(self, sms, **query):
        result = self.client.get(reverse("pathao-sms-sources", args=[sms.pk]), query)
        self.assertEqual(result.status_code, 200, result.data)
        return result.data

    def resolve(self, sms, preview, **fields):
        import uuid

        payload = {
            "preview_token": preview["preview_token"],
            "confirmed": True,
            "request_id": str(uuid.uuid4()),
            **fields,
        }
        return self.client.post(
            reverse("pathao-sms-sources", args=[sms.pk]), payload, format="json"
        ), payload

    def test_existing_four_rules_are_grouped_without_recreation_or_choice_changes(self):
        self.rules[1].is_active = False
        self.rules[1].default_transaction_type = "expense"
        self.rules[1].save()
        response = self.client.post(
            reverse("pathao-sender-group"),
            {"account": str(self.wallet.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            {item["id"] for item in response.data},
            {str(rule.pk) for rule in self.rules},
        )
        self.assertTrue(
            all(item["sender_group"] == "pathao_pay" for item in response.data)
        )
        self.rules[1].refresh_from_db()
        self.assertFalse(self.rules[1].is_active)
        self.assertEqual(self.rules[1].default_transaction_type, "expense")
        self.assertEqual(SenderRule.objects.count(), 4)

    def test_group_adds_missing_aliases_and_conflicting_routes_roll_back(self):
        self.rules[1].delete()
        self.rules[2].delete()
        result = self.client.post(
            reverse("pathao-sender-group"),
            {"account": str(self.wallet.pk)},
            format="json",
        )
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(SenderRule.objects.count(), 4)
        other = Account.objects.create(
            user=self.user, name="Synthetic other wallet", type="mobile_wallet"
        )
        blocked = self.client.post(
            reverse("pathao-sender-group"), {"account": str(other.pk)}, format="json"
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(SenderRule.objects.filter(account=self.wallet).count(), 4)

    def test_four_notifications_confirm_one_transaction_with_all_originals_and_undo(
        self,
    ):
        sources = [self.sms(index, minute=index) for index in range(4)]
        view = self.review(sources[0])
        self.assertEqual(len(view["sources"]), 4)
        self.assertEqual(Transaction.objects.count(), 0)
        result = self.confirm(sources[0])
        self.assertEqual(result.status_code, 200, result.data)
        record = Transaction.objects.get()
        self.assertEqual(record.amount, Decimal("100.00"))
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(
                transaction=record, status="confirmed"
            ).count(),
            4,
        )
        self.assertEqual(RawMessage.objects.count(), 4)
        self.assertTrue(
            all("SYNTHETIC MERCHANT" in item.body for item in RawMessage.objects.all())
        )
        undone = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undone.status_code, 200, undone.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="needs_review").count(), 4
        )

    def test_later_alias_notification_links_without_recording_money_twice(self):
        first = self.sms()
        self.assertEqual(self.confirm(first).status_code, 200)
        later = self.sms(1, minute=5)
        result = self.confirm(later)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(
                transaction=Transaction.objects.get()
            ).count(),
            2,
        )

    def test_reference_or_balance_disagreement_never_auto_combines(self):
        first = self.sms()
        self.sms(1, ref="SYNTH654321", minute=1)
        result = self.confirm(first)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="needs_review").count(), 1
        )
        bad = self.sms(2, balance="800.00", minute=2)
        blocked = self.confirm(bad)
        self.assertEqual(blocked.status_code, 409, blocked.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_same_reference_different_amount_or_direction_is_blocked(self):
        first = self.sms()
        self.sms(1, amount="200.00", minute=1)
        blocked = self.confirm(first)
        self.assertEqual(blocked.status_code, 409, blocked.data)
        self.assertIn("conflicting amount", str(blocked.data))
        self.assertEqual(Transaction.objects.count(), 0)

    def test_retention_keeps_verified_reference_for_future_duplicate_detection(self):
        SmsCapturePreference.objects.create(user=self.user, raw_sms_retention_days=0)
        first = self.sms()
        self.assertEqual(self.confirm(first).status_code, 200)
        first.refresh_from_db()
        self.assertTrue(first.source_transaction_id)
        later = self.sms(1, minute=1)
        result = self.confirm(later)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="confirmed").count(), 2
        )

    def test_legacy_candidates_use_original_body_not_edited_reference(self):
        first = self.sms()
        second = self.sms(1, minute=1)
        ParsedMessageCandidate.objects.update(
            source_transaction_id="", reference="thanks"
        )
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(len(source_plan(first)["sources"]), 2)
        result = self.confirm(first)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_preview_staleness_and_cross_user_sources_are_rejected(self):
        first = self.sms()
        self.assertEqual(self.confirm(first).status_code, 200)
        pending = self.sms(1, minute=1)
        view = self.review(pending)
        self.sms(2, minute=2)
        blocked, _ = self.resolve(pending, view)
        self.assertEqual(blocked.status_code, 409)
        other = get_user_model().objects.create_user(
            username="synthetic-other-source-owner"
        )
        self.client.force_authenticate(other)
        self.assertEqual(
            self.client.get(
                reverse("pathao-sms-sources", args=[pending.pk])
            ).status_code,
            404,
        )

    def test_link_existing_preview_is_idempotent_and_undo_retains_old_sources(self):
        first = self.sms()
        self.assertEqual(self.confirm(first).status_code, 200)
        later = self.sms(1, minute=1)
        result, payload = self.resolve(later, self.review(later))
        self.assertEqual(result.status_code, 200, result.data)
        retry = self.client.post(
            reverse("pathao-sms-sources", args=[later.pk]), payload, format="json"
        )
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(status="confirmed").count(), 2
        )

    def test_existing_double_entries_merge_and_keep_pending_sources(self):
        first, second, third = [self.sms(index, minute=index) for index in range(3)]
        records = []
        for item in (first, second):
            record = Transaction.objects.create(
                user=self.user,
                account=self.wallet,
                date="2026-01-02",
                type="expense",
                direction="debit",
                amount="100.00",
                balance_after="900.00",
                reference="SYNTH123456",
                raw_message=item.raw_message,
                source="sms",
            )
            item.transaction = record
            item.status = "confirmed"
            item.save()
            records.append(record)
        view = self.review(third)
        self.assertEqual(len(view["transactions"]), 2)
        result, _ = self.resolve(third, view)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(
                transaction=Transaction.objects.get(), status="confirmed"
            ).count(),
            3,
        )
        undone = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undone.status_code, 200, undone.data)
        self.assertEqual(Transaction.objects.count(), 2)
        third.refresh_from_db()
        self.assertEqual(third.status, "needs_review")

    def statement(self, record, reference="SYNTH123456"):
        import uuid

        from apps.statements.models import StatementImport, StatementRow

        batch = StatementImport.objects.create(
            user=self.user,
            account=self.wallet,
            file_digest=str(uuid.uuid4()),
            profile="pathao_pay",
            parser_version="synthetic",
            currency="BDT",
            account_identity="synthetic",
            page_count=1,
        )
        return StatementRow.objects.create(
            batch=batch,
            position=1,
            component="principal",
            source_fingerprint=str(uuid.uuid4()),
            extracted={
                "reference": reference,
                "amount": "100.00",
                "direction": "debit",
                "balance_after": "900.00",
            },
            reference=reference,
            date="2026-01-02",
            direction="debit",
            type="expense",
            amount="100.00",
            balance_after="900.00",
            transaction=record,
        )

    def entry(self, **changes):
        return Transaction.objects.create(
            user=self.user,
            account=self.wallet,
            date="2026-01-02",
            type="expense",
            direction="debit",
            amount="100.00",
            balance_after="900.00",
            **changes,
        )

    def test_statement_posted_first_is_reused_by_original_reference(self):
        record = self.entry(source="import")
        row = self.statement(record)
        sms = self.sms()
        result, _ = self.resolve(sms, self.review(sms))
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(Transaction.objects.count(), 1)
        row.refresh_from_db()
        sms.refresh_from_db()
        self.assertEqual(sms.transaction_id, row.transaction_id)

    def test_edited_statement_reference_cannot_create_automatic_source_identity(self):
        record = self.entry(source="import")
        row = self.statement(record, reference="OTHER123456")
        row.reference = "SYNTH123456"
        row.save()
        sms = self.sms()
        self.assertEqual(self.review(sms)["transactions"], [])

    def test_already_recorded_merge_retains_pdf_spreadsheet_and_every_sms(self):
        from apps.bulk_imports.models import BulkImport, BulkImportRow

        first, second = [self.sms(index, minute=index) for index in range(2)]
        one, two = self.entry(source="import"), self.entry(source="sms")
        row = self.statement(two)
        batch = BulkImport.objects.create(
            user=self.user,
            account=self.wallet,
            source_hash="synthetic-group",
            original=b"synthetic fixture",
        )
        bulk = BulkImportRow.objects.create(
            batch=batch,
            number=1,
            transaction=two,
            ledger_identity=two.pk,
            normalized={"reference": "SYNTH123456"},
        )
        for sms, entry in ((first, one), (second, two)):
            sms.transaction = entry
            sms.status = "confirmed"
            sms.save()
        view = self.review(first, keep=str(one.pk))
        self.assertTrue(view["can_resolve"], view)
        result, payload = self.resolve(first, view)
        self.assertEqual(result.status_code, 200, result.data)
        row.refresh_from_db()
        bulk.refresh_from_db()
        self.assertEqual(row.transaction_id, one.pk)
        self.assertEqual(bulk.transaction_id, one.pk)
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(transaction=one).count(), 2
        )
        self.assertEqual(row.extracted["reference"], "SYNTH123456")
        undo = self.client.post(
            reverse("transaction-undo"),
            {"action": result.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        row.refresh_from_db()
        bulk.refresh_from_db()
        self.assertEqual(row.transaction_id, two.pk)
        self.assertEqual(bulk.transaction_id, two.pk)
        retry = self.client.post(
            reverse("pathao-sms-sources", args=[first.pk]), payload, format="json"
        )
        self.assertEqual(retry.status_code, 409)

    def test_no_provider_id_never_groups_same_amount(self):
        first, second = self.sms(), self.sms(1, minute=1)
        for sms in (first, second):
            sms.source_transaction_id = ""
            sms.save()
            sms.raw_message.body = (
                "Pathao Pay payment BDT 100.00 successful. Balance BDT 900.00."
            )
            sms.raw_message.save()
        self.assertEqual(len(source_plan(first)["sources"]), 1)
        self.assertEqual(self.confirm(first).status_code, 200)
        self.assertEqual(self.confirm(second).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_redacted_legacy_reference_requires_manual_review(self):
        first = self.sms()
        self.assertEqual(self.confirm(first).status_code, 200)
        first.source_transaction_id = ""
        first.save()
        first.raw_message.redact(reason="retention")
        pending = self.sms(1, minute=1)
        view = self.review(pending)
        self.assertTrue(view["blockers"])
        self.assertEqual(self.confirm(pending).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_conflicting_fee_or_direction_is_blocked(self):
        first, second = self.sms(), self.sms(1, minute=1)
        second.fee_amount = Decimal("1.00")
        second.source_direction = "credit"
        second.save()
        first.fee_amount = Decimal("0.00")
        first.save()
        view = self.review(first)
        self.assertIn("conflicting debit/credit", str(view["blockers"]))
        self.assertIn("conflicting fee", str(view["blockers"]))
        self.assertEqual(self.confirm(first).status_code, 409)

    def test_transfer_duplicates_keep_each_reporting_side_evidence(self):
        from apps.transactions.models import TransferEvidence

        bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        first = self.sms()
        self.sms(1, minute=1)
        result = self.confirm(first, type="transfer", transfer_account=str(bank.pk))
        self.assertEqual(result.status_code, 200, result.data)
        record = Transaction.objects.get()
        self.assertEqual(record.type, "transfer")
        self.assertEqual(record.account_id, self.wallet.pk)
        self.assertEqual(
            TransferEvidence.objects.filter(
                transaction=record, account=self.wallet
            ).count(),
            2,
        )
        self.assertEqual(
            ParsedMessageCandidate.objects.filter(transaction=record).count(), 2
        )

    def test_unknown_amount_preview_stays_explicit_and_read_only(self):
        source = self.sms()
        source.amount = None
        source.save()
        view = self.review(source)
        self.assertIsNone(view["sources"][0]["amount"])
        self.assertFalse(view["available"])
        self.assertFalse(view["can_resolve"])
        self.assertEqual(Transaction.objects.count(), 0)

    def test_undo_snapshot_compares_each_provider_id_only_once(self):
        from unittest.mock import patch

        from apps.transactions.recovery import ActionRecorder

        sources = [self.sms(index, minute=index) for index in range(4)]
        with patch(
            "apps.messages.pathao_sources.source_plan", wraps=source_plan
        ) as compare:
            snapshot = ActionRecorder(
                self.user, candidate_ids=[source.pk for source in sources]
            )
        self.assertEqual(compare.call_count, 1)
        self.assertEqual(len(snapshot.candidate_ids), 4)
