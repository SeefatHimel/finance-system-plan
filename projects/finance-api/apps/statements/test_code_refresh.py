"""Synthetic source refresh checks: no ledger or reviewed draft may be replaced."""

import io
from copy import deepcopy
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.accounts.models import Account
from apps.transactions.models import Transaction
from config.secure_data import encrypt_bytes

from .citytouch import citytouch_printed_code
from .code_refresh import code_refresh_plan
from .counterparties import code_for_row, observed_codes
from .models import StatementImport, StatementOriginalFile, StatementRow
from .parser import extract_statement
from .services import file_digest, save_import
from .tests import synthetic_pdf


class CitytouchRefreshTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-refresh")
        self.account = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.pdf = b"synthetic PDF bytes for mocked extraction"
        self.batch = StatementImport.objects.create(
            user=self.user, account=self.account, file_digest=file_digest(self.pdf),
            profile="city_bank", parser_version="1", currency="BDT",
            account_hint="1234", account_identity="verify", page_count=1,
        )
        StatementOriginalFile.objects.create(
            batch=self.batch, ciphertext=encrypt_bytes(self.pdf), size=len(self.pdf)
        )
        self.original = {
            "id": "1:1", "page": 1, "row": 1, "date": "2026-01-02", "time": None,
            "posting_date": "2026-01-02", "provider_type": "",
            "value_date": None, "direction": "debit", "amount": "50.00",
            "signed_fee": "0.00", "balance_after": "950.00", "reference": "",
            "description": "CT-FT-***1234-***5678", "issues": [], "bounds": [1, 2, 3, 4],
        }
        self.transaction = Transaction.objects.create(
            user=self.user, account=self.account, date=date(2026, 1, 2),
            type="expense", direction="debit", amount="50.00", source="import",
        )
        self.row = StatementRow.objects.create(
            batch=self.batch, position=1, component="principal",
            extracted=self.original, source_fingerprint="old-source-fingerprint",
            date=date(2026, 1, 2), direction="debit", amount="50.00",
            type="expense", state="posted", transaction=self.transaction,
            note="Reviewed personal note", version=4,
        )
        self.preview = {
            "profile": "city_bank", "account_hint": "1234", "currency": "BDT",
            "page_count": 1,
            "rows": [{**self.original, "citytouch_printed_code": "12345675678"}],
        }

    def command(self, *args):
        output = io.StringIO()
        with patch.dict("os.environ", {"ALLOW_STATEMENT_CODE_REFRESH": "1"}):
            call_command(
                "refresh_citytouch_codes", "--username", self.user.username,
                "--batch-id", str(self.batch.id), *args, stdout=output,
            )
        return output.getvalue()

    def test_dry_run_then_apply_enriches_code_without_changing_ledger_or_review(self):
        with patch(
            "apps.statements.management.commands.refresh_citytouch_codes.extract_pdf_bytes",
            return_value=self.preview,
        ):
            result = self.command()
            self.assertIn("1 of 1", result)
            self.row.refresh_from_db()
            self.assertEqual(self.row.source_code, "")
            digest = result.split("Digest: ")[1].splitlines()[0]
            self.command("--apply", "--digest", digest)
        self.row.refresh_from_db()
        self.assertEqual(self.row.source_code, "12345675678")
        self.assertEqual(code_for_row(self.row), "12345675678")
        self.assertIn(
            (self.account.id, "city_bank", "12345675678", "debit"), observed_codes(self.user)
        )
        self.assertEqual(self.row.extracted, self.original)
        self.assertEqual(self.row.note, "Reviewed personal note")
        self.assertEqual(self.row.version, 5)
        self.assertEqual(self.row.transaction_id, self.transaction.id)
        self.assertEqual(Transaction.objects.count(), 1)
        client = APIClient()
        client.force_authenticate(self.user)
        result = client.get(
            f"/api/statements/imports/{self.batch.id}/rows/",
            {"search": "12345675678"},
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["count"], 1)
        self.assertEqual(
            result.data["results"][0]["citytouch_printed_code"], "12345675678"
        )
        self.assertEqual(
            result.data["results"][0]["extracted"]["description"],
            "CT-FT-***1234-***5678",
        )
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT source_code FROM statements_statementrow WHERE id = %s",
                [self.row.id.hex],
            )
            self.assertNotIn("12345675678", cursor.fetchone()[0])

    def test_mismatched_rows_and_stale_digest_never_change_source(self):
        old = list(self.batch.rows.filter(component="principal"))
        wrong = deepcopy(self.preview)
        wrong["rows"][0]["amount"] = "500.00"
        with self.assertRaisesMessage(ValidationError, "saved row differs"):
            code_refresh_plan(self.batch, wrong, old)
        with (
            patch(
                "apps.statements.management.commands.refresh_citytouch_codes.extract_pdf_bytes",
                return_value=self.preview,
            ),
            self.assertRaisesMessage(CommandError, "stale or incorrect"),
        ):
            self.command("--apply", "--digest", "a" * 64)
        self.row.refresh_from_db()
        self.assertEqual(self.row.source_code, "")

    def test_maintenance_command_is_disabled_by_default(self):
        with (
            patch.dict("os.environ", {"ALLOW_STATEMENT_CODE_REFRESH": ""}),
            self.assertRaisesMessage(CommandError, "disabled"),
        ):
            call_command(
                "refresh_citytouch_codes", "--username", self.user.username,
                "--batch-id", str(self.batch.id), stdout=io.StringIO(),
            )

    def test_only_longer_printed_suffix_is_an_upgrade(self):
        self.assertEqual(citytouch_printed_code("CT-FT-***1234-***99995678"), "***99995678")
        self.assertEqual(citytouch_printed_code("CT-FT-123456789012-12345675678"), "12345675678")
        rows = list(self.batch.rows.filter(component="principal"))
        same = deepcopy(self.preview)
        same["rows"][0]["citytouch_printed_code"] = "***5678"
        self.assertEqual(code_refresh_plan(self.batch, same, rows)["changed_count"], 0)
        conflict = deepcopy(self.preview)
        conflict["rows"][0]["citytouch_printed_code"] = "***99991234"
        with self.assertRaisesMessage(ValidationError, "conflicts"):
            code_refresh_plan(self.batch, conflict, rows)

    def test_pdf_parser_keeps_visible_second_code_separate_from_masked_description(self):
        pdf = synthetic_pdf(
            "city_bank", city_first_description="CT-FT-123456789012-12345675678"
        )
        preview = extract_statement(pdf)
        first = preview["rows"][0]
        self.assertEqual(first["citytouch_printed_code"], "12345675678")
        self.assertNotIn("12345675678", first["description"])
        preview["account_identity"] = "verify"
        imported, _ = save_import(
            user=self.user, account=self.account, digest=file_digest(pdf), preview=preview
        )
        saved = imported.rows.get(position=1, component="principal")
        self.assertEqual(saved.source_code, "12345675678")
        self.assertNotIn("citytouch_printed_code", saved.extracted)
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT source_code, extracted FROM statements_statementrow WHERE id = %s",
                [saved.id.hex],
            )
            ciphertext, extracted = cursor.fetchone()
            self.assertNotIn("12345675678", ciphertext)
            self.assertNotIn("12345675678", str(extracted))
