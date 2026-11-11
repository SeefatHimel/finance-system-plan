from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from threading import Barrier
from types import SimpleNamespace
from unittest import skipUnless
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, close_old_connections, transaction, IntegrityError
from django.test import TransactionTestCase
from rest_framework.test import APITestCase, APIClient
from apps.accounts.models import Account
from apps.debts.models import Debt
from apps.debts.serializers import DebtSerializer
from django.http import Http404
from .integrity import audit_integrity
from .models import Transaction


class IntegrityGuardrailsTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-guardrails"
        )
        self.account = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank"
        )

    def test_database_rejects_nonpositive_money_and_same_account_paths(self):
        for fields in (
            {"amount": 0},
            {"amount": -1},
            {"amount": 1, "type": "transfer", "transfer_account": self.account},
        ):
            with (
                self.subTest(fields=fields),
                self.assertRaises(IntegrityError),
                transaction.atomic(),
            ):
                Transaction.objects.create(
                    user=self.user,
                    account=self.account,
                    date="2026-01-01",
                    type=fields.pop("type", "expense"),
                    **fields,
                )

    def test_audit_reports_counts_without_values_or_original_source_content(self):
        row = Transaction.objects.create(
            user=self.user,
            account=self.account,
            date="2026-01-01",
            amount=123,
            type="expense",
            direction="credit",
            note="synthetic-private-source",
        )
        stream = StringIO()
        with self.assertRaises(CommandError):
            call_command(
                "audit_financial_integrity",
                user_id=self.user.pk,
                fail_on_issues=True,
                stdout=stream,
            )
        self.assertNotIn(row.note, stream.getvalue())
        self.assertNotIn(str(row.pk), stream.getvalue())
        self.assertEqual(
            audit_integrity(user_id=self.user.pk)["transactions"][
                "type_direction_mismatch"
            ],
            1,
        )
        row.refresh_from_db()
        self.assertEqual(row.direction, "credit")

    def test_deleted_planning_parent_becomes_not_found_after_validation(self):
        debt = Debt.objects.create(
            user=self.user,
            counterparty_name="Synthetic",
            direction="lent_by_me",
            principal_amount=10,
            current_balance=10,
            opened_at="2026-01-01",
        )
        serializer = DebtSerializer(
            Debt.objects.get(pk=debt.pk),
            data={"note": "Synthetic"},
            partial=True,
            context={"request": SimpleNamespace(user=self.user)},
        )
        self.assertTrue(serializer.is_valid())
        debt.delete()
        with self.assertRaises(Http404):
            serializer.save()

    def test_constraint_validation_requires_explicit_review(self):
        with self.assertRaises(CommandError):
            call_command("validate_financial_constraints", stdout=StringIO())


@skipUnless(
    connection.vendor == "postgresql", "Independent row locking requires PostgreSQL"
)
class ConcurrentLedgerRetryTests(TransactionTestCase):
    def test_parallel_identical_expenses_create_one_movement(self):
        user = get_user_model().objects.create_user(
            username="synthetic-concurrent-ledger"
        )
        account = Account.objects.create(user=user, name="Synthetic retry", type="bank")
        barrier = Barrier(4)

        def worker(_):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user)
                barrier.wait(timeout=10)
                response = client.post(
                    "/api/transactions/",
                    {
                        "account": str(account.pk),
                        "date": "2026-01-01",
                        "amount": "12.50",
                        "type": "expense",
                        "external_key": "synthetic-same-retry",
                    },
                    format="json",
                )
                return response.status_code, response.data["id"]
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(worker, range(4)))
        self.assertTrue(all(status == 201 for status, _ in results), results)
        self.assertEqual(len({pk for _, pk in results}), 1)
        self.assertEqual(Transaction.objects.filter(user=user).count(), 1)


@skipUnless(connection.vendor == "postgresql", "Staged checks are PostgreSQL-specific")
class StagedConstraintMigrationTests(TransactionTestCase):
    def test_legacy_exceptions_survive_migration_but_new_invalid_writes_fail(self):
        from django.db.migrations.executor import MigrationExecutor

        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        executor.migrate([("transactions", "0010_timelinebalanceallocation")])
        try:
            state = executor.loader.project_state(
                [("transactions", "0010_timelinebalanceallocation")]
            )
            User = state.apps.get_model("auth", "User")
            AccountBefore = state.apps.get_model("accounts", "Account")
            EntryBefore = state.apps.get_model("transactions", "Transaction")
            user = User.objects.create(username="synthetic-legacy-exception")
            account = AccountBefore.objects.create(
                user_id=user.pk, name="Synthetic legacy", type="bank"
            )
            legacy = EntryBefore.objects.create(
                user_id=user.pk,
                account_id=account.pk,
                transfer_account_id=account.pk,
                date="2026-01-01",
                type="transfer",
                amount=0,
            )
        finally:
            MigrationExecutor(connection).migrate(latest)
        preserved = Transaction.objects.get(pk=legacy.pk)
        self.assertEqual(preserved.amount, 0)
        self.assertEqual(preserved.transfer_account_id, preserved.account_id)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Transaction.objects.create(
                user_id=user.pk,
                account_id=account.pk,
                date="2026-01-01",
                type="expense",
                amount=0,
            )
        findings = audit_integrity(user_id=user.pk)
        self.assertEqual(findings["transactions"]["nonpositive_amount"], 1)
        with self.assertRaises(CommandError):
            call_command(
                "validate_financial_constraints", reviewed=True, stdout=StringIO()
            )
        self.assertTrue(Transaction.objects.filter(pk=legacy.pk, amount=0).exists())
