"""Synthetic sub-taka links use higher values atomically and validate supplied snapshots."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.transactions.models import Transaction

from . import test_imports as fixtures


class StatementRoundingTests(APITestCase):
    setUp = fixtures.SavedStatementTests.setUp
    upload = fixtures.SavedStatementTests.upload
    decide = fixtures.SavedStatementTests.decide
    ledger_purchase = fixtures.SavedStatementTests.ledger_purchase

    def pair(self, amount="50.37", balance="950.70", **ledger):
        row = (
            self.upload().rows.filter(direction="debit", component="principal").first()
        )
        row.amount = Decimal(amount)
        row.balance_after = Decimal(balance) if balance is not None else None
        row.save()
        return row, self.ledger_purchase(**ledger)

    def matches(self, row):
        response = self.client.get(reverse("statement-row-detail", args=[row.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["review"]["matches"]

    def correction(self, row, record, **fields):
        return {
            "existing_amount": str(record.amount),
            "statement_amount": str(row.amount),
            "transaction_updated_at": record.updated_at.isoformat(),
            **fields,
        }

    def link(self, row, record, **fields):
        return self.decide(
            row,
            "link",
            transaction=str(record.pk),
            acknowledge_issues=True,
            amount_correction=self.correction(row, record),
            balance_choice={
                "keep": "statement",
                "existing_balance_after": str(record.balance_after)
                if record.balance_after is not None
                else None,
                "statement_balance_after": str(row.balance_after)
                if row.balance_after is not None
                else None,
            },
            **fields,
        )

    def test_possible_reading_is_read_only_and_link_automatically_uses_higher_values(
        self,
    ):
        row, record = self.pair()
        matches = self.matches(row)
        self.assertEqual(len(matches), 1)
        match = matches[0]
        self.assertEqual(match["strength"], "possible")
        self.assertTrue(match["can_link"])
        self.assertTrue(match["rounding_correction"]["can_correct"])
        self.assertEqual(match["rounding_correction"]["difference"], "+0.37")
        response = self.decide(
            row, "link", transaction=str(record.pk), acknowledge_issues=True
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.37"))
        self.assertEqual(record.balance_after, Decimal("950.70"))
        self.assertEqual(row.transaction_id, record.pk)

    def test_correction_links_once_audits_both_exact_amounts_and_preserves_source(self):
        row, record = self.pair()
        extracted = row.extracted
        response = self.link(row, record)
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.37"))
        self.assertEqual(record.balance_after, Decimal("950.70"))
        self.assertEqual(row.transaction_id, record.pk)
        self.assertEqual(row.extracted, extracted)
        self.assertEqual(Transaction.objects.count(), 1)
        audit = AuditLogEntry.objects.filter(
            entity_id=str(record.pk), action="updated"
        ).latest("created_at")
        self.assertEqual(audit.before["amount"], "50.00")
        self.assertEqual(audit.after["amount"], "50.37")
        self.assertEqual(
            audit.metadata["amount_resolution"]["statement_amount"], "50.37"
        )
        repeat = self.link(row, record)
        self.assertEqual(repeat.status_code, 200, repeat.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_stale_amount_or_timestamp_does_not_write(self):
        row, record = self.pair()
        for fields in (
            {"existing_amount": "50.01"},
            {"statement_amount": "50.38"},
            {
                "transaction_updated_at": (
                    record.updated_at - timedelta(seconds=1)
                ).isoformat()
            },
        ):
            response = self.decide(
                row,
                "link",
                transaction=str(record.pk),
                acknowledge_issues=True,
                amount_correction=self.correction(row, record, **fields),
            )
            self.assertEqual(response.status_code, 409, response.data)
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.00"))

    def test_changed_live_transaction_requires_a_fresh_review(self):
        row, record = self.pair()
        old = self.correction(row, record)
        record.note = "A newer user correction"
        record.save()
        response = self.decide(
            row,
            "link",
            transaction=str(record.pk),
            acknowledge_issues=True,
            amount_correction=old,
        )
        self.assertEqual(response.status_code, 409, response.data)
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.00"))

    def test_differences_at_one_taka_dates_or_contradictory_balances_are_not_near_matches(
        self,
    ):
        row, record = self.pair()
        for fields in (
            {"amount": Decimal("49.37")},
            {"date": record.date + timedelta(days=4)},
            {"balance_after": Decimal("949.70")},
            {"direction": "credit"},
            {"account": self.wallet},
        ):
            original = {name: getattr(record, name) for name in fields}
            for name, value in fields.items():
                setattr(record, name, value)
            record.save()
            self.assertEqual(self.matches(row), [], fields)
            for name, value in original.items():
                setattr(record, name, value)
            record.save()
        self.bank.currency = "USD"
        self.bank.save()
        row.batch.currency = "USD"
        row.batch.save()
        self.assertEqual(self.matches(row), [])

    def test_without_reported_balance_independent_reference_or_merchant_and_time_required(
        self,
    ):
        row, record = self.pair(balance=None, balance_after=None, reference="")
        self.assertEqual(self.matches(row), [])
        row.reference = record.reference = "SYNTHETIC-REF"
        row.save()
        record.save()
        self.assertEqual(len(self.matches(row)), 1)

    def test_integer_statement_and_fractional_ledger_are_supported(self):
        row, record = self.pair(amount="50.00", balance="950.00")
        record.amount = Decimal("50.37")
        record.balance_after = Decimal("950.70")
        record.save()
        self.assertEqual(
            self.matches(row)[0]["rounding_correction"]["difference"], "-0.37"
        )
        self.assertEqual(self.link(row, record).status_code, 200)

    def test_existing_pdf_dependencies_block_correction_and_separate_creation_requires_review(
        self,
    ):
        row, record = self.pair()
        other = self.upload(
            data=self.pdf + b"\n%Synthetic second document"
        ).rows.first()
        other.transaction = record
        other.state = "linked"
        other.save()
        match = self.matches(row)[0]
        self.assertFalse(match["rounding_correction"]["can_correct"])
        self.assertEqual(self.link(row, record).status_code, 400)
        self.assertEqual(
            self.decide(row, "create", acknowledge_issues=True).status_code, 400
        )
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.00"))

    def test_correction_rolls_back_if_a_later_detail_choice_is_invalid(self):
        row, record = self.pair()
        response = self.link(
            row,
            record,
            detail_choices=[
                {"field": "note", "existing_value": "stale", "value": "new"}
            ],
        )
        self.assertEqual(response.status_code, 409, response.data)
        record.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.00"))
        self.assertIsNone(row.transaction_id)

    def test_other_users_and_wrong_action_cannot_correct(self):
        row, record = self.pair()
        self.assertEqual(
            self.decide(
                row, "skip", amount_correction=self.correction(row, record)
            ).status_code,
            400,
        )
        other = type(self.user).objects.create_user(username="synthetic-other-rounding")
        self.client.force_authenticate(other)
        self.assertEqual(self.link(row, record).status_code, 404)

    def test_original_sms_values_remain_unchanged_after_correction(self):
        row, record = self.pair()
        candidate = fixtures.SavedStatementTests.pending_sms(self, row)
        candidate.amount = record.amount
        candidate.transaction = record
        candidate.status = "confirmed"
        candidate.save()
        body = candidate.raw_message.body
        response = self.link(row, record)
        self.assertEqual(response.status_code, 200, response.data)
        candidate.refresh_from_db()
        candidate.raw_message.refresh_from_db()
        self.assertEqual(candidate.amount, Decimal("50.00"))
        self.assertEqual(candidate.raw_message.body, body)

    def test_debt_dependencies_disable_the_shortcut(self):
        from apps.debts.models import Debt

        row, record = self.pair()
        Debt.objects.create(
            user=self.user,
            opened_transaction=record,
            counterparty_name="Synthetic debtor",
            direction="lent_by_me",
            principal_amount="50.00",
            current_balance="50.00",
            opened_at=record.date,
        )
        match = self.matches(row)[0]
        self.assertFalse(match["rounding_correction"]["can_correct"])
        blocked = self.link(row, record)
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("debt or bill", str(blocked.data))

    def test_bulk_posting_does_not_add_a_near_match(self):
        row, _record = self.pair()
        response = self.client.post(
            reverse("statement-import-approve-new", args=[row.batch_id]),
            {"rows": [{"id": str(row.pk), "version": row.version}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["added"], 0)
        self.assertEqual(Transaction.objects.count(), 1)
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)

    def test_receiving_transfer_correction_keeps_both_account_reports(self):
        from apps.transactions.models import TransferEvidence

        row, record = self.pair()
        row.direction = "credit"
        row.other_account = self.wallet
        row.type = "transfer"
        row.classification_confirmed = True
        row.save()
        record.type = "transfer"
        record.account = self.wallet
        record.transfer_account = self.bank
        record.balance_after = Decimal("17.00")
        record.save()
        TransferEvidence.objects.create(
            user=self.user,
            transaction=record,
            account=self.wallet,
            direction="debit",
            date=record.date,
            source="sms",
            balance_after="17.00",
            external_key="synthetic-sender",
        )
        receiving = TransferEvidence.objects.create(
            user=self.user,
            transaction=record,
            account=self.bank,
            direction="credit",
            date=record.date,
            source="sms",
            balance_after="950.00",
            external_key="synthetic-receiver",
        )
        match = self.matches(row)[0]
        response = self.decide(
            row,
            "link",
            transaction=str(record.pk),
            acknowledge_issues=True,
            amount_correction=self.correction(row, record),
            balance_choice={
                "keep": "statement",
                "existing_balance_after": match["effective_balance_after"],
                "statement_balance_after": str(row.balance_after),
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        receiving.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.37"))
        self.assertEqual(record.balance_after, Decimal("17.00"))
        self.assertEqual(receiving.balance_after, Decimal("950.00"))

    def test_amount_and_category_choices_share_one_audited_atomic_decision(self):
        from apps.categories.models import Category

        row, record = self.pair()
        old_category = record.category_id
        row.category = Category.objects.create(
            user=self.user, name="Synthetic reviewed category", kind="expense"
        )
        row.save()
        self.assertEqual(self.link(row, record).status_code, 400)
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.00"))
        response = self.link(
            row,
            record,
            category_choice={
                "keep": "statement",
                "existing_category": str(old_category),
                "statement_category": str(row.category_id),
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.37"))
        self.assertEqual(record.category_id, row.category_id)
        audit = AuditLogEntry.objects.filter(
            entity_id=str(record.pk), action="updated"
        ).latest("created_at")
        self.assertEqual(audit.before["category"], str(old_category))
        self.assertEqual(audit.before["amount"], "50.00")
        self.assertEqual(audit.after["category"], str(row.category_id))
        self.assertIn("category_resolution", audit.metadata)
        self.assertIn("amount_resolution", audit.metadata)

    def test_busy_history_fails_closed_and_exact_suggestions_rank_before_nearby(self):
        from unittest.mock import patch

        from .services import find_matches

        row, near = self.pair()
        row.reference = near.reference = "SYNTHETIC-NEAR-REF"
        row.save()
        near.save()
        exact = self.ledger_purchase(
            amount=str(row.amount), balance_after=None, reference=""
        )
        matches = self.matches(row)
        self.assertEqual(matches[0]["id"], str(exact.pk))
        with patch("apps.statements.services.MAX_MATCH_HISTORY", 1):
            matches, truncated = find_matches([row])
        self.assertTrue(truncated)
        self.assertEqual(matches[row.pk], [])


@skipUnless(connection.vendor == "postgresql", "Requires PostgreSQL row locking")
class RoundingConcurrencyTests(TransactionTestCase):
    client_class = APIClient
    setUp = StatementRoundingTests.setUp
    upload = StatementRoundingTests.upload
    ledger_purchase = StatementRoundingTests.ledger_purchase
    pair = StatementRoundingTests.pair
    correction = StatementRoundingTests.correction

    def test_simultaneous_corrections_link_one_existing_transaction(self):
        row, record = self.pair()
        payload = {
            "action": "link",
            "version": row.version,
            "transaction": str(record.pk),
            "acknowledge_issues": True,
            "amount_correction": self.correction(row, record),
            "balance_choice": {
                "keep": "statement",
                "existing_balance_after": str(record.balance_after),
                "statement_balance_after": str(row.balance_after),
            },
        }
        start = Barrier(2)

        def approve():
            try:
                client = APIClient()
                client.force_authenticate(get_user_model().objects.get(pk=self.user.pk))
                start.wait(timeout=10)
                response = client.post(
                    reverse("statement-row-decide", args=[row.pk]),
                    payload,
                    format="json",
                )
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: approve(), range(2)))
        self.assertEqual(results, [200, 200])
        self.assertEqual(Transaction.objects.count(), 1)
        record.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(record.amount, Decimal("50.37"))
        self.assertEqual(row.transaction_id, record.pk)
        self.assertEqual(
            AuditLogEntry.objects.filter(
                entity_id=str(record.pk), action="updated"
            ).count(),
            1,
        )
