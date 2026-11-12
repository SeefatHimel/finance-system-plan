"""Pathao Pay regression coverage. Every PDF and SMS here is synthetic."""

import io
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from django.urls import reverse
from reportlab.pdfgen import canvas
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.messages.models import ParsedMessageCandidate, RawMessage, SenderRule
from apps.payment_methods.models import PaymentMethod
from apps.transactions.models import Transaction

from .models import StatementImport, StatementOriginalFile
from .parser import StatementParseError, extract_statement
from .services import posting_issues


def pathao_pdf(
    *,
    pages=1,
    fee="0.00",
    rebate=False,
    bad_balance=False,
    both_sides=False,
    missing_header=False,
    mixed_account=False,
    missing_time=False,
    malformed_money=False,
    currency="BDT",
    duplicate_id=False,
    credit_kind="Add Money",
):
    """Same positioned, wrapped headings as the provider; no private fixtures."""
    charge = Decimal(fee)
    if rebate:
        charge = -charge
    closing = Decimal("1000.00") + pages * (Decimal("100.00") - charge)
    total_out = pages * (Decimal("100.00") + max(charge, Decimal(0)))
    total_in = pages * (Decimal("200.00") - min(charge, Decimal(0)))
    stream = io.BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(595, 842), invariant=1)
    balance = Decimal("1000.00")
    for page in range(pages):
        pdf.setFont("Helvetica", 9)
        pdf.drawString(35, 805, "Pathao Pay Statement")
        pdf.drawString(
            35,
            782,
            f"Account Number : {'01900008888' if mixed_account and page else '01900007777'}",
        )
        pdf.drawString(35, 762, "Period : 01 Jan, 2026 to 31 Jan, 2026")
        pdf.drawString(35, 742, f"Currency : {currency}")
        pdf.drawString(35, 723, "Transactions")
        if page == 0:
            pdf.drawString(35, 701, "Balance Summary")
            for x, label in (
                (130, "Opening Balance"),
                (245, "Total In"),
                (345, "Total Out"),
                (460, "Closing Balance"),
            ):
                pdf.drawString(x, 680, label)
            pdf.drawString(35, 656, "Main Wallet")
            for x, amount in (
                (220, Decimal(1000)),
                (320, total_in),
                (420, total_out),
                (550, closing),
            ):
                pdf.drawRightString(x, 656, f"{amount:,.2f}")
        heading = 610 if page == 0 else 650
        for x, label in (
            (37, "Date & Time"),
            (112, "Transaction"),
            (192, "Transaction"),
            (284, "Details"),
            (365, "In"),
            (415, "Out"),
            (457, "Charge/"),
            (517, "Balance"),
        ):
            if not (missing_header and label == "In"):
                pdf.drawString(x, heading, label)
        for x, label in ((132, "ID"), (205, "Type"), (466, "Fee")):
            pdf.drawString(x, heading - 12, label)
        # Identical amounts and misleading wording cannot determine signs.
        for index, (kind, inc, out, details) in enumerate(
            [
                (credit_kind, "200.00", None, "VISA"),
                ("Make Payment", None, "100.00", "Synthetic Ride"),
            ]
        ):
            y = heading - 45 - index * 65
            pdf.drawString(37, y, "02 Jan, 2026")
            if not missing_time:
                pdf.drawString(37, y - 17, "12:05 AM" if index == 0 else "04:55 PM")
            pdf.drawString(112, y, f"SYNTH{page if not duplicate_id else 0}{index}")
            pdf.drawString(192, y, kind)
            if index == 0 and credit_kind == "Add Money":
                pdf.drawString(192, y - 13, "Card")
            pdf.drawString(284, y, details)
            if inc:
                pdf.drawRightString(390, y, "20O.00" if malformed_money else inc)
            if out or both_sides:
                pdf.drawRightString(440, y, out or "200.00")
            applied_fee = charge if index else Decimal(0)
            pdf.drawRightString(490, y, f"{applied_fee:.2f}")
            balance += Decimal(inc or 0) - Decimal(out or 0) - applied_fee
            pdf.drawRightString(
                550,
                y,
                f"{balance + (Decimal('3.45') if bad_balance and index else 0):,.2f}",
            )
        # Footer is directly beneath the last row, not at the page bottom.
        pdf.drawString(
            35, heading - 165, "Pathao Pay is a service by Digital Payments Ltd."
        )
        pdf.drawString(35, heading - 183, "Contact: Synthetic service contact")
        pdf.drawString(
            35,
            24,
            f"This is a system-generated statement, no signature required. Page {page + 1} of {pages}",
        )
        pdf.showPage()
    pdf.save()
    return stream.getvalue()


