"""Synthetic-only end-to-end review, ledger, and duplicate protection tests."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, connections
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.categories.models import Category
from apps.transactions.models import Transaction, TransferEvidence
from apps.transactions.services import calculate_expected_balance

from .models import StatementImport, StatementRow
from .tests import synthetic_pdf


class SavedStatementTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username="synthetic-import-user"
        )
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.wallet = Account.objects.create(
            user=self.user,
            name="Synthetic wallet",
            type="mobile_wallet",
            currency="BDT",
            starting_balance="1125.00",
        )
        self.category = Category.objects.create(
            user=self.user, name="Synthetic purchases", kind="expense"
        )
        self.client.force_authenticate(self.user)
        self.pdf = synthetic_pdf("city_bank")

    def upload(self, data=None, account=None):
        response = self.client.post(
            reverse("statement-import-list"),
            {
                "account": str((account or self.bank).id),
                "file": SimpleUploadedFile("synthetic.pdf", data or self.pdf),
            },
            format="multipart",
        )
        self.assertIn(response.status_code, (200, 201), response.data)
        self.assertEqual(response["Cache-Control"], "no-store")
        return StatementImport.objects.get(pk=response.data["id"])

    def edit(self, row, **fields):
        return self.client.patch(
            reverse("statement-row-detail", args=[row.id]),
            {"version": row.version, **fields},
            format="json",
        )

    def decide(self, row, action="create", **fields):
        return self.client.post(
            reverse("statement-row-decide", args=[row.id]),
            {"action": action, "version": row.version, **fields},
            format="json",
        )

    def ledger_purchase(self, **fields):
        data = {
            "user": self.user,
            "account": self.bank,
            "type": "expense",
            "direction": "debit",
            "amount": "50.00",
            "date": date(2026, 1, 2),
            "source": "sms",
            "balance_after": "950.00",
            "category": self.category,
            "note": "My corrected note",
            "reference": "REUSED",
        }
        return Transaction.objects.create(**{**data, **fields})

    def test_saved_draft_retry_preserves_edits_and_never_posts(self):
        batch = self.upload()
        row = batch.rows.first()
        response = self.edit(row, note="Saved correction", balance_after="0.00")
        self.assertEqual(response.status_code, 200, response.data)
        repeated = self.upload()
        self.assertEqual(batch.id, repeated.id)
        row.refresh_from_db()
        self.assertEqual(row.note, "Saved correction")
        self.assertEqual(row.balance_after, Decimal(0))
        self.assertEqual(StatementImport.objects.count(), 1)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertNotIn("9876543210123", str(response.data))

    def test_link_preserves_sms_fields_and_single_ledger_movement(self):
        target = self.ledger_purchase()
        batch = self.upload()
        row = batch.rows.first()
        response = self.client.get(reverse("statement-row-detail", args=[row.id]))
        self.assertEqual(response.data["review"]["matches"][0]["id"], str(target.id))
        linked = self.decide(row, "link", transaction=str(target.id))
        self.assertEqual(linked.status_code, 200, linked.data)
        self.assertEqual(
            self.decide(row, "link", transaction=str(target.id)).status_code, 200
        )
        target.refresh_from_db()
        self.assertEqual(target.source, "sms")
        self.assertEqual(target.note, "My corrected note")
        self.assertEqual(target.category, self.category)
        self.assertEqual(target.reference, "REUSED")
        self.assertEqual(target.balance_after, Decimal("950.00"))
        self.assertEqual(Transaction.objects.count(), 1)
        evidence = self.client.get(
            reverse("transaction-statement-evidence", args=[target.id])
        )
        self.assertEqual(evidence["Cache-Control"], "private, no-store")
        self.assertEqual(len(evidence.data), 1)
        self.assertEqual(
            evidence.data[0]["extracted"]["description"], "PURCHASE CARD SYNTH SHOP"
        )

    def test_true_repeat_purchase_requires_separate_decision_and_cannot_share_target(
        self,
    ):
        target = self.ledger_purchase()
        batch = self.upload()
        first, _, repeat = list(batch.rows.all())
        self.assertEqual(
            self.decide(first, "link", transaction=str(target.id)).status_code, 200
        )
        self.assertEqual(
            self.decide(repeat, "link", transaction=str(target.id)).status_code, 400
        )
        self.assertEqual(self.decide(repeat).status_code, 400)
        response = self.decide(repeat, allow_separate=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertNotEqual(response.data["transaction"], str(target.id))

    def test_overlap_reexport_suggests_existing_observation_without_adding(self):
        first = self.upload()
        row = first.rows.first()
        response = self.decide(row)
        self.assertEqual(response.status_code, 200, response.data)
        second = self.upload(self.pdf + b"\n% synthetic re-export\n")
        self.assertNotEqual(first.id, second.id)
        overlap = second.rows.first()
        target = response.data["transaction"]
        self.assertEqual(
            self.decide(
                overlap, "link", transaction=target, acknowledge_issues=True
            ).status_code,
            200,
        )
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(StatementRow.objects.filter(transaction=target).count(), 2)

    def test_overlap_does_not_recreate_user_corrected_ledger_amount_and_date(self):
        first = self.upload()
        row = first.rows.first()
        response = self.decide(row)
        target = response.data["transaction"]
        edit_url = reverse("transaction-detail", args=[target])
        self.assertEqual(
            self.client.patch(edit_url, {"amount": "60.00"}, format="json").status_code,
            400,
        )
        corrected = self.client.patch(
            edit_url,
            {"amount": "60.00", "date": "2026-04-02", "allow_linked_correction": True},
            format="json",
        )
        self.assertEqual(corrected.status_code, 200, corrected.data)
        second = self.upload(self.pdf + b"\n% synthetic corrected source export\n")
        overlap = second.rows.first()
        detail = self.client.get(reverse("statement-row-detail", args=[overlap.id]))
        self.assertEqual(detail.data["review"]["matches"][0]["id"], str(target))
        self.assertFalse(detail.data["review"]["matches"][0]["can_link"])
        self.assertEqual(self.decide(overlap).status_code, 400)
        updated = self.edit(overlap, amount="60.00")
        self.assertEqual(updated.status_code, 200, updated.data)
        overlap.refresh_from_db()
        self.assertEqual(
            self.decide(
                overlap, "link", transaction=target, acknowledge_issues=True
            ).status_code,
            200,
        )
        self.assertEqual(Transaction.objects.count(), 1)

    def test_wallet_principal_and_fee_post_once_with_final_balance_on_fee(self):
        batch = self.upload(synthetic_pdf("bkash"), self.wallet)
        principal = batch.rows.get(position=3, component="principal")
        fee = batch.rows.get(position=3, component="fee")
        for row in [principal, fee]:
            response = self.decide(row)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(self.decide(row).status_code, 200)
        principal.refresh_from_db()
        fee.refresh_from_db()
        self.assertIsNone(principal.transaction.balance_after)
        self.assertEqual(fee.transaction.type, "fee")
        self.assertEqual(fee.transaction.balance_after, Decimal("1093.00"))
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(
            calculate_expected_balance(account=self.wallet), Decimal("1093.00")
        )

    def test_incoming_transfer_uses_reporting_account_perspective(self):
        batch = self.upload(synthetic_pdf("bkash"), self.wallet)
        row = batch.rows.get(position=1)
        self.assertEqual(self.decide(row).status_code, 400)
        updated = self.edit(
            row,
            type="transfer",
            other_account=str(self.bank.id),
            classification_confirmed=True,
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        row.refresh_from_db()
        response = self.decide(row)
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get(pk=response.data["transaction"])
        self.assertEqual(record.account, self.bank)
        self.assertEqual(record.transfer_account, self.wallet)
        self.assertEqual(record.direction, "debit")
        self.assertEqual(record.transfer_evidence.count(), 1)
        evidence = record.transfer_evidence.get()
        self.assertEqual(evidence.direction, "credit")
        self.assertEqual(evidence.account, self.wallet)
        self.assertEqual(evidence.balance_after, Decimal("1100.00"))
        self.assertEqual(self.decide(row).status_code, 200)

    def test_transfer_match_attaches_observation_and_preserves_primary(self):
        target = Transaction.objects.create(
            user=self.user,
            account=self.bank,
            transfer_account=self.wallet,
            type="transfer",
            direction="debit",
            amount="100.00",
            date=date(2026, 1, 2),
            source="sms",
            note="Existing transfer",
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=target,
            account=self.bank,
            direction="debit",
            date=target.date,
            balance_after="800.00",
            source="sms",
            external_key="synthetic-primary",
        )
        batch = self.upload(synthetic_pdf("bkash"), self.wallet)
        row = batch.rows.get(position=1)
        response = self.decide(row, "link", transaction=str(target.id))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(target.transfer_evidence.count(), 2)
        target.refresh_from_db()
        self.assertEqual(target.note, "Existing transfer")
        self.assertIsNone(target.balance_after)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_bulk_creates_only_new_rows_and_skips_newly_found_matches(self):
        batch = self.upload()
        rows = [{"id": str(r.id), "version": r.version} for r in batch.rows.all()]
        url = reverse("statement-import-approve-new", args=[batch.id])
        response = self.client.post(url, {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["added"], 2)
        self.assertEqual(len(response.data["unresolved"]), 1)
        repeated = self.client.post(url, {"rows": rows}, format="json")
        self.assertEqual(repeated.data["added"], 0)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(
            self.client.get(reverse("statement-import-detail", args=[batch.id])).data[
                "counts"
            ],
            {"total": 3, "pending": 1, "posted": 2, "linked": 0, "skipped": 0},
        )

    def test_stale_changes_and_resolved_edits_are_rejected(self):
        batch = self.upload()
        row = batch.rows.first()
        self.assertEqual(self.edit(row, note="First edit").status_code, 200)
        self.assertEqual(self.edit(row, note="Stale edit").status_code, 409)
        self.assertEqual(self.decide(row).status_code, 409)
        row.refresh_from_db()
        self.assertEqual(self.decide(row).status_code, 200)
        self.assertEqual(self.edit(row, amount="60.00").status_code, 409)
        row.refresh_from_db()
        self.assertEqual(self.decide(row, "unlink").status_code, 200)
        row.refresh_from_db()
        self.assertEqual(self.decide(row, allow_separate=True).status_code, 400)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_skip_reopen_and_deleted_ledger_evidence_remain_reviewable(self):
        batch = self.upload()
        row = batch.rows.first()
        self.assertEqual(self.decide(row, "skip").status_code, 200)
        self.assertEqual(self.decide(row, "skip").status_code, 200)
        row.refresh_from_db()
        self.assertEqual(self.decide(row, "reopen").status_code, 200)
        row.refresh_from_db()
        self.assertEqual(self.decide(row).status_code, 200)
        row.refresh_from_db()
        row.transaction.delete()
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)
        self.assertEqual(self.decide(row).status_code, 400)
        self.assertEqual(self.decide(row, acknowledge_issues=True).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_source_discrepancies_and_balance_conflicts_need_acknowledgement(self):
        target = self.ledger_purchase(balance_after="949.00")
        batch = self.upload()
        row = batch.rows.first()
        response = self.decide(row, "link", transaction=str(target.id))
        self.assertEqual(response.status_code, 400)
        self.assertIn("acknowledge_conflict", response.data)
        self.assertEqual(
            self.decide(
                row, "link", transaction=str(target.id), acknowledge_conflict=True
            ).status_code,
            200,
        )
        bad = self.upload(synthetic_pdf("city_bank", bad_balance=True))
        problem = bad.rows.last()
        self.assertEqual(self.decide(problem, allow_separate=True).status_code, 400)
        response = self.decide(problem, allow_separate=True, acknowledge_issues=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            AuditLogEntry.objects.filter(
                entity_id=str(problem.id), metadata__acknowledge_issues=True
            ).exists()
        )

    def test_ownership_filters_and_validation_are_applied_before_decisions(self):
        batch = self.upload()
        row = batch.rows.first()
        url = reverse("statement-import-rows", args=[batch.id])
        self.assertEqual(
            self.client.get(url, {"state": "new", "direction": "credit"}).data["count"],
            1,
        )
        self.assertEqual(self.client.get(url, {"date_from": "bad"}).status_code, 400)
        other = get_user_model().objects.create_user(username="other-synthetic-import")
        foreign_category = Category.objects.create(user=other, name="Other category")
        self.assertEqual(
            self.edit(row, category=str(foreign_category.id)).status_code, 400
        )
        self.assertEqual(self.edit(row, amount="-1.00").status_code, 400)
        self.client.force_authenticate(other)
        self.assertEqual(
            self.client.get(reverse("statement-import-list")).data["count"], 0
        )
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.edit(row, note="No access").status_code, 404)
        self.assertEqual(self.decide(row).status_code, 404)

    def test_transfer_merge_retains_statement_observations_and_blocks_same_batch(self):
        from django.db import transaction
        from rest_framework.exceptions import ValidationError

        from apps.transactions.transfers import merge_transfers

        first = self.upload()
        second = self.upload(self.pdf + b"\n% synthetic second export\n")
        transfers = []
        for batch in (first, second):
            row = batch.rows.first()
            target = self.ledger_purchase(type="transfer", transfer_account=self.wallet)
            row.transaction = target
            row.state = "linked"
            row.save()
            transfers.append(target)
        with transaction.atomic():
            retained = merge_transfers(
                user=self.user, record_id=transfers[0].id, other_id=transfers[1].id
            )
        self.assertEqual(StatementRow.objects.filter(transaction=retained).count(), 2)
        self.assertEqual(Transaction.objects.count(), 1)
        repeat = first.rows.last()
        other = self.ledger_purchase(type="transfer", transfer_account=self.wallet)
        repeat.transaction = other
        repeat.state = "linked"
        repeat.save()
        with self.assertRaises(ValidationError), transaction.atomic():
            merge_transfers(user=self.user, record_id=retained.id, other_id=other.id)
        self.assertEqual(Transaction.objects.count(), 2)
        repeat.refresh_from_db()
        self.assertEqual(repeat.transaction_id, other.id)

    def test_row_filters_validate_values_and_allow_uncategorized(self):
        batch = self.upload()
        url = reverse("statement-import-rows", args=[batch.id])
        for params in (
            {"category": "invalid"},
            {"type": "invalid"},
            {"direction": "invalid"},
        ):
            self.assertEqual(self.client.get(url, params).status_code, 400)
        response = self.client.get(url, {"category": "none"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3)

    def test_unexpected_bulk_failure_rolls_back_all_movements(self):
        batch = self.upload()
        rows = [{"id": str(r.id), "version": r.version} for r in batch.rows.all()][:2]
        from .services import decide_locked

        count = 0

        def fail_second(**kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise RuntimeError("Synthetic unexpected failure")
            return decide_locked(**kwargs)

        with (
            patch(
                "apps.statements.review_views.decide_locked", side_effect=fail_second
            ),
            self.assertRaises(RuntimeError),
        ):
            self.client.post(
                reverse("statement-import-approve-new", args=[batch.id]),
                {"rows": rows},
                format="json",
            )
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(batch.rows.filter(state="posted").count(), 0)


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locking")
class StatementConcurrencyTests(TransactionTestCase):
    def test_concurrent_approvals_create_one_movement(self):
        self.check_concurrent_approvals(False)

    def test_concurrent_overlapping_imports_create_one_movement(self):
        self.check_concurrent_approvals(True)

    def check_concurrent_approvals(self, overlapping):
        from .parser import extract_statement
        from .services import save_import

        user = get_user_model().objects.create_user(
            username="synthetic-concurrent-import"
        )
        account = Account.objects.create(
            user=user, name="Synthetic concurrent bank", type="bank", currency="BDT"
        )
        preview = extract_statement(synthetic_pdf("city_bank"))
        preview["account_identity"] = "verify"
        batch, _ = save_import(
            user=user, account=account, digest="a" * 64, preview=preview
        )
        row = batch.rows.first()
        other_row = row
        if overlapping:
            other_batch, _ = save_import(
                user=user, account=account, digest="b" * 64, preview=preview
            )
            other_row = other_batch.rows.first()
        start = Barrier(2)

        def approve(selected_row):
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=user.pk))
                start.wait(timeout=10)
                response = client.post(
                    reverse("statement-row-decide", args=[selected_row.id]),
                    {"version": 1, "action": "create"},
                    format="json",
                )
                return response.status_code, response.data.get("transaction")
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(approve, row), pool.submit(approve, other_row)]
            results = [future.result(timeout=20) for future in futures]
        if overlapping:
            self.assertEqual(sorted(r[0] for r in results), [200, 400])
        else:
            self.assertEqual([r[0] for r in results], [200, 200])
            self.assertEqual(results[0][1], results[1][1])
        self.assertEqual(Transaction.objects.count(), 1)


class StatementInsightTests(APITestCase):
    """Behavioral regressions for review assistance; all fixtures are synthetic."""

    setUp = SavedStatementTests.setUp
    upload = SavedStatementTests.upload
    edit = SavedStatementTests.edit
    decide = SavedStatementTests.decide
    ledger_purchase = SavedStatementTests.ledger_purchase

    def test_draft_summary_preserves_source_checks_and_zero(self):
        batch = self.upload()
        checks = batch.checks
        row = batch.rows.first()
        response = self.edit(row, balance_after="0.00")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["review"]["draft_issues"])
        summary = self.client.get(reverse("statement-import-summary", args=[batch.id]))
        self.assertEqual(summary.status_code, 200, summary.data)
        self.assertGreater(summary.data["discrepancy_count"], 0)
        self.assertEqual(summary.data["remaining_count"], 3)
        batch.refresh_from_db()
        self.assertEqual(batch.checks, checks)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_remembered_choices_are_explicit_scoped_and_preserve_money(self):
        from .models import StatementMapping

        batch = self.upload()
        row = batch.rows.first()
        self.assertEqual(
            self.edit(row, category=str(self.category.id)).status_code, 200
        )
        row.refresh_from_db()
        result = self.decide(row, remember_choices=True)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(StatementMapping.objects.count(), 1)
        repeat = batch.rows.get(position=3)
        detail = self.client.get(reverse("statement-row-detail", args=[repeat.id]))
        suggestion = detail.data["review"]["suggestion"]
        self.assertEqual(suggestion["category"], str(self.category.id))
        self.assertIsNone(repeat.category_id)
        self.assertEqual(repeat.amount, Decimal(50))
        self.category.is_active = False
        self.category.save()
        detail = self.client.get(reverse("statement-row-detail", args=[repeat.id]))
        self.assertIsNone(detail.data["review"]["suggestion"])
        other = Account.objects.create(
            user=self.user, name="Other synthetic bank", type="bank", currency="BDT"
        )
        second = self.upload(account=other)
        detail = self.client.get(
            reverse("statement-row-detail", args=[second.rows.first().id])
        )
        self.assertIsNone(detail.data["review"]["suggestion"])

    def test_selected_skip_keeps_ledger_and_reports_stale_rows(self):
        batch = self.upload()
        first, second, third = list(batch.rows.all())
        self.assertEqual(self.decide(first).status_code, 200)
        response = self.client.post(
            reverse("statement-import-review-selected", args=[batch.id]),
            {
                "action": "skip",
                "rows": [
                    {"id": str(row.id), "version": row.version}
                    for row in [first, second, third]
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["skipped"], 2)
        self.assertEqual(Transaction.objects.count(), 1)
        summary = self.client.get(
            reverse("statement-import-summary", args=[batch.id])
        ).data
        self.assertEqual(summary["remaining_count"], 0)
        self.assertEqual(summary["dispositions"]["skipped"]["count"], 2)
        self.assertEqual(Decimal(summary["draft_net"]), Decimal(-50))

    def test_merchant_and_time_evidence_rank_matches_and_ties_stay_possible(self):
        from datetime import time

        batch = self.upload()
        row = batch.rows.first()
        row.time = time(12, 0)
        row.save()
        target = self.ledger_purchase(counterparty_text="SYNTH SHOP", time=time(12, 1))
        detail = self.client.get(reverse("statement-row-detail", args=[row.id])).data
        self.assertEqual(detail["review"]["matches"][0]["strength"], "strong")
        self.assertEqual(detail["review"]["matches"][0]["id"], str(target.id))
        self.ledger_purchase(counterparty_text="SYNTH SHOP", time=time(12, 2))
        detail = self.client.get(reverse("statement-row-detail", args=[row.id])).data
        self.assertTrue(
            all(m["strength"] == "possible" for m in detail["review"]["matches"])
        )
        self.assertEqual(Transaction.objects.count(), 2)

    def test_missing_source_amount_does_not_fabricate_net_check(self):
        from .insights import analyze

        batch = self.upload()
        rows = list(batch.rows.all())
        rows[0].extracted = {**rows[0].extracted, "amount": None}
        summary = analyze(batch, rows)
        self.assertIsNone(summary["source_net"])
        check = next(
            c
            for c in summary["checks"]
            if c["label"] == "Draft net movement versus source"
        )
        self.assertIsNone(check["passed"])

    def test_selected_stale_skip_is_not_applied(self):
        batch = self.upload()
        row = batch.rows.first()
        stale_version = row.version
        self.assertEqual(
            self.edit(row, note="Synthetic corrected note").status_code, 200
        )
        response = self.client.post(
            reverse("statement-import-review-selected", args=[batch.id]),
            {"action": "skip", "rows": [{"id": str(row.id), "version": stale_version}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["skipped"], 0)
        self.assertEqual(len(response.data["unresolved"]), 1)
        row.refresh_from_db()
        self.assertEqual(row.state, "pending")

    def test_transfer_match_uses_reporting_account_observation_date(self):
        batch = self.upload()
        row = batch.rows.first()
        self.assertEqual(
            self.edit(
                row,
                type="transfer",
                other_account=str(self.wallet.id),
                classification_confirmed=True,
            ).status_code,
            200,
        )
        target = Transaction.objects.create(
            user=self.user,
            account=self.bank,
            transfer_account=self.wallet,
            type="transfer",
            direction="debit",
            amount="50",
            date=date(2026, 4, 2),
            source="sms",
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=target,
            account=self.bank,
            direction="debit",
            date=date(2026, 1, 2),
            source="sms",
            balance_after="950",
        )
        response = self.client.get(reverse("statement-row-detail", args=[row.id]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["review"]["matches"][0]["id"], str(target.id))
