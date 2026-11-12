"""Only synthetic service merchants and owner-scoped category choices."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.statements.insights import remember, suggestions
from apps.statements.models import StatementImport, StatementMapping, StatementRow
from apps.transactions.models import Transaction

from .category_suggestions import CategorySuggestions, pathao_group, pathao_key
from .models import ParsedMessageCandidate, SenderRule, SenderRuleMapping
from .serializers import ParsedMessageCandidateSerializer


class PendingCategoryTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username="synthetic-category-owner"
        )
        self.wallet = Account.objects.create(
            user=self.user, name="Synthetic wallet", type="mobile_wallet"
        )
        self.rule = SenderRule.objects.create(
            user=self.user,
            account=self.wallet,
            provider="pathao_pay",
            sender="SYNTH-PATHAO",
            name="Synthetic Pathao",
        )
        self.transport = Category.objects.create(
            user=self.user, name="Synthetic transport", kind="expense"
        )
        self.food = Category.objects.create(
            user=self.user, name="Synthetic food", kind="expense"
        )
        self.client.force_authenticate(self.user)
        self.sequence = 0

    def imported(self, merchant="Pathao Car"):
        self.sequence += 1
        result = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": self.rule.sender,
                "body": f"Payment of BDT {self.sequence + 20}.00 to {merchant} successful. Balance BDT 700.00. TrxID SYNTH-CAT-{self.sequence}",
                "received_at": "2026-02-02T12:00:00+06:00",
                "device_message_id": f"synthetic-category-{self.sequence}",
            },
            format="json",
        )
        self.assertEqual(result.status_code, 201, result.data)
        return ParsedMessageCandidate.objects.select_related(
            "raw_message", "sender_rule", "account", "category"
        ).get(pk=result.data["candidate"]["id"])

    def confirm(self, candidate, category):
        result = self.client.post(
            reverse("message-candidate-confirm", args=[candidate.pk]),
            {"category": str(category.pk)},
            format="json",
        )
        self.assertEqual(result.status_code, 200, result.data)
        return Transaction.objects.get(pk=result.data["transaction"])

    def save(self, candidate, **extra):
        return self.client.post(
            reverse("message-candidate-remember", args=[candidate.pk]),
            extra,
            format="json",
        )

    def hint(self, candidate):
        result = self.client.get(reverse("message-review-detail", args=[candidate.pk]))
        self.assertEqual(result.status_code, 200, result.data)
        return result.data["suggested_category"]

    def row(self, merchant="Pathao Bike", **fields):
        batch = StatementImport.objects.create(
            user=self.user,
            account=self.wallet,
            file_digest=f"synthetic-{merchant}",
            profile="pathao_pay",
            parser_version="2",
            currency="BDT",
            account_identity="verify",
            page_count=1,
        )
        return StatementRow.objects.create(
            batch=batch,
            position=1,
            component="principal",
            source_fingerprint="synthetic-category-row",
            extracted={
                "description": f"Make Payment · {merchant}",
                "provider_type": "Make Payment",
                "direction": "debit",
                "signed_fee": "0.00",
            },
            date="2026-02-02",
            time="12:00:00",
            type="expense",
            direction="debit",
            amount="23.00",
            **fields,
        )

    def test_saving_ride_category_updates_pending_hints_without_reparsing_or_writes(
        self,
    ):
        first = self.imported()
        bike, cng, food = [
            self.imported(merchant)
            for merchant in ["Pathao Bike", "Pathao CNG", "Pathao Food"]
        ]
        self.confirm(first, self.transport)
        before = bike.updated_at
        saved = self.save(first)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["scope"], "service_group")
        self.assertEqual(self.hint(bike), str(self.transport.pk))
        self.assertEqual(self.hint(cng), str(self.transport.pk))
        self.assertIsNone(self.hint(food))
        bike.refresh_from_db()
        self.assertIsNone(bike.category)
        self.assertEqual(bike.updated_at, before)
        self.assertEqual(Transaction.objects.count(), 1)
        fresh = self.imported("Pathao Bike")
        self.assertEqual(self.hint(fresh), str(self.transport.pk))
        row = self.row()
        hint = suggestions([row])[row.pk]
        self.assertEqual(hint["category"], str(self.transport.pk))
        self.assertFalse(hint["note"])

    def test_food_is_learned_separately_and_explicit_replacement_is_required(self):
        ride, food = self.imported(), self.imported("Pathao Food")
        self.confirm(ride, self.transport)
        self.confirm(food, self.food)
        self.assertEqual(self.save(ride).status_code, 200)
        self.assertEqual(self.save(food).status_code, 200)
        self.assertEqual(self.hint(self.imported("Pathao Food")), str(self.food.pk))
        self.assertEqual(self.hint(self.imported("Pathao CNG")), str(self.transport.pk))
        ride.refresh_from_db()
        ride.transaction.category = self.food
        ride.transaction.save()
        self.assertEqual(self.save(ride).status_code, 409)
        self.assertEqual(self.save(ride, replace_existing=True).status_code, 200)

    def test_legacy_broad_pathao_rule_never_spills_into_food_or_unknown_services(self):
        SenderRuleMapping.objects.create(
            user=self.user,
            sender_rule=self.rule,
            account=self.wallet,
            message_kind="purchase",
            transaction_type="expense",
            category=self.transport,
        )
        for merchant in ["Pathao Food", "Pathao Parcel", "Pathao Car and Pathao Food"]:
            item = self.imported(merchant)
            self.assertIsNone(item.category)
            self.assertIsNone(self.hint(item))
        self.assertEqual(pathao_group("Pathao Car / Pathao Food"), "")

    def test_statement_remember_shares_category_with_sms_without_copying_notes(self):
        row = self.row(category=self.transport, note="Synthetic private ride note")
        remember(row, self.user)
        mapping = StatementMapping.objects.get(pattern_key=pathao_key("rides"))
        self.assertEqual(mapping.note_template, "")
        self.assertEqual(self.hint(self.imported("Pathao CNG")), str(self.transport.pk))
        self.assertIsNone(self.hint(self.imported("Pathao Food")))

    def test_combined_review_reads_the_saved_service_category_without_reparsing(self):
        first = self.imported()
        self.confirm(first, self.transport)
        self.assertEqual(self.save(first).status_code, 200)
        pending = self.imported("Pathao Bike")
        row = self.row(balance_after="700.00", reference=pending.reference)
        row.amount = pending.amount
        row.extracted.update(
            {
                "id": "1:1",
                "page": 1,
                "row": 1,
                "date": "2026-02-02",
                "time": "12:00:00",
                "posting_date": "2026-02-02",
                "value_date": None,
                "reference": pending.reference,
                "amount": str(pending.amount),
                "balance_after": "700.00",
                "issues": [],
                "bounds": [30, 50, 590, 120],
            }
        )
        row.save()
        response = self.client.post(
            reverse("unified-pair-preview"),
            {"statement": str(row.pk), "sms": str(pending.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["sms"]["suggested_category"], str(self.transport.pk)
        )
        self.assertEqual(
            response.data["row"]["review"]["suggestion"]["category"],
            str(self.transport.pk),
        )

    def test_scope_inactive_categories_and_manual_confirmation_are_respected(self):
        first = self.imported()
        self.confirm(first, self.transport)
        self.assertEqual(self.save(first).status_code, 200)
        pending = self.imported("Pathao Bike")
        manual = self.confirm(pending, self.food)
        self.assertEqual(manual.category_id, self.food.pk)
        other_account = Account.objects.create(
            user=self.user, name="Other synthetic wallet", type="mobile_wallet"
        )
        item = self.imported("Pathao Bike")
        item.account = other_account
        self.assertIsNone(CategorySuggestions(self.user.pk).category(item))
        item.account = self.wallet
        self.transport.is_active = False
        self.transport.save()
        self.assertIsNone(self.hint(item))
        other = get_user_model().objects.create_user(
            username="synthetic-category-other"
        )
        self.assertIsNone(CategorySuggestions(other.pk).category(item))

    def test_explicit_clear_and_type_change_do_not_receive_an_implicit_category(self):
        first = self.imported()
        self.confirm(first, self.transport)
        self.assertEqual(self.save(first).status_code, 200)
        for payload in [{"category": None}, {"type": "fee"}]:
            pending = self.imported("Pathao Bike")
            result = self.client.post(
                reverse("message-candidate-confirm", args=[pending.pk]),
                payload,
                format="json",
            )
            self.assertEqual(result.status_code, 200, result.data)
            self.assertIsNone(
                Transaction.objects.get(pk=result.data["transaction"]).category_id
            )

    def test_scoped_category_serializer_queries_are_constant_for_a_page(self):
        first = self.imported()
        self.confirm(first, self.transport)
        self.assertEqual(self.save(first).status_code, 200)
        pending = self.imported("Pathao Bike")
        with self.assertNumQueries(4):
            data = ParsedMessageCandidateSerializer([pending] * 20, many=True).data
        self.assertEqual(
            {entry["suggested_category"] for entry in data}, {str(self.transport.pk)}
        )

    def test_generic_saved_category_is_read_live_and_list_queries_do_not_grow_per_row(
        self,
    ):
        bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank"
        )
        rule = SenderRule.objects.create(
            user=self.user,
            account=bank,
            provider="ebl",
            sender="SYNTH-BANK",
            name="Synthetic bank",
        )
        item = self.imported()
        item.provider, item.sender_rule, item.account = "ebl", rule, bank
        SenderRuleMapping.objects.create(
            user=self.user,
            sender_rule=rule,
            account=bank,
            message_kind="purchase",
            transaction_type="expense",
            category=self.transport,
        )
        self.assertEqual(
            CategorySuggestions(self.user.pk).category(item), self.transport
        )
        # Two rule-family queries plus the serializer's existing identity lookup.
        with self.assertNumQueries(3):
            data = ParsedMessageCandidateSerializer([item] * 20, many=True).data
        self.assertEqual(
            {entry["suggested_category"] for entry in data}, {str(self.transport.pk)}
        )
