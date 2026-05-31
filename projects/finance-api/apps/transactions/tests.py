import csv
from io import StringIO

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction


class TransactionApiTests(APITestCase):
    def test_authenticated_user_can_create_transaction(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        self.client.force_authenticate(user)
        account = Account.objects.create(
            user=user,
            name="Cash",
            type=Account.Type.CASH,
        )
        category = Category.objects.create(
            user=user,
            name="Food",
            kind=Category.Kind.EXPENSE,
        )

        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(account.id),
                "category": str(category.id),
                "date": "2026-05-01",
                "type": "expense",
                "amount": "250.00",
                "note": "Lunch",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["amount"], "250.00")
        self.assertEqual(response.data["direction"], "debit")

    def test_authenticated_user_can_create_transaction_with_ledger_fields(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        self.client.force_authenticate(user)
        account = Account.objects.create(
            user=user,
            name="Bkash Wallet",
            type=Account.Type.MOBILE_WALLET,
        )
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="Personal bKash",
            provider=PaymentMethod.Provider.BKASH,
        )

        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(account.id),
                "payment_method": str(payment_method.id),
                "date": "2026-05-01",
                "type": "expense",
                "direction": "debit",
                "amount": "350.00",
                "balance_after": "1150.00",
                "reference": "DEF456XYZ",
                "counterparty_text": "SAMPLE MERCHANT",
                "external_key": "sms:bkash:def456xyz",
                "note": "Payment SMS",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["reference"], "DEF456XYZ")
        self.assertEqual(response.data["counterparty_text"], "SAMPLE MERCHANT")
        self.assertEqual(response.data["balance_after"], "1150.00")
        self.assertEqual(str(response.data["payment_method"]), str(payment_method.id))

    def test_authenticated_user_can_export_filtered_transactions_as_csv(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        self.client.force_authenticate(user)
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        other_account = Account.objects.create(user=other_user, name="Other Cash", type=Account.Type.CASH)
        category = Category.objects.create(user=user, name="Food", kind=Category.Kind.EXPENSE)
        payment_method = PaymentMethod.objects.create(
            user=user,
            account=account,
            name="Cash Wallet",
            provider=PaymentMethod.Provider.CASH,
        )
        exported_transaction = Transaction.objects.create(
            user=user,
            account=account,
            category=category,
            payment_method=payment_method,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            direction=Transaction.Direction.DEBIT,
            amount="250.00",
            balance_after="750.00",
            reference="CASH-001",
            counterparty_text="Lunch Shop",
            external_key="manual:cash-001",
            note="Lunch",
            source=Transaction.Source.WEB,
        )
        Transaction.objects.create(
            user=user,
            account=account,
            date="2026-06-01",
            type=Transaction.Type.INCOME,
            amount="1000.00",
            note="June salary",
        )
        Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-02",
            type=Transaction.Type.EXPENSE,
            amount="300.00",
            reference="DINNER-001",
            note="Dinner",
        )
        Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-03",
            type=Transaction.Type.EXPENSE,
            amount="400.00",
            reference="CASH-001",
            note="Imported matching reference",
            source=Transaction.Source.IMPORT,
        )
        Transaction.objects.create(
            user=other_user,
            account=other_account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="999.00",
            note="Other user's transaction",
        )

        response = self.client.get(
            reverse("transaction-export"),
            {"month": "2026-05", "search": "cash-001", "source": "web"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv")
        rows = list(csv.DictReader(StringIO(response.content.decode())))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], str(exported_transaction.id))
        self.assertEqual(rows[0]["account_name"], "Cash")
        self.assertEqual(rows[0]["category_name"], "Food")
        self.assertEqual(rows[0]["payment_method_name"], "Cash Wallet")
        self.assertEqual(rows[0]["balance_after"], "750.00")
        self.assertEqual(rows[0]["reference"], "CASH-001")
        self.assertEqual(rows[0]["counterparty_text"], "Lunch Shop")

    def test_authenticated_user_can_search_transactions_by_normalized_text_fields(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        self.client.force_authenticate(user)
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        other_account = Account.objects.create(user=other_user, name="Other Cash", type=Account.Type.CASH)
        matched_transaction = Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="250.00",
            reference="BKASH-ABC-001",
            counterparty_text="Lunch Shop",
            external_key="sms:bkash:abc-001",
            note="Team lunch",
        )
        Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-02",
            type=Transaction.Type.EXPENSE,
            amount="120.00",
            reference="CASH-002",
            counterparty_text="Tea Stall",
            note="Snacks",
        )
        Transaction.objects.create(
            user=other_user,
            account=other_account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="999.00",
            reference="BKASH-ABC-001",
            note="Other user matching transaction",
        )

        response = self.client.get(reverse("transaction-list"), {"search": "abc-001"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], str(matched_transaction.id))

    def test_authenticated_user_can_filter_transactions_by_source(self):
        user = get_user_model().objects.create_user(username="himel", password="password")
        other_user = get_user_model().objects.create_user(username="other", password="password")
        self.client.force_authenticate(user)
        account = Account.objects.create(user=user, name="Cash", type=Account.Type.CASH)
        other_account = Account.objects.create(user=other_user, name="Other Cash", type=Account.Type.CASH)
        matched_transaction = Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="250.00",
            source=Transaction.Source.SMS,
        )
        Transaction.objects.create(
            user=user,
            account=account,
            date="2026-05-02",
            type=Transaction.Type.EXPENSE,
            amount="120.00",
            source=Transaction.Source.WEB,
        )
        Transaction.objects.create(
            user=other_user,
            account=other_account,
            date="2026-05-01",
            type=Transaction.Type.EXPENSE,
            amount="999.00",
            source=Transaction.Source.SMS,
        )

        response = self.client.get(reverse("transaction-list"), {"source": "sms"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], str(matched_transaction.id))
