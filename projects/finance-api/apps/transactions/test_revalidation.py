"""Synthetic historical revalidation, reviewed corrections and stale safety."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.categories.models import Category
from apps.debts.models import Debt
from apps.messages.models import RawMessage, SenderRule, SenderRuleMapping
from apps.statements import test_unified as fixtures
from apps.transactions.balance_reports import reported_values

from .models import Transaction, TransactionAction, TransferEvidence


class RevalidationTests(APITestCase):
    candidate = fixtures.UnifiedReviewTests.candidate

    def setUp(self):
        fixtures.UnifiedReviewTests.setUp(self)
        self.record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            raw_message=self.sms.raw_message,
            amount="100.00",
            balance_after="900.00",
            date=self.row.date,
            type="expense",
            direction="debit",
            source="sms",
        )
        self.sms.transaction = self.record
        self.sms.status = "confirmed"
        self.sms.amount = Decimal("100.37")
        self.sms.save()
        self.row.transaction = self.record
        self.row.state = "linked"
        self.row.save()

    def preview(self):
        return self.client.get(reverse("transaction-revalidate", args=[self.record.pk]))

    def apply(self, preview, selected=None, **changes):
        return self.client.post(
            reverse("transaction-apply-revalidation", args=[self.record.pk]),
            {
                "token": preview["token"],
                "selected": selected
                if selected is not None
                else [item["key"] for item in preview["suggestions"]],
                **changes,
            },
            format="json",
        )

    def correct_sms(self, preview, candidate, action, account=None):
        return self.client.post(
            reverse("transaction-correct-sms-evidence", args=[self.record.pk]),
            {
                "token": preview["token"], "candidate": str(candidate.pk),
                "action": action, **({"account": str(account.pk)} if account else {}),
            },
            format="json",
        )

    def transfer_with_misattributed_sms(self):
        self.record.type = "transfer"
        self.record.transfer_account = self.wallet
        self.record.external_key = f"raw-message:{self.sms.raw_message_id}"
        self.record.save()
        self.sms.message_kind = "bank_transfer_out"
        self.sms.transaction_type = "transfer"
        self.sms.source_direction = "debit"
        self.sms.destination_account = self.wallet
        self.sms.save()
        TransferEvidence.objects.create(
            user=self.user, transaction=self.record, account=self.account,
            raw_message=self.sms.raw_message, direction="debit",
            date=self.record.date, source="sms", balance_after="900.00",
        )
        wrong = self.candidate(
            kind="bank_transfer_in", balance="42.00", transaction_type="transfer",
            source_direction="credit", destination_account=self.account,
            suggested_transfer_direction="credit",
        )
        wrong.transaction = self.record
        wrong.status = "confirmed"
        wrong.save(update_fields=("transaction", "status", "updated_at"))
        TransferEvidence.objects.create(
            user=self.user, transaction=self.record, account=self.account,
            raw_message=wrong.raw_message, direction="credit",
            date=self.record.date, source="sms", balance_after="42.00",
        )
        return wrong

    def test_move_one_misattributed_sms_preserves_transfer_and_other_evidence(self):
        wrong = self.transfer_with_misattributed_sms()
        old = self.preview().data
        response = self.correct_sms(old, wrong, "move", self.wallet)
        self.assertEqual(response.status_code, 200, response.data)
        wrong.refresh_from_db()
        self.record.refresh_from_db()
        self.assertEqual(wrong.transaction_id, self.record.pk)
        self.assertEqual(wrong.status, "confirmed")
        self.assertEqual(wrong.destination_account_id, self.wallet.pk)
        self.assertEqual(wrong.source_direction, "credit")
        self.assertEqual(self.record.account_id, self.account.pk)
        self.assertEqual(self.record.transfer_account_id, self.wallet.pk)
        self.assertEqual(self.record.amount, Decimal("100.00"))
        self.assertEqual(self.record.balance_after, Decimal("900.00"))
        moved = TransferEvidence.objects.get(raw_message=wrong.raw_message)
        self.assertEqual((moved.account_id, moved.direction, moved.balance_after), (self.wallet.pk, "credit", Decimal("42.00")))
        self.assertEqual(TransferEvidence.objects.filter(transaction=self.record).count(), 2)
        self.assertEqual(reported_values(self.record)[self.wallet.pk], Decimal("42.00"))
        self.assertTrue(RawMessage.objects.filter(pk=wrong.raw_message_id).exists())
        self.assertEqual(AuditLogEntry.objects.latest("created_at").metadata["operation"], "correct_sms_evidence")
        self.assertEqual(self.correct_sms(old, wrong, "move", self.wallet).status_code, 409)
        action = TransactionAction.objects.latest("created_at")
        undo = self.client.post(reverse("transaction-undo"), {"action": str(action.pk)}, format="json")
        self.assertEqual(undo.status_code, 200, undo.data)
        wrong.refresh_from_db()
        moved.refresh_from_db()
        self.assertEqual(wrong.destination_account_id, self.account.pk)
        self.assertEqual((moved.account_id, moved.direction), (self.account.pk, "credit"))

    def test_unlink_only_selected_sms_returns_it_to_review_and_is_undoable(self):
        wrong = self.transfer_with_misattributed_sms()
        response = self.correct_sms(self.preview().data, wrong, "unlink")
        self.assertEqual(response.status_code, 200, response.data)
        wrong.refresh_from_db()
        self.record.refresh_from_db()
        self.assertEqual(wrong.status, "needs_review")
        self.assertIsNone(wrong.transaction_id)
        self.assertFalse(TransferEvidence.objects.filter(raw_message=wrong.raw_message).exists())
        self.assertTrue(TransferEvidence.objects.filter(raw_message=self.sms.raw_message, transaction=self.record).exists())
        self.assertEqual(self.record.balance_after, Decimal("900.00"))
        self.assertTrue(RawMessage.objects.filter(pk=wrong.raw_message_id).exists())
        action = TransactionAction.objects.latest("created_at")
        undo = self.client.post(reverse("transaction-undo"), {"action": str(action.pk)}, format="json")
        self.assertEqual(undo.status_code, 200, undo.data)
        wrong.refresh_from_db()
        self.assertEqual(wrong.status, "confirmed")
        self.assertEqual(wrong.transaction_id, self.record.pk)
        self.assertTrue(TransferEvidence.objects.filter(raw_message=wrong.raw_message, transaction=self.record).exists())

    def test_sms_correction_rejects_wrong_direction_and_other_user(self):
        wrong = self.transfer_with_misattributed_sms()
        wrong.source_direction = "debit"
        wrong.save(update_fields=("source_direction", "updated_at"))
        preview = self.preview().data
        self.assertEqual(self.correct_sms(preview, wrong, "move", self.wallet).status_code, 400)
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.correct_sms(preview, wrong, "unlink").status_code, 404)

    def test_secondary_sms_correction_keeps_reviewed_scalar_balance(self):
        wrong = self.transfer_with_misattributed_sms()
        self.record.balance_after = Decimal("901.00")
        self.record.save(update_fields=("balance_after", "updated_at"))
        response = self.correct_sms(self.preview().data, wrong, "move", self.wallet)
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.balance_after, Decimal("901.00"))

    def test_preview_is_read_only_and_shows_both_originals(self):
        stamp = self.record.updated_at
        response = self.preview()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(
            {item["key"] for item in response.data["suggestions"]},
            {"amount", f"balance:{self.account.pk}"},
        )
        self.assertEqual(
            {item["amount"] for item in response.data["sources"] if item["amount"]},
            {"100.00", "100.37"},
        )
        self.assertEqual(response.data["ledger"]["amount"], "100.00")
        self.assertEqual(response.data["ledger"]["accounts"][0]["balance_after"], "900.00")
        self.assertTrue(all("direction" in source and "date" in source and "issues" in source for source in response.data["sources"]))
        self.record.refresh_from_db()
        self.assertEqual(self.record.updated_at, stamp)
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(TransactionAction.objects.count(), 0)
        self.assertNotIn(self.sms.raw_message.body, str(response.data))

    def test_apply_uses_higher_values_preserves_sources_and_can_undo(self):
        old_extracted = self.row.extracted.copy()
        result = self.apply(self.preview().data)
        self.assertEqual(result.status_code, 200, result.data)
        self.record.refresh_from_db()
        self.sms.refresh_from_db()
        self.row.refresh_from_db()
        self.assertEqual(self.record.amount, Decimal("100.37"))
        self.assertEqual(self.record.balance_after, Decimal("900.07"))
        self.assertEqual(self.row.amount, Decimal("100.00"))
        self.assertEqual(self.sms.amount, Decimal("100.37"))
        self.assertEqual(self.row.extracted, old_extracted)
        self.assertEqual(
            AuditLogEntry.objects.get().metadata["operation"], "revalidate"
        )
        action = TransactionAction.objects.get()
        undo = self.client.post(
            reverse("transaction-undo"), {"action": str(action.pk)}, format="json"
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.amount, Decimal("100.00"))
        self.assertEqual(self.record.balance_after, Decimal("900.00"))

    def test_select_only_one_correction_and_scanner_clears_after_apply(self):
        self.assertIn(
            "saved_source_difference",
            {
                item["code"]
                for item in self.client.get(reverse("transaction-issues")).data[
                    "results"
                ][0]["issues"]
            },
        )
        response = self.apply(self.preview().data, ["amount"])
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.balance_after, Decimal("900.00"))
        response = self.apply(self.preview().data)
        self.assertEqual(response.status_code, 200, response.data)
        findings = self.client.get(reverse("transaction-issues")).data["results"]
        self.assertFalse(
            any(
                item["code"] == "saved_source_difference"
                for finding in findings
                for item in finding["issues"]
            )
        )

    def test_changed_transaction_source_policy_and_repeated_apply_are_stale(self):
        preview = self.preview().data
        self.record.note = "Reviewed change"
        self.record.save()
        self.assertEqual(self.apply(preview).status_code, 409)
        preview = self.preview().data
        self.sms.amount = Decimal("100.50")
        self.sms.save()
        self.assertEqual(self.apply(preview).status_code, 409)
        preview = self.preview().data
        with patch("apps.transactions.revalidation.POLICY_VERSION", "next-policy"):
            self.assertEqual(self.apply(preview).status_code, 409)
        preview = self.preview().data
        self.assertEqual(self.apply(preview).status_code, 200)
        self.assertEqual(self.apply(preview).status_code, 409)
        self.assertEqual(AuditLogEntry.objects.count(), 1)

    def test_tamper_expiry_wrong_user_and_unoffered_fields(self):
        preview = self.preview().data
        self.assertEqual(self.apply(preview, ["account"]).status_code, 400)
        self.assertEqual(self.apply(preview, ["amount", "amount"]).status_code, 400)
        self.assertEqual(
            self.apply(preview, token=preview["token"] + "bad").status_code, 409
        )
        with patch("django.core.signing.time.time", return_value=99999999999):
            self.assertEqual(self.apply(preview).status_code, 409)
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.preview().status_code, 404)
        self.assertEqual(self.apply(preview).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.preview().status_code, 401)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_exact_one_non_bdt_chained_span_and_fees_do_not_offer_amount(self):
        self.sms.amount = Decimal("101.00")
        self.sms.save()
        self.assertNotIn(
            "amount", [item["key"] for item in self.preview().data["suggestions"]]
        )
        self.sms.amount = Decimal("100.37")
        self.sms.save()
        self.account.currency = self.batch.currency = "USD"
        self.account.save()
        self.batch.save()
        self.assertEqual(self.preview().data["suggestions"], [])
        self.account.currency = self.batch.currency = "BDT"
        self.account.save()
        self.batch.save()
        self.row.amount = Decimal("99.50")
        self.row.save()
        self.sms.amount = Decimal("100.50")
        self.sms.save()
        self.assertNotIn(
            "amount", [item["key"] for item in self.preview().data["suggestions"]]
        )
        self.row.amount = Decimal("100.00")
        self.row.save()
        self.sms.fee_amount = Decimal("0.50")
        self.sms.save()
        self.assertEqual(self.preview().data["suggestions"], [])

    def test_dependencies_block_amount_and_caps_disable_corrections(self):
        preview = self.preview().data
        Debt.objects.create(
            user=self.user,
            opened_transaction=self.record,
            counterparty_name="Synthetic borrower",
            direction="lent_by_me",
            principal_amount="100.00",
            current_balance="100.00",
            opened_at=self.record.date,
        )
        self.assertNotIn(
            "amount", [item["key"] for item in self.preview().data["suggestions"]]
        )
        self.assertEqual(self.apply(preview, ["amount"]).status_code, 409)
        with patch("apps.transactions.revalidation.MAX_SOURCES", 0):
            self.assertEqual(self.preview().data["suggestions"], [])

    def test_account_direction_or_date_mismatch_blocks_corrections(self):
        for changes in (
            {"direction": "credit"},
            {"date": "2026-02-01"},
            {"other_account": self.wallet},
        ):
            for name, value in changes.items():
                setattr(self.row, name, value)
            self.row.save()
            preview = self.preview().data
            self.assertEqual(preview["suggestions"], [])
            statement = next(source for source in preview["sources"] if source["kind"] == "Statement")
            self.assertFalse(statement["usable"])
            self.assertTrue(statement["issues"])
            self.row.direction = "debit"
            self.row.date = self.record.date
            self.row.other_account = None
            self.row.save()

    def test_statement_version_redaction_and_larger_source_conflicts_require_fresh_review(
        self,
    ):
        preview = self.preview().data
        self.row.version += 1
        self.row.save()
        self.assertEqual(self.apply(preview).status_code, 409)
        preview = self.preview().data
        self.sms.raw_message.redact(reason=RawMessage.RedactionReason.RETENTION)
        self.assertEqual(self.apply(preview).status_code, 409)
        preview = self.preview().data
        self.assertTrue(
            any("unavailable" in warning for warning in preview["warnings"])
        )
        self.row.amount = Decimal("105.00")
        self.row.save()
        self.assertEqual(self.preview().data["suggestions"], [])

    def test_conflicting_balances_do_not_support_amount_rounding(self):
        self.row.balance_after = Decimal("910.00")
        self.row.save()
        self.assertEqual(self.preview().data["suggestions"], [])

    def test_null_balance_is_only_restored_after_explicit_selection(self):
        self.record.balance_after = None
        self.record.save()
        preview = self.preview().data
        self.assertIsNone(
            next(
                item
                for item in preview["suggestions"]
                if item["key"].startswith("balance:")
            )["current"]
        )
        self.record.refresh_from_db()
        self.assertIsNone(self.record.balance_after)
        response = self.apply(preview, [f"balance:{self.account.pk}"])
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.balance_after, Decimal("900.07"))

    def test_transfer_balances_stay_bound_to_accounts_and_captured_values_unchanged(
        self,
    ):
        self.record.type = "transfer"
        self.record.transfer_account = self.wallet
        self.record.save()
        # Preserve source ownership; this fixture's statement and SMS report bank debit.
        primary = TransferEvidence.objects.create(
            user=self.user,
            transaction=self.record,
            account=self.account,
            raw_message=self.sms.raw_message,
            direction="debit",
            date=self.record.date,
            source="sms",
            balance_after="900.00",
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=self.record,
            account=self.wallet,
            direction="credit",
            date=self.record.date,
            source="import",
            balance_after="42.00",
        )
        preview = self.preview().data
        response = self.apply(preview, [f"balance:{self.account.pk}"])
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        primary.refresh_from_db()
        self.assertEqual(
            reported_values(self.record)[self.account.pk], Decimal("900.07")
        )
        self.assertEqual(reported_values(self.record)[self.wallet.pk], Decimal("42.00"))
        self.assertEqual(primary.balance_after, Decimal("900.00"))

    def test_receiving_transfer_keeps_primary_balance_and_other_account_separate(self):
        self.record.type = "transfer"
        self.record.account = self.wallet
        self.record.transfer_account = self.account
        self.record.save()
        self.sms.transaction_type = "income"
        self.sms.message_kind = "bank_transfer_in"
        self.sms.save()
        self.row.direction = "credit"
        self.row.save()
        raw = self.sms.raw_message
        raw.sender = "CITYBANK"
        raw.body = "Tk. 100 Deposit. Tk. 900 Balance. A/C: 1234***5678"
        raw.save()
        SenderRule.objects.create(
            user=self.user,
            account=self.account,
            name="Synthetic bank deposits",
            provider="city_bank",
            sender="CITYBANK",
        )
        primary = TransferEvidence.objects.create(
            user=self.user,
            transaction=self.record,
            account=self.account,
            raw_message=raw,
            direction="credit",
            date=self.record.date,
            source="sms",
            balance_after="900.00",
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=self.record,
            account=self.wallet,
            direction="debit",
            date=self.record.date,
            source="import",
            balance_after="42.00",
        )
        preview = self.preview().data
        self.assertTrue(
            any(
                item["kind"] == "Current SMS parser" and item["usable"]
                for item in preview["sources"]
            )
        )
        response = self.apply(preview)
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        primary.refresh_from_db()
        self.assertEqual(self.record.balance_after, Decimal("900.07"))
        self.assertEqual(reported_values(self.record)[self.wallet.pk], Decimal("42.00"))
        self.assertEqual(primary.balance_after, Decimal("900.00"))
        self.assertEqual(self.record.amount, Decimal("100.37"))

    def test_zero_balance_restoration_and_failed_apply_are_atomic(self):
        self.record.balance_after = None
        self.record.save()
        self.row.balance_after = self.sms.balance_after = Decimal("0.00")
        self.row.save()
        self.sms.save()
        preview = self.preview().data
        offered = next(
            item
            for item in preview["suggestions"]
            if item["key"].startswith("balance:")
        )
        self.assertEqual(offered["proposed"], "0.00")
        with (
            patch(
                "apps.transactions.revalidation.create_audit_log",
                side_effect=RuntimeError("synthetic failure"),
            ),
            self.assertRaises(RuntimeError),
        ):
            self.apply(preview)
        self.record.refresh_from_db()
        self.assertEqual(self.record.amount, Decimal("100.00"))
        self.assertIsNone(self.record.balance_after)
        self.assertEqual(TransactionAction.objects.count(), 0)
        self.assertEqual(self.apply(preview).status_code, 200)
        self.record.refresh_from_db()
        self.assertEqual(self.record.balance_after, Decimal("0.00"))

    def test_current_rule_category_preview_apply_and_rule_change_stale(self):
        raw = self.sms.raw_message
        raw.sender = "CITYBANK"
        raw.body = "Tk. 100 purchase at SAMPLE SHOP. Balance Tk. 900. A/C: 1234***5678"
        raw.save()
        # Align SMS received date with saved financial date.
        raw.received_at = raw.received_at.replace(year=2026, month=1, day=2)
        raw.save()
        rule = SenderRule.objects.create(
            user=self.user,
            account=self.account,
            name="Synthetic alerts",
            provider="city_bank",
            sender="CITYBANK",
        )
        category = Category.objects.create(
            user=self.user, name="Shopping", kind="expense"
        )
        mapping = SenderRuleMapping.objects.create(
            user=self.user,
            sender_rule=rule,
            message_kind="card_purchase",
            account=self.account,
            category=category,
            transaction_type="expense",
        )
        preview = self.preview().data
        self.assertIn("category", [item["key"] for item in preview["suggestions"]])
        mapping.category = Category.objects.create(
            user=self.user, name="Other shopping", kind="expense"
        )
        mapping.save()
        self.assertEqual(self.apply(preview, ["category"]).status_code, 409)
        response = self.apply(self.preview().data, ["category"])
        self.assertEqual(response.status_code, 200, response.data)
        self.record.refresh_from_db()
        self.assertEqual(self.record.category, mapping.category)


class ConcurrentRevalidationTests(TransactionTestCase):
    def test_same_preview_applies_once(self):
        user = get_user_model().objects.create_user(username=f"synthetic-{uuid4()}")
        from django.utils import timezone

        from apps.accounts.models import Account
        from apps.messages.models import ParsedMessageCandidate

        account = Account.objects.create(user=user, name="Synthetic", type="bank")
        raw = RawMessage.objects.create(
            user=user,
            sender="SYNTHETIC",
            body="Synthetic evidence",
            body_hash=str(uuid4()),
            received_at=timezone.now(),
        )
        record = Transaction.objects.create(
            user=user,
            account=account,
            date=timezone.localdate(),
            type="expense",
            amount="100.00",
            direction="debit",
            source="sms",
            raw_message=raw,
        )
        ParsedMessageCandidate.objects.create(
            user=user,
            raw_message=raw,
            account=account,
            transaction=record,
            status="confirmed",
            message_kind="card_purchase",
            amount="100.37",
            transaction_type="expense",
        )
        client = APIClient()
        client.force_authenticate(user)
        preview = client.get(reverse("transaction-revalidate", args=[record.pk])).data

        def apply():
            connections.close_all()
            try:
                client = APIClient()
                client.force_authenticate(user)
                return client.post(
                    reverse("transaction-apply-revalidation", args=[record.pk]),
                    {"token": preview["token"], "selected": ["amount"]},
                    format="json",
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: apply(), range(2)))
        self.assertEqual(sorted(statuses), [200, 409])
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("100.37"))
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(AuditLogEntry.objects.count(), 1)
