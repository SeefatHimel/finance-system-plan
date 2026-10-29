"""Synthetic source facts only; badge metadata must not reparse or move money."""
from copy import deepcopy
from unittest.mock import patch
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APITestCase
from apps.statements import test_transfer_report_accounts as fixtures
from apps.accounts.models import Account
from .models import Transaction


class BalanceProvenanceTests(APITestCase):
    candidate = fixtures.TransferReportAccountTests.candidate

    def setUp(self):
        fixtures.TransferReportAccountTests.setUp(self)

    def metadata(self):
        result = self.client.get(reverse('transaction-detail', args=[self.record.pk]))
        self.assertEqual(result.status_code, 200, result.data)
        return result.data['balance_sources']

    def test_saved_sms_and_original_statement_values_keep_their_accounts(self):
        self.row.state = 'linked'; self.row.transaction = self.record
        self.row.balance_after = '888.00'  # Edited draft is not original evidence.
        self.row.save()
        original = deepcopy(self.row.extracted)
        before = self.record.balance_after
        with patch('apps.messages.parsers.parse_raw_message', side_effect=AssertionError('No parser reads')):
            data = self.metadata()
        self.assertTrue(data['complete'])
        sms = next(item for item in data['observations'] if item['kind'] == 'sms')
        statement = next(item for item in data['observations'] if item['kind'] == 'statement')
        self.assertEqual(sms['account'], str(self.wallet.pk))
        self.assertEqual(sms['balance_after'], '250.00')
        self.assertEqual(sms['time_kind'], 'received')
        self.assertEqual(statement['account'], str(self.account.pk))
        self.assertEqual(statement['balance_after'], original['balance_after'])
        self.assertEqual(statement['date'], original['date'])
        self.assertEqual(statement['time'], original['time'])
        self.assertEqual(statement['time_kind'], 'reported')
        self.assertTrue(sms['usable']); self.assertTrue(statement['usable'])
        self.assertNotIn('body', str(data)); self.assertNotIn('note', str(data))
        self.record.refresh_from_db(); self.row.refresh_from_db()
        self.assertEqual(self.record.balance_after, before)
        self.assertEqual(self.row.extracted, original)

    def test_missing_direction_and_wrong_path_never_become_usable(self):
        self.card_sms.source_direction = ''; self.card_sms.save()
        self.assertFalse(next(item for item in self.metadata()['observations'] if item['kind'] == 'sms')['usable'])
        self.card_sms.source_direction = 'credit'; self.card_sms.destination_account = None
        self.card_sms.account = Account.objects.create(user=self.other_user,name='Foreign synthetic bank',type='bank',currency='BDT'); self.card_sms.save()
        sms = next(item for item in self.metadata()['observations'] if item['kind'] == 'sms')
        self.assertIsNone(sms['account']); self.assertFalse(sms['usable'])

    def test_source_reads_are_batched_and_capped_per_transaction(self):
        url = reverse('transaction-activity')
        with CaptureQueriesContext(connection) as first:
            one = self.client.get(url, {'limit':100})
        self.assertEqual(one.status_code, 200)
        for index in range(8):
            Transaction.objects.create(user=self.user,account=self.account,date='2026-01-02',type='expense',amount='1.00')
        with CaptureQueriesContext(connection) as many:
            result = self.client.get(url, {'limit':100})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(first),len(many),'Adding cards must not add per-card source queries')
        for index in range(21):
            item = self.candidate(kind='bank_transfer_in',source_direction='credit',destination_account=self.wallet,transaction_type='transfer')
            item.status = 'confirmed'; item.transaction = self.record; item.save()
        data = self.metadata()
        self.assertFalse(data['complete']); self.assertEqual(len(data['observations']),20)

    def test_activity_is_owner_scoped_and_read_only(self):
        self.client.force_authenticate(self.other_user)
        response = self.client.get(reverse('transaction-detail',args=[self.record.pk]))
        self.assertEqual(response.status_code,404)

    def test_fee_metadata_uses_the_original_signed_fee_direction(self):
        self.row.component = 'fee'; self.row.state = 'linked'; self.row.transaction = self.record
        self.row.extracted = {**self.row.extracted, 'direction':'credit', 'signed_fee':'-1.00'}
        self.row.save()
        source = next(item for item in self.metadata()['observations'] if item['kind'] == 'statement')
        self.assertEqual(source['direction'], 'debit')

    def test_response_metadata_cannot_be_overridden_by_a_client(self):
        response = self.client.patch(reverse('transaction-detail',args=[self.record.pk]), {
            'note':'Synthetic note only', 'balance_sources':{'observations':[], 'complete':False},
        }, format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertTrue(response.data['balance_sources']['complete'])
        self.assertEqual(len(response.data['balance_sources']['observations']),1)

    def test_statement_posting_moment_never_uses_value_date_or_monthly_header(self):
        self.row.state = 'linked'; self.row.transaction = self.record
        self.row.extracted = {**self.row.extracted, 'posting_date':'2026-01-05',
            'value_date':'2026-01-02', 'statement_date':'2026-01-31'}
        self.row.save()
        source = next(item for item in self.metadata()['observations'] if item['kind'] == 'statement')
        self.assertEqual(source['date'],'2026-01-05')
