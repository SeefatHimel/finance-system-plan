"""Synthetic scan pagination, all-or-nothing apply groups and whole-group Undo."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
from uuid import UUID

from django.db import connection, connections
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.statements.models import StatementRow

from . import bulk_revalidation, revalidation
from . import test_revalidation as fixtures
from .models import Transaction, TransactionAction, TransferEvidence


class BulkRevalidationTests(APITestCase):
    setUp = fixtures.RevalidationTests.setUp
    candidate = fixtures.RevalidationTests.candidate

    def scan(self, **params):
        return self.client.get(reverse("transaction-bulk-revalidation"), params)

    def extra_record(self, amount="200.00", **changes):
        candidate = self.candidate(amount="200.37", balance="700.00")
        record = Transaction.objects.create(
            user=self.user,
            account=self.account,
            raw_message=candidate.raw_message,
            date=self.record.date,
            type="expense",
            direction="debit",
            amount=amount,
            balance_after="700.00",
            source="sms",
            **changes,
        )
        candidate.status = "confirmed"
        candidate.transaction = record
        candidate.save()
        return record

    def items(self):
        page = self.scan().data
        return [
            {
                "transaction": entry["preview"]["transaction"],
                "token": entry["preview"]["token"],
                "selected": [
                    suggestion["key"] for suggestion in entry["preview"]["suggestions"]
                ],
            }
            for entry in page["results"]
            if entry["preview"]["suggestions"]
        ]

    def apply(self, items):
        return self.client.post(
            reverse("transaction-bulk-apply-revalidation"),
            {"items": items},
            format="json",
        )

    def test_read_only_scan_returns_same_fingerprint_as_single_preview_and_no_sms_body(
        self,
    ):
        self.extra_record()
        response = self.scan(limit=1)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response.data["scanned"], 1)
        self.assertEqual(response.data["total"], 2)
        self.assertIsNotNone(response.data["next_cursor"])
        entry = response.data["results"][0]
        single = self.client.get(
            reverse("transaction-revalidate", args=[entry["preview"]["transaction"]])
        )
        self.assertEqual(single.data["fingerprint"], entry["preview"]["fingerprint"])
        self.assertNotIn(self.sms.raw_message.body, str(response.data))
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(TransactionAction.objects.count(), 0)
        self.assertEqual(
            str(Transaction.objects.get(pk=self.record.pk).amount), "100.00"
        )

    def test_keyset_scan_excludes_new_entries_and_never_reorders_on_updates(self):
        second = self.extra_record()
        first = self.scan(limit=1).data
        self.record.note = "Changed after first page"
        self.record.save()
        self.extra_record()
        second_page = self.scan(limit=1, cursor=first["next_cursor"]).data
        self.assertEqual(second_page["scanned"], 2)
        self.assertEqual(second_page["total"], 2)
        self.assertIsNone(second_page["next_cursor"])
        self.assertEqual(
            second_page["results"][0]["preview"]["transaction"], str(second.pk)
        )
        self.assertEqual(self.scan(limit=26).status_code, 400)
        self.assertEqual(
            self.scan(cursor=first["next_cursor"] + "tampered").status_code, 409
        )
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.scan(cursor=first["next_cursor"]).status_code, 400)
        self.assertEqual(self.scan().data["total"], 0)
        self.client.force_authenticate(None)
        self.assertEqual(self.scan().status_code, 401)

    def test_complete_scan_omits_clean_entries_and_is_resumable_after_deletion(self):
        second = self.extra_record()
        clean = Transaction.objects.create(
            user=self.user,
            account=self.account,
            date=self.record.date,
            amount="50.00",
            type="expense",
            direction="debit",
        )

        StatementRow.objects.create(
            batch=self.batch,
            transaction=clean,
            state="linked",
            position=2,
            component="principal",
            extracted={},
            source_fingerprint="synthetic-clean",
            date=self.record.date,
            direction="debit",
            amount="50.00",
            type="expense",
        )
        first = self.scan(limit=1).data
        second.delete()
        page = self.scan(cursor=first["next_cursor"], limit=1).data
        self.assertEqual(page["results"], [])
        self.assertEqual(page["scanned"], 2)
        self.assertEqual(
            page["total"], 3
        )  # Initial count, not an assertion of a snapshot ledger.
        self.assertIsNone(page["next_cursor"])
        clean.refresh_from_db()

    def test_bulk_apply_only_selected_fields_has_one_undo_for_all_entries(self):
        second = self.extra_record()
        items = self.items()
        items[0]["selected"] = ["amount"]
        response = self.apply(items)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            set(response.data["applied"]), {str(self.record.pk), str(second.pk)}
        )
        self.assertEqual(response.data["undo_action"]["kind"], "bulk_revalidate")
        self.assertEqual(TransactionAction.objects.count(), 1)
        self.record.refresh_from_db()
        second.refresh_from_db()
        self.row.refresh_from_db()
        self.sms.refresh_from_db()
        self.assertEqual(str(self.record.amount), "100.37")
        self.assertEqual(str(self.record.balance_after), "900.00")
        self.assertEqual(str(second.amount), "200.37")
        self.assertEqual(str(self.row.amount), "100.00")
        self.assertEqual(str(self.sms.amount), "100.37")
        self.assertEqual(
            AuditLogEntry.objects.filter(
                metadata__bulk_batch=response.data["batch"]
            ).count(),
            2,
        )
        action = response.data["undo_action"]["id"]
        undo = self.client.post(
            reverse("transaction-undo"), {"action": action}, format="json"
        )
        self.assertEqual(undo.status_code, 200, undo.data)
        self.record.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(str(self.record.amount), "100.00")
        self.assertEqual(str(second.amount), "200.00")
        self.assertEqual(self.apply(items).status_code, 409)

    def test_one_stale_or_invalid_preview_rolls_back_entire_group(self):
        second = self.extra_record()
        items = self.items()
        second.note = "New review"
        second.save()
        response = self.apply(items)
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn("No corrections", str(response.data))
        self.record.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(str(self.record.amount), "100.00")
        self.assertEqual(str(second.amount), "200.00")
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(TransactionAction.objects.count(), 0)
        items = self.items()
        items[-1]["selected"] = ["account"]
        self.assertEqual(self.apply(items).status_code, 400)
        self.record.refresh_from_db()
        self.assertEqual(str(self.record.amount), "100.00")
        self.assertEqual(TransactionAction.objects.count(), 0)

    def test_replay_expiry_duplicate_ids_cross_user_and_oversize_are_safe(self):
        self.extra_record()
        items = self.items()
        self.assertEqual(self.apply([items[0], items[0]]).status_code, 400)
        self.assertEqual(self.apply(items * 13).status_code, 400)
        self.assertEqual(self.apply([]).status_code, 400)
        with patch("django.core.signing.time.time", return_value=99999999999):
            self.assertEqual(self.apply(items).status_code, 409)
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.apply(items).status_code, 404)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.apply(items).status_code, 200)
        self.assertEqual(self.apply(items).status_code, 409)
        self.assertEqual(AuditLogEntry.objects.count(), 2)
        self.assertEqual(TransactionAction.objects.count(), 1)

    def test_undo_rejects_if_any_entry_changed_after_group(self):
        second = self.extra_record()
        result = self.apply(self.items()).data
        second.note = "Later edit"
        second.save()
        response = self.client.post(
            reverse("transaction-undo"),
            {"action": result["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        self.record.refresh_from_db()
        self.assertEqual(str(self.record.amount), "100.37")

    def test_source_cap_and_policy_or_scan_expiry_require_review(self):
        self.extra_record()
        first = self.scan(limit=1).data
        with patch("apps.transactions.revalidation.MAX_SOURCES", 0):
            page = self.scan().data
            self.assertTrue(
                all(not item["preview"]["suggestions"] for item in page["results"])
            )
        with patch("apps.transactions.revalidation.POLICY_VERSION", "next"):
            self.assertEqual(self.scan(cursor=first["next_cursor"]).status_code, 409)
        with patch("django.core.signing.time.time", return_value=99999999999):
            self.assertEqual(self.scan(cursor=first["next_cursor"]).status_code, 409)

    def test_preview_sources_and_dependencies_are_batched_for_larger_scan_pages(self):
        for number in range(18):
            record = Transaction.objects.create(
                user=self.user,
                account=self.account,
                date=self.record.date,
                amount="50.00",
                type="expense",
                direction="debit",
            )
            StatementRow.objects.create(
                batch=self.batch,
                transaction=record,
                state="linked",
                position=number + 10,
                component="principal",
                extracted={},
                source_fingerprint=f"synthetic-clean-{number}",
                date=self.record.date,
                direction="debit",
                amount="50.00",
                type="expense",
            )
        with CaptureQueriesContext(connection) as one:
            self.assertEqual(self.scan(limit=1).status_code, 200)
        with CaptureQueriesContext(connection) as many:
            self.assertEqual(self.scan(limit=25).status_code, 200)
        self.assertLessEqual(len(many), len(one) + 1)

    def test_bulk_transfer_preview_keeps_the_same_effective_report_order_as_single(
        self,
    ):
        self.record.type = "transfer"
        self.record.transfer_account = self.wallet
        self.record.save()
        TransferEvidence.objects.create(
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
            id=UUID(int=2),
            user=self.user,
            transaction=self.record,
            account=self.wallet,
            direction="credit",
            date=self.record.date + timedelta(days=1),
            source="import",
            balance_after="42.00",
        )
        TransferEvidence.objects.create(
            id=UUID(int=3),
            user=self.user,
            transaction=self.record,
            account=self.wallet,
            direction="credit",
            date=self.record.date,
            source="import",
            balance_after="42.07",
        )
        preview = self.scan().data["results"][0]["preview"]
        single = self.client.get(
            reverse("transaction-revalidate", args=[self.record.pk])
        ).data
        self.assertEqual(preview["fingerprint"], single["fingerprint"])
        balance = next(
            item
            for item in preview["suggestions"]
            if item["key"] == f"balance:{self.wallet.pk}"
        )
        self.assertEqual(balance["current"], "42.00")
        self.assertEqual(balance["proposed"], "42.07")
        self.assertEqual(
            self.apply(
                [
                    {
                        "transaction": str(self.record.pk),
                        "token": preview["token"],
                        "selected": [balance["key"]],
                    }
                ]
            ).status_code,
            200,
        )

    def test_failure_after_first_write_rolls_back_entire_group_and_recovery(self):
        second = self.extra_record()
        items = self.items()
        original = revalidation._write_corrections
        calls = 0

        def fail_later(**kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("synthetic write failure")
            return original(**kwargs)

        with (
            patch(
                "apps.transactions.revalidation._write_corrections",
                side_effect=fail_later,
            ),
            self.assertRaises(RuntimeError),
        ):
            self.apply(items)
        self.record.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(str(self.record.amount), "100.00")
        self.assertEqual(str(second.amount), "200.00")
        self.assertEqual(AuditLogEntry.objects.count(), 0)
        self.assertEqual(TransactionAction.objects.count(), 0)


class ConcurrentBulkRevalidationTests(TransactionTestCase):
    def test_concurrent_group_applies_once_with_one_recovery_action(self):
        case = BulkRevalidationTests()
        case.client = APIClient()
        case.setUp()
        case.extra_record()
        items = case.items()

        def apply():
            connections.close_all()
            try:
                client = APIClient()
                client.force_authenticate(case.user)
                return client.post(
                    reverse("transaction-bulk-apply-revalidation"),
                    {"items": items},
                    format="json",
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(lambda _: apply(), range(2)))
        self.assertEqual(sorted(result), [200, 409])
        self.assertEqual(TransactionAction.objects.count(), 1)
        self.assertEqual(AuditLogEntry.objects.count(), 2)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(bulk_revalidation.APPLY_LIMIT, 25)
