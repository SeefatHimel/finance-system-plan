"""Synthetic cash observations: no financial data or automatic ledger changes."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from uuid import uuid4

from config.secure_data import decrypt_bytes
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.transactions.models import Transaction

from .cash_counts import build_preview
from .cash_serializers import CashCountInput
from .models import BalanceSnapshot, CashCountBatch


class CashCountTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-counter")
        self.other = get_user_model().objects.create_user(username="synthetic-other")
        self.cash = Account.objects.create(
            user=self.user, name="Example wallet", type="cash", starting_balance="1000"
        )
        self.home = Account.objects.create(
            user=self.user, name="Example storage", type="home_cash"
        )
        self.bank = Account.objects.create(
            user=self.user, name="Example bank", type="bank"
        )
        self.foreign = Account.objects.create(
            user=self.other, name="Other cash", type="cash"
        )
        self.client.force_authenticate(self.user)

    def payload(self, **changes):
        return {
            "rows": [
                {
                    "account": str(self.cash.pk),
                    "date": "2026-02-01",
                    "balance": "950",
                    "note": "Synthetic count",
                }
            ],
            "end_of_day": True,
            **changes,
        }

    def check(self, data):
        response = self.client.post(reverse("cash-counts-preview"), data, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("no-store", response["Cache-Control"])
        return response.data

    def save(self, data, token=None, key=None):
        token = token or self.check(data)["review_token"]
        return self.client.post(
            reverse("cash-counts"),
            {**data, "review_token": token, "idempotency_key": str(key or uuid4())},
            format="json",
        )

    def count(self, data=None):
        response = self.save(data or self.payload())
        self.assertEqual(response.status_code, 200, response.data)
        return BalanceSnapshot.objects.get(pk=response.data["counts"][0]["id"])

    def movement(self, **changes):
        return Transaction.objects.create(
            user=self.user,
            account=self.cash,
            date="2026-02-01",
            amount="100",
            type="expense",
            **changes,
        )

    def test_date_only_requires_end_of_day_and_zero_is_valid(self):
        data = self.payload(end_of_day=False)
        self.assertFalse(self.check(data)["ready"])
        data["end_of_day"] = True
        data["rows"][0]["balance"] = "0"
        item = self.count(data)
        self.assertEqual(item.actual_balance, 0)
        self.assertEqual(item.precision, "end_of_day")
        self.assertEqual(item.checked_at.astimezone().date(), date(2026, 2, 1))
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertIsNone(item.adjustment_transaction_id)

    def test_only_owned_active_physical_accounts_can_receive_counts(self):
        digital = Account.objects.create(
            user=self.user, name="Digital wallet", type="mobile_wallet"
        )
        inactive = Account.objects.create(
            user=self.user, name="Old cash", type="cash", is_active=False
        )
        for account in [self.bank, digital, inactive, self.foreign]:
            data = self.payload()
            data["rows"][0]["account"] = str(account.pk)
            self.assertFalse(self.check(data)["ready"])
            self.assertEqual(self.save(data).status_code, 400)
        self.assertEqual(BalanceSnapshot.objects.count(), 0)

    def test_correct_signs_for_cash_movements_and_transfer_sides(self):
        for kind, direction, value in [
            ("expense", "debit", "10"),
            ("fee", "debit", "2"),
            ("lend", "debit", "3"),
            ("repayment_paid", "debit", "4"),
            ("income", "credit", "20"),
            ("refund", "credit", "5"),
            ("borrow", "credit", "6"),
            ("repayment_received", "credit", "7"),
            ("adjustment", "credit", "8"),
            ("adjustment", "debit", "9"),
        ]:
            Transaction.objects.create(
                user=self.user,
                account=self.cash,
                date="2026-02-01",
                amount=value,
                type=kind,
                direction=direction,
            )
        Transaction.objects.create(
            user=self.user,
            account=self.cash,
            transfer_account=self.home,
            type="transfer",
            amount="30",
            date="2026-02-01",
        )
        Transaction.objects.create(
            user=self.user,
            account=self.home,
            transfer_account=self.cash,
            type="transfer",
            amount="40",
            date="2026-02-01",
        )
        row = self.check(self.payload())["rows"][0]
        self.assertEqual(row["expected_balance"], "1028.00")
        self.assertEqual(row["difference"], "-78.00")

    def test_mismatch_is_saved_without_hiding_or_adjusting_it(self):
        self.movement()
        item = self.count()
        self.assertEqual(item.expected_balance, 900)
        self.assertEqual(item.difference, 50)
        self.assertEqual(item.status, "extra_money")
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            AuditLogEntry.objects.filter(
                entity_type="reconciliation.balancesnapshot"
            ).count(),
            1,
        )
        self.assertIn(
            "Cash count",
            self.client.get(reverse("balance-snapshot-detail", args=[item.pk])).data[
                "source_label"
            ],
        )

    def test_idempotent_retry_and_new_key_duplicate_protection(self):
        data = self.payload()
        key = uuid4()
        token = self.check(data)["review_token"]
        first = self.save(data, token, key)
        second = self.save(data, token, key)
        self.assertEqual(first.data, second.data)
        self.assertEqual(BalanceSnapshot.objects.count(), 1)
        self.assertEqual(CashCountBatch.objects.count(), 1)
        self.assertFalse(self.check(data)["ready"])
        self.assertEqual(self.save(data).status_code, 400)
        data["rows"][0]["balance"] = "960"
        self.assertEqual(self.save(data, token, key).status_code, 409)

    def test_original_table_is_encrypted_and_spreadsheet_expected_is_reference_only(
        self,
    ):
        data = {
            "text": "| Storage Account | Date | Counted Balance | Expected Balance | Notes |\n| :---: | --- | ---: | ---: | --- |\n| Example wallet | 2026-02-01 | 1,050 | 999,999 | Synthetic source note |\n| Example storage | 2026-02-01 | 0 | 888 | |",
            "end_of_day": True,
        }
        result = self.check(data)
        self.assertTrue(result["ready"])
        self.assertEqual(result["rows"][0]["expected_balance"], "1000.00")
        self.assertEqual(result["rows"][0]["source_expected"], "999,999")
        response = self.save(data)
        self.assertEqual(response.data["saved"], 2)
        batch = CashCountBatch.objects.get()
        self.assertNotIn(b"Synthetic source note", bytes(batch.original))
        self.assertEqual(
            json.loads(decrypt_bytes(batch.original))["text"], data["text"]
        )

    def test_custom_columns_and_account_mapping(self):
        data = {
            "text": "Jar,When,Count\nMy wallet,02/01/2026,1,050",
            "end_of_day": True,
        }
        # Unquoted grouped CSV amounts must be rejected rather than shifted into another column.
        self.assertEqual(
            self.client.post(
                reverse("cash-counts-preview"), data, format="json"
            ).status_code,
            400,
        )
        data.update(
            text="Jar\tWhen\tCount\nMy wallet\t02/01/2026\t1,050",
            mapping={"account": "Jar", "date": "When", "balance": "Count"},
            account_map={"My wallet": str(self.cash.pk)},
            date_order="DMY",
        )
        result = self.check(data)
        self.assertTrue(result["ready"])
        self.assertEqual(result["rows"][0]["date"], "2026-01-02")

    def test_repeated_periods_require_skip_or_explicit_correction(self):
        item = self.count()
        data = self.payload()
        data["rows"][0].update(balance="940", action="replace")
        response = self.save(data)
        self.assertEqual(response.status_code, 200, response.data)
        item.refresh_from_db()
        self.assertEqual(item.actual_balance, 940)
        self.assertEqual(BalanceSnapshot.objects.count(), 1)
        self.assertEqual(CashCountBatch.objects.count(), 2)
        self.assertEqual(AuditLogEntry.objects.filter(action="updated").count(), 1)
        data["rows"].append({**data["rows"][0], "action": "add"})
        self.assertFalse(self.check(data)["ready"])
        data["decisions"] = {"2": {"action": "skip"}}
        self.assertTrue(self.check(data)["ready"])

    def test_correction_does_not_modify_a_saved_adjustment(self):
        item = self.count()
        adjustment = self.movement()
        item.adjustment_transaction = adjustment
        item.save()
        data = self.payload()
        data["rows"][0]["action"] = "replace"
        result = self.check(data)
        self.assertFalse(result["ready"])
        self.assertIn("adjustment", " ".join(result["rows"][0]["errors"]))

    def test_stale_preview_cannot_record_changed_ledger_or_account_start(self):
        data = self.payload()
        token = self.check(data)["review_token"]
        self.movement()
        self.assertEqual(self.save(data, token).status_code, 409)
        self.assertEqual(BalanceSnapshot.objects.count(), 0)
        token = self.check(data)["review_token"]
        self.cash.starting_balance = 1100
        self.cash.save()
        self.assertEqual(self.save(data, token).status_code, 409)

    def test_timed_count_requires_explicit_order_for_unknown_times(self):
        untimed = self.movement()
        self.movement(time="17:00")
        self.movement(time="19:00")
        data = self.payload(end_of_day=False)
        data["rows"][0].update(time="18:00", balance="800")
        result = self.check(data)
        self.assertFalse(result["ready"])
        self.assertEqual(len(result["rows"][0]["unknown"]), 1)
        data["rows"][0]["timing_order"] = {str(untimed.pk): "before"}
        item = self.count(data)
        self.assertEqual(item.expected_balance, 800)
        self.assertEqual(item.precision, "instant")
        untimed.refresh_from_db()
        self.assertIsNone(untimed.time)
        data["rows"][0].update(
            action="replace", timing_order={str(untimed.pk): "after"}
        )
        self.assertEqual(self.check(data)["rows"][0]["expected_balance"], "900.00")

    def test_end_of_day_includes_untimed_and_last_second_even_with_timed_rows(self):
        self.movement()
        self.movement(time="23:59:59")
        data = self.payload()
        data["rows"].append(
            {**data["rows"][0], "time": "18:00", "unknown_position": "before"}
        )
        result = self.check(data)
        self.assertTrue(result["ready"])
        self.assertEqual(result["rows"][0]["expected_balance"], "800.00")
        self.assertEqual(result["rows"][1]["expected_balance"], "900.00")

    def test_repeated_gap_is_compared_against_same_current_ledger(self):
        first = self.count()
        Transaction.objects.create(
            user=self.user,
            account=self.cash,
            type="expense",
            amount="100",
            date="2026-02-02",
        )
        data = self.payload()
        data["rows"][0].update(date="2026-02-02", balance="850")
        preview = self.check(data)
        self.assertEqual(preview["rows"][0]["difference_change"], "0.00")
        second = self.count(data)
        result = self.client.get(
            reverse("cash-count-comparison", args=[second.pk])
        ).data
        self.assertEqual(result["difference_change"], "0.00")
        self.assertEqual(result["movement_count"], 1)
        self.assertEqual(result["previous"]["id"], str(first.pk))
        self.movement()
        changed = self.client.get(
            reverse("cash-count-comparison", args=[second.pk])
        ).data
        self.assertTrue(changed["count"]["ledger_changed"])
        self.assertEqual(changed["difference_change"], "0.00")
        self.assertNotEqual(result["revision"], changed["revision"])
        second.refresh_from_db()
        self.assertEqual(second.expected_balance, 900)

    def test_batch_uses_corrected_prior_count_not_old_duplicate(self):
        self.count()
        data = self.payload()
        data["rows"][0].update(balance="900", action="replace")
        data["rows"].append(
            {"account": str(self.cash.pk), "date": "2026-02-02", "balance": "900"}
        )
        result = self.check(data)
        self.assertEqual(result["rows"][1]["previous"]["balance"], "900.00")
        self.assertEqual(result["rows"][1]["difference_change"], "0.00")

    def test_legacy_end_of_day_clock_uses_whole_day_boundary(self):
        first = BalanceSnapshot.objects.create(
            user=self.user,
            account=self.cash,
            checked_at="2026-02-01T10:00:00+06:00",
            actual_balance=1000,
            expected_balance=1000,
            difference=0,
        )
        result = self.check(self.payload())
        self.assertEqual(result["rows"][0]["duplicate"]["id"], str(first.pk))
        self.assertIsNone(result["rows"][0]["previous"])

    def test_history_is_private_paginated_and_keeps_inactive_counts(self):
        data = self.payload()
        data["rows"] = [
            {**data["rows"][0], "date": str(date(2026, 2, 1) + timedelta(days=n))}
            for n in range(52)
        ]
        self.assertEqual(self.save(data).status_code, 200)
        response = self.client.get(reverse("cash-counts"))
        self.assertEqual(response.data["count"], 52)
        self.assertEqual(len(response.data["results"]), 50)
        self.assertEqual(response.data["next_offset"], 50)
        self.assertTrue(response.data["results"][0]["same_recorded_difference"])
        self.assertEqual(
            len(self.client.get(reverse("cash-counts") + "?offset=50").data["results"]),
            2,
        )
        self.cash.is_active = False
        self.cash.save()
        self.assertEqual(self.client.get(reverse("cash-counts")).data["count"], 52)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(reverse("cash-counts")).data["count"], 0)
        self.assertEqual(
            self.client.get(
                reverse(
                    "cash-count-comparison", args=[response.data["results"][0]["id"]]
                )
            ).status_code,
            404,
        )

    def test_preview_reads_are_bounded_for_one_hundred_counts(self):
        data = self.payload()
        data["rows"] = [
            {**data["rows"][0], "date": str(date(2026, 2, 1) + timedelta(days=n))}
            for n in range(100)
        ]
        serializer = CashCountInput(data=data)
        serializer.is_valid(raise_exception=True)
        with CaptureQueriesContext(connection) as queries:
            result, _ = build_preview(self.user, serializer.validated_data)
        self.assertTrue(result["ready"])
        self.assertLessEqual(len(queries), 4)
        self.assertEqual(len(result["rows"]), 100)

    def test_invalid_last_row_prevents_partial_save(self):
        data = self.payload()
        data["rows"].append(
            {"account": str(self.cash.pk), "date": "bad date", "balance": "-10"}
        )
        self.assertFalse(self.check(data)["ready"])
        self.assertEqual(self.save(data).status_code, 400)
        self.assertEqual(BalanceSnapshot.objects.count(), 0)
        self.assertEqual(CashCountBatch.objects.count(), 0)

    def test_large_projection_returns_review_error_instead_of_database_overflow(self):
        self.cash.starting_balance = Decimal("999999999999.99")
        self.cash.save()
        Transaction.objects.create(
            user=self.user,
            account=self.cash,
            type="income",
            amount="1",
            date="2026-02-01",
        )
        self.assertFalse(self.check(self.payload())["ready"])
        self.assertEqual(self.save(self.payload()).status_code, 400)

    def test_new_untimed_entry_marks_old_timed_comparison_unresolved(self):
        data = self.payload()
        data["rows"][0]["time"] = "18:00"
        item = self.count(data)
        self.movement()
        result = self.client.get(reverse("cash-count-comparison", args=[item.pk]))
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["errors"])
        self.assertIsNone(result.data["count"]["current_expected"])
        self.assertEqual(result.data["movements"], [])

    def test_invalid_offsets_and_anonymous_access(self):
        self.assertEqual(
            self.client.get(reverse("cash-counts") + "?offset=-1").status_code, 400
        )
        self.assertEqual(
            self.client.get(reverse("cash-counts") + "?account=invalid").status_code,
            400,
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("cash-counts")).status_code, 401)

    def test_timed_order_cannot_move_an_entry_backwards_between_counts(self):
        self.movement()
        data = self.payload()
        data["rows"][0].update(time="10:00", unknown_position="before")
        data["rows"].append(
            {**data["rows"][0], "time": "18:00", "unknown_position": "after"}
        )
        self.assertFalse(self.check(data)["ready"])
        data["rows"].pop()
        self.count(data)
        data["rows"][0].update(time="18:00", unknown_position="after")
        self.assertFalse(self.check(data)["ready"])

    def test_new_earlier_count_also_checks_following_saved_timing(self):
        self.movement()
        data = self.payload()
        data["rows"][0].update(time="18:00", unknown_position="after")
        self.count(data)
        data["rows"][0].update(time="10:00", unknown_position="before")
        self.assertFalse(self.check(data)["ready"])

    def test_movement_pages_keep_interval_boundaries_and_signal_changes(self):
        first = self.count()
        for n in range(28):
            Transaction.objects.create(
                user=self.user,
                account=self.cash,
                date="2026-02-02",
                amount="1",
                type="expense",
                counterparty_text=f"Synthetic purchase {n}",
            )
        data = self.payload()
        data["rows"][0].update(date="2026-02-02", balance="922")
        second = self.count(data)
        url = reverse("cash-count-comparison", args=[second.pk])
        one = self.client.get(url).data
        two = self.client.get(url + "?offset=25").data
        self.assertEqual(one["previous"]["id"], str(first.pk))
        self.assertEqual(one["movement_count"], 28)
        self.assertEqual(len(one["movements"]), 25)
        self.assertEqual(len(two["movements"]), 3)
        self.assertEqual(one["revision"], two["revision"])
        self.assertFalse(
            {x["id"] for x in one["movements"]} & {x["id"] for x in two["movements"]}
        )

    def test_timing_dictionary_rejects_unbounded_input(self):
        data = self.payload()
        data["rows"][0]["timing_order"] = {str(uuid4()): "before" for _ in range(1001)}
        self.assertEqual(
            self.client.post(
                reverse("cash-counts-preview"), data, format="json"
            ).status_code,
            400,
        )

    def test_combined_timing_size_is_bounded_before_sql_parameter_exhaustion(self):
        Transaction.objects.bulk_create(
            [
                Transaction(
                    user=self.user,
                    account=self.cash,
                    date="2026-02-01",
                    amount="1",
                    type="expense",
                )
                for _ in range(1000)
            ]
        )
        data = self.payload()
        data["rows"] = [
            {**data["rows"][0], "time": f"{hour:02}:00", "unknown_position": "before"}
            for hour in range(6)
        ]
        result = self.client.post(reverse("cash-counts-preview"), data, format="json")
        self.assertEqual(result.status_code, 400)
        self.assertIn("Split", str(result.data))

    def test_legacy_duplicate_flood_is_bounded_before_projection(self):
        BalanceSnapshot.objects.bulk_create(
            [
                BalanceSnapshot(
                    user=self.user,
                    account=self.cash,
                    checked_at="2026-02-01T10:00:00+06:00",
                    actual_balance=1000,
                    expected_balance=1000,
                    difference=0,
                )
                for _ in range(301)
            ]
        )
        self.assertEqual(
            self.client.post(
                reverse("cash-counts-preview"), self.payload(), format="json"
            ).status_code,
            400,
        )

    def test_explicit_correction_can_fix_date_time_and_account_on_same_observation(
        self,
    ):
        item = self.count()
        data = self.payload()
        data["rows"][0].update(
            action="replace",
            replace_id=str(item.pk),
            account=str(self.home.pk),
            date="2026-02-03",
            time="18:00",
            balance="70",
        )
        self.assertEqual(self.save(data).status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.account, self.home)
        self.assertEqual(item.actual_balance, 70)
        self.assertEqual(str(item.checked_at.astimezone().date()), "2026-02-03")
        self.assertEqual(item.precision, "instant")
        self.assertEqual(BalanceSnapshot.objects.count(), 1)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_explicit_correction_cannot_take_another_period_or_users_count(self):
        first = self.count()
        data = self.payload()
        data["rows"][0]["date"] = "2026-02-02"
        second = self.count(data)
        data["rows"][0].update(action="replace", replace_id=str(first.pk))
        self.assertFalse(self.check(data)["ready"])
        data["rows"][0].update(date="2026-02-03", replace_id=str(uuid4()))
        self.assertFalse(self.check(data)["ready"])
        self.client.force_authenticate(self.other)
        foreign_data = {
            "rows": [
                {
                    "account": str(self.foreign.pk),
                    "date": "2026-02-03",
                    "balance": "30",
                    "action": "replace",
                    "replace_id": str(second.pk),
                }
            ],
            "end_of_day": True,
        }
        self.assertFalse(self.check(foreign_data)["ready"])

    def test_a_moved_count_is_not_its_own_previous_count_or_two_corrections(self):
        item = self.count()
        data = self.payload()
        data["rows"][0].update(
            action="replace", replace_id=str(item.pk), date="2026-02-02"
        )
        result = self.check(data)
        self.assertTrue(result["ready"])
        self.assertIsNone(result["rows"][0]["previous"])
        data["rows"].append({**data["rows"][0], "date": "2026-02-03"})
        self.assertFalse(self.check(data)["ready"])


@skipUnless(
    connection.vendor == "postgresql",
    "Independent concurrent writes require PostgreSQL",
)
class ConcurrentCashCountTests(TransactionTestCase):
    def test_parallel_retries_save_one_observation_and_one_receipt(self):
        user = get_user_model().objects.create_user(username="synthetic-count-race")
        account = Account.objects.create(
            user=user, name="Example race wallet", type="cash"
        )
        api = APIClient()
        api.force_authenticate(user)
        data = {
            "rows": [
                {"account": str(account.pk), "date": "2026-02-01", "balance": "100"}
            ],
            "end_of_day": True,
        }
        token = api.post(reverse("cash-counts-preview"), data, format="json").data[
            "review_token"
        ]
        data.update(review_token=token, idempotency_key=str(uuid4()))
        barrier = Barrier(2)

        def worker(_):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user)
                barrier.wait(timeout=10)
                response = client.post(reverse("cash-counts"), data, format="json")
                return response.status_code, response.data
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            first, second = list(executor.map(worker, range(2)))
        self.assertEqual(first[0], 200)
        self.assertEqual(first, second)
        self.assertEqual(BalanceSnapshot.objects.count(), 1)
        self.assertEqual(CashCountBatch.objects.count(), 1)
        self.assertEqual(Transaction.objects.count(), 0)
