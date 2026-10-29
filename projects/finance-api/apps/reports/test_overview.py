from datetime import timedelta
from unittest.mock import patch
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.credit_cards.models import CreditCardBill
from apps.debts.models import Debt
from apps.recurring_bills.models import RecurringBill
from apps.transactions.models import Transaction

class FinancialOverviewTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="overview-user")
        self.client.force_authenticate(self.user)
    def test_no_data_is_not_zero_verified_spending(self):
        response = self.client.get('/api/reports/overview/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['accounts'], [])
        self.assertEqual(response.data['transaction_count'], 0)
        self.assertEqual(response.data['currencies'], [])
    def test_currency_isolation_liabilities_and_commitments_are_not_added_twice(self):
        today = timezone.localdate()
        bank = Account.objects.create(user=self.user, name="Bank", type="bank", starting_balance=1000)
        card = Account.objects.create(user=self.user, name="Card", type="credit_card")
        Account.objects.create(user=self.user, name="USD", type="cash", currency="USD", starting_balance=10)
        Transaction.objects.create(user=self.user, account=card, date=today, type="expense", direction="debit", amount=100)
        CreditCardBill.objects.create(user=self.user, account=card, statement_balance=150, remaining_balance=150, statement_date=today, due_date=today + timedelta(days=4))
        Debt.objects.create(user=self.user, counterparty_name="Example", direction="lent_by_me", principal_amount=200, current_balance=200, opened_at=today)
        RecurringBill.objects.create(user=self.user, account=bank, name="Weekly", amount=10, frequency="weekly", next_due_date=today)
        other = get_user_model().objects.create_user(username="foreign-overview")
        Account.objects.create(user=other, name="Private", type="cash", starting_balance=9999)
        payload = self.client.get('/api/reports/overview/').data
        bdt = next(row for row in payload['currencies'] if row['currency'] == 'BDT')
        usd = next(row for row in payload['currencies'] if row['currency'] == 'USD')
        self.assertEqual(bdt['account_balance'], '900.00')
        self.assertEqual(bdt['card_liability'], '100.00')
        self.assertEqual(bdt['receivable'], '200.00')
        self.assertEqual(usd['account_balance'], '10.00')
        self.assertEqual(sum(row['kind'] == 'recurring' for row in payload['upcoming']), 5)
        self.assertEqual(next(row for row in payload['upcoming'] if row['kind'] == 'card')['amount'], '150.00')
        self.assertTrue(all(row['last_check'] is None for row in payload['coverage']))
        self.assertEqual(len(payload['accounts']), 3)

    def test_overdue_schedule_still_exposes_future_occurrences_without_old_backlog(self):
        today = timezone.localdate()
        bank = Account.objects.create(user=self.user, name="Schedule bank", type="bank")
        RecurringBill.objects.create(user=self.user, account=bank, name="Old weekly", amount=10, frequency="weekly", next_due_date=today - timedelta(days=60))
        rows = self.client.get('/api/reports/overview/').data['upcoming']
        self.assertEqual(sum(row['date'] < today.isoformat() for row in rows), 1)
        self.assertTrue(any(row['date'] >= today.isoformat() for row in rows))
        self.assertTrue(all(row['date'] <= (today + timedelta(days=30)).isoformat() for row in rows))
