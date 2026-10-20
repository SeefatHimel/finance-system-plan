from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.categories.models import Category
from apps.messages.models import RawMessage, SenderRule, SenderRuleMapping
from apps.payment_methods.models import PaymentMethod

from .models import Transaction, TransferEvidence


class TransactionIssueScanTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="scan-user")
        self.client.force_authenticate(self.user)
        self.city = Account.objects.create(user=self.user, name="City Bank", type="bank")
        self.other = Account.objects.create(user=self.user, name="EBL", type="bank")
        PaymentMethod.objects.create(user=self.user, account=self.other, name="Other bank", provider="ebl")
        self.category = Category.objects.create(user=self.user, name="Investment profit", kind="income")

    def message(self, body, sender="CITYBANK"):
        return RawMessage.objects.create(
            user=self.user, sender=sender, body=body,
            body_hash=str(uuid4()), received_at=timezone.now(),
        )

    def scan(self, **params):
        return self.client.get(reverse("transaction-issues"), params)

    def test_scan_flags_bank_conflict_and_unsupported_deposit_details_without_writing(self):
        message = self.message("Tk. 5,313 Deposit\nTk. 72,488 Balance\nA/C: 1234***5678")
        record = Transaction.objects.create(
            user=self.user, account=self.other, category=self.category,
            raw_message=message, date="2026-09-30", type="income", direction="credit",
            amount="5313.00", counterparty_text="Unverified payer", note="Investment profit",
        )
        stamp = record.updated_at
        response = self.scan()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response.data["scanned"], 1)
        issues = response.data["results"][0]["issues"]
        self.assertEqual({issue["code"] for issue in issues}, {
            "bank_account_conflict", "deposit_purpose_unverified",
        })
        self.assertNotIn(message.body, str(response.data))
        record.refresh_from_db()
        self.assertEqual(record.updated_at, stamp)
        self.assertEqual(record.account, self.other)
        self.assertEqual(AuditLogEntry.objects.filter(user=self.user).count(), 0)

    def test_new_learned_category_is_only_a_suggestion_and_other_users_are_excluded(self):
        rule = SenderRule.objects.create(
            user=self.user, account=self.city, name="City alerts",
            provider="city_bank", sender="CITYBANK",
        )
        message = self.message("Tk. 100 purchase at SAMPLE SHOP. Balance Tk. 900. A/C: 1234***5678")
        record = Transaction.objects.create(
            user=self.user, account=self.city, raw_message=message,
            date="2026-09-30", type="expense", direction="debit", amount="100.00",
        )
        self.assertEqual(self.scan().data["results"], [])
        category = Category.objects.create(user=self.user, name="Shopping", kind="expense")
        SenderRuleMapping.objects.create(
            user=self.user, sender_rule=rule, message_kind="card_purchase",
            account=self.city, category=category, transaction_type="expense",
        )
        response = self.scan()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["issues"][0]["code"], "current_category_suggestion")
        record.refresh_from_db()
        self.assertIsNone(record.category)
        stranger = get_user_model().objects.create_user(username="another-scan-user")
        self.client.force_authenticate(stranger)
        self.assertEqual(self.scan().data["total"], 0)

    def test_transfer_sms_is_checked_against_its_reporting_account(self):
        message = self.message("Tk. 100 Deposit. Balance Tk. 900. A/C: 1234***5678")
        record = Transaction.objects.create(
            user=self.user, account=self.other, transfer_account=self.city,
            raw_message=message, date="2026-09-30", type="transfer",
            direction="debit", amount="100.00",
        )
        TransferEvidence.objects.create(
            user=self.user, transaction=record, account=self.city,
            raw_message=message, direction="credit", date=record.date, source="sms",
        )
        response = self.scan()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    def test_scan_rejects_unbounded_requests_and_requires_authentication(self):
        self.assertEqual(self.scan(limit=101).status_code, 400)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.scan().status_code, 401)

    def test_unattributed_transfer_sms_does_not_claim_the_wrong_bank(self):
        message = self.message("Tk. 100 Deposit. Balance Tk. 900. A/C: 1234***5678")
        Transaction.objects.create(
            user=self.user, account=self.other, transfer_account=self.city,
            raw_message=message, date="2026-09-30", type="transfer",
            direction="debit", amount="100.00",
        )
        self.assertEqual(self.scan().data["results"], [])
