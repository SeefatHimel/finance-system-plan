"""Synthetic account balances for one canonical movement."""

from datetime import date, time
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import RawMessage

from .models import Transaction, TransferEvidence
from .services import calculate_account_balance_summaries


class TransferAccountReportTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-two-balances"
        )
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(
            user=self.user,
            name="Synthetic sender",
            type="bank",
            starting_balance="10000.00",
        )
        self.b = Account.objects.create(
            user=self.user,
            name="Synthetic receiver",
            type="bank",
            starting_balance="2000.00",
        )
        self.c = Account.objects.create(
            user=self.user, name="Synthetic other", type="bank"
        )

    def reports(self, a="9000.00", b="3000.00"):
        return [
            {"account": str(self.a.pk), "balance_after": a},
            {"account": str(self.b.pk), "balance_after": b},
        ]

    def create(self, **changes):
        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(self.a.pk),
                "transfer_account": str(self.b.pk),
                "type": "transfer",
                "amount": "1000.00",
                "date": "2026-10-12",
                "reported_balances": self.reports(),
                **changes,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def patch(self, record_id, **changes):
        response = self.client.patch(
            reverse("transaction-detail", kwargs={"pk": record_id}),
            changes,
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_two_balances_on_one_transfer_and_account_histories(self):
        data = self.create()
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(len(data["reported_balances"]), 2)
        summary = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(summary[self.a.pk].ledger_balance, Decimal("9000.00"))
        self.assertEqual(summary[self.b.pk].ledger_balance, Decimal("3000.00"))
        self.assertEqual(summary[self.a.pk].latest_reported_balance, Decimal("9000.00"))
        self.assertEqual(summary[self.b.pk].latest_reported_balance, Decimal("3000.00"))
        for account, direction in ((self.a, "debit"), (self.b, "credit")):
            records = self.client.get(
                reverse("transaction-list"), {"account": str(account.pk)}
            ).data
            self.assertEqual(records[0]["account_direction"], direction)
        report = self.client.get(reverse("monthly-report"), {"month": "2026-10"}).data
        self.assertEqual(Decimal(report["income_total"]), 0)
        self.assertEqual(Decimal(report["expense_total"]), 0)

    def test_incoming_create_preserves_receiver_primary_report(self):
        data = self.create(
            account=str(self.b.pk), transfer_account=str(self.a.pk), direction="credit"
        )
        self.assertEqual(str(data["account"]), str(self.a.pk))
        self.assertEqual(str(data["balance_reporting_account"]), str(self.b.pk))
        self.assertEqual(data["balance_after"], "3000.00")

    def test_reversing_endpoints_preserves_both_reports_and_updates_evidence_direction(
        self,
    ):
        data = self.create()
        changed = self.patch(
            data["id"],
            account=str(self.b.pk),
            transfer_account=str(self.a.pk),
            allow_linked_correction=True,
            reported_balances=self.reports(),
        )
        self.assertEqual(
            {
                row["account"]: row["balance_after"]
                for row in changed["reported_balances"]
            },
            {str(self.a.pk): "9000.00", str(self.b.pk): "3000.00"},
        )
        self.assertEqual(str(changed["balance_reporting_account"]), str(self.a.pk))
        self.assertEqual(changed["balance_after"], "9000.00")
        self.assertEqual(
            {
                str(row["account"]): row["direction"]
                for row in changed["transfer_evidence"]
            },
            {str(self.a.pk): "credit", str(self.b.pk): "debit"},
        )
        self.assertEqual(Transaction.objects.count(), 1)

    def test_incoming_sms_reclassified_as_transfer_keeps_city_like_balance_on_receiver(
        self,
    ):
        raw = RawMessage.objects.create(
            user=self.user,
            sender="DEMO",
            body="Synthetic deposit BDT 1000. Balance BDT 3000.",
            body_hash="synthetic-account-report",
            received_at=timezone.now(),
        )
        record = Transaction.objects.create(
            user=self.user,
            account=self.b,
            raw_message=raw,
            type="income",
            direction="credit",
            date="2026-10-12",
            amount="1000.00",
            balance_after="3000.00",
            source="sms",
        )
        changed = self.patch(
            record.pk,
            type="transfer",
            account=str(self.a.pk),
            transfer_account=str(self.b.pk),
            reported_balances=self.reports(a=None),
        )
        self.assertEqual(changed["balance_after"], "3000.00")
        self.assertEqual(str(changed["balance_reporting_account"]), str(self.b.pk))
        primary = next(row for row in changed["transfer_evidence"] if row["is_primary"])
        self.assertEqual(str(primary["raw_message"]), str(raw.pk))
        self.assertEqual(primary["direction"], "credit")
        self.assertEqual(Transaction.objects.count(), 1)

    def test_secondary_edit_zero_clear_and_retry_do_not_duplicate_observations(self):
        data = self.create()
        changed = self.patch(
            data["id"], reported_balances=self.reports(a="0.00", b=None)
        )
        self.assertEqual(changed["balance_after"], "0.00")
        self.assertEqual(
            {
                row["account"]: row["balance_after"]
                for row in changed["reported_balances"]
            }[str(self.b.pk)],
            None,
        )
        self.patch(data["id"], reported_balances=self.reports(a="0.00", b=None))
        self.assertEqual(TransferEvidence.objects.count(), 2)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertTrue(AuditLogEntry.objects.filter(action="updated").exists())

    def test_transfer_edits_preserve_captured_sms_and_statement_reports(self):
        raw = RawMessage.objects.create(
            user=self.user, sender="SYNTH", body="Synthetic transfer notice",
            body_hash=str(uuid4()), received_at=timezone.now(),
        )
        record = Transaction.objects.create(
            user=self.user, account=self.a, transfer_account=self.b,
            type="transfer", direction="debit", amount="1000.00",
            date=date(2026, 10, 12), time=time(9), balance_after="9000.00",
            source="sms", raw_message=raw, reference="SMS-REF", note="SMS note",
        )
        sms = TransferEvidence.objects.create(
            user=self.user, transaction=record, account=self.a,
            direction="debit", date=record.date, time=record.time,
            balance_after="9000.00", source="sms", raw_message=raw,
            reference="SMS-REF", note="SMS note",
        )
        statement = TransferEvidence.objects.create(
            user=self.user, transaction=record, account=self.b,
            direction="credit", date=record.date, time=time(9, 5),
            balance_after="3000.00", source="import",
            external_key=f"statement-row:{uuid4()}", reference="PDF-REF",
        )
        self.patch(
            record.pk, date="2026-10-13", time="11:30:00",
            reference="LEDGER-REF", note="Corrected ledger note",
            reported_balances=self.reports(),
        )
        sms.refresh_from_db()
        statement.refresh_from_db()
        self.assertEqual(TransferEvidence.objects.count(), 2)
        self.assertEqual((sms.date, sms.time, sms.reference, sms.note),
                         (date(2026, 10, 12), time(9), "SMS-REF", "SMS note"))
        self.assertEqual((statement.time, statement.reference),
                         (time(9, 5), "PDF-REF"))

        legacy = self.patch(record.pk, balance_after="8995.00")
        sms.refresh_from_db()
        self.assertEqual(sms.balance_after, Decimal("9000.00"))
        self.assertEqual(legacy["balance_after"], "8995.00")
        self.assertEqual(TransferEvidence.objects.count(), 3)

        changed = self.patch(
            record.pk, reported_balances=self.reports(a="8990.00", b="3010.00")
        )
        sms.refresh_from_db()
        statement.refresh_from_db()
        self.assertEqual(sms.balance_after, Decimal("9000.00"))
        self.assertEqual(statement.balance_after, Decimal("3000.00"))
        self.assertEqual(changed["balance_after"], "8990.00")
        self.assertEqual(
            {item["account"]: item["balance_after"] for item in changed["reported_balances"]},
            {str(self.a.pk): "8990.00", str(self.b.pk): "3010.00"},
        )
        self.assertEqual(TransferEvidence.objects.count(), 4)
        self.patch(record.pk, reported_balances=self.reports(a="8990.00", b="3010.00"))
        self.assertEqual(TransferEvidence.objects.count(), 4)

    def test_replacing_only_source_does_not_move_receiving_report(self):
        data = self.create(
            account=str(self.b.pk), transfer_account=str(self.a.pk), direction="credit"
        )
        changed = self.patch(
            data["id"],
            account=str(self.c.pk),
            allow_linked_correction=True,
            reported_balances=[
                {"account": str(self.c.pk), "balance_after": None},
                {"account": str(self.b.pk), "balance_after": "3000.00"},
            ],
        )
        self.assertEqual(changed["balance_after"], "3000.00")
        self.assertEqual(str(changed["balance_reporting_account"]), str(self.b.pk))
        self.assertIsNone(
            next(
                row["balance_after"]
                for row in changed["reported_balances"]
                if row["account"] == str(self.c.pk)
            )
        )

    def test_invalid_accounts_duplicates_and_negative_transfer_amount_roll_back(self):
        other = get_user_model().objects.create_user(
            username="synthetic-foreign-report"
        )
        foreign = Account.objects.create(user=other, name="Foreign report", type="bank")
        for reports in (
            [{"account": str(foreign.pk), "balance_after": "50.00"}],
            [{"account": str(self.c.pk), "balance_after": "50.00"}],
            self.reports() + self.reports()[:1],
            [{"account": str(self.a.pk)}],
        ):
            response = self.client.post(
                reverse("transaction-list"),
                {
                    "account": str(self.a.pk),
                    "transfer_account": str(self.b.pk),
                    "type": "transfer",
                    "amount": "1000.00",
                    "date": "2026-10-12",
                    "reported_balances": reports,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post(
            reverse("transaction-list"),
            {
                "account": str(self.a.pk),
                "transfer_account": str(self.b.pk),
                "type": "transfer",
                "amount": "-1000.00",
                "date": "2026-10-12",
                "reported_balances": self.reports(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_linking_receiver_report_to_existing_transfer_still_counts_once(self):
        data = self.create()
        response = self.client.post(
            reverse("transaction-link-transfer"),
            {
                "match_transaction": data["id"],
                "draft": {
                    "account": str(self.b.pk),
                    "transfer_account": str(self.a.pk),
                    "type": "transfer",
                    "direction": "credit",
                    "amount": "1000.00",
                    "date": "2026-10-12",
                    "external_key": "synthetic-incoming-report",
                    "reported_balances": self.reports(),
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(response.data["balance_after"], "9000.00")
        self.assertEqual(
            {
                row["account"]: row["balance_after"]
                for row in response.data["reported_balances"]
            },
            {str(self.a.pk): "9000.00", str(self.b.pk): "3000.00"},
        )

    def test_restore_transfer_uses_original_report_not_reclassified_scalar_for_other_account(
        self,
    ):
        data = self.create(
            account=str(self.b.pk), transfer_account=str(self.a.pk), direction="credit"
        )
        changed = self.patch(
            data["id"],
            type="expense",
            transfer_account=None,
            account=str(self.a.pk),
            balance_after="8500.00",
            allow_linked_correction=True,
        )
        self.assertEqual(changed["balance_after"], "8500.00")
        restored = self.patch(
            data["id"],
            type="transfer",
            transfer_account=str(self.b.pk),
            reported_balances=self.reports(a="8500.00"),
            allow_linked_correction=True,
        )
        self.assertEqual(restored["balance_after"], "3000.00")
        self.assertEqual(str(restored["balance_reporting_account"]), str(self.b.pk))
        self.assertEqual(
            {
                row["account"]: row["balance_after"]
                for row in restored["reported_balances"]
            },
            {str(self.a.pk): "8500.00", str(self.b.pk): "3000.00"},
        )
