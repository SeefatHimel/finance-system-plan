"""Synthetic-only tests for recurring Citytouch codes and review suggestions."""

from datetime import date

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .counterparties import citytouch_code
from .insights import pattern, suggestions
from .models import StatementImport, StatementRow
from .services import transfer_hint


class CitytouchCounterpartyTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-citytouch")
        self.other_user = get_user_model().objects.create_user(
            username="synthetic-other"
        )
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.wallet = Account.objects.create(
            user=self.user,
            name="Synthetic wallet",
            type="mobile_wallet",
            currency="BDT",
        )
        self.foreign = Account.objects.create(
            user=self.other_user, name="Other user's bank", type="bank", currency="BDT"
        )
        self.income_category = Category.objects.create(
            user=self.user, name="Synthetic income", kind="income"
        )
        self.batch = StatementImport.objects.create(
            user=self.user,
            account=self.bank,
            file_digest="a" * 64,
            profile="city_bank",
            parser_version="1",
            currency="BDT",
            account_identity="synthetic",
            page_count=1,
        )
        self.client.force_authenticate(self.user)

    def row(self, position, first, last, direction="debit"):
        description = f"CT-FT-***{first}-***{last}"
        return StatementRow.objects.create(
            batch=self.batch,
            position=position,
            component="principal",
            extracted={
                "description": description,
                "provider_type": "",
                "direction": direction,
            },
            source_fingerprint=f"fingerprint-{position}",
            date=date(2026, 1, position),
            direction=direction,
            amount="100.00",
            type="expense" if direction == "debit" else "income",
            counterparty_text=description,
            note=description,
        )

    def payload(self, code="5678", direction="debit", **changes):
        return {
            "account": str(self.bank.id),
            "code": code,
            "direction": direction,
            "party_kind": "external",
            "label": "Synthetic recipient",
            "other_account": None,
            "suggested_type": "expense",
            "category": None,
            **changes,
        }

    def test_only_second_code_recurs_and_generic_learning_is_disabled(self):
        first = self.row(1, "1234", "5678")
        second = self.row(2, "9876", "5678")
        unrelated = self.row(3, "5678", "2222")
        self.assertEqual(citytouch_code(first.extracted["description"]), "5678")
        self.assertEqual(citytouch_code(second.extracted["description"]), "5678")
        self.assertEqual(citytouch_code(unrelated.extracted["description"]), "2222")
        self.assertIsNone(pattern(first)[0])
        self.assertTrue(transfer_hint(first))
        self.assertEqual(suggestions([first, second, unrelated]), {})
        response = self.client.get(reverse("statement-counterparty-codes"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        code = next(row for row in response.data["results"] if row["code"] == "5678")
        self.assertEqual(code["count"], 2)
        self.assertEqual(code["pending_count"], 2)
        self.assertEqual(code["examples"][0]["amount"], "100.00")
        self.assertIsNone(code["mapping"])

    def test_external_payment_mapping_suggests_without_rewriting_draft(self):
        first = self.row(1, "1234", "5678")
        second = self.row(2, "9876", "5678")
        different = self.row(3, "9999", "5678", direction="credit")
        first.category = Category.objects.create(
            user=self.user, name="Synthetic spending", kind="expense"
        )
        first.save(update_fields=["category"])
        response = self.client.post(
            reverse("statement-counterparty-codes"), self.payload(), format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        found = suggestions([first, second, different])
        self.assertEqual(found[first.id]["type"], "expense")
        self.assertEqual(found[first.id]["counterparty_text"], "Synthetic recipient")
        self.assertEqual(found[first.id]["category"], str(first.category_id))
        self.assertIsNone(found[first.id]["other_account"])
        self.assertIn(second.id, found)
        self.assertNotIn(different.id, found)
        first.refresh_from_db()
        self.assertEqual(first.counterparty_text, first.extracted["description"])
        self.assertEqual(first.type, "expense")
        self.assertEqual(Transaction.objects.count(), 0)
        self.client.post(
            reverse("statement-counterparty-codes"),
            self.payload(suggested_type=""),
            format="json",
        )
        self.assertEqual(
            suggestions([first])[first.id]["category"], str(first.category_id)
        )
        self.assertEqual(
            self.client.delete(
                reverse(
                    "statement-counterparty-code-detail", args=[response.data["id"]]
                )
            ).status_code,
            204,
        )
        self.assertEqual(suggestions([first]), {})

    def test_owned_mapping_suggests_transfer_only_when_user_chooses_it(self):
        row = self.row(1, "1234", "5678", direction="credit")
        input_data = self.payload(
            direction="credit",
            party_kind="owned",
            label="Synthetic wallet",
            other_account=str(self.wallet.id),
            suggested_type="transfer",
        )
        response = self.client.post(
            reverse("statement-counterparty-codes"), input_data, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            suggestions([row])[row.id]["other_account"], str(self.wallet.id)
        )
        self.assertEqual(suggestions([row])[row.id]["type"], "transfer")
        input_data["suggested_type"] = "income"
        self.assertEqual(
            self.client.post(
                reverse("statement-counterparty-codes"), input_data, format="json"
            ).status_code,
            200,
        )
        self.assertEqual(suggestions([row])[row.id]["type"], "income")
        self.assertIsNone(suggestions([row])[row.id]["other_account"])

    def test_same_code_on_another_reporting_account_is_not_reused(self):
        first = self.row(1, "1234", "5678")
        self.assertEqual(
            self.client.post(
                reverse("statement-counterparty-codes"), self.payload(), format="json"
            ).status_code,
            200,
        )
        second_bank = Account.objects.create(
            user=self.user, name="Second synthetic bank", type="bank", currency="BDT"
        )
        second_batch = StatementImport.objects.create(
            user=self.user,
            account=second_bank,
            file_digest="b" * 64,
            profile="city_bank",
            parser_version="1",
            currency="BDT",
            account_identity="second-synthetic",
            page_count=1,
        )
        second = StatementRow.objects.create(
            batch=second_batch,
            position=1,
            component="principal",
            extracted={"description": "CT-FT-***9999-***5678"},
            source_fingerprint="second-fingerprint",
            date=date(2026, 1, 1),
            direction="debit",
            amount="100.00",
            type="expense",
        )
        self.assertIn(first.id, suggestions([first]))
        self.assertNotIn(second.id, suggestions([second]))

    def test_rejects_unverified_code_unsafe_target_and_wrong_direction(self):
        self.row(1, "1234", "5678")
        url = reverse("statement-counterparty-codes")
        self.assertEqual(
            self.client.post(url, self.payload(code="1234"), format="json").status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                url, self.payload(suggested_type="transfer"), format="json"
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                url, self.payload(suggested_type="income"), format="json"
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                url, self.payload(category=str(self.income_category.id)), format="json"
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                url,
                self.payload(
                    party_kind="owned",
                    other_account=str(self.foreign.id),
                    suggested_type="transfer",
                ),
                format="json",
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                url,
                self.payload(
                    party_kind="owned",
                    other_account=str(self.bank.id),
                    suggested_type="transfer",
                ),
                format="json",
            ).status_code,
            400,
        )
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get(url).data["count"], 0)
