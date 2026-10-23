from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Account
from apps.messages.models import RawMessage, SenderRule, SenderRuleMapping
from apps.messages.parsers import classify_message_kind_for_capture, parse_raw_message


class CashWithdrawalParsingTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="cash-withdrawal-test")
        self.bank = Account.objects.create(user=self.user, name="Demo bank", type=Account.Type.BANK)
        self.rule = SenderRule.objects.create(
            user=self.user, account=self.bank, name="Demo bank sender",
            sender="DEMO-EBL", provider=SenderRule.Provider.EBL,
        )

    def parse(self, body="Cash WD BDT125 from Demo ATM. Your A/C 000**1234 Balance BDT 875."):
        return parse_raw_message(RawMessage(
            user=self.user, sender="DEMO-EBL", body=body, received_at=timezone.now(),
        ))

    def test_one_cash_account_prefills_debit_transfer(self):
        cash = Account.objects.create(user=self.user, name="Home cash", type=Account.Type.HOME_CASH)
        parsed = self.parse()
        self.assertEqual(parsed["message_kind"], "cash_out")
        self.assertEqual(parsed["source_direction"], "debit")
        self.assertEqual(parsed["transaction_type"], "transfer")
        self.assertEqual(parsed["account"], self.bank)
        self.assertEqual(parsed["destination_account"], cash)
        self.assertEqual(parsed["suggested_transfer_direction"], "debit")
        self.assertIn("Only one active cash account", parsed["transfer_suggestion_reason"])

    def test_multiple_cash_accounts_require_destination_choice(self):
        Account.objects.create(user=self.user, name="Wallet cash", type=Account.Type.CASH)
        Account.objects.create(user=self.user, name="Home cash", type=Account.Type.HOME_CASH)
        parsed = self.parse()
        self.assertEqual(parsed["transaction_type"], "transfer")
        self.assertIsNone(parsed["destination_account"])
        self.assertIn("Several cash accounts", parsed["transfer_suggestion_reason"])

    def test_no_eligible_cash_account_keeps_transfer_for_review(self):
        Account.objects.create(user=self.user, name="Inactive cash", type=Account.Type.CASH, is_active=False)
        Account.objects.create(user=self.user, name="Foreign cash", type=Account.Type.CASH, currency="USD")
        other = get_user_model().objects.create_user(username="another-cash-user")
        Account.objects.create(user=other, name="Other person's cash", type=Account.Type.CASH)
        parsed = self.parse()
        self.assertEqual(parsed["transaction_type"], "transfer")
        self.assertIsNone(parsed["destination_account"])
        self.assertIn("No cash account", parsed["transfer_suggestion_reason"])

    def test_old_learned_expense_does_not_override_cash_withdrawal_default(self):
        SenderRuleMapping.objects.create(
            user=self.user, sender_rule=self.rule, message_kind="cash_out",
            account=self.bank, transaction_type="expense",
        )
        parsed = self.parse()
        self.assertEqual(parsed["transaction_type"], "transfer")

    def test_cash_wd_variants_are_activity_not_balance_notices(self):
        for wording in ("Cash WD", "Cash W/D", "cash-wd", "ATM withdrawal", "ATM withdrawal BDT125 fee BDT0"):
            body = f"{wording} BDT125 from Demo ATM. Balance BDT 875."
            with self.subTest(wording=wording):
                self.assertEqual(classify_message_kind_for_capture(body), "")
                self.assertEqual(self.parse(body)["message_kind"], "cash_out")

    def test_cashback_is_not_withdrawal(self):
        self.assertNotEqual(self.parse("Cashback BDT40. Balance BDT 704000.")["message_kind"], "cash_out")
