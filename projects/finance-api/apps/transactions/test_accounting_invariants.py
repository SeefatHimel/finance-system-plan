"""Synthetic regression cases from the repository-wide accounting review."""

from decimal import Decimal
from types import SimpleNamespace
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.credit_cards.models import CreditCardBill
from apps.credit_cards.serializers import CreditCardBillSerializer
from apps.debts.models import Debt
from apps.debts.serializers import DebtSerializer
from .models import Transaction


class AccountingInvariantTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-invariants"
        )
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.card = Account.objects.create(
            user=self.user, name="Synthetic card", type="credit_card", currency="BDT"
        )
        self.context = {"request": SimpleNamespace(user=self.user)}

    def entry(self, **changes):
        return self.client.post(
            "/api/transactions/",
            {
                "account": str(self.bank.pk),
                "date": "2026-01-01",
                "type": "expense",
                "amount": "100.00",
                **changes,
            },
            format="json",
        )

    def test_direction_conflicts_are_rejected_and_adjustments_allow_both(self):
        for kind, direction in [
            ("expense", "credit"),
            ("income", "debit"),
            ("lend", "credit"),
            ("repayment_received", "debit"),
        ]:
            self.assertEqual(
                self.entry(type=kind, direction=direction).status_code, 400
            )
        for direction in ["debit", "credit"]:
            self.assertEqual(
                self.entry(type="adjustment", direction=direction).status_code, 201
            )
        row = Transaction.objects.first()
        self.assertEqual(
            self.client.patch(
                f"/api/transactions/{row.pk}/",
                {"type": "income", "direction": "debit"},
                format="json",
            ).status_code,
            400,
        )

    def test_cross_currency_transfer_and_currency_relabelling_are_rejected(self):
        usd = Account.objects.create(
            user=self.user, name="Synthetic USD", type="bank", currency="USD"
        )
        self.assertEqual(
            self.entry(type="transfer", transfer_account=str(usd.pk)).status_code, 400
        )
        self.assertEqual(
            self.entry(type="transfer", transfer_account=str(self.card.pk)).status_code,
            201,
        )
        for account in [self.bank, self.card]:
            self.assertEqual(
                self.client.patch(
                    f"/api/accounts/{account.pk}/", {"currency": "USD"}, format="json"
                ).status_code,
                400,
            )
        self.assertEqual(
            self.client.patch(
                f"/api/accounts/{usd.pk}/", {"currency": "eur"}, format="json"
            ).data["currency"],
            "EUR",
        )

    def test_stale_card_edit_keeps_the_payment_and_revalidates_new_total(self):
        bill = CreditCardBill.objects.create(
            user=self.user,
            account=self.card,
            statement_balance=1000,
            remaining_balance=1000,
            statement_date="2026-01-01",
            due_date="2026-01-31",
        )
        note = CreditCardBillSerializer(
            CreditCardBill.objects.get(pk=bill.pk),
            data={"note": "Synthetic note"},
            partial=True,
            context=self.context,
        )
        lower = CreditCardBillSerializer(
            CreditCardBill.objects.get(pk=bill.pk),
            data={"statement_balance": "50"},
            partial=True,
            context=self.context,
        )
        self.assertTrue(note.is_valid())
        self.assertTrue(lower.is_valid())
        response = self.client.post(
            f"/api/credit-card-bills/{bill.pk}/payments/",
            {"amount": "100", "paid_at": "2026-01-02", "ledger_action": "record_only"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        note.save()
        bill.refresh_from_db()
        self.assertEqual(
            (bill.paid_amount, bill.remaining_balance), (Decimal("100"), Decimal("900"))
        )
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            lower.save()

    def test_debt_correction_uses_payments_and_stale_edits_cannot_reset_them(self):
        debt = Debt.objects.create(
            user=self.user,
            counterparty_name="Synthetic party",
            direction="lent_by_me",
            principal_amount=100,
            current_balance=100,
            opened_at="2026-01-01",
        )
        note = DebtSerializer(
            Debt.objects.get(pk=debt.pk),
            data={"note": "Synthetic note"},
            partial=True,
            context=self.context,
        )
        self.assertTrue(note.is_valid())
        self.assertEqual(
            self.client.post(
                f"/api/debts/{debt.pk}/payments/",
                {
                    "amount": "40",
                    "paid_at": "2026-01-02",
                    "ledger_action": "record_only",
                },
                format="json",
            ).status_code,
            201,
        )
        note.save()
        debt.refresh_from_db()
        self.assertEqual(debt.current_balance, Decimal("60"))
        response = self.client.patch(
            f"/api/debts/{debt.pk}/", {"principal_amount": "200"}, format="json"
        )
        self.assertEqual(response.data["current_balance"], "160.00")
        self.assertEqual(
            self.client.patch(
                f"/api/debts/{debt.pk}/", {"principal_amount": "30"}, format="json"
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/debts/{debt.pk}/", {"direction": "borrowed_by_me"}, format="json"
            ).status_code,
            400,
        )

    def test_existing_bad_records_are_flagged_without_rewriting_them(self):
        row = Transaction.objects.create(
            user=self.user,
            account=self.bank,
            date="2026-01-01",
            amount=100,
            type="expense",
            direction="credit",
        )
        response = self.client.get("/api/transactions/issues/")
        self.assertIn(
            "type_direction_mismatch",
            [
                issue["code"]
                for finding in response.data["results"]
                for issue in finding["issues"]
            ],
        )
        row.refresh_from_db()
        self.assertEqual(row.direction, "credit")

    def test_queued_expense_retry_reuses_one_movement(self):
        first = self.entry(source="mobile", external_key="queued-entry:synthetic-id")
        second = self.entry(source="mobile", external_key="queued-entry:synthetic-id")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            self.entry(
                source="mobile",
                external_key="queued-entry:synthetic-id",
                amount="101.00",
            ).status_code,
            400,
        )
