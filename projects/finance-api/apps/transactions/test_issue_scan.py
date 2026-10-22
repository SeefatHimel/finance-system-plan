from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.categories.models import Category
from apps.messages.models import ParsedMessageCandidate, RawMessage, SenderRule, SenderRuleMapping
from apps.messages.parsers import parse_raw_message
from apps.payment_methods.models import PaymentMethod
from apps.statements.models import StatementImport, StatementRow

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

    def refresh_directions(self, **params):
        return self.client.post(reverse("transaction-refresh-evidence-directions"), params)

    def test_refresh_recovers_legacy_sms_direction_then_check_finds_conflict(self):
        message = self.message("Tk. 100 purchase at SAMPLE SHOP. Balance Tk. 900")
        record = Transaction.objects.create(
            user=self.user, account=self.city, raw_message=message,
            date="2026-09-30", type="income", direction="credit", amount="100.00",
        )
        candidate = ParsedMessageCandidate.objects.create(
            user=self.user, raw_message=message, transaction=record, account=self.city,
            status="confirmed", message_kind="unknown", transaction_type="income",
            amount="100.00", source_direction="",
        )
        response = self.refresh_directions(limit=50, offset=0)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response.data["sms_updated"], 1)
        candidate.refresh_from_db()
        self.assertEqual(candidate.source_direction, "debit")
        self.assertEqual(self.refresh_directions().data["sms_updated"], 0)
        self.assertIn("sms_source_direction_mismatch", {
            issue["code"] for issue in self.scan().data["results"][0]["issues"]
        })
        record.refresh_from_db()
        self.assertEqual(record.direction, "credit")

    def test_refresh_keeps_ambiguous_redacted_sms_and_statement_originals(self):
        message = self.message("Tk. 100 was processed")
        message.status = RawMessage.Status.REDACTED
        message.save(update_fields=("status",))
        candidate = ParsedMessageCandidate.objects.create(
            user=self.user, raw_message=message, account=self.city,
            message_kind="unknown", transaction_type="expense", source_direction="",
        )
        batch = StatementImport.objects.create(
            user=self.user, account=self.city, file_digest="refresh-evidence-test",
            profile="bkash", parser_version="test", currency="BDT",
            account_identity="synthetic", page_count=1,
        )
        known = StatementRow.objects.create(
            batch=batch, position=1, component="principal", source_fingerprint="known",
            extracted={"direction": "debit"}, direction="credit", type="income",
        )
        StatementRow.objects.create(
            batch=batch, position=2, component="principal", source_fingerprint="missing",
            extracted={"description": "synthetic legacy row"}, direction="debit", type="expense",
        )
        response = self.refresh_directions()
        self.assertEqual(response.data["sms_unknown"], 1)
        self.assertEqual(response.data["statement_known"], 1)
        self.assertEqual(response.data["statement_unknown"], 1)
        candidate.refresh_from_db()
        known.refresh_from_db()
        self.assertEqual(candidate.source_direction, "")
        self.assertEqual(known.extracted["direction"], "debit")
        self.assertEqual(known.direction, "credit")

    def test_refresh_is_user_scoped_and_requires_authentication(self):
        stranger = get_user_model().objects.create_user(username="refresh-stranger")
        message = RawMessage.objects.create(
            user=stranger, sender="CITYBANK", body="Tk. 100 purchase at SAMPLE SHOP",
            body_hash=str(uuid4()), received_at=timezone.now(),
        )
        candidate = ParsedMessageCandidate.objects.create(
            user=stranger, raw_message=message, message_kind="card_purchase",
            transaction_type="expense", source_direction="",
        )
        self.assertEqual(self.refresh_directions().data["sms_total"], 0)
        candidate.refresh_from_db()
        self.assertEqual(candidate.source_direction, "")
        self.client.force_authenticate(user=None)
        self.assertEqual(self.refresh_directions().status_code, 401)

    def test_refresh_pages_existing_candidates_without_reprocessing_prior_page(self):
        for amount in ("100", "200"):
            message = self.message(f"Tk. {amount} purchase at SAMPLE SHOP")
            ParsedMessageCandidate.objects.create(
                user=self.user, raw_message=message, account=self.city,
                message_kind="card_purchase", transaction_type="expense",
                source_direction="",
            )
        first = self.refresh_directions(limit=1, offset=0)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data["sms_scanned"], 1)
        self.assertEqual(first.data["sms_total"], 2)
        self.assertEqual(first.data["sms_updated"], 1)
        self.assertEqual(first.data["next_offset"], 1)
        second = self.refresh_directions(limit=1, offset=first.data["next_offset"])
        self.assertEqual(second.data["sms_updated"], 1)
        self.assertIsNone(second.data["next_offset"])
        self.assertEqual(set(ParsedMessageCandidate.objects.values_list("source_direction", flat=True)), {"debit"})

    def test_refresh_never_overwrites_a_previously_saved_source_direction(self):
        message = self.message("Tk. 100 purchase at SAMPLE SHOP")
        candidate = ParsedMessageCandidate.objects.create(
            user=self.user, raw_message=message, account=self.city,
            message_kind="card_purchase", transaction_type="expense",
            source_direction="credit",
        )
        response = self.refresh_directions()
        self.assertEqual(response.data["sms_updated"], 0)
        self.assertEqual(response.data["sms_known"], 1)
        candidate.refresh_from_db()
        self.assertEqual(candidate.source_direction, "credit")

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

    def test_scan_compares_original_statement_and_saved_draft_separately(self):
        record = Transaction.objects.create(
            user=self.user, account=self.city, date="2026-09-30",
            type="income", direction="credit", amount="100.00",
        )
        batch = StatementImport.objects.create(
            user=self.user, account=self.city, file_digest="synthetic-digest",
            profile="bkash", parser_version="test", currency="BDT",
            account_identity="synthetic", page_count=1,
        )
        row = StatementRow.objects.create(
            batch=batch, position=1, component="principal", source_fingerprint="synthetic",
            extracted={"direction": "debit"}, direction="credit", amount="100.00",
            type="income", state="posted", transaction=record,
        )
        codes = {issue["code"] for issue in self.scan().data["results"][0]["issues"]}
        self.assertIn("statement_source_direction_mismatch", codes)
        self.assertNotIn("statement_draft_direction_mismatch", codes)
        row.extracted = {"direction": "credit"}
        row.direction = "debit"
        row.save(update_fields=("extracted", "direction"))
        codes = {issue["code"] for issue in self.scan().data["results"][0]["issues"]}
        self.assertIn("statement_draft_direction_mismatch", codes)
        self.assertNotIn("statement_source_direction_mismatch", codes)

    def test_scan_checks_saved_sms_direction_after_ledger_edit(self):
        message = self.message("Tk. 100 purchase at SAMPLE SHOP. Balance Tk. 900")
        record = Transaction.objects.create(
            user=self.user, account=self.city, raw_message=message,
            date="2026-09-30", type="income", direction="credit", amount="100.00",
        )
        ParsedMessageCandidate.objects.create(
            user=self.user, raw_message=message, transaction=record,
            account=self.city, amount="100.00", status="confirmed",
            message_kind="card_purchase", transaction_type="income",
            source_direction="debit",
        )
        codes = {issue["code"] for issue in self.scan().data["results"][0]["issues"]}
        self.assertIn("sms_source_direction_mismatch", codes)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_fee_row_uses_its_own_direction_not_the_principal_pdf_direction(self):
        record = Transaction.objects.create(
            user=self.user, account=self.city, date="2026-09-30",
            type="fee", direction="debit", amount="5.00",
        )
        batch = StatementImport.objects.create(
            user=self.user, account=self.city, file_digest="fee-digest",
            profile="bkash", parser_version="test", currency="BDT",
            account_identity="synthetic", page_count=1,
        )
        StatementRow.objects.create(
            batch=batch, position=1, component="fee", source_fingerprint="fee-row",
            extracted={"direction": "credit", "signed_fee": "-5.00"},
            direction="debit", amount="5.00", type="fee", state="posted", transaction=record,
        )
        self.assertEqual(self.scan().data["results"], [])

    def test_sms_direction_is_captured_before_a_learned_type_override(self):
        rule = SenderRule.objects.create(
            user=self.user, account=self.city, name="City alerts",
            provider="city_bank", sender="CITYBANK",
        )
        SenderRuleMapping.objects.create(
            user=self.user, sender_rule=rule, message_kind="card_purchase",
            account=self.city, transaction_type="income",
        )
        parsed = parse_raw_message(self.message("Tk. 100 purchase at SAMPLE SHOP. Balance Tk. 900"))
        self.assertEqual(parsed["message_kind"], "card_purchase")
        self.assertEqual(parsed["transaction_type"], "income")
        self.assertEqual(parsed["source_direction"], "debit")

    def test_unattributed_transfer_sms_does_not_claim_the_wrong_bank(self):
        message = self.message("Tk. 100 Deposit. Balance Tk. 900. A/C: 1234***5678")
        Transaction.objects.create(
            user=self.user, account=self.other, transfer_account=self.city,
            raw_message=message, date="2026-09-30", type="transfer",
            direction="debit", amount="100.00",
        )
        self.assertEqual(self.scan().data["results"], [])
