"""Synthetic metadata review: source text and money remain intact."""

from datetime import time
from types import SimpleNamespace

from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.audit_logs.models import AuditLogEntry
from apps.transactions.models import Transaction

from . import test_imports as fixtures
from .details import clean_merchant, detail_suggestions, identifier_suggestions


class StatementDetailSuggestionTests(SimpleTestCase):
    def row(self, description, **changes):
        return SimpleNamespace(
            extracted={"description": description, "provider_type": "Card purchase"},
            counterparty_text=description[:255],
            note=description,
            reference="",
            type="expense",
            direction="debit",
            batch=SimpleNamespace(account_hint="***1234"),
            **changes,
        )

    def test_merchant_cleanup_is_anchored_and_keeps_names_and_original_punctuation(
        self,
    ):
        cases = {
            "CARD PURCHASE Demo Cafe & Bakery": "Demo Cafe & Bakery",
            "Purchase Card Demo SHOP Card No: 1234**5678 Ref: QA": "Demo SHOP",
            "Reversal CARD PURCHASE Demo Cafe": "Demo Cafe",
            "POS PURCHASE: Demo Store": "Demo Store",
            "CARD PURCHASE Card 24 Cafe": "Card 24 Cafe",
            "Demo Card Gallery": "Demo Card Gallery",
            "Card Purchase": "",
        }
        for original, expected in cases.items():
            with self.subTest(original=original):
                self.assertEqual(clean_merchant(original), expected)

    def test_only_unambiguous_masked_identifiers_are_suggested_with_correct_roles(self):
        row = self.row("CARD PURCHASE Demo Cafe Card No: 1234**5678")
        suggestions = identifier_suggestions(row)
        self.assertEqual(suggestions["sender_card_identifier"], "1234**5678")
        self.assertEqual(suggestions["sender_account_identifier"], "***1234")
        self.assertNotIn("receiver_card_identifier", suggestions)
        row.type = "transfer"
        self.assertNotIn("sender_card_identifier", identifier_suggestions(row))
        row.extracted["description"] = "Transfer from account ***2222 to card ***3333"
        suggestions = identifier_suggestions(row)
        self.assertEqual(suggestions["sender_account_identifier"], "***2222")
        self.assertEqual(suggestions["receiver_card_identifier"], "***3333")
        row.extracted["description"] = "From card ***2222 and from card ***3333"
        self.assertEqual(identifier_suggestions(row)["sender_card_identifier"], "")

    def test_saved_merchant_correction_is_not_normalized_again(self):
        row = self.row("CARD PURCHASE Demo Cafe")
        row.counterparty_text = "My merchant label"
        row.note = "My saved note"
        record = SimpleNamespace(
            **{
                field: ""
                for field in (
                    "counterparty_text",
                    "reference",
                    "note",
                    "sender_account_identifier",
                    "sender_card_identifier",
                    "receiver_account_identifier",
                    "receiver_card_identifier",
                )
            }
        )
        result = {
            item["field"]: item["suggested_value"]
            for item in detail_suggestions(row, record)
        }
        self.assertEqual(result["counterparty_text"], "My merchant label")
        self.assertEqual(result["note"], "My saved note")

    def test_existing_pending_row_gets_clean_suggestion_without_reimport(self):
        row = self.row("CARD PURCHASE Demo Cafe")
        record = SimpleNamespace(
            **{
                field: ""
                for field in (
                    "counterparty_text",
                    "reference",
                    "note",
                    "sender_account_identifier",
                    "sender_card_identifier",
                    "receiver_account_identifier",
                    "receiver_card_identifier",
                )
            }
        )
        result = {item["field"]: item["suggested_value"] for item in detail_suggestions(row, record)}
        self.assertEqual(result["counterparty_text"], "Demo Cafe")
        self.assertEqual(row.counterparty_text, "CARD PURCHASE Demo Cafe")
        self.assertEqual(row.extracted["description"], "CARD PURCHASE Demo Cafe")


