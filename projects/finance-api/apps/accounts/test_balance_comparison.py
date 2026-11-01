"""Synthetic reports compare against ledger history, never today's balance blindly."""

from datetime import date, time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.transactions.models import Transaction, TransferEvidence
from apps.transactions.services import calculate_account_balance_summaries

from .models import Account


class ReportedBalanceComparisonTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-comparison"
        )
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(
            user=self.user,
            name="Synthetic bank",
            type="bank",
            starting_balance="1000.00",
        )
        self.day = date(2026, 1, 2)

    def record(self, **changes):
        return Transaction.objects.create(
            **{
                "user": self.user,
                "account": self.bank,
                "type": "expense",
                "direction": "debit",
                "date": self.day,
                "time": time(10, 0),
                "amount": "100.00",
                "balance_after": "900.00",
                **changes,
            }
        )

    def summary(self, account=None):
        account = account or self.bank
        return calculate_account_balance_summaries(accounts=[account])[account.pk]

    def test_later_days_do_not_create_a_false_mismatch(self):
        self.record()
        self.record(
            type="income",
            direction="credit",
            amount="50.00",
            balance_after=None,
            date=date(2026, 1, 3),
        )
        summary = self.summary()
        self.assertEqual(summary.ledger_balance, Decimal("950.00"))
        self.assertEqual(summary.ledger_balance_at_latest_report, Decimal("900.00"))
        self.assertEqual(summary.latest_reported_balance_difference, Decimal("0.00"))
        self.assertEqual(summary.reported_balance_comparison, "matched")

    def test_exact_cent_difference_excludes_later_same_day_activity(self):
        self.record(balance_after="899.99")
        self.record(
            type="income",
            direction="credit",
            amount="20.00",
            balance_after=None,
            time=time(11, 0),
        )
        summary = self.summary()
        self.assertEqual(summary.ledger_balance, Decimal("920.00"))
        self.assertEqual(summary.ledger_balance_at_latest_report, Decimal("900.00"))
        self.assertEqual(summary.latest_reported_balance_difference, Decimal("-0.01"))
        self.assertEqual(summary.reported_balance_comparison, "mismatch")

    def test_earlier_corrections_recompute_the_comparison(self):
        earlier = self.record(amount="20.00", balance_after=None, date=date(2026, 1, 1))
        self.record(balance_after="880.00")
        self.assertEqual(self.summary().reported_balance_comparison, "matched")
        earlier.amount = Decimal("25.00")
        earlier.save()
        self.assertEqual(
            self.summary().latest_reported_balance_difference, Decimal("5.00")
        )
        self.bank.starting_balance = Decimal("1005.00")
        self.bank.save()
        self.assertEqual(self.summary().reported_balance_comparison, "matched")

    def test_transfer_observations_use_each_accounts_report_cutoff_and_count_once(self):
        destination = Account.objects.create(
            user=self.user,
            name="Synthetic destination",
            type="bank",
            starting_balance="500.00",
        )
        transfer = self.record(
            type="transfer",
            transfer_account=destination,
            amount="30.00",
            balance_after="970.00",
            time=time(9, 55),
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=transfer,
            account=self.bank,
            direction="debit",
            date=self.day,
            time=time(9, 55),
            balance_after="970.00",
            external_key="synthetic-source",
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=transfer,
            account=destination,
            direction="credit",
            date=self.day,
            time=time(10, 1),
            balance_after="550.00",
            external_key="synthetic-destination",
        )
        self.record(
            account=destination,
            type="income",
            direction="credit",
            amount="20.00",
            balance_after=None,
            time=time(10, 0),
        )
        self.record(
            account=destination, amount="10.00", balance_after=None, time=time(10, 2)
        )
        # A second SMS evidence row is a report, never a second money movement.
        TransferEvidence.objects.create(
            user=self.user,
            transaction=transfer,
            account=destination,
            direction="credit",
            date=self.day,
            time=time(10, 1),
            balance_after="550.00",
            external_key="synthetic-duplicate-report",
        )
        # SQL aggregates and latest-report windows do not materialize ledger history.
        # Two report-cutoff checks are account-scoped, independent of row count.
        with self.assertNumQueries(7):
            summaries = calculate_account_balance_summaries(
                accounts=[self.bank, destination]
            )
        self.assertEqual(summaries[self.bank.pk].ledger_balance, Decimal("970.00"))
        self.assertEqual(summaries[self.bank.pk].reported_balance_comparison, "matched")
        self.assertEqual(summaries[destination.pk].ledger_balance, Decimal("540.00"))
        self.assertEqual(
            summaries[destination.pk].ledger_balance_at_latest_report, Decimal("550.00")
        )
        self.assertEqual(
            summaries[destination.pk].reported_balance_comparison, "matched"
        )

    def test_unknown_same_day_order_requires_review_instead_of_a_red_mismatch(self):
        self.record()
        self.record(time=None, amount="20.00", balance_after=None)
        summary = self.summary()
        self.assertEqual(summary.reported_balance_comparison, "timing_unknown")
        self.assertIsNone(summary.latest_reported_balance_difference)
        self.assertIsNone(summary.ledger_balance_at_latest_report)

    def test_date_only_single_movement_is_comparable_but_multiple_movements_are_not(
        self,
    ):
        self.record(time=None)
        self.assertEqual(self.summary().reported_balance_comparison, "matched")
        self.record(time=time(11, 0), amount="20.00", balance_after=None)
        self.assertEqual(self.summary().reported_balance_comparison, "timing_unknown")

    def test_same_timestamp_movements_are_not_assumed_to_have_a_known_order(self):
        self.record()
        self.record(amount="20.00", balance_after=None)
        self.assertEqual(self.summary().reported_balance_comparison, "timing_unknown")

    def test_credit_card_available_credit_is_a_reference(self):
        self.bank.type = "credit_card"
        self.bank.save()
        self.record(balance_after="50000.00")
        summary = self.summary()
        self.assertEqual(summary.reported_balance_comparison, "credit_card_reference")
        self.assertIsNone(summary.ledger_balance_at_latest_report)
        self.assertIsNone(summary.latest_reported_balance_difference)
        self.assertEqual(summary.latest_reported_balance, Decimal("50000.00"))

    def test_missing_reports_and_zero_balances_remain_distinct(self):
        self.assertEqual(self.summary().reported_balance_comparison, "unavailable")
        self.assertIsNone(self.summary().latest_reported_balance_difference)
        self.record(amount="1000.00", balance_after="0.00")
        self.assertEqual(
            self.summary().ledger_balance_at_latest_report, Decimal("0.00")
        )
        self.assertEqual(
            self.summary().latest_reported_balance_difference, Decimal("0.00")
        )
        self.assertEqual(self.summary().reported_balance_comparison, "matched")

    def test_report_before_its_linked_movement_is_not_compared(self):
        transfer = self.record(type="transfer")
        TransferEvidence.objects.create(
            user=self.user,
            transaction=transfer,
            account=self.bank,
            direction="debit",
            date=self.day,
            time=time(9, 59),
            balance_after="900.00",
            external_key="synthetic-clock-disagreement",
        )
        self.assertEqual(
            self.summary().reported_balance_comparison, "report_precedes_movement"
        )
        self.assertIsNone(self.summary().latest_reported_balance_difference)

    def test_api_exposes_read_only_decimal_comparison_without_leaking_other_accounts(
        self,
    ):
        self.record(balance_after="910.00")
        response = self.client.get(
            reverse("account-detail", kwargs={"pk": self.bank.pk})
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["ledger_balance_at_latest_report"], "900.00")
        self.assertEqual(response.data["latest_reported_balance_difference"], "10.00")
        self.assertEqual(response.data["reported_balance_comparison"], "mismatch")
        self.client.patch(
            reverse("account-detail", kwargs={"pk": self.bank.pk}),
            {
                "latest_reported_balance_difference": "0.00",
                "reported_balance_comparison": "matched",
            },
            format="json",
        )
        self.assertEqual(self.summary().reported_balance_comparison, "mismatch")
        other = get_user_model().objects.create_user(username="synthetic-other-owner")
        private = Account.objects.create(user=other, name="Other account", type="bank")
        self.assertEqual(
            self.client.get(
                reverse("account-detail", kwargs={"pk": private.pk})
            ).status_code,
            404,
        )
        self.assertEqual(
            [item["id"] for item in self.client.get(reverse("account-list")).data],
            [str(self.bank.pk)],
        )

    def test_date_only_transfer_report_includes_the_single_known_time_movement(self):
        destination = Account.objects.create(
            user=self.user, name="Synthetic single transfer", type="bank"
        )
        transfer = self.record(
            type="transfer", transfer_account=destination, balance_after=None
        )
        TransferEvidence.objects.create(
            user=self.user,
            transaction=transfer,
            account=destination,
            direction="credit",
            date=self.day,
            time=None,
            balance_after="100.00",
            external_key="synthetic-date-only-transfer",
        )
        summary = self.summary(destination)
        self.assertEqual(summary.ledger_balance_at_latest_report, Decimal("100.00"))
        self.assertEqual(summary.reported_balance_comparison, "matched")


