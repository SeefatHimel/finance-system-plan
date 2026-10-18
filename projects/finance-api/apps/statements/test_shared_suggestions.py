"""Synthetic regressions for provider-wide review hints and personal precedence."""

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.accounts.models import Account
from apps.categories.models import Category

from .bkash_identifiers import mapping_code
from .insights import suggestions
from .models import StatementCounterpartyCode, StatementImport, StatementRow


class SharedStatementSuggestionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="shared-hint-user")
        self.wallet = Account.objects.create(
            user=self.user, name="Test wallet", type="mobile_wallet", currency="BDT"
        )
        self.food = Category.objects.get(user=self.user, name="Food & Dining")
        self.transport = Category.objects.get(user=self.user, name="Transport")
        self.shopping = Category.objects.get(user=self.user, name="Shopping & Personal")
        self.batch = StatementImport.objects.create(
            user=self.user,
            account=self.wallet,
            file_digest="a" * 64,
            profile="bkash",
            parser_version="1",
            currency="BDT",
            account_identity="synthetic",
            page_count=1,
        )

    def row(self, position, merchant, *, kind="Payment", direction="debit", code=""):
        description = f"{merchant} / TRX ID: SYNTH{position:04d}"
        return StatementRow.objects.create(
            batch=self.batch,
            position=position,
            component="principal",
            extracted={
                "description": description,
                "provider_type": kind,
                "direction": direction,
            },
            source_code=code,
            source_fingerprint=f"synthetic-{position}",
            date=date(2026, 1, position),
            direction=direction,
            amount="100.00",
            type="expense" if direction == "debit" else "income",
            counterparty_text=merchant,
            note=description,
        )

    def test_shared_merchant_hints_are_review_only_and_use_own_categories(self):
        rows = [
            self.row(1, "Foodi Express Limited-1-RM50870", code="payment:name:FOODI EXPRESS LIMITED-1-RM50870"),
            self.row(2, "Shohoj Limited-1-RM46212", code="payment:name:SHOHOJ LIMITED-1-RM46212"),
            self.row(3, "Daraz Bangladesh Limited", code="payment:name:DARAZ BANGLADESH LIMITED"),
        ]
        found = suggestions(rows)
        self.assertEqual(
            [found[row.id]["category"] for row in rows],
            [str(self.food.id), str(self.transport.id), str(self.shopping.id)],
        )
        self.assertTrue(all(found[row.id]["type"] == "expense" for row in rows))
        self.assertTrue(all(found[row.id]["other_account"] is None for row in rows))
        self.assertTrue(all(row.category_id is None for row in rows))

        other = get_user_model().objects.create_user(username="other-shared-hint-user")
        other_food = Category.objects.get(user=other, name="Food & Dining")
        other_wallet = Account.objects.create(
            user=other, name="Other wallet", type="mobile_wallet", currency="BDT"
        )
        other_batch = StatementImport.objects.create(
            user=other,
            account=other_wallet,
            file_digest="b" * 64,
            profile="bkash",
            parser_version="1",
            currency="BDT",
            account_identity="other-synthetic",
            page_count=1,
        )
        other_row = StatementRow.objects.create(
            batch=other_batch,
            position=1,
            component="principal",
            extracted=rows[0].extracted,
            source_code=rows[0].source_code,
            source_fingerprint="other-synthetic-1",
            date=date(2026, 1, 1),
            direction="debit",
            amount="100.00",
            type="expense",
        )
        self.assertEqual(suggestions([other_row])[other_row.id]["category"], str(other_food.id))

    def test_personal_code_mapping_and_edited_draft_win(self):
        row = self.row(1, "Foodi Express Limited-1-RM50870", code="payment:name:FOODI EXPRESS LIMITED-1-RM50870")
        StatementCounterpartyCode.objects.create(
            user=self.user,
            account=self.wallet,
            profile="bkash",
            code=mapping_code("bkash", self.wallet.id, row.source_code),
            direction="debit",
            party_kind="external",
            label="My saved merchant",
            suggested_type="expense",
            category=self.shopping,
        )
        found = suggestions([row])[row.id]
        self.assertEqual(found["category"], str(self.shopping.id))
        self.assertEqual(found["counterparty_text"], "My saved merchant")

        StatementCounterpartyCode.objects.all().delete()
        row.category = self.shopping
        row.save(update_fields=["category"])
        self.assertNotIn(row.id, suggestions([row]))

    def test_uncertain_or_inactive_categories_never_get_shared_hint(self):
        rows = [
            self.row(1, "Foodi Express Limited-1-RM50870", direction="credit"),
            self.row(2, "Foodi Express Limited-1-RM50870", kind="Send Money"),
            self.row(3, "Unknown Limited-1-RM50870"),
            self.row(5, "Foodi Express Limited Fake-1-RM50870"),
        ]
        self.food.is_active = False
        self.food.save(update_fields=["is_active"])
        rows.append(self.row(4, "Foodi Express Limited-1-RM50870"))
        self.assertEqual(suggestions(rows), {})
