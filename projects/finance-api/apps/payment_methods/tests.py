from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account


class PaymentMethodApiTests(APITestCase):
    def test_authenticated_user_can_create_payment_method(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("payment-method-list"),
            {
                "account": str(account.id),
                "name": "Personal bKash",
                "provider": "bkash",
                "identifier": "01700000000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Personal bKash")

    def test_user_cannot_attach_payment_method_to_another_users_account(self):
        user = get_user_model().objects.create_user(
            username="himel", password="password"
        )
        other_user = get_user_model().objects.create_user(
            username="other", password="password"
        )
        other_account = Account.objects.create(
            user=other_user,
            name="Other Bank",
            type=Account.Type.BANK,
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("payment-method-list"),
            {
                "account": str(other_account.id),
                "name": "Blocked Bank",
                "provider": "bank",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)


class PaymentIdentityTests(APITestCase):
    def setUp(self):
        from .models import PaymentMethod

        self.user = get_user_model().objects.create_user(username="synthetic-identity")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank"
        )
        self.wallet = Account.objects.create(
            user=self.user, name="Synthetic wallet", type="mobile_wallet"
        )
        self.method = PaymentMethod.objects.create(
            user=self.user,
            account=self.bank,
            name="Everyday card",
            provider="ebl",
            identifier="1111",
            identifier_kind="account",
        )

    def test_masking_typed_identifiers_and_no_ledger_mutation(self):
        from apps.transactions.models import Transaction

        record = Transaction.objects.create(
            user=self.user,
            account=self.bank,
            type="expense",
            date="2026-01-01",
            amount="10.00",
            sender_card_identifier="****2222",
        )
        record.refresh_from_db()
        before = (record.amount, record.updated_at, record.sender_card_identifier)
        response = self.client.patch(
            reverse("payment-method-detail", args=[self.method.id]),
            {
                "additional_identifiers": [
                    {"kind": "card", "value": "12345678902222", "label": "Daily card"}
                ],
                "aliases": ["Everyday", "Everyday debit"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["additional_identifiers"][0]["value"], "2222")
        record.refresh_from_db()
        self.assertEqual(
            (record.amount, record.updated_at, record.sender_card_identifier), before
        )
        self.assertEqual(Transaction.objects.count(), 1)

    def test_typed_identifiers_match_sms_endpoints_and_exclude_wrong_kind(self):
        from apps.messages.parsers import _find_payment_method_for_identifiers

        self.method.additional_identifiers = [
            {"kind": "card", "value": "****2222", "label": "Daily card"}
        ]
        self.method.save()
        match = _find_payment_method_for_identifiers(
            user=self.user, identifiers=("", "****2222"), provider="ebl"
        )
        self.assertEqual(match.pk, self.method.pk)
        self.assertIsNone(
            _find_payment_method_for_identifiers(
                user=self.user, identifiers=("****2222", ""), provider="ebl"
            )
        )

    def test_equal_suffixes_are_ambiguous_regardless_of_mask_style(self):
        from .models import PaymentMethod
        from .resolution import unique_method

        PaymentMethod.objects.create(
            user=self.user,
            account=self.wallet,
            name="Other suffix",
            provider="ebl",
            identifier="****1111",
            identifier_kind="account",
        )
        self.assertIsNone(
            unique_method(
                user=self.user, evidence=[("account", "****1111")], provider="ebl"
            )
        )

    def test_visible_prefix_resolves_stronger_identity_and_rejects_conflict(self):
        from .models import PaymentMethod
        from .resolution import unique_method

        self.method.identifier = "1234****1111"
        self.method.save()
        PaymentMethod.objects.create(
            user=self.user,
            account=self.wallet,
            name="Other prefix",
            provider="ebl",
            identifier="9876****1111",
            identifier_kind="account",
        )
        self.assertEqual(
            unique_method(user=self.user, evidence=[("account", "1234****1111")]).pk,
            self.method.pk,
        )
        self.assertIsNone(
            unique_method(user=self.user, evidence=[("account", "5555****1111")])
        )

    def test_statement_account_hint_uses_additional_identifiers(self):
        from .resolution import statement_account_suggestion

        self.method.identifier = ""
        self.method.additional_identifiers = [
            {"kind": "account", "value": "****1111", "label": "Bank"}
        ]
        self.method.save()
        suggestion = statement_account_suggestion(
            user=self.user, profile="ebl_bank", hint="***1111"
        )
        self.assertEqual(suggestion["account"], str(self.bank.id))
        self.assertFalse(suggestion["ambiguous"])

    def test_aliases_suggest_unique_account_and_conflicts_require_choice(self):
        from apps.messages.transfer_suggestions import unique_named_account

        from .models import PaymentMethod

        self.method.aliases = ["Pocket wallet"]
        self.method.save()
        account, _ = unique_named_account(self.user, "Pocket wallet DHAKA", self.wallet)
        self.assertEqual(account.pk, self.bank.pk)
        other = Account.objects.create(
            user=self.user, name="Synthetic other", type="bank"
        )
        PaymentMethod.objects.create(
            user=self.user,
            account=other,
            name="Other alias",
            provider="bank",
            aliases=["Pocket wallet"],
        )
        account, reason = unique_named_account(
            self.user, "Pocket wallet DHAKA", self.wallet
        )
        self.assertIsNone(account)
        self.assertIn("Several", reason)

    def test_invalid_lists_and_numeric_aliases_return_field_errors(self):
        for data in (
            {"aliases": ["12345678"]},
            {"aliases": ["ab"]},
            {"additional_identifiers": [{"kind": "card", "value": "123"}]},
            {"additional_identifiers": [{"kind": "card", "value": "1111"}] * 21},
            {"additional_identifiers": [{"kind": "account", "value": "1111"}] * 2},
        ):
            with self.subTest(data=data):
                response = self.client.patch(
                    reverse("payment-method-detail", args=[self.method.id]),
                    data,
                    format="json",
                )
                self.assertEqual(response.status_code, 400, response.data)

    def test_inactive_and_other_user_mappings_are_ignored(self):
        from .models import PaymentMethod
        from .resolution import unique_method

        other_user = get_user_model().objects.create_user(
            username="synthetic-identity-other"
        )
        other_bank = Account.objects.create(
            user=other_user, name="Other user's bank", type="bank"
        )
        PaymentMethod.objects.create(
            user=other_user,
            account=other_bank,
            name="Private method",
            provider="ebl",
            identifier="1111",
        )
        self.method.is_active = False
        self.method.save()
        self.assertIsNone(unique_method(user=self.user, evidence=[("account", "1111")]))
        self.client.force_authenticate(other_user)
        self.assertEqual(
            self.client.patch(
                reverse("payment-method-detail", args=[self.method.id]),
                {"aliases": ["Other name"]},
                format="json",
            ).status_code,
            404,
        )

    def test_arbitrary_reference_numbers_are_not_account_evidence(self):
        from .resolution import text_identifier_evidence

        self.assertEqual(
            text_identifier_evidence("Reference 1111; amount 100; date 2026-01-01"), []
        )
        self.assertEqual(
            text_identifier_evidence("Card ****1111"), [("card", "****1111")]
        )

    def test_conflicting_account_and_card_evidence_is_not_overridden_by_score(self):
        from .models import PaymentMethod
        from .resolution import unique_method

        PaymentMethod.objects.create(
            user=self.user,
            account=self.wallet,
            name="Different card owner",
            provider="ebl",
            identifier="1234****2222",
            identifier_kind="card",
        )
        self.assertIsNone(
            unique_method(
                user=self.user,
                evidence=[("account", "****1111"), ("card", "1234****2222")],
            )
        )

    def test_ambiguous_endpoint_is_not_replaced_by_a_unique_name_alias(self):
        from apps.messages.transfer_suggestions import apply_transfer_suggestion

        from .models import PaymentMethod

        other = Account.objects.create(
            user=self.user, name="Synthetic second wallet", type="mobile_wallet"
        )
        for account in (self.wallet, other):
            PaymentMethod.objects.create(
                user=self.user,
                account=account,
                name=account.name,
                provider="bkash",
                identifier="2222",
                identifier_kind="card",
                aliases=["Pocket wallet"] if account == self.wallet else [],
            )
        parsed = {
            "message_kind": "bank_transfer_out",
            "suggested_transfer_direction": "debit",
            "receiver_card_identifier": "****2222",
            "counterparty_text": "Pocket wallet",
            "destination_account": None,
        }
        apply_transfer_suggestion(
            parsed, self.user, self.bank, (self.bank, None, self.method, None)
        )
        self.assertIsNone(parsed["destination_account"])
        self.assertIn("Several", parsed["transfer_suggestion_reason"])