class BoundedBalanceReadTests(APITestCase):
    def test_many_accounts_do_not_add_per_account_timing_queries(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        user = get_user_model().objects.create_user(username="synthetic-batch-balances")
        accounts = Account.objects.bulk_create([Account(user=user, name=f"Synthetic batch {n}", type="bank") for n in range(20)])
        Transaction.objects.bulk_create([Transaction(user=user, account=account, date=date(2026,1,1), time=time(12), type="expense", direction="debit", amount=1, balance_after=99) for account in accounts])
        with CaptureQueriesContext(connection) as one:
            calculate_account_balance_summaries(accounts=accounts[:1])
        with CaptureQueriesContext(connection) as many:
            result = calculate_account_balance_summaries(accounts=accounts)
        self.assertEqual(len(many), len(one), "Timing checks must be batched, independent of account count")
        self.assertEqual(len(result), 20)

    def test_account_detail_only_summarizes_its_own_account(self):
        from unittest.mock import patch
        user = get_user_model().objects.create_user(username="synthetic-detail-query")
        accounts = Account.objects.bulk_create([Account(user=user, name=f"Synthetic detail {n}", type="bank") for n in range(3)])
        self.client.force_authenticate(user)
        with patch("apps.accounts.views.calculate_account_balance_summaries", wraps=calculate_account_balance_summaries) as summaries:
            response = self.client.get(reverse("account-detail", kwargs={"pk":accounts[0].pk}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([account.pk for account in summaries.call_args.kwargs["accounts"]], [accounts[0].pk])

    def test_sql_report_selection_matches_the_editor_for_varied_transfer_sources(self):
        import random
        from apps.transactions.balance_queries import latest_reports
        from apps.transactions.balance_reports import account_reports

        randomizer = random.Random(17)
        user = get_user_model().objects.create_user(username="synthetic-report-selection")
        accounts = [Account.objects.create(user=user, name=f"Synthetic bank {index}", type="bank") for index in range(3)]
        for index in range(40):
            sender, receiver = randomizer.sample(accounts, 2)
            record = Transaction.objects.create(user=user, account=sender, transfer_account=receiver, date=date(2026, 1, 1 + index % 8), time=time(index % 24), type="transfer", direction="debit", amount=10, external_key=f"synthetic-source:{index}")
            for position in range(4):
                account = sender if position < 2 else receiver
                TransferEvidence.objects.create(user=user, transaction=record, account=account, direction="debit" if account == sender else "credit", date=record.date, time=None if position % 2 else record.time, source="sms" if position % 2 else "web", balance_after=None if index % 3 == 0 and position % 2 else index * 100 + position, is_effective_balance=position % 2 == 1, external_key=record.external_key if position == 0 else f"balance:{record.pk}:{position}" if position % 2 else f"synthetic-other:{index}:{position}")
        for cutoff in [None, date(2026, 1, 4)]:
            _, actual = latest_reports(accounts, cutoff)
            expected = {}
            records = Transaction.objects.filter(user=user).prefetch_related("transfer_evidence")
            if cutoff:
                records = records.filter(date__lte=cutoff)
            for record in records:
                items = [item for item in record.transfer_evidence.all() if not cutoff or item.date <= cutoff]
                chosen, _ = account_reports(record, items)
                for account, item in chosen.items():
                    if item.balance_after is None:
                        continue
                    order = (item.date, item.time or time.min, item.created_at)
                    if account not in expected or order >= expected[account][0]:
                        expected[account] = (order, item.balance_after)
            self.assertEqual({account: result[:2] for account, result in actual.items()}, expected)

    def test_ledger_history_stays_in_sql_instead_of_loading_every_transaction(self):
        from unittest.mock import patch
        user = get_user_model().objects.create_user(username="synthetic-bounded-balances")
        account = Account.objects.create(user=user, name="Synthetic bounded bank", type="bank", starting_balance=1000)
        Transaction.objects.bulk_create([Transaction(user=user, account=account, date=date(2026,1,1), type="expense", direction="debit", amount=1, balance_after=999-index) for index in range(1000)])
        with patch.object(Transaction, "from_db", wraps=Transaction.from_db) as loaded:
            summary = calculate_account_balance_summaries(accounts=[account])[account.pk]
        self.assertEqual(summary.ledger_balance, Decimal("0.00"))
        self.assertLessEqual(loaded.call_count, 2, "Latest reports, not historical ledger rows, should be materialized")
