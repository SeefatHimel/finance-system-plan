"""Synthetic only: no personal spreadsheet rows or wallet balances."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from django.contrib.auth import get_user_model
from django.db import connection, close_old_connections
from django.test import TransactionTestCase
from rest_framework.test import APITestCase, APIClient
from rest_framework.exceptions import ValidationError
from apps.accounts.models import Account
from apps.categories.models import Category
from apps.reconciliation.models import BalanceSnapshot
from apps.reconciliation.timing import checkpoint_expected
from apps.transactions.models import Transaction, TransferEvidence
from apps.transactions.services import calculate_expected_balance
from config.secure_data import decrypt_bytes
from .models import BulkImport, BulkImportRow
from .parsing import table, money, day

TABLE = "Date\tCategory\tDescription\tAmount\tNotes\n2026-01-02\tFood\tSynthetic meal\t৳150.00\tSynthetic note\n2026-01-02\tFood\tSynthetic return\t-৳20.00\t"


class BulkImportTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-bulk")
        self.account = Account.objects.create(
            user=self.user, name="Synthetic wallet", type="cash", starting_balance=1000
        )
        self.category = Category.objects.create(user=self.user, name="Food")
        self.client.force_authenticate(self.user)

    def create(self, text=TABLE, account=None):
        response = self.client.post(
            "/api/bulk-imports/",
            {"account": str((account or self.account).pk), "text": text},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def review(self, batch, **changes):
        decisions = changes.get(
            "decisions", batch["configuration"].get("decisions", {})
        )
        for row in batch["rows"]:
            decision = decisions.get(str(row["number"]), {})
            if decision.get("reviewed"):
                decision.setdefault(
                    "review_fingerprint", row.get("review_fingerprint", "")
                )
        if decisions:
            changes["decisions"] = decisions
        payload = {**batch["configuration"], "version": batch["version"], **changes}
        response = self.client.patch(
            f"/api/bulk-imports/{batch['id']}/", payload, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def commit(self, batch):
        return self.client.post(
            f"/api/bulk-imports/{batch['id']}/commit/",
            {"version": batch["version"], "review_token": batch["review_token"]},
            format="json",
        )

    def record(self):
        batch = self.create()
        response = self.commit(batch)
        self.assertEqual(response.status_code, 200, response.data)
        return batch

    def test_preview_is_read_only_and_original_is_encrypted(self):
        raw = "\ufeff" + TABLE.replace("\n", "\r\n")
        batch = self.create(raw)
        self.assertEqual(Transaction.objects.count(), 0)
        source = BulkImport.objects.get(pk=batch["id"])
        self.assertNotIn(b"Synthetic note", bytes(source.original))
        self.assertEqual(decrypt_bytes(source.original).decode(), raw)
        self.assertEqual(self.create(TABLE)["id"], batch["id"])
        self.assertEqual(batch["rows"][1]["values"]["type"], "refund")
        self.assertIsNone(batch["rows"][0]["values"]["time"])
        self.assertEqual(batch["summary"]["needs_review"], 0)

    def test_record_updates_regular_reports_and_retry_does_not_duplicate(self):
        batch = self.record()
        retry = self.commit(batch)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(
            calculate_expected_balance(account=self.account), Decimal("870.00")
        )
        report = self.client.get("/api/reports/monthly/?month=2026-01")
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["expense_total"], "130.00")
        reopened = self.create()
        self.assertEqual(reopened["id"], batch["id"])
        self.assertIn("Spreadsheet", reopened["rows"][0]["matches"][0]["source_labels"])

    def test_custom_column_mapping_is_required_and_survives_reload(self):
        batch = self.create("When,What,Cost\n02/01/2026,Synthetic ride,45.50")
        self.assertTrue(batch["errors"])
        self.assertEqual(
            self.client.get(f"/api/bulk-imports/{batch['id']}/").status_code, 200
        )
        batch = self.review(
            batch,
            mapping={"date": "When", "description": "What", "amount": "Cost"},
            date_order="DMY",
        )
        self.assertEqual(batch["rows"][0]["values"]["date"], "2026-01-02")
        self.assertEqual(self.commit(batch).status_code, 200)

    def test_zero_missing_amount_and_adjustment_require_review_or_skip(self):
        batch = self.create(
            "Date\tDescription\tAmount\n2026-01-02\tMissing\t৳0.00\n2026-01-02\tUnaccounted cash difference\t৳3.45"
        )
        self.assertEqual(self.commit(batch).status_code, 400)
        batch = self.review(
            batch,
            decisions={
                "1": {"action": "skip"},
                "2": {"type": "adjustment", "reviewed": True},
            },
        )
        response = self.commit(batch)
        self.assertEqual(response.status_code, 200, response.data)
        entry = Transaction.objects.get()
        self.assertEqual((entry.type, entry.amount), ("adjustment", Decimal("3.45")))
        self.assertEqual(response.data["receipt"]["skipped"], 1)

    def test_row_amount_date_and_description_corrections_keep_original(self):
        batch = self.create("Date\tDescription\tAmount\nnot a date\t\t0")
        batch = self.review(
            batch,
            decisions={
                "1": {
                    "date": "2026-01-03",
                    "amount": "5.25",
                    "description": "Corrected synthetic entry",
                }
            },
        )
        response = self.commit(batch)
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        source = self.client.get(f"/api/transactions/{record.pk}/bulk-sources/")
        self.assertEqual(source.data[0]["original"]["Amount"], "0")
        self.assertEqual(source.data[0]["normalized"]["amount"], "5.25")

    def test_repeated_rows_require_decision_and_can_both_be_kept(self):
        batch = self.create(
            "Date\tDescription\tAmount\n2026-01-02\tSynthetic tea\t30\n2026-01-02\tSynthetic tea\t30"
        )
        self.assertEqual(batch["summary"]["needs_review"], 2)
        batch = self.review(
            batch, decisions={str(n): {"reviewed": True} for n in (1, 2)}
        )
        self.assertEqual(self.commit(batch).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_existing_sms_can_be_linked_without_recording_money_twice(self):
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=150,
            date="2026-01-02",
            source="sms",
        )
        batch = self.create()
        self.assertEqual(batch["rows"][0]["matches"][0]["source"], "sms")
        self.assertEqual(self.commit(batch).status_code, 400)
        batch = self.review(
            batch,
            decisions={
                "1": {"action": "link", "transaction": str(record.pk), "reviewed": True}
            },
        )
        response = self.commit(batch)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["receipt"]["linked"], 1)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(record.bulk_import_rows.count(), 1)

    def test_changed_ledger_suggestions_are_rejected_before_writing(self):
        batch = self.create()
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=150,
            date="2026-01-02",
        )
        self.assertEqual(self.commit(batch).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_other_users_targets_and_accounts_are_not_accessible(self):
        other = get_user_model().objects.create_user(username="synthetic-outsider")
        foreign = Account.objects.create(
            user=other, name="Synthetic foreign", type="cash"
        )
        denied = self.client.post(
            "/api/bulk-imports/",
            {"account": str(foreign.pk), "text": TABLE},
            format="json",
        )
        self.assertEqual(denied.status_code, 404)
        batch = self.create()
        self.client.force_authenticate(other)
        for suffix in ("", "commit/", "undo/"):
            url = f"/api/bulk-imports/{batch['id']}/{suffix}"
            response = (
                self.client.get(url)
                if not suffix
                else self.client.post(
                    url, {"version": 1, "review_token": "x"}, format="json"
                )
            )
            self.assertEqual(response.status_code, 404)

    def test_end_of_day_checkpoint_requires_confirmation_and_never_moves_money(self):
        batch = self.create()
        batch = self.review(
            batch, checkpoints=[{"date": "2026-01-02", "balance": "860.00"}]
        )
        self.assertEqual(self.commit(batch).status_code, 400)
        batch = self.review(
            batch,
            checkpoints=[
                {"date": "2026-01-02", "balance": "860.00", "end_of_day": True}
            ],
        )
        self.assertEqual(batch["checkpoints"][0]["expected_balance"], "870.00")
        self.assertEqual(batch["checkpoints"][0]["difference"], "-10.00")
        self.assertEqual(self.commit(batch).status_code, 200)
        snapshot = BalanceSnapshot.objects.get()
        self.assertEqual(snapshot.checked_at.microsecond, 999999)
        self.assertEqual(snapshot.precision, "end_of_day")
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(
            self.client.get("/api/reconciliation/snapshots/").status_code, 200
        )
        self.assertEqual(
            self.client.post(f"/api/bulk-imports/{batch['id']}/undo/").status_code, 200
        )
        self.assertEqual(BalanceSnapshot.objects.count(), 0)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_timed_checkpoint_explicit_unknown_order_and_exception(self):
        batch = self.create()
        unknown = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=5,
            date="2026-01-02",
        )
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=100,
            date="2026-01-02",
            time="20:00",
        )
        checkpoint = {"date": "2026-01-02", "time": "18:00", "balance": "850"}
        batch = self.review(batch, checkpoints=[checkpoint])
        self.assertTrue(batch["checkpoints"][0]["errors"])
        batch = self.review(
            batch,
            checkpoints=[
                {
                    **checkpoint,
                    "unknown_position": "before",
                    "exceptions": {"row:2": "after"},
                }
            ],
        )
        self.assertEqual(batch["checkpoints"][0]["expected_balance"], "845.00")
        response = self.commit(batch)
        self.assertEqual(response.status_code, 200, response.data)
        snapshot = BalanceSnapshot.objects.get()
        self.assertEqual(snapshot.timing_order[str(unknown.pk)], "before")
        self.assertEqual(
            checkpoint_expected(
                self.account,
                snapshot.checked_at,
                snapshot.precision,
                snapshot.timing_order,
            ),
            Decimal("845.00"),
        )
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=1,
            date="2026-01-02",
        )
        with self.assertRaises(ValidationError):
            checkpoint_expected(
                self.account,
                snapshot.checked_at,
                snapshot.precision,
                snapshot.timing_order,
            )

    def test_checkpoint_change_after_preview_requires_refresh(self):
        batch = self.review(
            self.create(),
            checkpoints=[{"date": "2026-01-02", "balance": "870", "end_of_day": True}],
        )
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=1,
            date="2026-01-01",
        )
        self.assertEqual(self.commit(batch).status_code, 409)
        self.assertEqual(BalanceSnapshot.objects.count(), 0)

    def test_atomic_rollback_when_final_row_has_invalid_destination(self):
        batch = self.review(
            self.create(), decisions={"2": {"type": "transfer", "direction": "credit"}}
        )
        self.assertEqual(self.commit(batch).status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_transfer_and_reported_balance_preserve_account_perspective(self):
        bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank"
        )
        batch = self.create(
            "Date\tDescription\tAmount\tBalance after\n2026-01-02\tReceived cash\t-100\t1100"
        )
        batch = self.review(
            batch, decisions={"1": {"type": "transfer", "other_account": str(bank.pk)}}
        )
        self.assertEqual(self.commit(batch).status_code, 200)
        record = Transaction.objects.get()
        self.assertEqual(record.transfer_account_id, self.account.pk)
        self.assertEqual(
            calculate_expected_balance(account=self.account), Decimal("1100.00")
        )

    def test_transfer_matches_only_compare_the_reporting_accounts_balance(self):
        bank = Account.objects.create(user=self.user, name="Synthetic bank", type="bank")
        record = Transaction.objects.create(
            user=self.user, account=bank, transfer_account=self.account,
            type="transfer", direction="debit", amount=100, date="2026-01-02",
            balance_after=900, source="web",
        )
        batch = self.create(
            "Date,Description,Amount,Balance after\n2026-01-02,Received cash,-100,1100"
        )
        self.assertIsNone(batch["rows"][0]["matches"][0]["balance_after"])
        report = TransferEvidence.objects.create(
            user=self.user, transaction=record, account=self.account,
            direction="credit", date=record.date, balance_after=1100,
            source="web", is_effective_balance=True,
        )
        batch = self.client.get(f"/api/bulk-imports/{batch['id']}/").data
        self.assertEqual(batch["rows"][0]["matches"][0]["balance_after"], "1100.00")
        batch = self.review(batch, decisions={"1": {
            "action": "link", "transaction": str(record.pk), "reviewed": True,
        }})
        self.assertFalse(any("source balance" in warning.lower()
                             for warning in batch["rows"][0]["warnings"]))
        # An explicitly cleared cash report must remain unknown, not use bank cash.
        report.balance_after = None
        report.save(update_fields=["balance_after"])
        latest = self.client.get(f"/api/bulk-imports/{batch['id']}/").data
        self.assertIsNone(latest["rows"][0]["matches"][0]["balance_after"])
        self.assertFalse(latest["rows"][0]["reviewed"])
        self.assertEqual(self.commit(batch).status_code, 409)

    def test_import_undo_is_idempotent_and_keeps_original(self):
        batch = self.record()
        url = f"/api/bulk-imports/{batch['id']}/undo/"
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(
            self.client.get(f"/api/bulk-imports/{batch['id']}/").data["state"], "undone"
        )
        self.assertEqual(self.commit(batch).status_code, 409)

    def test_undo_never_deletes_a_linked_existing_movement(self):
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=150,
            date="2026-01-02",
        )
        batch = self.review(
            self.create(),
            decisions={
                "1": {"action": "link", "transaction": str(record.pk), "reviewed": True}
            },
        )
        self.assertEqual(self.commit(batch).status_code, 200)
        self.assertEqual(
            self.client.post(f"/api/bulk-imports/{batch['id']}/undo/").status_code, 200
        )
        self.assertTrue(Transaction.objects.filter(pk=record.pk).exists())
        self.assertEqual(BulkImportRow.objects.filter(transaction=record).count(), 0)

    def test_undo_refuses_edited_entries_without_partial_deletion(self):
        batch = self.record()
        row = Transaction.objects.first()
        self.client.patch(
            f"/api/transactions/{row.pk}/",
            {"note": "Synthetic correction"},
            format="json",
        )
        self.assertEqual(
            self.client.post(f"/api/bulk-imports/{batch['id']}/undo/").status_code, 409
        )
        self.assertEqual(Transaction.objects.count(), 2)

    def test_stale_draft_version_and_wrong_source_target_are_rejected(self):
        batch = self.create()
        updated = self.review(batch)
        self.assertEqual(self.commit(batch).status_code, 409)
        wrong = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=99,
            date="2026-01-02",
        )
        updated = self.review(
            updated,
            decisions={
                "1": {"action": "link", "transaction": str(wrong.pk), "reviewed": True}
            },
        )
        self.assertEqual(self.commit(updated).status_code, 400)

    def test_reopening_an_undone_import_allows_a_corrected_retry(self):
        batch = self.record()
        self.assertEqual(
            self.client.post(
                f"/api/bulk-imports/{batch['id']}/reopen/",
                {"version": batch["version"]},
                format="json",
            ).status_code,
            409,
        )
        self.client.post(f"/api/bulk-imports/{batch['id']}/undo/")
        reopened = self.client.post(
            f"/api/bulk-imports/{batch['id']}/reopen/",
            {"version": batch["version"]},
            format="json",
        )
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(self.commit(reopened.data).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_new_suggestion_invalidates_previous_row_acknowledgement(self):
        first = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=150,
            date="2026-01-02",
        )
        batch = self.create()
        batch = self.review(batch, decisions={"1": {"action": "new", "reviewed": True}})
        old_decisions = batch["configuration"]["decisions"]
        Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            amount=150,
            date="2026-01-02",
        )
        self.assertEqual(self.commit(batch).status_code, 409)
        batch = self.review(batch, decisions=old_decisions)
        self.assertFalse(batch["rows"][0]["reviewed"])
        self.assertEqual(self.commit(batch).status_code, 400)
        batch = self.review(
            batch,
            decisions={
                "1": {"action": "link", "transaction": str(first.pk), "reviewed": True}
            },
        )
        self.assertEqual(self.commit(batch).status_code, 200)

    def test_unmapped_categories_are_preserved_without_blocking_every_row(self):
        batch = self.create(
            "Date,Category,Description,Amount\n2026-01-02,Synthetic trip,Synthetic snack,10"
        )
        self.assertEqual(batch["summary"]["needs_review"], 0)
        self.assertEqual(self.commit(batch).status_code, 200)
        self.assertIn("Synthetic trip", Transaction.objects.get().note)

    def test_preview_query_count_does_not_grow_with_sheet_rows(self):
        from django.test.utils import CaptureQueriesContext

        text = "Date,Description,Amount\n" + "\n".join(
            f"2026-01-02,Synthetic row {n},{n + 1}" for n in range(108)
        )
        bank = Account.objects.create(user=self.user, name="Synthetic bank", type="bank")
        Transaction.objects.bulk_create([
            Transaction(user=self.user, account=bank, transfer_account=self.account,
                        type="transfer", amount=n + 1, date="2026-01-02")
            for n in range(108)
        ])
        with CaptureQueriesContext(connection) as queries:
            batch = self.create(text, account=bank)
        self.assertEqual(len(batch["rows"]), 108)
        self.assertLessEqual(len(queries), 15)

    def test_deleted_and_restored_ledger_identity_keeps_archived_source(self):
        batch = self.record()
        record = Transaction.objects.first()
        identity = record.pk
        fields = {
            key: getattr(record, key)
            for key in ("type", "direction", "date", "time", "amount", "source")
        }
        response = self.client.delete(f"/api/transactions/{identity}/")
        self.assertEqual(response.status_code, 204)
        self.assertIsNone(
            BulkImportRow.objects.get(ledger_identity=identity).transaction_id
        )
        # Restoring the same ledger identity must not lose its immutable archive.
        Transaction.objects.create(
            id=identity, user=self.user, account=self.account, **fields
        )
        self.assertEqual(
            self.client.get(f"/api/transactions/{identity}/bulk-sources/").data[0][
                "batch"
            ],
            batch["id"],
        )

    def test_currency_changes_invalidate_the_review_even_with_plain_numbers(self):
        batch = self.create(
            "Date,Description,Amount\n2026-01-02,Synthetic plain amount,10"
        )
        self.account.currency = "USD"
        self.account.save(update_fields=["currency"])
        self.assertEqual(self.commit(batch).status_code, 409)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_legacy_direction_conflicts_are_visible_but_cannot_be_linked(self):
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            type="expense",
            direction="credit",
            amount=150,
            date="2026-01-02",
        )
        batch = self.create()
        self.assertTrue(batch["rows"][0]["matches"])
        batch = self.review(
            batch,
            decisions={
                "1": {"action": "link", "transaction": str(record.pk), "reviewed": True}
            },
        )
        self.assertEqual(self.commit(batch).status_code, 400)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_money_parsing_is_exact_and_currency_mismatch_is_not_silent(self):
        self.assertEqual(money("-৳1,234.56"), Decimal("-1234.56"))
        self.assertEqual(money("৳১২.৫০"), Decimal("12.50"))
        for invalid in ("1,23.45", "nan", "1.234", "0", "=SUM(A1:A2)"):
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                money(invalid)
        with self.assertRaises(ValueError):
            money("৳10", currency="USD")
        with self.assertRaises(ValueError):
            day("02/03/2026")

    def test_csv_quoted_fields_and_unsafe_header_shapes(self):
        headers, rows, _ = table(
            'Date,Description,Amount\n2026-01-02,"Synthetic, note",15'
        )
        self.assertEqual(rows[0][1], "Synthetic, note")
        for invalid in (
            "Date,Date\nx,y",
            "Date,Amount\nx,2,3",
            "Date,Amount",
            "Date,Amount\n" + "2026-01-02,1\n" * 501,
        ):
            with self.assertRaises(ValidationError):
                table(invalid)


@skipUnless(
    connection.vendor == "postgresql",
    "Independent concurrent writes require PostgreSQL",
)
class ConcurrentBulkImportTests(TransactionTestCase):
    def test_parallel_confirmations_record_the_batch_once(self):
        user = get_user_model().objects.create_user(username="synthetic-bulk-race")
        wallet = Account.objects.create(
            user=user, name="Synthetic race wallet", type="cash"
        )
        client = APIClient()
        client.force_authenticate(user)
        batch = client.post(
            "/api/bulk-imports/",
            {
                "account": str(wallet.pk),
                "text": "Date,Description,Amount\n2026-01-02,Synthetic,10",
            },
            format="json",
        ).data
        barrier = Barrier(2)

        def worker(_):
            close_old_connections()
            try:
                api = APIClient()
                api.force_authenticate(user)
                barrier.wait(timeout=10)
                response = api.post(
                    f"/api/bulk-imports/{batch['id']}/commit/",
                    {
                        "version": batch["version"],
                        "review_token": batch["review_token"],
                    },
                    format="json",
                )
                return response.status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(list(executor.map(worker, range(2))), [200, 200])
        self.assertEqual(Transaction.objects.count(), 1)