class StatementDetailChoiceTests(APITestCase):
    setUp = fixtures.SavedStatementTests.setUp
    upload = fixtures.SavedStatementTests.upload
    decide = fixtures.SavedStatementTests.decide
    ledger_purchase = fixtures.SavedStatementTests.ledger_purchase

    def choice(self, field, existing, value):
        return {"field": field, "existing_value": existing, "value": value}

    def test_selected_missing_fields_and_edited_suggestions_apply_without_changing_timing_or_money(
        self,
    ):
        record = self.ledger_purchase(
            reference="", counterparty_text="", time=time(19, 12)
        )
        row = self.upload().rows.first()
        original = row.extracted
        response = self.decide(
            row,
            "link",
            transaction=str(record.id),
            detail_choices=[
                self.choice("reference", "", "USER-EDITED-REF"),
                self.choice("counterparty_text", "", "Demo Cafe"),
                self.choice("sender_card_identifier", "", "1234567890123456"),
            ],
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(record.reference, "USER-EDITED-REF")
        self.assertEqual(record.counterparty_text, "Demo Cafe")
        self.assertEqual(record.sender_card_identifier, "3456")
        self.assertEqual(record.time, time(19, 12))
        self.assertEqual(str(record.date), "2026-01-02")
        self.assertEqual(str(record.amount), "50.00")
        self.assertEqual(record.note, "My corrected note")
        self.assertEqual(record.source, "sms")
        self.assertEqual(row.extracted, original)
        self.assertEqual(Transaction.objects.count(), 1)
        audit = AuditLogEntry.objects.get(
            entity_id=str(record.pk), metadata__statement_row=str(row.pk)
        )
        self.assertEqual(audit.before["reference"], "")
        self.assertIn("reference", audit.metadata["updated_details"])
        self.assertEqual(self.decide(row, "unlink").status_code, 200)
        record.refresh_from_db()
        self.assertEqual(record.counterparty_text, "Demo Cafe")

    def test_existing_note_and_merchant_change_only_when_explicitly_selected(self):
        record = self.ledger_purchase(counterparty_text="Old merchant")
        row = self.upload().rows.first()
        response = self.decide(
            row,
            "link",
            transaction=str(record.pk),
            detail_choices=[
                self.choice("note", "My corrected note", "My edited statement note")
            ],
        )
        self.assertEqual(response.status_code, 200, response.data)
        record.refresh_from_db()
        self.assertEqual(record.note, "My edited statement note")
        self.assertEqual(record.counterparty_text, "Old merchant")

    def test_stale_or_invalid_metadata_choices_are_atomic(self):
        record = self.ledger_purchase(reference="Changed reference")
        row = self.upload().rows.first()
        response = self.decide(
            row,
            "link",
            transaction=str(record.pk),
            detail_choices=[
                self.choice("counterparty_text", "", "New merchant"),
                self.choice("reference", "", "PDF-ref"),
            ],
        )
        self.assertEqual(response.status_code, 409, response.data)
        record.refresh_from_db()
        self.assertEqual(record.counterparty_text, "")
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)
        for choices in (
            [self.choice("amount", "50.00", "500.00")],
            [self.choice("sender_card_identifier", "", "12")],
            [self.choice("note", "My corrected note", "x" * 4001)],
            [
                self.choice("note", "My corrected note", "one"),
                self.choice("note", "My corrected note", "two"),
            ],
        ):
            response = self.decide(
                row, "link", transaction=str(record.pk), detail_choices=choices
            )
            self.assertEqual(response.status_code, 400, response.data)

    def test_new_statement_drafts_have_plain_merchants_but_original_description_is_retained(
        self,
    ):
        row = self.upload().rows.first()
        self.assertEqual(row.counterparty_text, "SYNTH SHOP")
        self.assertEqual(row.extracted["description"], "PURCHASE CARD SYNTH SHOP")
        self.assertEqual(row.note, row.extracted["description"])

    def test_saved_pending_import_exposes_new_suggestions_without_reimport(self):
        record = self.ledger_purchase(counterparty_text="")
        row = self.upload().rows.first()
        row.counterparty_text = row.extracted["description"]
        row.save(update_fields=["counterparty_text"])
        response = self.client.get(reverse("statement-row-detail", args=[row.id]))
        self.assertEqual(response.status_code, 200, response.data)
        match = next(item for item in response.data["review"]["matches"] if item["id"] == str(record.pk))
        merchant = next(item for item in match["detail_suggestions"] if item["field"] == "counterparty_text")
        self.assertEqual(merchant["suggested_value"], "SYNTH SHOP")
        row.refresh_from_db()
        self.assertEqual(row.state, "pending")
        self.assertEqual(row.counterparty_text, row.extracted["description"])
        record.refresh_from_db()
        self.assertEqual(record.counterparty_text, "")

    def test_metadata_selections_are_rejected_for_non_link_actions(self):
        row = self.upload().rows.first()
        response = self.decide(
            row, "create", detail_choices=[self.choice("note", "", "New note")]
        )
        self.assertEqual(response.status_code, 400)
