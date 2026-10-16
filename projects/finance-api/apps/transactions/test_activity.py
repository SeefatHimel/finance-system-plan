"""Timeline pagination uses synthetic, user-owned records only."""
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction


class TransactionActivityTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="activity-demo")
        self.other = get_user_model().objects.create_user(username="activity-other")
        self.bank = Account.objects.create(user=self.user, name="Demo bank", type="bank")
        self.wallet = Account.objects.create(user=self.user, name="Demo wallet", type="mobile_wallet")
        self.category = Category.objects.create(user=self.user, name="Demo food", kind="expense")
        for day in range(1, 32):
            Transaction.objects.create(user=self.user, account=self.bank, category=self.category,
                                       date=f"2026-10-{day:02}", type="expense", direction="debit",
                                       amount="25.00", counterparty_text="Demo Cafe")
        foreign = Account.objects.create(user=self.other, name="Other bank", type="bank")
        Transaction.objects.create(user=self.other, account=foreign, date="2026-10-31",
                                   type="expense", amount="99.00", direction="debit")
        self.url = reverse("transaction-activity")
        self.client.force_authenticate(self.user)

    def test_pages_are_bounded_and_cover_owned_history_without_duplicates(self):
        first = self.client.get(self.url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first["Cache-Control"], "private, no-store")
        self.assertEqual(first.data["count"], 31)
        self.assertEqual(len(first.data["results"]), 25)
        self.assertEqual(first.data["results"][0]["date"], "2026-10-31")
        second = self.client.get(self.url, {"offset": first.data["next_offset"]})
        self.assertEqual(len(second.data["results"]), 6)
        self.assertIsNone(second.data["next_offset"])
        ids = [row["id"] for row in first.data["results"] + second.data["results"]]
        self.assertEqual(len(set(ids)), 31)
        self.assertEqual(len(self.client.get(reverse("transaction-list")).data), 31)

    def test_filters_search_and_receiving_transfer_perspective(self):
        transfer = Transaction.objects.create(user=self.user, account=self.bank, transfer_account=self.wallet,
                                              date="2026-10-20", type="transfer", amount="100.00", direction="debit")
        result = self.client.get(self.url, {"account": str(self.wallet.id), "direction": "credit"})
        self.assertEqual(result.data["count"], 1)
        self.assertEqual(result.data["results"][0]["id"], str(transfer.id))
        self.assertEqual(result.data["results"][0]["account_direction"], "credit")
        result = self.client.get(self.url, {"category": str(self.category.id), "search": "Demo Cafe",
                                           "start_date": "2026-10-02", "end_date": "2026-10-04"})
        self.assertEqual(result.data["count"], 3)
        self.assertEqual(self.client.get(self.url, {"search": "no such merchant"}).data["count"], 0)

    def test_bad_paging_and_date_inputs_are_rejected(self):
        for query in ({"limit": 0}, {"limit": 101}, {"limit": "bad"}, {"offset": -1},
                      {"offset": "bad"}, {"offset": "999999999999999999999"}, {"account": "bad"}, {"category": "bad"},
                      {"ordering": "amount"}, {"start_date": "2026-10-01"}):
            with self.subTest(query=query):
                self.assertEqual(self.client.get(self.url, query).status_code, 400)

    def test_authentication_required_and_empty_page_is_well_formed(self):
        result = self.client.get(self.url, {"offset": 100})
        self.assertEqual(result.data, {"count": 31, "next_offset": None, "results": []})
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)
