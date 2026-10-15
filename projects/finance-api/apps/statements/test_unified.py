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
from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SmsCapturePreference,
)
from apps.transactions.balance_reports import reported_values
from apps.transactions.models import Transaction, TransferEvidence

from .models import StatementImport, StatementRow
from .services import review_context
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
            counterparty_text=fields.pop("counterparty_text", "Synthetic Cafe"),
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

    def draft(self, **overrides):
        return {
            "version": self.row.version,
            "date": self.row.date.isoformat(),
            "time": self.row.time.isoformat() if self.row.time else None,
            "value_date": None,
            "direction": self.row.direction,
            "amount": str(self.row.amount),
            "balance_after": str(self.row.balance_after),
            "type": self.row.type,
            "other_account": str(self.row.other_account_id) if self.row.other_account_id else None,
            "category": str(self.row.category_id) if self.row.category_id else None,
            "reference": self.row.reference,
            "counterparty_text": self.row.counterparty_text,
            "note": self.row.note,
            "classification_confirmed": True,
            **overrides,
        }

    def confirm(self, **overrides):
        return self.client.post(
            reverse("unified-pair"), self.payload(**overrides), format="json"
        )

    def test_queue_filters_and_read_only_detail(self):
        self.candidate(account=self.wallet, amount="99.00")
        response = self.client.get(reverse("unified-pending"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["overview"],
            {"matched": 1, "ambiguous": 0, "statement_only": 0, "sms_only": 1},
        )
        self.assertIsNone(response.data["next_cursor"])
        pair = response.data["results"][0]
        self.assertEqual(pair["statement"]["id"], str(self.row.pk))
        self.assertEqual(pair["sms"]["id"], str(self.sms.pk))
        self.assertTrue(pair["match"]["conflict"])
        response = self.client.get(
            reverse("unified-pending"),
            {"search": "Synthetic Cafe", "limit": 1},
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
        self.assertEqual(response.data["sms_summary"]["account"], str(self.account.pk))
        self.assertEqual(response.data["sms_summary"]["direction"], "debit")
        self.assertEqual(
            response.data["row"]["extracted"]["description"], "Synthetic Cafe"
        )
        self.assertEqual(Transaction.objects.count(), 0)

    def test_queue_review_condition_filters_and_validates(self):
        for condition, expected in (
            ("all", 1),
            ("possible", 1),
            ("strong", 0),
            ("balance_differs", 1),
            ("type_differs", 0),
            ("needs_correction", 0),
        ):
            with self.subTest(condition=condition):
                response = self.client.get(
                    reverse("unified-pending"), {"condition": condition, "limit": 1}
                )
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["count"], expected)
                self.assertEqual(len(response.data["results"]), expected)
                self.assertIsNone(response.data["next_cursor"])
                self.assertEqual(response.data["overview"]["matched"], 1)
        invalid = self.client.get(
            reverse("unified-pending"), {"condition": "not-a-condition"}
        )
        self.assertEqual(invalid.status_code, 400)

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
        response = self.confirm(acknowledge_match=False)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(Transaction.objects.count(), 0)
        response = self.confirm(balance_source="statement", acknowledge_conflict=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.get().balance_after, Decimal("900.07"))

    def test_one_taka_difference_still_requires_conflict_acknowledgment(self):
        self.sms.balance_after = Decimal("899.07")
        self.sms.save()
        response = self.confirm(acknowledge_conflict=False)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("acknowledge_conflict", response.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_edited_large_difference_requires_acknowledgment(self):
        response = self.confirm(
            draft=self.draft(balance_after="902.00"), acknowledge_conflict=False
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("acknowledge_conflict", response.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_type_disagreement_requires_explicit_choice(self):
        self.sms.transaction_type = "transfer"
        self.sms.save()
        self.sms.refresh_from_db()
        response = self.confirm()
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("type_choice", response.data)
        self.assertEqual(Transaction.objects.count(), 0)
        response = self.confirm(type_choice="statement")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.get().type, "expense")

    def test_one_step_draft_correction_creates_transfer_and_keeps_originals(self):
        self.sms.transaction_type = "transfer"
        self.sms.save()
        self.sms.refresh_from_db()
        original = self.row.extracted.copy()
        response = self.confirm(
            type_choice="sms",
            draft=self.draft(
                type="transfer",
                other_account=str(self.wallet.pk),
                counterparty_text="Synthetic wallet",
                note="Reviewed movement between owned accounts",
            ),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        record = Transaction.objects.get()
        self.assertEqual(record.type, "transfer")
        self.assertEqual(record.account_id, self.account.pk)
        self.assertEqual(record.transfer_account_id, self.wallet.pk)
        self.assertEqual(record.note, "Reviewed movement between owned accounts")
        self.assertEqual(self.row.extracted, original)
        self.assertEqual(self.sms.balance_after, Decimal("900.00"))
        self.assertEqual(self.row.balance_after, Decimal("900.07"))
        self.assertEqual(self.row.transaction_id, record.pk)
        self.assertEqual(self.sms.transaction_id, record.pk)

    def test_draft_that_breaks_match_rolls_back_without_posting(self):
        response = self.confirm(draft=self.draft(amount="101.00"))
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("draft", response.data)
        self.row.refresh_from_db()
        self.assertEqual(self.row.amount, Decimal("100.00"))
        self.assertEqual(self.row.state, "pending")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_corrected_merchant_keeps_original_pair_evidence(self):
        self.row.balance_after = None
        self.row.save(update_fields=["balance_after"])
        self.sms.balance_after = None
        self.sms.save(update_fields=["balance_after"])
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertIsNotNone(pair_signals(self.row, self.sms))
        response = self.confirm(
            draft=self.draft(
                balance_after=None,
                counterparty_text="Corrected merchant",
                note="Reviewed purchase",
            )
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.get().counterparty_text, "Corrected merchant")
        self.row.refresh_from_db()
        self.assertEqual(self.row.extracted["description"], "Synthetic Cafe")

    def test_corrected_statement_balance_is_selected_without_changing_sms_report(self):
        response = self.confirm(
            balance_source="statement",
            draft=self.draft(balance_after="900.44"),
        )
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.sms.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("900.44"))
        self.assertEqual(self.sms.balance_after, Decimal("900.00"))

    def test_edited_draft_still_needs_source_review_but_not_subtaka_balance_ack(self):
        self.row.balance_after = Decimal("900.00")
        self.row.save(update_fields=["balance_after"])
        self.row.refresh_from_db()
        edited = self.draft(balance_after="900.44", note="Reviewed purchase")
        response = self.confirm(draft=edited, acknowledge_issues=False)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("acknowledge_issues", response.data)
        response = self.confirm(draft=edited, acknowledge_conflict=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.row.refresh_from_db()
        self.assertEqual(self.row.balance_after, Decimal("900.44"))

    def test_stale_or_foreign_draft_is_rejected(self):
        self.assertEqual(
            self.confirm(draft=self.draft(version=self.row.version + 1)).status_code,
            400,
        )
        foreign = Account.objects.create(
            user=self.other_user, name="Other user's account", type="bank", currency="BDT"
        )
        response = self.confirm(
            draft=self.draft(type="transfer", other_account=str(foreign.pk))
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_missing_balance_cannot_replace_reported_value(self):
        self.sms.balance_after = None
        self.sms.save()
        response = self.confirm(balance_source="sms", acknowledge_conflict=False)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("balance_source", response.data)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(
            self.confirm(balance_source="statement", acknowledge_conflict=False).status_code,
            200,
        )
        self.assertEqual(Transaction.objects.get().balance_after, Decimal("900.07"))

    def test_transfer_balance_choice_preserves_both_source_reports(self):
        self.row.type = "transfer"
        self.row.other_account = self.wallet
        self.row.save()
        self.sms.transaction_type = "transfer"
        self.sms.message_kind = "bank_transfer_out"
        self.sms.suggested_transfer_direction = "debit"
        self.sms.destination_account = self.wallet
        self.sms.save()
        response = self.confirm(balance_source="statement")
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.assertEqual(record.balance_after, Decimal("900.07"))
        self.assertEqual(reported_values(record)[self.account.pk], Decimal("900.07"))
        self.assertEqual(
            set(record.transfer_evidence.values_list("balance_after", flat=True)),
            {Decimal("900.00"), Decimal("900.07")},
        )
        self.row.refresh_from_db()
        unlinked = self.client.post(
            reverse("statement-row-decide", kwargs={"pk": self.row.pk}),
            {"action": "unlink", "version": self.row.version},
            format="json",
        )
        self.assertEqual(unlinked.status_code, 200, unlinked.data)
        record.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("900.00"))
        self.assertEqual(reported_values(record)[self.account.pk], Decimal("900.00"))
        reversal = AuditLogEntry.objects.get(
            entity_type="transactions.transaction", entity_id=str(record.pk),
            metadata__decision="unlink", metadata__statement_row=str(self.row.pk),
        )
        self.assertEqual(reversal.before["balance_after"], "900.07")
        self.assertEqual(reversal.after["balance_after"], "900.00")

    def test_linking_existing_transfer_keeps_its_effective_report(self):
        self.row.type = "transfer"
        self.row.other_account = self.wallet
        self.row.save()
        self.sms.transaction_type = "transfer"
        self.sms.message_kind = "bank_transfer_out"
        self.sms.suggested_transfer_direction = "debit"
        self.sms.destination_account = self.wallet
        self.sms.save()
        record = Transaction.objects.create(
            user=self.user, account=self.account, transfer_account=self.wallet,
            type="transfer", direction="debit", amount="100.00",
            date=self.row.date, balance_after="900.05",
        )
        response = self.confirm(transaction=str(record.pk), balance_source="existing")
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("900.05"))
        self.assertEqual(reported_values(record)[self.account.pk], Decimal("900.05"))

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
        far.balance_after = Decimal("899.07")
        self.assertIsNone(pair_signals(self.row, far))
        far.balance_after = self.row.balance_after
        self.assertIsNotNone(pair_signals(self.row, far))
        self.row.reference = "SYNTH-A"
        self.sms.reference = "SYNTH-B"
        self.assertIsNone(pair_signals(self.row, self.sms))

    def test_merchant_only_match_remains_possible_until_stronger_evidence_agrees(self):
        self.row.balance_after = None
        self.row.save()
        self.sms.balance_after = None
        self.sms.save()
        self.assertEqual(pair_signals(self.row, self.sms)["strength"], "possible")
        self.row.reference = "SYNTH-REFERENCE"
        self.row.save()
        self.sms.reference = "synth-reference"
        self.sms.save()
        self.assertEqual(pair_signals(self.row, self.sms)["strength"], "strong")

    def test_sub_taka_balance_difference_suggests_pair_without_changing_reports(self):
        self.sms.counterparty_text = ""
        self.sms.save()
        signals = pair_signals(self.row, self.sms)
        self.assertIsNotNone(signals)
        self.assertEqual(signals["strength"], "possible")
        self.assertTrue(signals["conflict"])
        self.assertIn("Reported balances differ by less than BDT 1.", signals["reasons"])
        response = self.client.get(reverse("unified-pending"))
        self.assertEqual(response.data["overview"]["matched"], 1)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(self.row.balance_after, Decimal("900.07"))
        self.assertEqual(self.sms.balance_after, Decimal("900.00"))

    def test_balance_difference_threshold_is_strictly_below_one_taka(self):
        self.sms.counterparty_text = ""
        self.sms.balance_after = Decimal("899.08")
        self.assertIsNotNone(pair_signals(self.row, self.sms))
        self.sms.balance_after = Decimal("899.07")
        self.assertIsNone(pair_signals(self.row, self.sms))

    def test_subunit_balance_tolerance_is_bdt_only(self):
        self.sms.counterparty_text = ""
        self.account.currency = "USD"
        self.account.save()
        self.batch.currency = "USD"
        self.batch.save()
        self.assertIsNone(pair_signals(self.row, self.sms))
        self.sms.balance_after = self.row.balance_after
        self.assertIsNotNone(pair_signals(self.row, self.sms))

    def test_shared_claims_stay_out_of_unique_pair_queue(self):
        self.candidate()
        response = self.client.get(reverse("unified-pending"))
        self.assertEqual(response.data["count"], 0)
        self.assertEqual(response.data["overview"]["ambiguous"], 3)
        self.assertEqual(
            self.client.get(
                reverse("unified-pair"),
                {"statement": self.row.pk, "sms": self.sms.pk},
            ).status_code,
            400,
        )
        self.assertEqual(self.confirm().status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_many_statement_claims_cannot_open_or_confirm_direct_pair(self):
        StatementRow.objects.create(
            batch=self.batch,
            position=2,
            component="principal",
            source_fingerprint="synthetic-row-two",
            date=self.row.date,
            time=self.row.time,
            direction=self.row.direction,
            type=self.row.type,
            amount=self.row.amount,
            balance_after=self.row.balance_after,
            counterparty_text=self.row.counterparty_text,
            note=self.row.note,
            classification_confirmed=True,
            extracted=self.row.extracted,
        )
        self.assertEqual(self.client.get(reverse("unified-pending")).data["count"], 0)
        self.assertEqual(
            self.client.get(
                reverse("unified-pair"),
                {"statement": self.row.pk, "sms": self.sms.pk},
            ).status_code,
            400,
        )
        self.assertEqual(self.confirm().status_code, 409)

    def test_date_filter_does_not_hide_competing_sources(self):
        StatementRow.objects.create(
            batch=self.batch,
            position=2,
            component="principal",
            source_fingerprint="synthetic-row-outside-filter",
            date=date(2026, 1, 3),
            time=self.row.time,
            direction=self.row.direction,
            type=self.row.type,
            amount=self.row.amount,
            balance_after=self.row.balance_after,
            counterparty_text=self.row.counterparty_text,
            note=self.row.note,
            classification_confirmed=True,
            extracted={**self.row.extracted, "id": "synthetic-outside-filter"},
        )
        response = self.client.get(
            reverse("unified-pending"),
            {"start_date": "2026-01-02", "end_date": "2026-01-02"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 0)
        self.assertEqual(response.data["overview"]["ambiguous"], 2)

    def test_amount_and_date_without_independent_evidence_are_not_a_match(self):
        self.row.balance_after = None
        self.row.counterparty_text = "Synthetic Grocer"
        self.row.extracted = {**self.row.extracted, "description": "Synthetic Grocer"}
        self.row.save()
        self.sms.balance_after = None
        self.sms.counterparty_text = "Synthetic Pharmacy"
        self.sms.save()
        self.assertIsNone(pair_signals(self.row, self.sms))
        response = self.client.get(reverse("unified-pending"))
        self.assertEqual(response.data["count"], 0)
        self.assertEqual(response.data["overview"]["statement_only"], 1)
        self.assertEqual(response.data["overview"]["sms_only"], 1)

    def test_cursor_pagination_is_stable_when_an_earlier_pair_is_removed(self):
        second_row = StatementRow.objects.create(
            batch=self.batch,
            position=2,
            component="principal",
            source_fingerprint="synthetic-later-row",
            date=date(2026, 1, 3),
            time=self.row.time,
            direction="debit",
            type="expense",
            amount="200.00",
            balance_after="700.00",
            counterparty_text="Synthetic Market",
            note="Synthetic Market",
            classification_confirmed=True,
            extracted={
                **self.row.extracted,
                "id": "synthetic-later",
                "date": "2026-01-03",
                "amount": "200.00",
                "balance_after": "700.00",
                "description": "Synthetic Market",
            },
        )
        second_sms = self.candidate(
            amount="200.00",
            balance="700.00",
            day=3,
            counterparty_text="Synthetic Market",
        )
        first = self.client.get(reverse("unified-pending"), {"limit": 1})
        self.assertEqual(first.data["results"][0]["statement"]["id"], str(second_row.pk))
        cursor = first.data["next_cursor"]
        second_row.state = "skipped"
        second_row.save()
        second_sms.status = "ignored"
        second_sms.save()
        following = self.client.get(
            reverse("unified-pending"), {"limit": 1, "cursor": cursor}
        )
        self.assertEqual(following.data["results"][0]["statement"]["id"], str(self.row.pk))

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

    def test_distinct_ledger_suggestion_requires_explicit_review_before_new_pair(self):
        record = Transaction.objects.create(
            user=self.user, account=self.account, amount="100.00",
            date=self.row.date, type="expense", direction="debit",
            balance_after="800.00", note="Similar earlier purchase", source="manual",
        )
        pair = self.client.get(
            reverse("unified-pair"), {"statement": self.row.pk, "sms": self.sms.pk}
        )
        matches = pair.data["row"]["review"]["matches"]
        self.assertEqual([match["id"] for match in matches], [str(record.pk)])
        self.assertTrue(matches[0]["can_link"])
        self.assertEqual(self.confirm().status_code, 400)
        self.assertEqual(
            self.confirm(
                dismissed_ledger_matches=[str(record.pk)],
            ).status_code,
            400,
        )
        self.assertEqual(
            self.confirm(
                dismissed_ledger_matches=[str(record.pk), str(record.pk)],
                acknowledge_distinct_ledger_matches=True,
            ).status_code,
            400,
        )
        self.assertEqual(
            self.confirm(
                dismissed_ledger_matches=[str(self.wallet.pk)],
                acknowledge_distinct_ledger_matches=True,
            ).status_code,
            409,
        )
        response = self.confirm(
            dismissed_ledger_matches=[str(record.pk)],
            acknowledge_distinct_ledger_matches=True,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotEqual(response.data["transaction"], str(record.pk))
        self.assertEqual(Transaction.objects.count(), 2)
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(self.row.transaction_id, self.sms.transaction_id)
        self.assertTrue(
            AuditLogEntry.objects.filter(
                user=self.user,
                metadata__dismissed_ledger_matches=[str(record.pk)],
            ).exists()
        )

    def test_unlinkable_ledger_suggestion_can_be_reviewed_as_distinct(self):
        record = Transaction.objects.create(
            user=self.user, account=self.account, amount="100.00",
            date=self.row.date, type="expense", direction="debit",
            balance_after="800.00", note="Another statement row", source="import",
        )
        StatementRow.objects.create(
            batch=self.batch, position=2, component="principal",
            source_fingerprint="synthetic-other-row",
            date=self.row.date, direction="debit", type="expense",
            amount="100.00", balance_after="800.00", transaction=record,
            state="linked", classification_confirmed=True,
            extracted={**self.row.extracted, "id": "synthetic-other", "row": 2},
        )
        pair = self.client.get(
            reverse("unified-pair"), {"statement": self.row.pk, "sms": self.sms.pk}
        )
        matches = pair.data["row"]["review"]["matches"]
        self.assertEqual([match["id"] for match in matches], [str(record.pk)])
        self.assertFalse(matches[0]["can_link"])
        self.assertEqual(self.confirm().status_code, 400)
        response = self.confirm(
            dismissed_ledger_matches=[str(record.pk)],
            acknowledge_distinct_ledger_matches=True,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_distinct_ledger_choice_rejects_stale_suggestions(self):
        record = Transaction.objects.create(
            user=self.user, account=self.account, amount="100.00",
            date=self.row.date, type="expense", direction="debit",
            note="Similar earlier purchase", source="manual",
        )
        pair = self.client.get(
            reverse("unified-pair"), {"statement": self.row.pk, "sms": self.sms.pk}
        )
        self.assertEqual(
            [match["id"] for match in pair.data["row"]["review"]["matches"]],
            [str(record.pk)],
        )
        Transaction.objects.create(
            user=self.user, account=self.account, amount="100.00",
            date=self.row.date, type="expense", direction="debit",
            note="Another similar purchase", source="manual",
        )
        response = self.confirm(
            dismissed_ledger_matches=[str(record.pk)],
            acknowledge_distinct_ledger_matches=True,
        )
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(Transaction.objects.count(), 2)

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
        self.assertEqual(reported_values(record)[self.account.pk], Decimal("900.00"))

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

    def test_date_filter_reduces_queue_before_safety_limit(self):
        self.candidate(amount="99.00", day=6)
        with patch("apps.statements.unified.MAX_PENDING", 1):
            response = self.client.get(
                reverse("unified-pending"),
                {"start_date": "2026-01-02", "end_date": "2026-01-02"},
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)

    def test_source_filter_bounds_unrelated_comparison_sources(self):
        extra = self.candidate(amount="99.00")
        with patch("apps.statements.unified.MAX_PENDING", 1):
            response = self.client.get(reverse("unified-pending"), {"source": "statement"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        extra.status = "ignored"
        extra.save()
        StatementRow.objects.create(
            batch=self.batch, position=2, component="principal",
            source_fingerprint="synthetic-other-row", extracted=self.row.extracted,
            date=self.row.date, direction="debit", type="expense", amount="99.00",
        )
        with patch("apps.statements.unified.MAX_PENDING", 1):
            response = self.client.get(reverse("unified-pending"), {"source": "sms"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)

    def test_pair_detail_ignores_unrelated_backlog_limit(self):
        self.candidate(amount="99.00")
        with patch("apps.statements.unified.MAX_PENDING", 1):
            response = self.client.get(
                reverse("unified-pair"),
                {"statement": self.row.pk, "sms": self.sms.pk},
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["match"]["strength"], "possible")

    def test_truncated_sms_match_count_is_not_presented_as_zero(self):
        review = review_context(self.row, [], pending_sms_count=None)
        self.assertIsNone(review["pending_sms_match_count"])
        self.assertNotEqual(review["review_state"], "new")

    def test_invalid_cursor_fails_explicitly(self):
        response = self.client.get(
            reverse("unified-pending"), {"cursor": "not-a-valid-cursor"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cursor", response.data)
