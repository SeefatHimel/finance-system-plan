"""One complete synthetic PDF + SMS workflow, including correction and undo."""

from datetime import datetime
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.messages.models import RawMessage, ParsedMessageCandidate
from apps.statements.models import StatementImport
from apps.statements.tests import synthetic_pdf
from .models import Transaction


class SourceLifecycleTests(APITestCase):
    def test_import_pair_correct_undo_keeps_one_movement_and_original_evidence(self):
        user = get_user_model().objects.create_user(
            username="synthetic-source-lifecycle"
        )
        account = Account.objects.create(
            user=user, name="Synthetic source bank", type="bank"
        )
        self.client.force_authenticate(user)
        pdf = synthetic_pdf()
        imported = self.client.post(
            reverse("statement-import-list"),
            {
                "account": str(account.pk),
                "file": SimpleUploadedFile(
                    "synthetic.pdf", pdf, content_type="application/pdf"
                ),
            },
            format="multipart",
        )
        self.assertEqual(imported.status_code, 201, imported.data)
        batch = StatementImport.objects.get(pk=imported.data["id"])
        row = batch.rows.get(component="principal", amount=100)
        source = row.extracted.copy()
        ciphertext = bytes(batch.original_file.ciphertext)
        self.assertNotEqual(ciphertext, pdf)
        self.assertEqual(Transaction.objects.count(), 0)
        raw = RawMessage.objects.create(
            user=user,
            sender="SYNTHETIC",
            body="Synthetic notification: debit BDT 100.00, balance 900.00",
            body_hash="synthetic-source-lifecycle",
            received_at=datetime(
                2026, 1, 2, 12, tzinfo=timezone.get_current_timezone()
            ),
        )
        sms = ParsedMessageCandidate.objects.create(
            user=user,
            raw_message=raw,
            account=account,
            amount=100,
            balance_after=900,
            source_direction="debit",
            transaction_type="expense",
            message_kind="card_purchase",
            counterparty_text="Synthetic source",
        )
        payload = {
            "statement": str(row.pk),
            "sms": str(sms.pk),
            "statement_version": row.version,
            "sms_updated_at": sms.updated_at.isoformat(),
            "balance_source": "sms",
            "acknowledge_match": True,
            "acknowledge_conflict": True,
            "acknowledge_issues": True,
            "remember_choices": False,
            "type_choice": "custom",
            "draft": {
                "version": row.version,
                "type": "expense",
                "direction": "debit",
                "other_account": None,
                "classification_confirmed": True,
            },
        }
        paired = self.client.post(reverse("unified-pair"), payload, format="json")
        self.assertEqual(paired.status_code, 200, paired.data)
        row.refresh_from_db()
        sms.refresh_from_db()
        self.assertEqual(row.transaction_id, sms.transaction_id)
        self.assertEqual(Transaction.objects.count(), 1)
        retry = self.client.post(reverse("unified-pair"), payload, format="json")
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(Transaction.objects.count(), 1)
        record = row.transaction
        note = record.note
        edit = self.client.patch(
            reverse("transaction-detail", kwargs={"pk": record.pk}),
            {"note": "Synthetic corrected display note"},
            format="json",
        )
        self.assertEqual(edit.status_code, 200, edit.data)
        undone = self.client.post(
            reverse("transaction-undo"),
            {"action": edit.data["undo_action"]["id"]},
            format="json",
        )
        self.assertEqual(undone.status_code, 200, undone.data)
        record.refresh_from_db()
        row.refresh_from_db()
        raw.refresh_from_db()
        self.assertEqual(record.note, note)
        self.assertEqual(row.extracted, source)
        self.assertEqual(
            bytes(StatementImport.objects.get(pk=batch.pk).original_file.ciphertext),
            ciphertext,
        )
        self.assertEqual(
            raw.body, "Synthetic notification: debit BDT 100.00, balance 900.00"
        )
        other = get_user_model().objects.create_user(
            username="synthetic-source-outsider"
        )
        self.client.force_authenticate(other)
        self.assertEqual(
            self.client.get(
                reverse("statement-import-detail", kwargs={"pk": batch.pk})
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(
                reverse("transaction-detail", kwargs={"pk": record.pk})
            ).status_code,
            404,
        )
