"""Synthetic review choices must never create money or overwrite another account."""

from decimal import Decimal

from django.urls import reverse
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import ParsedMessageCandidate, SenderRule
from apps.transactions.balance_reports import reported_values
from apps.transactions.models import Transaction, TransferEvidence
from apps.transactions.services import calculate_expected_balance

from . import test_imports as fixtures


class StatementBalanceChoiceTests(APITestCase):
    setUp = fixtures.SavedStatementTests.setUp
    upload = fixtures.SavedStatementTests.upload
    decide = fixtures.SavedStatementTests.decide
    ledger_purchase = fixtures.SavedStatementTests.ledger_purchase

    def choice(self, keep="statement", existing="949.93", incoming="950.00"):
        return {
            "keep": keep,
            "existing_balance_after": existing,
            "statement_balance_after": incoming,
        }

    def conflict(self):
        record = self.ledger_purchase(balance_after="949.93")
        row = self.upload().rows.first()
        return row, record

    def test_acknowledgement_without_balance_choice_cannot_link(self):
        row, record = self.conflict()
        response = self.decide(
            row, "link", transaction=str(record.id), acknowledge_conflict=True
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("balance_choice", response.data)
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_each_choice_counts_once_and_preserves_draft_source_and_audit_values(self):
        for keep, expected in (("existing", "949.93"), ("statement", "950.00")):
            with self.subTest(keep=keep):
                row, record = self.conflict()
                source = row.extracted
                before = calculate_expected_balance(account=self.bank)
                count = Transaction.objects.count()
                response = self.decide(
                    row,
                    "link",
                    transaction=str(record.id),
                    balance_choice=self.choice(keep),
                )
                self.assertEqual(response.status_code, 200, response.data)
                record.refresh_from_db()
                row.refresh_from_db()
                self.assertEqual(record.balance_after, Decimal(expected))
                account_detail = self.client.get(
                    reverse("account-detail", args=[self.bank.id])
                ).data
                self.assertEqual(account_detail["latest_reported_balance"], expected)
                self.assertEqual(row.balance_after, Decimal("950.00"))
                self.assertEqual(row.extracted, source)
                self.assertEqual(record.note, "My corrected note")
                self.assertEqual(record.category, self.category)
                self.assertEqual(record.source, "sms")
                self.assertEqual(record.reference, "REUSED")
                self.assertEqual(record.amount, Decimal("50.00"))
                self.assertEqual(Transaction.objects.count(), count)
                self.assertEqual(calculate_expected_balance(account=self.bank), before)
                audit = AuditLogEntry.objects.get(
                    entity_id=str(record.id), metadata__statement_row=str(row.id)
                )
                self.assertEqual(audit.before["balance_after"], "949.93")
                self.assertEqual(audit.after["balance_after"], expected)
                self.assertEqual(audit.metadata["balance_resolution"]["keep"], keep)
                self.assertEqual(
                    audit.metadata["balance_resolution"]["statement_balance_after"],
                    "950.00",
                )
                # Same row/version retries cannot replay a different balance choice.
                retry = self.decide(
                    row,
                    "link",
                    transaction=str(record.id),
                    balance_choice=self.choice("existing"),
                )
                self.assertEqual(retry.status_code, 200, retry.data)
                record.refresh_from_db()
                self.assertEqual(record.balance_after, Decimal(expected))
                self.assertEqual(self.decide(row, "unlink").status_code, 200)
                record.refresh_from_db()
                self.assertEqual(record.balance_after, Decimal(expected))
                # Remove test-only fixtures between independent choices.
                row.batch.delete()
                record.delete()

    def test_changed_ledger_or_statement_values_are_rejected_atomically(self):
        row, record = self.conflict()
        Transaction.objects.filter(pk=record.pk).update(balance_after="949.94")
        response = self.decide(
            row, "link", transaction=str(record.id), balance_choice=self.choice()
        )
        self.assertEqual(response.status_code, 409, response.data)
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)
        record.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("949.94"))
        response = self.decide(
            row,
            "link",
            transaction=str(record.id),
            balance_choice=self.choice(existing="949.94", incoming="951.00"),
        )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(
            AuditLogEntry.objects.filter(entity_id=str(record.id)).exists()
        )

    def test_invalid_choices_and_unrelated_actions_are_rejected(self):
        row, record = self.conflict()
        for payload in (
            self.choice("unknown"),
            {"keep": "statement"},
            self.choice(existing="bad"),
        ):
            response = self.decide(
                row, "link", transaction=str(record.id), balance_choice=payload
            )
            self.assertEqual(response.status_code, 400, response.data)
        for action in ("create", "skip"):
            self.assertEqual(
                self.decide(row, action, balance_choice=self.choice()).status_code, 400
            )
        other_user = type(self.user).objects.create_user(
            username="synthetic-balance-other"
        )
        self.client.force_authenticate(other_user)
        self.assertEqual(
            self.decide(
                row, "link", transaction=str(record.id), balance_choice=self.choice()
            ).status_code,
            404,
        )

    def test_zero_is_a_reported_balance_not_missing(self):
        row, record = self.conflict()
        Transaction.objects.filter(pk=record.pk).update(balance_after="0.00")
        response = self.decide(
            row,
            "link",
            transaction=str(record.id),
            balance_choice=self.choice("existing", existing="0.00"),
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal(0))

    def test_receiving_transfer_choice_preserves_sender_and_source_observations(self):
        for keep, expected in (("existing", "999.93"), ("statement", "1000.00")):
            with self.subTest(keep=keep):
                row = self.upload().rows.get(direction="credit")
                record = self.ledger_purchase(
                    type="transfer",
                    account=self.wallet,
                    transfer_account=self.bank,
                    balance_after="42.00",
                    external_key="synthetic-source",
                )
                TransferEvidence.objects.create(
                    user=self.user,
                    transaction=record,
                    account=self.wallet,
                    direction="debit",
                    date=record.date,
                    source="sms",
                    balance_after="42.00",
                    external_key="synthetic-source",
                )
                observation = TransferEvidence.objects.create(
                    user=self.user,
                    transaction=record,
                    account=self.bank,
                    direction="credit",
                    date=record.date,
                    source="sms",
                    balance_after="999.93",
                )
                response = self.decide(
                    row,
                    "link",
                    transaction=str(record.id),
                    balance_choice=self.choice(
                        keep, existing="999.93", incoming="1000.00"
                    ),
                )
                self.assertEqual(response.status_code, 200, response.data)
                record.refresh_from_db()
                observation.refresh_from_db()
                self.assertEqual(record.balance_after, Decimal("42.00"))
                self.assertEqual(observation.balance_after, Decimal("999.93"))
                statement_evidence = record.transfer_evidence.get(
                    external_key=f"statement-row:{row.pk}"
                )
                self.assertEqual(statement_evidence.balance_after, Decimal("1000.00"))
                self.assertEqual(
                    reported_values(record)[self.wallet.id], Decimal("42.00")
                )
                self.assertEqual(
                    reported_values(record)[self.bank.id], Decimal(expected)
                )
                self.assertEqual(Transaction.objects.count(), 1)
                row.refresh_from_db()
                self.assertEqual(self.decide(row, "unlink").status_code, 200)
                record.refresh_from_db()
                self.assertEqual(
                    reported_values(record)[self.bank.id], Decimal(expected)
                )
                observation.refresh_from_db()
                self.assertEqual(observation.balance_after, Decimal("999.93"))
                self.assertFalse(
                    record.transfer_evidence.filter(
                        external_key=f"statement-row:{row.pk}"
                    ).exists()
                )
                row.batch.delete()
                record.delete()

    def test_primary_receiving_report_changes_only_its_own_account(self):
        row = self.upload().rows.get(direction="credit")
        record = self.ledger_purchase(
            type="transfer",
            account=self.wallet,
            transfer_account=self.bank,
            balance_after="999.93",
            external_key="synthetic-receiving",
        )
        sender = TransferEvidence.objects.create(
            user=self.user,
            transaction=record,
            account=self.wallet,
            direction="debit",
            date=record.date,
            source="sms",
            balance_after="42.00",
            external_key="synthetic-sender",
        )
        receiver = TransferEvidence.objects.create(
            user=self.user,
            transaction=record,
            account=self.bank,
            direction="credit",
            date=record.date,
            source="sms",
            balance_after="999.93",
            external_key="synthetic-receiving",
        )
        response = self.decide(
            row,
            "link",
            transaction=str(record.id),
            balance_choice=self.choice(existing="999.93", incoming="1000.00"),
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        sender.refresh_from_db()
        receiver.refresh_from_db()
        self.assertEqual(record.balance_after, Decimal("1000.00"))
        self.assertEqual(sender.balance_after, Decimal("42.00"))
        self.assertEqual(receiver.balance_after, Decimal("999.93"))
        self.assertEqual(reported_values(record)[self.wallet.id], Decimal("42.00"))
        row.refresh_from_db()
        self.assertEqual(self.decide(row, "unlink").status_code, 200)
        record.refresh_from_db()
        self.assertEqual(reported_values(record)[self.bank.id], Decimal("1000.00"))

    def test_mobile_rescan_cannot_overwrite_chosen_statement_balance(self):
        SenderRule.objects.create(
            user=self.user,
            account=self.bank,
            name="Synthetic bank sender",
            provider="city_bank",
            sender="CITYBANK",
        )
        payload = {
            "sender": "CITYBANK",
            "body": "02-Jan-2026 Tk. 50 Withdrawal Tk. 949.93 Balance",
            "received_at": "2026-01-02T12:00:00+06:00",
            "device_message_id": "synthetic-balance-rescan",
        }
        first = self.client.post(reverse("raw-message-import"), payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        candidate = ParsedMessageCandidate.objects.get(id=first.data["candidate"]["id"])
        record = self.ledger_purchase(
            balance_after="949.93", raw_message=candidate.raw_message
        )
        candidate.status = "confirmed"
        candidate.transaction = record
        candidate.balance_after = Decimal("949.93")
        candidate.save()
        row = self.upload().rows.first()
        response = self.decide(
            row, "link", transaction=str(record.id), balance_choice=self.choice()
        )
        self.assertEqual(response.status_code, 200, response.data)
        for reprocess in (False, True):
            rescan = self.client.post(
                reverse("raw-message-import"),
                {**payload, "reprocess_existing": reprocess},
                format="json",
            )
            self.assertEqual(rescan.status_code, 200, rescan.data)
            self.assertTrue(rescan.data["is_duplicate"])
            self.assertFalse(rescan.data["was_reprocessed"])
            record.refresh_from_db()
            candidate.refresh_from_db()
            self.assertEqual(record.balance_after, Decimal("950.00"))
            self.assertEqual(candidate.balance_after, Decimal("949.93"))
            self.assertEqual(candidate.transaction_id, record.pk)
        self.assertEqual(Transaction.objects.count(), 1)
