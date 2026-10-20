"""A statement link resolves category differences on the single ledger entry."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.categories.models import Category
from apps.transactions.models import Transaction

from . import test_imports as fixtures


class StatementCategoryChoiceTests(APITestCase):
    setUp = fixtures.SavedStatementTests.setUp
    upload = fixtures.SavedStatementTests.upload
    decide = fixtures.SavedStatementTests.decide
    ledger_purchase = fixtures.SavedStatementTests.ledger_purchase
    pending_sms = fixtures.SavedStatementTests.pending_sms

    def conflicting_pair(self):
        statement_category = Category.objects.create(
            user=self.user, name="Demo dining", kind=Category.Kind.EXPENSE
        )
        row = self.upload().rows.first()
        row.category = statement_category
        row.save(update_fields=("category",))
        record = self.ledger_purchase()
        return row, record, statement_category

    def choice(self, row, record, keep, category=None):
        value = {
            "keep": keep,
            "existing_category": str(record.category_id) if record.category_id else None,
            "statement_category": str(row.category_id) if row.category_id else None,
        }
        if keep == "custom":
            value["category"] = str(category.id) if category else None
        return value

    def test_conflict_requires_choice_without_creating_or_changing_ledger(self):
        row, record, statement_category = self.conflicting_pair()
        review = self.client.get(reverse("statement-row-detail", args=[row.id])).data
        suggestion = next(item for item in review["review"]["matches"] if item["id"] == str(record.id))
        self.assertEqual(suggestion["category_id"], str(self.category.id))
        response = self.decide(row, "link", transaction=str(record.id))
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("category_choice", response.data)
        record.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(record.category_id, self.category.id)
        self.assertEqual(row.category_id, statement_category.id)
        self.assertIsNone(row.transaction_id)
        self.assertEqual(Transaction.objects.count(), 1)

    def assert_choice(self, keep):
        row, record, statement_category = self.conflicting_pair()
        custom = Category.objects.create(
            user=self.user, name="Demo alternate", kind=Category.Kind.EXPENSE
        )
        original = row.extracted
        expected = {
            "existing": self.category,
            "statement": statement_category,
            "custom": custom,
        }[keep]
        response = self.decide(
            row, "link", transaction=str(record.id),
            category_choice=self.choice(row, record, keep, custom),
        )
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        record.refresh_from_db()
        self.assertEqual(record.category_id, expected.id)
        self.assertEqual(row.category_id, expected.id)
        self.assertEqual(row.extracted, original)
        self.assertEqual(Transaction.objects.count(), 1)
        audit = AuditLogEntry.objects.get(
            entity_id=str(record.id), metadata__statement_row=str(row.id)
        )
        self.assertEqual(audit.before["category"], str(self.category.id))
        self.assertEqual(audit.after["category"], str(expected.id))
        self.assertEqual(audit.metadata["category_resolution"]["keep"], keep)
        self.assertEqual(
            audit.metadata["category_resolution"]["statement_category"],
            str(statement_category.id),
        )

    def test_keep_existing_category(self):
        self.assert_choice("existing")

    def test_use_statement_category(self):
        self.assert_choice("statement")

    def test_choose_another_category(self):
        self.assert_choice("custom")

    def test_choose_uncategorized_explicitly(self):
        row, record, _ = self.conflicting_pair()
        response = self.decide(
            row, "link", transaction=str(record.id),
            category_choice=self.choice(row, record, "custom"),
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertIsNone(record.category_id)

    def test_sms_statement_confirmation_preserves_sms_category(self):
        row = self.upload().rows.first()
        statement_category = Category.objects.create(
            user=self.user, name="Demo dining", kind=Category.Kind.EXPENSE
        )
        row.category = statement_category
        row.save(update_fields=("category",))
        candidate = self.pending_sms(row)
        response = self.decide(row, "combine_sms", candidate=str(candidate.id))
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        self.assertEqual(row.transaction.category_id, self.category.id)
        self.assertEqual(row.category_id, self.category.id)
        self.assertNotEqual(statement_category.id, row.category_id)

    def test_stale_or_foreign_category_is_rejected_atomically(self):
        row, record, _ = self.conflicting_pair()
        stale = self.choice(row, record, "statement")
        record.category = None
        record.save(update_fields=("category",))
        response = self.decide(row, "link", transaction=str(record.id), category_choice=stale)
        self.assertEqual(response.status_code, 409, response.data)
        record.refresh_from_db()
        self.assertIsNone(record.category_id)

        other = get_user_model().objects.create_user(username="other-category-owner")
        foreign = Category.objects.create(user=other, name="Other person's category")
        response = self.decide(
            row, "link", transaction=str(record.id),
            category_choice=self.choice(row, record, "custom", foreign),
        )
        self.assertEqual(response.status_code, 400, response.data)
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)

    def test_incompatible_statement_category_cannot_reclassify_ledger(self):
        row, record, statement_category = self.conflicting_pair()
        statement_category.kind = Category.Kind.TRANSFER
        statement_category.save(update_fields=("kind",))
        response = self.decide(
            row, "link", transaction=str(record.id),
            category_choice=self.choice(row, record, "statement"),
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("category_choice", response.data)
        record.refresh_from_db()
        self.assertEqual(record.category_id, self.category.id)

    def test_incompatible_custom_category_cannot_reclassify_ledger(self):
        row, record, _ = self.conflicting_pair()
        other_kind = Category.objects.create(
            user=self.user, name="Demo transfer", kind=Category.Kind.TRANSFER
        )
        response = self.decide(
            row, "link", transaction=str(record.id),
            category_choice=self.choice(row, record, "custom", other_kind),
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("category_choice", response.data)
        record.refresh_from_db()
        self.assertEqual(record.category_id, self.category.id)
