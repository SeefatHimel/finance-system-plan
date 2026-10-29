import uuid
from datetime import date
from decimal import Decimal
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.credit_cards.models import CreditCardBill
from apps.debts.models import Debt
from apps.recurring_bills.models import RecurringBill
from .models import Transaction

class PlanningPaymentTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="planning-user")
        self.other = get_user_model().objects.create_user(username="other-planning-user")
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(user=self.user, name="Bank", type="bank")
        self.card = Account.objects.create(user=self.user, name="Card", type="credit_card")
        self.debt = Debt.objects.create(user=self.user, counterparty_name="Example", direction="lent_by_me", principal_amount=100, current_balance=100, opened_at="2026-01-01")
        self.bill = CreditCardBill.objects.create(user=self.user, account=self.card, statement_balance=100, remaining_balance=100, statement_date="2026-01-01", due_date="2026-02-01")
        self.recurring = RecurringBill.objects.create(user=self.user, account=self.bank, name="Internet", amount=100, next_due_date="2026-02-01")

    def pay(self, kind="debt", parent=None, **overrides):
        parent = parent or {"debt": self.debt, "card": self.bill, "recurring": self.recurring}[kind]
        prefix = {"debt": "debts", "card": "credit-card-bills", "recurring": "recurring-bills"}[kind]
        data = {"amount": "100.00", "paid_at": "2026-02-01", "note": "", "request_id": str(uuid.uuid4()), "ledger_action": "create", "funding_account": str(self.bank.pk), **overrides}
        return self.client.post(f"/api/{prefix}/{parent.pk}/payments/", data, format="json"), data

    def test_debt_create_final_retry_and_changed_retry(self):
        response, data = self.pay()
        self.assertEqual(response.status_code, 201, response.data)
        movement = Transaction.objects.get()
        self.assertEqual(movement.type, "repayment_received")
        self.assertIsNone(movement.time)
        self.debt.refresh_from_db()
        self.assertEqual(self.debt.current_balance, Decimal("0"))
        response, _ = self.pay(**data)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        response, _ = self.pay(**{**data, "amount": "50"})
        self.assertEqual(response.status_code, 400)

    def test_card_creates_transfer_and_protects_edit_delete(self):
        response, _ = self.pay("card")
        self.assertEqual(response.status_code, 201, response.data)
        movement = Transaction.objects.get()
        self.assertEqual(movement.type, "transfer")
        self.assertEqual(movement.transfer_account, self.card)
        self.assertEqual(self.client.patch(f"/api/transactions/{movement.pk}/", {"amount": "90"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/transactions/{movement.pk}/").status_code, 400)

    def test_link_and_unlink_keeps_movement_restores_balance(self):
        existing = Transaction.objects.create(user=self.user, account=self.bank, type="repayment_received", direction="credit", amount=100, date="2026-02-01")
        response, _ = self.pay(ledger_action="link", transaction=str(existing.pk))
        self.assertEqual(response.status_code, 201, response.data)
        options = self.client.get(f"/api/planning-payments/debt/{self.debt.pk}/")
        self.assertEqual(options.data["eligible_count"], 0)
        response = self.client.delete(f"/api/planning-payments/debt/{self.debt.pk}/{response.data['id']}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Transaction.objects.filter(pk=existing.pk).exists())
        self.debt.refresh_from_db()
        self.assertEqual(self.debt.current_balance, Decimal("100"))
        self.assertEqual(self.debt.status, "open")

    def test_recurring_retry_and_unlink_restores_schedule(self):
        response, data = self.pay("recurring")
        self.assertEqual(response.status_code, 201, response.data)
        payment_id = response.data["id"]
        response, _ = self.pay("recurring", **data)
        self.assertEqual(response.status_code, 201, response.data)
        self.recurring.refresh_from_db()
        self.assertEqual(self.recurring.next_due_date, date(2026, 3, 1))
        response = self.client.delete(f"/api/planning-payments/recurring/{self.recurring.pk}/{payment_id}/")
        self.assertEqual(response.status_code, 200)
        self.recurring.refresh_from_db()
        self.assertEqual(self.recurring.next_due_date, date(2026, 2, 1))
        self.assertEqual(Transaction.objects.count(), 1)

    def test_rejects_overpayment_wrong_movement_and_foreign_account(self):
        response, _ = self.pay(amount="101")
        self.assertEqual(response.status_code, 400)
        wrong = Transaction.objects.create(user=self.user, account=self.bank, type="repayment_paid", direction="debit", amount=100, date="2026-02-01")
        response, _ = self.pay(ledger_action="link", transaction=str(wrong.pk))
        self.assertEqual(response.status_code, 400)
        foreign = Account.objects.create(user=self.other, name="Foreign", type="bank")
        response, _ = self.pay(funding_account=str(foreign.pk))
        self.assertEqual(response.status_code, 400)
        self.debt.refresh_from_db()
        self.assertEqual(self.debt.current_balance, Decimal("100"))
        self.assertEqual(self.client.get(f"/api/planning-payments/debt/{uuid.uuid4()}/").status_code, 404)

    def test_record_only_creates_no_movement(self):
        response, _ = self.pay(ledger_action="record_only")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data["transaction"])
        self.assertFalse(Transaction.objects.exists())

from concurrent.futures import ThreadPoolExecutor
from unittest import skipUnless
from django.db import connection, connections, close_old_connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

@skipUnless(connection.vendor == "postgresql", "Row-lock concurrency requires PostgreSQL")
class PlanningPaymentConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.client = APIClient()
        PlanningPaymentTests.setUp(self)
    def run_parallel(self, data):
        def post(payload):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(get_user_model().objects.get(pk=self.user.pk))
            try:
                return client.post(f"/api/debts/{self.debt.pk}/payments/", payload, format="json").status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(post, data))
    def test_same_request_creates_one_movement_and_one_payment(self):
        payload = {"amount": "100", "paid_at": "2026-02-01", "request_id": str(uuid.uuid4()), "ledger_action": "create", "funding_account": str(self.bank.pk)}
        self.assertEqual(self.run_parallel([payload, payload]), [201, 201])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(self.debt.payments.count(), 1)
    def test_different_requests_cannot_overpay_the_same_debt(self):
        base = {"amount": "60", "paid_at": "2026-02-01", "ledger_action": "create", "funding_account": str(self.bank.pk)}
        statuses = self.run_parallel([{**base, "request_id": str(uuid.uuid4())}, {**base, "request_id": str(uuid.uuid4())}])
        self.assertEqual(sorted(statuses), [201, 400])
        self.debt.refresh_from_db()
        self.assertEqual(self.debt.current_balance, Decimal("40"))
        self.assertEqual(Transaction.objects.count(), 1)
