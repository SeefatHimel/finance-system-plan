"""Only synthetic statement data; PDFs are generated in memory."""

import io
import subprocess
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from django.urls import reverse
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen import canvas
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction

from .parser import MAX_BYTES, StatementParseError, extract_statement


def synthetic_pdf(profile="ebl_bank", password=None, bad_balance=False, page_count=1):
    stream = io.BytesIO()
    c = canvas.Canvas(
        stream,
        pagesize=(595, 842),
        encrypt=StandardEncryption(password) if password else None,
    )
    for page in range(page_count):
        c.setFont("Helvetica", 8)

        def text(x, y, value):
            c.drawString(x, y, value)

        def number(x, y, value):
            c.drawRightString(x, y, value)

        if profile == "ebl_bank":
            text(21, 800, "EBL Bank")
            text(21, 780, "Currency Name : BANGLADESH TAKA")
            text(21, 765, "Account No : 9876543210123")
            text(21, 750, "Period From : 01-JAN-2026 - 05-JAN-2026")
            text(21, 610, "TRN. DATE")
            text(81, 610, "DESCRIPTION")
            text(259, 610, "REFERENCE")
            number(410, 610, "DEBITS")
            number(486, 610, "CREDITS")
            number(570, 610, "BALANCE")
            text(21, 580, "01-Jan-2026")
            text(81, 580, "Opening Balance")
            number(486, 580, "1,000.00")
            number(570, 580, "1,000.00")
            text(21, 550, "02-Jan-2026")
            text(81, 550, "NPSB TRANSFER //SYNTHREF")
            number(410, 550, "100.00")
            number(570, 550, "900.00")
            text(81, 540, "value date:01-JAN-26 9876543210123")
            text(21, 510, "02-Jan-2026")
            text(81, 510, "NPSB TRANSFER //SYNTHREF")
            number(410, 510, "2.00")
            number(570, 510, "898.00")
            text(81, 480, "STATEMENT CLOSING BALANCE")
            number(570, 480, "898.00")
            text(81, 450, "DEBITS 102.00 #DRCOUNT: 2")
            text(81, 430, "CREDITS 0 #CRCOUNT: 0")
        elif profile == "city_bank":
            text(21, 800, "Statement of Account")
            text(21, 780, "Currency : BDT")
            text(21, 765, "Account Number : 9876543210123")
            text(21, 750, "Period From : 01-01-2026 To 05-01-2026")
            text(31, 650, "DATE")
            text(88, 650, "DESCRIPTION")
            text(240, 650, "CHQ.NO.")
            number(380, 650, "WITHDRAWAL")
            number(471, 650, "DEPOSIT")
            number(564, 650, "BALANCE")
            for y, description, out, inc, balance in [
                (620, "PURCHASE CARD SYNTH SHOP", "50.00", None, "950.00"),
                (600, "REVERSE PURCHASE SYNTH SHOP", None, "50.00", "1,000.00"),
                (580, "PURCHASE CARD SYNTH SHOP", "50.00", None, "950.00"),
            ]:
                text(31, y, "02-01-2026")
                text(88, y, description)
                if out:
                    number(380, y, out)
                if inc:
                    number(471, y, inc)
                number(564, y, "949.00" if bad_balance and y == 580 else balance)
            text(
                31, 540, "Total Withdrawal : 100.00 BDT Opening Balance : 1,000.00 BDT"
            )
            text(
                31,
                520,
                "Total Deposit : 50.00 BDT Available Balance as of 05-01-2026 : 950.00 BDT",
            )
        elif profile == "bkash":
            text(31, 800, "bKash Statement")
            text(31, 780, "bKash Account Number: 01999990123")
            text(31, 760, "Statement Period: 01 Jan 2026 to 05 Jan 2026")
            text(31, 740, "Total Out: 32.00")
            text(31, 720, "Total In: 125.00")
            text(31, 650, "Date & Time")
            text(92, 650, "Transaction Type")
            text(194, 650, "Transaction Details")
            number(387, 650, "Out")
            number(444, 650, "In")
            number(499, 650, "Charge/Fee")
            number(560, 650, "Balance")
            for y, label, out, inc, fee, balance in [
                (620, "Card to bKash", None, "100.00", None, "1,100.00"),
                (580, "Send Money", None, "25.00", None, "1,125.00"),
                (540, "Pay Bill", "30.00", None, "-2.00", "1,093.00"),
            ]:
                text(31, y, "02-Jan-26")
                text(31, y - 10, "07:15:05 PM")
                text(92, y, label)
                text(194, y, "SYNTH MERCHANT / TRX ID:")
                text(194, y - 10, f"SYNTH{y} / 01999990123")
                for edge, value in [(387, out), (444, inc), (499, fee), (560, balance)]:
                    if value:
                        number(edge, y, value)
        elif profile == "scan":
            c.rect(20, 20, 200, 100)
        else:
            text(30, 800, "Unsupported digital document")
        c.showPage()
    c.save()
    return stream.getvalue()


