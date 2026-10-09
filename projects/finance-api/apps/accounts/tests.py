from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.transactions.models import Transaction

from .models import Account


class AccountIdentityApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-account-identity"
        )
        self.client.force_authenticate(self.user)

    def create_identified_account(self, name="Synthetic bank", **identity):
        response = self.client.post(
            reverse("account-list"),
            {
                "name": name,
                "type": "bank",
                "starting_balance": "500.00",
                "identity": {
                    "provider": "ebl",
                    "identifier": "9876543210123",
                    "identifier_kind": "account",
                    **identity,
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return Account.objects.get(pk=response.data["id"]), response

    def test_account_numbers_and_multiple_cards_use_shared_sms_and_pdf_matching(self):
        from django.utils import timezone

        from apps.messages.models import RawMessage
        from apps.messages.parsers import parse_raw_message
        from apps.payment_methods.resolution import statement_account_suggestion

        account, response = self.create_identified_account(
            additional_identifiers=[
                {
                    "kind": "card",
                    "value": "12345678902222",
                    "label": "Daily card",
                }
            ],
            aliases=["Everyday bank"],
        )
        self.assertEqual(response.data["identity"]["identifier"], "0123")
        self.assertEqual(
            response.data["identity"]["additional_identifiers"][0]["value"], "2222"
        )
        self.assertEqual(account.identity_method.account_id, account.pk)
        message = RawMessage.objects.create(
            user=self.user,
            sender="EBL",
            body="Card ****2222 used at SYNTHETIC SHOP for BDT 100. Balance BDT 400.",
            received_at=timezone.now(),
            body_hash="synthetic-identity",
        )
        parsed = parse_raw_message(message)
        self.assertEqual(parsed["account"].pk, account.pk)
        self.assertEqual(parsed["payment_method"].pk, account.identity_method_id)
        suggestion = statement_account_suggestion(
            user=self.user, profile="ebl_bank", hint="****0123"
        )
        self.assertEqual(suggestion["account"], str(account.pk))
        self.assertEqual(Transaction.objects.count(), 0)

    def test_omit_preserves_and_null_disables_without_changing_existing_transactions(
        self,
    ):
        account, _ = self.create_identified_account()
        entry = Transaction.objects.create(
            user=self.user,
            account=account,
            payment_method=account.identity_method,
            type="expense",
            date="2026-01-02",
            amount="100.00",
            balance_after="400.00",
        )
        entry.refresh_from_db()
        before = (
            entry.amount,
            entry.balance_after,
            entry.payment_method_id,
            entry.updated_at,
        )
        url = reverse("account-detail", kwargs={"pk": account.pk})
        renamed = self.client.patch(
            url, {"name": "Renamed synthetic bank"}, format="json"
        )
        self.assertEqual(renamed.status_code, 200, renamed.data)
        self.assertTrue(renamed.data["identity"]["is_active"])
        disabled = self.client.patch(url, {"identity": None}, format="json")
        self.assertEqual(disabled.status_code, 200, disabled.data)
        self.assertFalse(disabled.data["identity"]["is_active"])
        self.assertEqual(disabled.data["ledger_balance"], "400.00")
        self.assertEqual(disabled.data["latest_reported_balance"], "400.00")
        entry.refresh_from_db()
        self.assertEqual(
            (
                entry.amount,
                entry.balance_after,
                entry.payment_method_id,
                entry.updated_at,
            ),
            before,
        )
        from apps.payment_methods.resolution import unique_method

        self.assertIsNone(
            unique_method(user=self.user, evidence=[("account", "****0123")])
        )
        enabled = self.client.patch(
            url, {"identity": {"identifier": "****8888"}}, format="json"
        )
        self.assertEqual(enabled.status_code, 200, enabled.data)
        self.assertTrue(enabled.data["identity"]["is_active"])
        self.assertEqual(enabled.data["identity"]["identifier"], "****8888")

    def test_invalid_profile_rolls_back_account_creation(self):
        from apps.payment_methods.models import PaymentMethod

        for identity in (
            {"provider": "ebl"},
            {"provider": "ebl", "identifier": "123"},
            {"provider": "ebl", "aliases": ["12345678"]},
            {
                "provider": "ebl",
                "additional_identifiers": [{"kind": "card", "value": "123"}],
            },
        ):
            response = self.client.post(
                reverse("account-list"),
                {"name": "Invalid synthetic", "type": "bank", "identity": identity},
                format="json",
            )
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Account.objects.exists())
        self.assertFalse(PaymentMethod.objects.exists())

    def test_mask_character_cannot_preserve_an_almost_complete_card_number(self):
        _, response = self.create_identified_account(
            identifier="1234567890123456x",
            additional_identifiers=[
                {
                    "kind": "card",
                    "value": "1234567890**3456",
                }
            ],
        )
        self.assertEqual(response.data["identity"]["identifier"], "3456")
        self.assertEqual(
            response.data["identity"]["additional_identifiers"][0]["value"], "3456"
        )

    def test_new_profiles_default_to_typed_account_or_card_and_accept_long_account_names(
        self,
    ):
        for kind in ("bank", "credit_card"):
            response = self.client.post(
                reverse("account-list"),
                {
                    "name": kind + "x" * (120 - len(kind)),
                    "type": kind,
                    "identity": {"provider": "ebl", "identifier": "****1234"},
                },
                format="json",
            )
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(
                response.data["identity"]["identifier_kind"],
                "card" if kind == "credit_card" else "account",
            )
            self.assertLessEqual(
                len(Account.objects.get(pk=response.data["id"]).identity_method.name),
                120,
            )
            patched = self.client.patch(
                reverse("account-detail", kwargs={"pk": response.data["id"]}),
                {
                    "identity": {
                        "additional_identifiers": [
                            {"kind": "card", "value": "****5678"}
                        ]
                    },
                },
                format="json",
            )
            self.assertEqual(patched.status_code, 200, patched.data)
            self.assertEqual(
                patched.data["identity"]["additional_identifiers"][0]["label"], ""
            )

    def test_shared_profile_cannot_be_moved_and_is_editable_from_payment_settings(self):
        account, _ = self.create_identified_account()
        other = Account.objects.create(
            user=self.user, name="Another synthetic bank", type="bank"
        )
        url = reverse(
            "payment-method-detail", kwargs={"pk": account.identity_method_id}
        )
        moved = self.client.patch(url, {"account": str(other.pk)}, format="json")
        self.assertEqual(moved.status_code, 400, moved.data)
        changed = self.client.patch(url, {"identifier": "****8888"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        result = self.client.get(reverse("account-detail", kwargs={"pk": account.pk}))
        self.assertEqual(result.data["identity"]["identifier"], "****8888")

    def test_deletion_removes_unused_profile_but_restores_protected_links_on_failure(
        self,
    ):
        from apps.payment_methods.models import PaymentMethod

        unused, _ = self.create_identified_account()
        method_id = unused.identity_method_id
        response = self.client.delete(
            reverse("account-detail", kwargs={"pk": unused.pk})
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(PaymentMethod.objects.filter(pk=method_id).exists())
        used, _ = self.create_identified_account("Used synthetic bank")
        entry = Transaction.objects.create(
            user=self.user,
            account=used,
            payment_method=used.identity_method,
            type="expense",
            date="2026-01-02",
            amount="100.00",
        )
        response = self.client.delete(reverse("account-detail", kwargs={"pk": used.pk}))
        self.assertEqual(response.status_code, 400, response.data)
        used.refresh_from_db()
        entry.refresh_from_db()
        self.assertEqual(entry.payment_method_id, used.identity_method_id)
        self.assertTrue(
            PaymentMethod.objects.filter(pk=used.identity_method_id).exists()
        )

    def test_foreign_account_profile_cannot_be_read_or_updated(self):
        account, _ = self.create_identified_account()
        other = get_user_model().objects.create_user(
            username="synthetic-other-identity"
        )
        self.client.force_authenticate(other)
        url = reverse("account-detail", kwargs={"pk": account.pk})
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(
            self.client.patch(
                url, {"identity": {"identifier": "****8888"}}, format="json"
            ).status_code,
            404,
        )


class AccountApiTests(APITestCase):
    def test_authenticated_user_can_create_account(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("account-list"),
            {
                "name": "Bkash",
                "type": "mobile_wallet",
                "starting_balance": "1000.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Bkash")
        self.assertEqual(response.data["ledger_balance"], "1000.00")
        self.assertIsNone(response.data["latest_reported_balance"])

    def test_account_exposes_derived_ledger_and_latest_reported_balances(self):
        user = get_user_model().objects.create_user(
            username="himel", password="password"
        )
        self.client.force_authenticate(user)
        cash = Account.objects.create(
            user=user,
            name="Cash",
            type=Account.Type.CASH,
            starting_balance="1000.00",
        )
        bank = Account.objects.create(
            user=user,
            name="Bank",
            type=Account.Type.BANK,
            starting_balance="500.00",
        )
        Transaction.objects.create(
            user=user,
            account=cash,
            amount="200.00",
            balance_after="800.00",
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
        )
        income_transaction = Transaction.objects.create(
            user=user,
            account=cash,
            amount="50.00",
            balance_after="850.00",
            date="2026-05-02",
            type=Transaction.Type.INCOME,
        )
        Transaction.objects.create(
            user=user,
            account=cash,
            transfer_account=bank,
            amount="100.00",
            date="2026-05-03",
            type=Transaction.Type.TRANSFER,
        )
        Transaction.objects.create(
            user=user,
            account=cash,
            amount="25.00",
            date="2026-05-04",
            direction=Transaction.Direction.CREDIT,
            type=Transaction.Type.ADJUSTMENT,
        )

        cash_response = self.client.get(
            reverse("account-detail", kwargs={"pk": cash.id})
        )
        bank_response = self.client.get(
            reverse("account-detail", kwargs={"pk": bank.id})
        )

        self.assertEqual(cash_response.status_code, 200)
        self.assertEqual(cash_response.data["ledger_balance"], "775.00")
        self.assertEqual(cash_response.data["latest_reported_balance"], "850.00")
        self.assertEqual(
            cash_response.data["latest_reported_balance_date"], "2026-05-02"
        )
        self.assertEqual(bank_response.data["ledger_balance"], "600.00")

        update_response = self.client.patch(
            reverse("account-detail", kwargs={"pk": cash.id}),
            {"starting_balance": "1200.00"},
            format="json",
        )

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["ledger_balance"], "975.00")

        delete_response = self.client.delete(
            reverse("transaction-detail", kwargs={"pk": income_transaction.id})
        )
        refreshed_response = self.client.get(
            reverse("account-detail", kwargs={"pk": cash.id})
        )

        self.assertEqual(delete_response.status_code, 204)
        self.assertEqual(refreshed_response.data["ledger_balance"], "925.00")
        self.assertEqual(refreshed_response.data["latest_reported_balance"], "800.00")
        self.assertEqual(
            refreshed_response.data["latest_reported_balance_date"], "2026-05-01"
        )
