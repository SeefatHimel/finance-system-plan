import csv
from datetime import datetime, timezone as datetime_timezone
from io import StringIO
from uuid import UUID

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.payment_methods.models import PaymentMethod

from .models import Transaction, TransferEvidence


class TransactionSearchTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="search-demo")
        self.other = get_user_model().objects.create_user(username="other-demo")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(user=self.user, name="Demo bank", type="bank")
        self.wallet = Account.objects.create(user=self.user, name="Demo wallet", type="mobile_wallet")
        self.food = Category.objects.create(user=self.user, name="Food", kind="expense")
        self.method = PaymentMethod.objects.create(user=self.user, account=self.bank,
                                                  name="Demo debit card", provider="city_bank", identifier="***2468")
        self.record = Transaction.objects.create(
            id=UUID("11111111-1111-4111-8111-888888888880"),
            user=self.user, account=self.bank, category=self.food, payment_method=self.method,
            date="2026-10-12", time="13:47:00", type="expense", direction="debit",
            amount="1234.50", balance_after="9876.25", source="web", needs_review=True,
            reference="DEMO-REF", counterparty_text="Demo cafe", note="Team lunch",
            external_key="demo:purchase", sender_card_identifier="***5678",
        )
        self.unrelated = Transaction.objects.create(user=self.user, account=self.wallet,
                                                   date="2026-10-10", type="income", direction="credit",
                                                   amount="80.00", note="Demo unrelated", source="mobile")
        Transaction.objects.create(user=self.other, account=Account.objects.create(
            user=self.other, name="Demo bank", type="bank"), category=Category.objects.create(
                user=self.other, name="Food", kind="expense"), date="2026-10-12", time="13:47:00",
            type="expense", amount="1234.50", balance_after="9876.25", note="Team lunch",
            source="web", reference="DEMO-REF", needs_review=True,
        )
        # An activity timestamp crossing UTC midnight must search its Dhaka day.
        Transaction.objects.all().update(created_at=datetime(2025, 9, 19, tzinfo=datetime_timezone.utc),
                                         updated_at=datetime(2025, 9, 19, tzinfo=datetime_timezone.utc))
        stamp = datetime(2026, 10, 20, 20, 15, tzinfo=datetime_timezone.utc)
        Transaction.objects.filter(pk=self.record.pk).update(created_at=stamp, updated_at=stamp)

    def ids(self, search, **filters):
        response = self.client.get(reverse("transaction-list"), {"search": search, **filters})
        self.assertEqual(response.status_code, 200, response.data)
        return [row["id"] for row in response.data]

    def test_search_covers_ledger_names_metadata_numbers_and_ids(self):
        for query in ("food", "DEMO BANK", "Demo debit card", "City Bank", "2468", "1234.50",
                      "1,234.50", "9876.25", "2026-10-12", "13:47", "expense", "debit",
                      "web", "needs review", "DEMO-REF", "cafe", "team", "purchase", "5678",
                      str(self.record.pk), self.record.pk.hex, self.record.pk.hex[:8], str(self.food.pk), str(self.method.pk),
                      "2026-10-21", "02:15"):
            with self.subTest(query=query):
                self.assertEqual(self.ids(query), [str(self.record.pk)])

    def test_multiple_terms_match_different_fields_and_quotes_keep_phrases(self):
        self.assertEqual(self.ids('Food 1,234.50 "Team lunch"'), [str(self.record.pk)])
        self.assertEqual(self.ids('"City Bank"'), [str(self.record.pk)])
        self.assertEqual(self.ids("Food 80"), [])
        self.assertEqual(self.ids('"Team cafe"'), [])
        self.assertEqual(self.ids("  \t  "), [str(self.record.pk), str(self.unrelated.pk)])
        self.assertEqual(self.ids('""'), [str(self.record.pk), str(self.unrelated.pk)])
        self.assertEqual(self.ids("Uncategorized"), [str(self.unrelated.pk)])
        self.assertEqual(self.ids("false mobile"), [str(self.unrelated.pk)])

    def test_linked_evidence_is_searchable_without_duplicate_rows(self):
        transfer = Transaction.objects.create(user=self.user, account=self.bank, transfer_account=self.wallet,
                                              date="2026-10-13", time="14:30", type="transfer", amount="500.00")
        for reference in ("DEMO-IN-1", "DEMO-IN-2"):
            TransferEvidence.objects.create(user=self.user, transaction=transfer, account=self.wallet,
                                           direction="credit", date="2026-10-14", time="19:22",
                                           balance_after="6200.00", fee_amount="7.50", provider="pathao_pay",
                                           source="sms", reference=reference, note="Incoming observation",
                                           external_key=f"demo:{reference}")
        for query in ("Demo wallet", "500.00", "Pathao Pay", "sms", "credit", "6200.00", "7.50",
                      "2026-10-14", "19:22", "observation", "IN-1", "Demo bank DEMO-IN-2"):
            with self.subTest(query=query):
                self.assertEqual(self.ids(query), [str(transfer.pk)] if query not in {"Demo wallet", "credit"}
                                 else [str(transfer.pk), str(self.unrelated.pk)])
        # Terms may corroborate different observations of the same movement.
        self.assertEqual(self.ids("DEMO-IN-1 DEMO-IN-2"), [str(transfer.pk)])
        response = self.client.get(reverse("transaction-export"), {"search": "Pathao 6200"})
        self.assertEqual(response.status_code, 200)
        rows = list(csv.DictReader(StringIO(response.content.decode())))
        self.assertEqual([row["id"] for row in rows], [str(transfer.pk)])

    def test_export_and_combined_filters_share_search_scope(self):
        self.assertEqual(self.ids("Food", category=str(self.food.pk), source="web", month="2026-10"), [str(self.record.pk)])
        self.assertEqual(self.ids("Food", account=str(self.wallet.pk)), [])
        self.assertEqual(self.ids("Food", month="2026-09"), [])
        response = self.client.get(reverse("transaction-export"), {"search": "Food 1,234.50"})
        self.assertEqual(response.status_code, 200)
        rows = list(csv.DictReader(StringIO(response.content.decode())))
        self.assertEqual([row["id"] for row in rows], [str(self.record.pk)])

    def test_queries_are_bounded_and_literal_special_characters_are_safe(self):
        for query in ("x" * 257, " ".join(["term"] * 13)):
            response = self.client.get(reverse("transaction-list"), {"search": query})
            self.assertEqual(response.status_code, 400)
            self.assertIn("search", response.data)
            self.assertEqual(self.client.get(reverse("transaction-export"), {"search": query}).status_code, 400)
        for query in ("%", "_missing_", "' OR 1=1 --", "\x00Food"):
            with self.subTest(query=query):
                self.assertEqual(self.ids(query), [str(self.record.pk)] if query == "\x00Food" else [])

    def test_search_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("transaction-list"), {"search": "Food"}).status_code, 401)