class StatementParserTests(SimpleTestCase):
    def test_ebl_excludes_opening_closing_and_keeps_fee_row(self):
        result = extract_statement(synthetic_pdf())
        self.assertEqual(len(result["rows"]), 2)
        self.assertEqual(result["rows"][0]["value_date"], "2026-01-01")
        self.assertEqual(result["opening_balance"], "1000.00")
        self.assertEqual(result["closing_balance"], "898.00")
        self.assertEqual(result["balance_transitions_checked"], 2)
        self.assertTrue(all(c["passed"] for c in result["checks"]))
        self.assertNotIn("9876543210123", str(result))
        self.assertFalse(result["can_post"])

    def test_city_keeps_purchase_reversal_and_repeat(self):
        result = extract_statement(synthetic_pdf("city_bank"))
        self.assertEqual(
            [r["direction"] for r in result["rows"]], ["debit", "credit", "debit"]
        )
        self.assertTrue(all(c["passed"] for c in result["checks"]))
        self.assertTrue(all(r["time"] is None for r in result["rows"]))
        self.assertEqual(result["needs_review_count"], 0)

    def test_bkash_direction_fees_wrapped_reference_and_time(self):
        result = extract_statement(synthetic_pdf("bkash"))
        self.assertEqual(result["rows"][1]["provider_type"], "Send Money")
        self.assertEqual(result["rows"][1]["direction"], "credit")
        self.assertEqual(result["rows"][2]["signed_fee"], "-2.00")
        self.assertEqual(result["rows"][0]["time"], "19:15:05")
        self.assertEqual(result["rows"][0]["reference"], "SYNTH620")
        self.assertEqual(result["checks"][0]["passed"], True)
        self.assertEqual(result["checks"][1]["passed"], True)
        self.assertIsNone(result["opening_balance"])
        self.assertNotIn("01999990123", str(result))
        self.assertEqual(result["needs_review_count"], 0)

    def test_mismatch_is_visible_without_overwriting_reported_amounts(self):
        result = extract_statement(synthetic_pdf("city_bank", bad_balance=True))
        self.assertEqual(result["rows"][-1]["balance_after"], "949.00")
        self.assertEqual(result["needs_review_count"], 1)
        self.assertTrue(any(c["passed"] is False for c in result["checks"]))

    def test_password_and_unsupported_inputs_have_readable_codes(self):
        locked = synthetic_pdf(password="synthetic-password")
        with self.assertRaises(StatementParseError) as error:
            extract_statement(locked)
        self.assertEqual(error.exception.code, "password_required")
        self.assertEqual(
            len(extract_statement(locked, "synthetic-password")["rows"]), 2
        )
        for data, code in [
            (b"not pdf", "invalid_pdf"),
            (synthetic_pdf("unknown"), "unsupported_layout"),
            (synthetic_pdf("scan"), "ocr_required"),
            (synthetic_pdf(page_count=31), "page_limit"),
            (b"%PDF-" + b"x" * MAX_BYTES, "file_too_large"),
        ]:
            with (
                self.subTest(code=code),
                self.assertRaises(StatementParseError) as error,
            ):
                extract_statement(data)
            self.assertEqual(error.exception.code, code)


class StatementPreviewApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username="statement-test", password="synthetic-password"
        )
        self.account = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.client.force_authenticate(self.user)

    def upload(self, data=None, **fields):
        return self.client.post(
            reverse("statement-preview"),
            {
                "account": str(self.account.id),
                "file": SimpleUploadedFile(
                    "synthetic.pdf",
                    data or synthetic_pdf(),
                    content_type="application/pdf",
                ),
                **fields,
            },
            format="multipart",
        )

    def test_preview_is_authenticated_private_and_does_not_post(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(len(response.data["rows"]), 2)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(response.data["account_identity"], "verify")
        self.client.force_authenticate(None)
        self.assertEqual(self.upload().status_code, 401)

    def test_account_ownership_currency_type_and_file_validation(self):
        other = get_user_model().objects.create_user(username="other-statement-test")
        foreign = Account.objects.create(user=other, name="Other bank", type="bank")
        self.assertEqual(self.upload(account=str(foreign.id)).status_code, 400)
        self.assertEqual(self.upload(b"not a pdf").status_code, 400)
        self.assertEqual(self.upload(b"%PDF-" + b"x" * MAX_BYTES).status_code, 400)
        self.account.currency = "USD"
        self.account.save()
        self.assertEqual(self.upload().status_code, 400)
        self.account.currency = "BDT"
        self.account.type = "credit_card"
        self.account.save()
        self.assertEqual(self.upload().status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_locked_pdf_password_is_transient_and_errors_do_not_echo_it(self):
        locked = synthetic_pdf(password="synthetic-password")
        self.assertEqual(self.upload(locked).status_code, 400)
        response = self.upload(locked, password="synthetic-password")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("synthetic-password", str(response.data))
        self.assertEqual(Transaction.objects.count(), 0)

    def test_account_suffix_is_only_a_scoped_hint(self):
        method = PaymentMethod.objects.create(
            user=self.user,
            account=self.account,
            name="Synthetic account identifier",
            provider="ebl",
            identifier="***0123",
        )
        response = self.upload()
        self.assertEqual(response.data["account_identity"], "matched_suffix")
        self.assertFalse(response.data["can_post"])
        self.assertTrue(any("not proof" in w for w in response.data["warnings"]))
        method.is_active = False
        method.save()
        self.assertEqual(self.upload().data["account_identity"], "verify")
        self.account.is_active = False
        self.account.save()
        self.assertEqual(self.upload().status_code, 400)

    def test_wallet_statements_require_wallet_accounts(self):
        response = self.upload(synthetic_pdf("bkash"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("wallet account", response.data["account"][0])
        self.account.type = "mobile_wallet"
        self.account.save()
        self.assertEqual(self.upload(synthetic_pdf("bkash")).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 0)

    @patch("apps.statements.views.subprocess.run")
    def test_user_rate_limit_blocks_processing_before_upload_parse(self, run):
        # Invalid small files still consume preview attempts, but do not start a worker.
        for _ in range(10):
            self.assertEqual(
                self.upload(
                    file=SimpleUploadedFile("synthetic.txt", b"invalid")
                ).status_code,
                400,
            )
        response = self.upload(file=SimpleUploadedFile("synthetic.txt", b"invalid"))
        self.assertEqual(response.status_code, 429)
        self.assertIsNotNone(response.get("Retry-After"))
        run.assert_not_called()

    @patch(
        "apps.statements.views.subprocess.run",
        side_effect=subprocess.TimeoutExpired("worker", 20),
    )
    def test_worker_timeout_is_readable(self, run):
        response = self.upload()
        self.assertEqual(response.status_code, 422)
        self.assertIn("shorter", response.data["file"][0])