class PathaoParserTests(SimpleTestCase):
    def test_short_and_long_statements_preserve_columns_times_and_masking(self):
        for pages in (1, 3, 9):
            with self.subTest(pages=pages):
                result = extract_statement(pathao_pdf(pages=pages))
                self.assertEqual(result["profile"], "pathao_pay")
                self.assertEqual(len(result["rows"]), pages * 2)
                self.assertEqual(result["needs_review_count"], 0)
                self.assertTrue(all(check["passed"] for check in result["checks"]))
                self.assertEqual(result["balance_transitions_checked"], pages * 2)
                self.assertEqual(result["account_hint"], "***7777")
                self.assertNotIn("01900007777", str(result))
                self.assertEqual(result["rows"][0]["time"], "00:05:00")
                self.assertEqual(result["rows"][1]["time"], "16:55:00")
                self.assertEqual(result["rows"][0]["provider_type"], "Add Money Card")
                self.assertEqual(
                    [r["direction"] for r in result["rows"][:2]], ["credit", "debit"]
                )
                self.assertEqual(result["rows"][-1]["provider_type"], "Make Payment")

    def test_charges_and_rebates_are_signed_separately(self):
        for rebate, signed in ((False, "-3.45"), (True, "3.45")):
            result = extract_statement(pathao_pdf(fee="3.45", rebate=rebate, pages=3))
            self.assertEqual(result["rows"][1]["amount"], "100.00")
            self.assertEqual(result["rows"][1]["signed_fee"], signed)
            self.assertEqual(
                result["rows"][1]["printed_fee"], "-3.45" if rebate else "3.45"
            )
            self.assertEqual(result["needs_review_count"], 0)
            self.assertTrue(all(check["passed"] for check in result["checks"]))

    def test_arithmetic_never_changes_printed_direction_or_amount(self):
        result = extract_statement(pathao_pdf(bad_balance=True))
        self.assertEqual(result["rows"][1]["direction"], "debit")
        self.assertEqual(result["rows"][1]["amount"], "100.00")
        self.assertIn("Balance does not reconcile", str(result["rows"][1]["issues"]))
        self.assertFalse(all(check["passed"] for check in result["checks"]))

    def test_ambiguous_extraction_fails_closed(self):
        for options in (
            {"both_sides": True},
            {"missing_header": True},
            {"malformed_money": True},
            {"mixed_account": True, "pages": 2},
            {"currency": "USD"},
        ):
            with self.subTest(options=options), self.assertRaises(StatementParseError):
                extract_statement(pathao_pdf(**options))

    def test_unknown_time_and_repeated_ids_require_review(self):
        result = extract_statement(pathao_pdf(missing_time=True))
        self.assertIsNone(result["rows"][0]["time"])
        self.assertEqual(result["needs_review_count"], 2)
        repeated = extract_statement(pathao_pdf(pages=2, duplicate_id=True))
        self.assertIn("transaction ID is repeated", str(repeated["rows"][2]["issues"]))


class PathaoImportTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(username="synthetic-pathao")
        self.wallet = Account.objects.create(
            user=self.user,
            name="Synthetic Pathao",
            type="mobile_wallet",
            currency="BDT",
        )
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank", currency="BDT"
        )
        self.client.force_authenticate(self.user)

    def upload(self, **options):
        data = pathao_pdf(**options)
        response = self.client.post(
            reverse("statement-import-list"),
            {
                "account": str(self.wallet.pk),
                "file": SimpleUploadedFile("synthetic-pathao.pdf", data),
            },
            format="multipart",
        )
        self.assertIn(response.status_code, (200, 201), response.data)
        return StatementImport.objects.get(pk=response.data["id"])

    def decide(self, row, **fields):
        return self.client.post(
            reverse("statement-row-decide", args=[row.pk]),
            {
                "version": row.version,
                "action": "create",
                **fields,
            },
            format="json",
        )

    def test_import_archive_idempotency_funding_and_exact_fee_drafts(self):
        transfer = Category.objects.get_or_create(
            user=self.user, name="Account Transfer", defaults={"kind": "transfer"}
        )[0]
        batch = self.upload(fee="3.45")
        self.assertEqual(batch, self.upload(fee="3.45"))
        self.assertEqual(batch.rows.count(), 3)
        self.assertTrue(StatementOriginalFile.objects.filter(batch=batch).exists())
        credit = batch.rows.get(component="principal", direction="credit")
        self.assertEqual((credit.type, credit.category), ("transfer", transfer))
        self.assertIsNone(credit.other_account)
        self.assertEqual(self.decide(credit).status_code, 400)
        fee = batch.rows.get(component="fee")
        self.assertEqual(
            (fee.amount, fee.direction, fee.type), (Decimal("3.45"), "debit", "fee")
        )
        self.assertEqual(fee.extracted["printed_fee"], "3.45")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_wallet_account_suggestion_and_invalid_account_type(self):
        PaymentMethod.objects.create(
            user=self.user,
            account=self.wallet,
            name="Synthetic Pathao recognition",
            provider="pathao_pay",
            identifier="7777",
        )
        result = self.client.post(
            reverse("statement-identify"),
            {"file": SimpleUploadedFile("synthetic.pdf", pathao_pdf())},
            format="multipart",
        )
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(
            str(result.data["account_suggestion"]["account"]), str(self.wallet.pk)
        )
        bad = self.client.post(
            reverse("statement-import-list"),
            {
                "account": str(self.bank.pk),
                "file": SimpleUploadedFile("synthetic.pdf", pathao_pdf()),
            },
            format="multipart",
        )
        self.assertEqual(bad.status_code, 400, bad.data)

    def test_source_direction_guard_and_existing_transaction_link(self):
        row = self.upload().rows.get(direction="debit")
        row.direction, row.type = "credit", "income"
        self.assertIn("Pathao Pay PDF direction", str(posting_issues(row)))
        row.direction, row.type = "debit", "expense"
        row.save()
        record = Transaction.objects.create(
            user=self.user,
            account=self.wallet,
            type="expense",
            direction="debit",
            amount=row.amount,
            date=row.date,
            time=row.time,
            reference=row.reference,
            balance_after=row.balance_after,
            source="manual",
        )
        detail = self.client.get(reverse("statement-row-detail", args=[row.pk]))
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertIn(str(record.pk), str(detail.data["review"]["matches"]))
        result = self.decide(
            row, action="link", transaction=str(record.pk), acknowledge_match=True
        )
        self.assertEqual(result.status_code, 200, result.data)
        row.refresh_from_db()
        self.assertEqual(row.transaction_id, record.pk)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_pending_pathao_sms_and_statement_record_one_transaction(self):
        row = self.upload().rows.get(direction="debit")
        raw = RawMessage.objects.create(
            user=self.user,
            sender="PATHAOPAY",
            body="Synthetic Pathao payment BDT 100",
            body_hash="synthetic-pathao-one",
            received_at=datetime(2026, 1, 2, 16, 55, tzinfo=ZoneInfo("Asia/Dhaka")),
        )
        sms = ParsedMessageCandidate.objects.create(
            user=self.user,
            raw_message=raw,
            account=self.wallet,
            amount=row.amount,
            balance_after=row.balance_after,
            transaction_type="expense",
            source_direction="debit",
            message_kind="card_purchase",
            reference=row.reference,
        )
        detail = self.client.get(
            reverse("unified-pair"), {"statement": str(row.pk), "sms": str(sms.pk)}
        )
        self.assertEqual(detail.status_code, 200, detail.data)
        result = self.client.post(
            reverse("unified-pair"),
            {
                "statement": str(row.pk),
                "sms": str(sms.pk),
                "statement_version": row.version,
                "sms_updated_at": sms.updated_at.isoformat(),
                "balance_source": "sms",
                "acknowledge_match": True,
                "acknowledge_conflict": True,
                "acknowledge_issues": True,
                "remember_choices": False,
            },
            format="json",
        )
        self.assertEqual(result.status_code, 200, result.data)
        row.refresh_from_db()
        sms.refresh_from_db()
        self.assertEqual(row.transaction_id, sms.transaction_id)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(row.transaction.balance_after, Decimal("1100.00"))

    def test_pathao_parser_sms_is_suggested_in_both_review_directions(self):
        row = self.upload().rows.get(direction="debit")
        SenderRule.objects.create(
            user=self.user,
            account=self.wallet,
            name="Synthetic Pathao sender",
            provider="pathao_pay",
            sender="PATHAOPAY",
        )
        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "PATHAOPAY",
                "body": f"Pathao Pay payment BDT 100.00 to SYNTHETIC RIDE successful. Balance BDT 1100.00. Ref {row.reference}.",
                "received_at": "2026-01-02T16:55:00+06:00",
                "device_message_id": "synthetic-pathao-parser-pair",
            },
            format="json",
        )
        self.assertIn(response.status_code, (200, 201), response.data)
        sms = ParsedMessageCandidate.objects.get(
            raw_message__device_message_id="synthetic-pathao-parser-pair"
        )
        self.assertEqual(sms.provider, "pathao_pay")
        self.assertEqual(sms.reference, row.reference)
        self.assertEqual(sms.source_direction, "debit")
        matches = self.client.post(
            reverse("message-candidate-statement-matches", args=[sms.pk]),
            {"account": str(self.wallet.pk)},
            format="json",
        )
        self.assertEqual(matches.status_code, 200, matches.data)
        self.assertIn(str(row.pk), str(matches.data["matches"]))
        detail = self.client.get(reverse("statement-row-detail", args=[row.pk]))
        self.assertIn(str(sms.pk), str(detail.data["review"]["pending_sms_matches"]))
        self.assertEqual(Transaction.objects.count(), 0)

    def post_fee(self, rebate):
        batch = self.upload(fee="3.45", rebate=rebate)
        principal = batch.rows.get(component="principal", direction="debit")
        fee = batch.rows.get(component="fee")
        result = self.decide(principal)
        self.assertEqual(result.status_code, 200, result.data)
        result = self.decide(fee)
        self.assertEqual(result.status_code, 200, result.data)
        principal.refresh_from_db()
        fee.refresh_from_db()
        self.assertIsNone(principal.transaction.balance_after)
        self.assertEqual(principal.transaction.amount, Decimal("100.00"))
        self.assertEqual(
            fee.transaction.balance_after, Decimal("1103.45" if rebate else "1096.55")
        )
        self.assertEqual(fee.transaction.direction, "credit" if rebate else "debit")
        self.assertEqual(self.decide(fee).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_charge_posts_once_with_final_balance_on_fee(self):
        self.post_fee(False)

    def test_rebate_posts_once_with_final_balance_on_fee(self):
        self.post_fee(True)

    def test_funding_can_link_an_existing_incoming_transfer(self):
        row = self.upload().rows.get(direction="credit")
        row.other_account = self.bank
        row.classification_confirmed = True
        row.save()
        record = Transaction.objects.create(
            user=self.user,
            account=self.bank,
            transfer_account=self.wallet,
            category=row.category,
            type="transfer",
            direction="debit",
            amount=row.amount,
            date=row.date,
            time=row.time,
            reference=row.reference,
            source="sms",
        )
        result = self.decide(
            row, action="link", transaction=str(record.pk), acknowledge_conflict=True
        )
        self.assertEqual(result.status_code, 200, result.data)
        row.refresh_from_db()
        self.assertEqual(row.transaction_id, record.pk)
        self.assertTrue(
            record.transfer_evidence.filter(
                account=self.wallet, direction="credit"
            ).exists()
        )
        self.assertEqual(Transaction.objects.count(), 1)

    def test_cashback_uses_compatible_existing_rewards_category(self):
        category = Category.objects.get_or_create(
            user=self.user, name="Interest & Rewards", defaults={"kind": "income"}
        )[0]
        row = self.upload(credit_kind="Cashback").rows.get(direction="credit")
        self.assertEqual((row.type, row.category), ("income", category))
        result = self.decide(row)
        self.assertEqual(result.status_code, 200, result.data)
        row.refresh_from_db()
        self.assertEqual(row.transaction.direction, "credit")

    def test_direction_edit_cannot_be_posted_as_opposite_source(self):
        row = self.upload().rows.get(direction="debit")
        response = self.client.patch(
            reverse("statement-row-detail", args=[row.pk]),
            {"version": row.version, "type": "income", "direction": "credit"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        blocked = self.decide(row, acknowledge_issues=True)
        self.assertEqual(blocked.status_code, 400, blocked.data)
        self.assertIn("Pathao Pay PDF direction", str(blocked.data))
        self.assertEqual(row.extracted["direction"], "debit")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_reversed_source_cannot_link_an_opposite_ledger_movement(self):
        row = self.upload().rows.get(direction="debit")
        row.direction, row.type = "credit", "income"
        row.save()
        record = Transaction.objects.create(
            user=self.user,
            account=self.wallet,
            type="income",
            direction="credit",
            date=row.date,
            amount=row.amount,
            reference=row.reference,
        )
        blocked = self.decide(
            row, action="link", transaction=str(record.pk), acknowledge_issues=True
        )
        self.assertEqual(blocked.status_code, 400, blocked.data)
        self.assertIn("Pathao Pay PDF direction", str(blocked.data))
        row.refresh_from_db()
        self.assertIsNone(row.transaction_id)
