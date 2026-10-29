"""Synthetic EBL identifiers, independent charge hints and archived recovery."""

import time
from copy import deepcopy
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.models import Transaction

from .ebl_identifiers import identifier, movement_reference, possible_fee_ids
from .insights import suggestions
from .models import StatementCounterpartyCode, StatementImport, StatementRow
from .parser import extract_statement, mask_identifiers
from .services import refresh_statement_identifiers, source_fingerprint
from .tests import synthetic_pdf

PRINTED = "111122****123*||765432109876|DC"
CODE = "ebl:bkash:phone:01700000000"
OLD_MASK = "npsb:masked:111122****123*"
RETIRED = "npsb:code:765432109876"


class EblIdentifierTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(
            username="synthetic-ebl-identifiers"
        )
        self.other = get_user_model().objects.create_user(
            username="synthetic-ebl-other"
        )
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic source bank", type="bank", currency="BDT"
        )
        self.wallet = Account.objects.create(
            user=self.user,
            name="Synthetic destination",
            type="mobile_wallet",
            currency="BDT",
        )
        self.client.force_authenticate(self.user)
        self.batch = StatementImport.objects.create(
            user=self.user,
            account=self.bank,
            file_digest="a" * 64,
            profile="ebl_bank",
            parser_version="2",
            currency="BDT",
            account_identity="synthetic",
            page_count=1,
        )

    def row(
        self, position, *, amount="100.00", balance="900.00", ref="SYNTH-ONE", code=OLD_MASK,
        movement_code="765432109876", wallet=False,
    ):
        printed = PRINTED.replace("765432109876", movement_code)
        description = f"NPSB FUND TRANSFER {printed} TO NPSB ACCOUNT //{ref}"
        if wallet:
            description = f"bKash transfer to 01700000000 //{ref}"
        original = {
            "description": mask_identifiers(description),
            "date": "2026-01-02",
            "direction": "debit",
            "amount": amount,
            "balance_after": balance,
        }
        return StatementRow.objects.create(
            batch=self.batch,
            position=position,
            component="principal",
            source_code=CODE if wallet else code,
            source_fingerprint=source_fingerprint(original, "principal"),
            extracted=original,
            date=date(2026, 1, 2),
            direction="debit",
            amount=amount,
            balance_after=balance,
            type="expense",
            note="Keep reviewed note",
        )

    def payload(self, **changes):
        return {
            "account": str(self.bank.pk),
            "profile": "ebl_bank",
            "code": CODE,
            "direction": "debit",
            "party_kind": "external",
            "label": "Verified synthetic party",
            "suggested_type": "expense",
            **changes,
        }

    def upload(self):
        pdf = synthetic_pdf("ebl_bank", ebl_details=PRINTED)
        response = self.client.post(
            reverse("statement-import-list"),
            {
                "account": str(self.bank.pk),
                "file": SimpleUploadedFile("synthetic-ebl.pdf", pdf),
            },
            format="multipart",
        )
        self.assertIn(response.status_code, (200, 201), response.data)
        return StatementImport.objects.get(pk=response.data["id"]), pdf

    def test_own_card_masks_and_references_are_not_counterparties(self):
        for text in [f"NPSB FUND TRANSFER {PRINTED}", f"NPSB TRANSFER {PRINTED} {PRINTED}",
                     "NPSB TRANSFER 111122****123*||765432109876||DC", "NPSB FUND TRANSFER //999VMT123456789",
                     "NPSB FUND TRANSFER ||765432109876|DC", "CARD PURCHASE 111122****123*"]:
            self.assertIsNone(identifier(text), text)
        self.assertEqual(movement_reference("//SYNTH-ONE //SYNTH-ONE"), "SYNTH-ONE")
        self.assertIsNone(movement_reference("//SYNTH-ONE //SYNTH-TWO"))

    def test_private_parser_retention_does_not_leak_into_preview_or_fingerprint(self):
        pdf = synthetic_pdf("ebl_bank", ebl_details=PRINTED)
        public = extract_statement(pdf)
        private = extract_statement(pdf, include_private_identifiers=True)
        self.assertNotIn("ebl_identifier", private["rows"][0])
        self.assertNotIn("765432109876", str(public))
        self.assertNotIn("ebl_identifier", public["rows"][0])
        self.assertEqual(
            source_fingerprint(public["rows"][0], "principal"),
            source_fingerprint(private["rows"][0], "principal"),
        )

    def test_even_verified_legacy_mask_rules_cannot_suggest_or_be_saved(self):
        from .bkash_identifiers import mapping_code
        from .counterparties import code_suggestions
        principal = self.row(1)
        fee = self.row(2, amount="9.99", balance="890.01")
        for code in [RETIRED, OLD_MASK]:
            StatementCounterpartyCode.objects.create(user=self.user, account=self.bank, profile="ebl_bank",
                code=mapping_code("ebl_bank", self.bank.pk, code), direction="debit", ebl_mask_verified=True,
                party_kind="owned", label="Obsolete recipient", other_account=self.wallet, suggested_type="transfer")
            self.assertEqual(self.client.post(reverse("statement-counterparty-codes"), self.payload(code=code), format="json").status_code, 400)
        self.assertEqual(self.client.get(reverse("statement-counterparty-codes")).data["count"], 0)
        self.assertEqual(code_suggestions([principal, fee]), {})
        self.assertNotIn(principal.pk, suggestions([principal, fee]))
        self.assertEqual(suggestions([principal, fee])[fee.pk]["type"], "fee")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_recipient_mapping_supports_owned_routes_categories_notes_edit_and_forget(self):
        from .counterparties import code_suggestions

        row = self.row(1, wallet=True)
        version, original = row.version, deepcopy(row.extracted)
        category = Category.objects.create(user=self.user, name="Synthetic transfers", kind="transfer")
        url = reverse("statement-counterparty-codes")
        payload = self.payload(party_kind="owned", other_account=str(self.wallet.pk),
                               suggested_type="transfer", category=str(category.pk),
                               note_template="Verified synthetic route")
        saved = self.client.post(url, payload, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        hint = code_suggestions([row])[row.pk]
        self.assertEqual(hint["type"], "transfer")
        self.assertEqual(hint["other_account"], str(self.wallet.pk))
        self.assertEqual(hint["category"], str(category.pk))
        self.assertEqual(hint["note"], "Verified synthetic route")
        row.refresh_from_db()
        self.assertEqual(row.version, version)
        self.assertEqual(row.type, "expense")
        self.assertIsNone(row.other_account_id)
        self.assertEqual(row.extracted, original)
        self.assertEqual(row.note, "Keep reviewed note")
        self.assertEqual(Transaction.objects.count(), 0)

        edited = self.client.post(url, self.payload(label="Edited synthetic party"), format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["id"], saved.data["id"])
        self.assertEqual(code_suggestions([row])[row.pk]["type"], "expense")
        self.assertIsNone(code_suggestions([row])[row.pk]["other_account"])
        deleted = self.client.delete(reverse("statement-counterparty-code-detail", args=[saved.data["id"]]))
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(code_suggestions([row]), {})

    def test_recipient_mapping_does_not_cross_reporting_accounts_or_directions(self):
        from .counterparties import code_suggestions

        principal = self.row(1, wallet=True)
        credit = self.row(2, ref="SYNTH-CREDIT", wallet=True)
        credit.direction = "credit"
        credit.type = "income"
        credit.extracted = {**credit.extracted, "direction": "credit"}
        credit.save()
        other_bank = Account.objects.create(user=self.user, name="Other source bank", type="bank", currency="BDT")
        other_batch = StatementImport.objects.create(
            user=self.user, account=other_bank, file_digest="b" * 64,
            profile="ebl_bank", parser_version="2", currency="BDT",
            account_identity="synthetic-other", page_count=1,
        )
        other_row = self.row(3, ref="SYNTH-OTHER", wallet=True)
        other_row.batch = other_batch
        other_row.save()
        saved = self.client.post(reverse("statement-counterparty-codes"), self.payload(), format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(set(code_suggestions([principal, credit, other_row])), {principal.pk})

    def test_recipient_mapping_validates_observation_ownership_direction_and_account_path(self):
        self.row(1, wallet=True)
        foreign = Account.objects.create(user=self.other, name="Foreign destination", type="bank")
        inactive = Account.objects.create(user=self.user, name="Inactive destination", type="bank", is_active=False)
        usd = Account.objects.create(user=self.user, name="Other currency", type="bank", currency="USD")
        foreign_category = Category.objects.create(user=self.other, name="Foreign expense", kind="expense")
        url = reverse("statement-counterparty-codes")
        invalid = [
            {"code": "npsb:masked:111122****124*"}, {"code": RETIRED},
            {"direction": "credit"}, {"suggested_type": "income"},
            {"account": str(self.wallet.pk)}, {"category": str(foreign_category.pk)},
            {"party_kind": "owned", "suggested_type": "transfer", "other_account": str(self.bank.pk)},
            {"party_kind": "owned", "suggested_type": "transfer", "other_account": str(foreign.pk)},
            {"party_kind": "owned", "suggested_type": "transfer", "other_account": str(inactive.pk)},
            {"party_kind": "owned", "suggested_type": "transfer", "other_account": str(usd.pk)},
            {"suggested_type": "transfer"},
        ]
        for changes in invalid:
            response = self.client.post(url, self.payload(**changes), format="json")
            self.assertEqual(response.status_code, 400, (changes, response.data))
        self.assertEqual(StatementCounterpartyCode.objects.count(), 0)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(url, self.payload(), format="json").status_code, 400)

    def test_charge_hint_requires_all_source_guards(self):
        principal = self.row(1)
        fee = self.row(2, amount="2.00", balance="898.00")
        self.assertEqual(possible_fee_ids([principal, fee]), {fee.pk})
        principal.source_code = ""
        self.assertEqual(possible_fee_ids([principal, fee]), {fee.pk})
        principal.source_code = OLD_MASK
        baseline = deepcopy(fee.extracted)
        for key, value in [
            ("direction", "credit"),
            ("date", "2026-01-03"),
            ("balance_after", None),
            ("balance_after", "897.00"),
            ("description", "NPSB TRANSFER //SYNTH-TWO"),
            ("amount", "100.00"),
            ("amount", "NaN"),
        ]:
            fee.extracted = {**baseline, key: value}
            self.assertEqual(possible_fee_ids([principal, fee]), set(), key)
        fee.extracted = baseline
        fee.position = 3
        self.assertEqual(possible_fee_ids([principal, fee]), set())
        fee.position = 2
        fee.source_code = "npsb:masked:111122****124*"
        self.assertEqual(possible_fee_ids([principal, fee]), set())
        fee.source_code = OLD_MASK
        extra = self.row(3, amount="1.00", balance="897.00")
        self.assertEqual(possible_fee_ids([principal, fee, extra]), set())

    def test_independent_npsb_movements_never_become_recipient_clues(self):
        self.row(1)
        self.row(2, amount="2.00", balance="898.00")
        self.row(3, ref="SYNTH-TWO", code=RETIRED)
        self.assertEqual(self.client.get(reverse("statement-counterparty-codes")).data["count"], 0)

    def test_recipient_clues_are_owner_scoped_and_use_source_not_edited_notes(self):
        row = self.row(1, wallet=True)
        row.counterparty_text = "Edited merchant"
        row.note = "Edited note"
        row.save(update_fields=["counterparty_text", "note"])
        listed = self.client.get(reverse("statement-counterparty-codes"))
        self.assertEqual(listed.data["results"][0]["code"], CODE)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(reverse("statement-counterparty-codes")).data["count"], 0)

    def test_import_and_archived_refresh_preserve_decisions_and_ledger(self):
        batch, pdf = self.upload()
        row = batch.rows.get(position=1, component="principal")
        self.assertEqual(row.source_code, "")
        self.assertNotIn("765432109876", str(row.extracted))
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT source_code FROM statements_statementrow WHERE id=%s",
                [row.pk.hex if connection.vendor == "sqlite" else str(row.pk)],
            )
            self.assertNotIn("765432109876", cursor.fetchone()[0])
        StatementRow.objects.filter(pk=row.pk).update(
            source_code=RETIRED, note="My saved decision"
        )
        before_version = row.version
        response = self.client.post(
            reverse("statement-import-refresh-identifiers", args=[batch.pk]),
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["updated_rows"], 1)
        row.refresh_from_db()
        self.assertEqual(row.source_code, "")
        self.assertEqual(row.note, "My saved decision")
        self.assertEqual(row.version, before_version + 1)
        self.assertEqual(Transaction.objects.count(), 0)
        self.assertEqual(
            self.client.post(
                reverse("statement-import-refresh-identifiers", args=[batch.pk]),
                {},
                format="json",
            ).data["updated_rows"],
            0,
        )
        broken = extract_statement(pdf, include_private_identifiers=True)
        broken["rows"][0]["amount"] = "200.00"
        with self.assertRaisesMessage(
            ValidationError, "Archived statement rows do not match"
        ):
            refresh_statement_identifiers(batch, broken, strict=True)

    def test_archived_refresh_does_not_consume_or_depend_on_upload_allowance(self):
        batch, _ = self.upload()
        url = reverse("statement-import-refresh-identifiers", args=[batch.pk])
        upload_key = f"throttle_statement_preview_{self.user.pk}"
        refresh_key = f"throttle_statement_identifier_refresh_{self.user.pk}"
        cache.set(upload_key, [time.time()] * 10, 3600)

        response = self.client.post(url, {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(cache.get(upload_key)), 10)

        cache.delete(upload_key)
        cache.set(refresh_key, [time.time()] * 20, 3600)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 429)
        # An exhausted refresh allowance must still permit a separate upload.
        self.upload()
        self.assertEqual(len(cache.get(upload_key)), 1)

        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 404)

    def test_refresh_of_posted_source_cannot_rewrite_ledger(self):
        batch, _ = self.upload()
        row = batch.rows.get(position=1, component="principal")
        entry = Transaction.objects.create(
            user=self.user,
            account=self.bank,
            date=row.date,
            type="expense",
            direction="debit",
            amount="100.00",
            note="Reviewed ledger note",
        )
        StatementRow.objects.filter(pk=row.pk).update(
            source_code=RETIRED,
            transaction=entry,
            state="posted",
            classification_confirmed=True,
        )
        original = row.extracted.copy()
        response = self.client.post(
            reverse("statement-import-refresh-identifiers", args=[batch.pk]),
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        row.refresh_from_db()
        entry.refresh_from_db()
        self.assertEqual(row.source_code, "")
        self.assertEqual(row.state, "posted")
        self.assertEqual(row.transaction_id, entry.pk)
        self.assertEqual(row.extracted, original)
        self.assertEqual(entry.amount, Decimal("100.00"))
        self.assertEqual(entry.type, "expense")
        self.assertEqual(entry.note, "Reviewed ledger note")
        self.assertEqual(Transaction.objects.count(), 1)

    def test_password_required_for_locked_ebl_archive(self):
        pdf = synthetic_pdf("ebl_bank", ebl_details=PRINTED, password="synthetic-lock")
        uploaded = self.client.post(
            reverse("statement-import-list"),
            {
                "account": str(self.bank.pk),
                "file": SimpleUploadedFile("synthetic-locked.pdf", pdf),
                "password": "synthetic-lock",
            },
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        batch = StatementImport.objects.get(pk=uploaded.data["id"])
        row = batch.rows.get(position=1, component="principal")
        StatementRow.objects.filter(pk=row.pk).update(source_code="")
        url = reverse("statement-import-refresh-identifiers", args=[batch.pk])
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 400)
        self.assertEqual(
            self.client.post(
                url, {"password": "synthetic-lock"}, format="json"
            ).status_code,
            200,
        )
        row.refresh_from_db()
        self.assertEqual(row.source_code, "")

    def test_ebl_charge_guard_does_not_change_citytouch_mapping_behavior(self):
        from .counterparties import code_for_row

        row = self.row(1)
        row.batch.profile = "city_bank"
        row.type = "fee"
        row.source_code = ""
        row.extracted = {"description": "CT-FT-***1111-***2222"}
        self.assertEqual(code_for_row(row), "2222")

    def test_principal_and_near_equal_charge_are_not_rounding_variants(self):
        from types import SimpleNamespace

        from .rounding import corroborates, has_separate_fee, mark_fee_rows

        principal = self.row(1, amount="10.00", balance="990.00")
        fee = self.row(2, amount="9.99", balance="980.01")
        principal.refresh_from_db()
        fee.refresh_from_db()
        mark_fee_rows([principal, fee])
        self.assertTrue(has_separate_fee(principal))
        self.assertTrue(has_separate_fee(fee))
        self.assertFalse(
            corroborates(fee, SimpleNamespace(amount=Decimal("10.00")), {})
        )
        self.assertFalse(
            corroborates(principal, SimpleNamespace(amount=Decimal("9.99")), {})
        )

    def test_description_keywords_and_explicit_wallet_recipients(self):
        self.assertEqual(identifier("monthly SALARY credited", direction="credit"), "ebl:keyword:salary")
        self.assertEqual(identifier("PAYROLL July", direction="credit"), "ebl:keyword:salary")
        self.assertEqual(identifier(f"NPSB TRANSFER {PRINTED} monthly salary", direction="credit"), "ebl:keyword:salary")
        self.assertIsNone(identifier("SALARY", direction="debit"))
        for text in ["salary loan", "salary advance", "salary reversal", "salary refund", "salary returned"]:
            self.assertIsNone(identifier(text, direction="credit"), text)
        self.assertEqual(identifier("PataPay settlement"), "ebl:keyword:patapay")
        self.assertEqual(identifier("PATA PAY transaction"), "ebl:keyword:patapay")
        self.assertEqual(identifier("bKash fund transfer to 01700000000"), CODE)
        self.assertEqual(identifier("Bikash transfer beneficiary: 01700000000"), CODE)
        for text in ["bKash transfer A/C 01700000000", "bKash transfer //01700000000",
                     "bKash transfer //TO01700000000", "bKash transfer Reference: to 01700000000",
                     "bKash transfer ref# beneficiary 01700000000", "bKash transfer TRX ID: recipient 01700000000",
                     "bKash transfer to 01700000000 to 01800000000", "bKash transfer to 01700***000"]:
            self.assertEqual(identifier(text), "ebl:keyword:bkash", text)
        self.assertEqual(identifier("bKash transfer to 01700000000 //TO01800000000"), CODE)
        self.assertIsNone(identifier("random transaction to 01700000000"))
        self.assertIsNone(identifier("NPSB TRANSFER //SALARY", direction="credit"))
        self.assertIsNone(identifier("Unrelated credit ref: salary", direction="credit"))
        self.assertIsNone(identifier("Unrelated credit reference: PataPay"))
        self.assertEqual(identifier("bKash transfer ref: salary", direction="credit"), "ebl:keyword:bkash")

    def test_wallet_private_parser_retains_recipient_without_public_disclosure(self):
        pdf = synthetic_pdf("ebl_bank", ebl_heading="bKash fund transfer", ebl_details="to 01700000000")
        private = extract_statement(pdf, include_private_identifiers=True)
        public = extract_statement(pdf)
        self.assertEqual(private["rows"][0]["ebl_identifier"], CODE)
        self.assertNotIn("01700000000", str(public))
        self.assertEqual(source_fingerprint(public["rows"][0], "principal"), source_fingerprint(private["rows"][0], "principal"))

    def test_salary_category_hint_is_review_only_and_respects_saved_choices(self):
        row = self.row(1)
        row.source_code = ""
        row.type = "income"
        row.direction = "credit"
        row.extracted = {**row.extracted, "direction": "credit", "description": "Monthly salary credit"}
        row.save()
        category = Category.objects.get(user=self.user, name="Salary & Wages", kind="income")
        version = row.version
        hint = suggestions([row])[row.pk]
        self.assertEqual(hint["type"], "income")
        self.assertEqual(hint["category"], str(category.pk))
        self.assertIsNone(hint["other_account"])
        row.refresh_from_db()
        self.assertEqual(row.version, version)
        self.assertIsNone(row.category_id)
        self.assertEqual(Transaction.objects.count(), 0)
        custom = Category.objects.create(user=self.user, name="Custom payroll", kind="income")
        payload = self.payload(code="ebl:keyword:salary", direction="credit", suggested_type="income", category=str(custom.pk))
        response = self.client.post(reverse("statement-counterparty-codes"), payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(suggestions([row])[row.pk]["category"], str(custom.pk))
        row.classification_confirmed = True
        row.category = custom
        row.save()
        from .shared_suggestions import shared_category_name
        self.assertIsNone(shared_category_name(row))

    def test_retirement_migration_preserves_sources_financial_values_and_non_ebl_rules(self):
        from importlib import import_module
        from django.apps import apps
        from .bkash_identifiers import mapping_code
        from .models import StatementIdentifierSkip
        migration = import_module("apps.statements.migrations.0014_retire_npsb_own_card_clues")
        row = self.row(1)
        source = deepcopy(row.extracted)
        version = row.version
        row.classification_confirmed = True
        entry = Transaction.objects.create(user=self.user, account=self.bank, date=row.date,
            type="expense", direction="debit", amount="100.00", note="Preserve posted movement")
        row.transaction = entry
        row.state = "posted"
        row.save()
        rule = StatementCounterpartyCode.objects.create(user=self.user, account=self.bank, profile="ebl_bank",
            code=mapping_code("ebl_bank", self.bank.pk, OLD_MASK), direction="debit", ebl_mask_verified=True,
            party_kind="owned", label="Wrong old route", other_account=self.wallet, suggested_type="transfer")
        StatementIdentifierSkip.objects.create(user=self.user, account=self.bank, profile="ebl_bank", code=rule.code, direction="debit")
        keep = StatementCounterpartyCode.objects.create(user=self.user, account=self.wallet, profile="bkash",
            code=mapping_code("bkash", self.wallet.pk, "send:phone:01700000000"), direction="debit", party_kind="external", label="Keep wallet mapping")
        supported_row = self.row(2, wallet=True)
        supported_rules = []
        for code in ("ebl:keyword:salary", CODE):
            supported_rules.append(StatementCounterpartyCode.objects.create(user=self.user, account=self.bank,
                profile="ebl_bank", code=mapping_code("ebl_bank", self.bank.pk, code), direction="credit" if "salary" in code else "debit",
                party_kind="external", label="Preserve supported clue", ebl_mask_verified=True))
            StatementIdentifierSkip.objects.create(user=self.user, account=self.bank, profile="ebl_bank",
                code=supported_rules[-1].code, direction=supported_rules[-1].direction)
        editor = connection.schema_editor()
        migration.retire_own_card_clues(apps, editor)
        migration.retire_own_card_clues(apps, editor)
        row.refresh_from_db()
        self.assertEqual(row.source_code, "")
        self.assertEqual(row.version, version + 1)
        self.assertEqual(row.extracted, source)
        self.assertTrue(row.classification_confirmed)
        self.assertEqual(row.note, "Keep reviewed note")
        self.assertEqual(row.amount, Decimal("100.00"))
        self.assertFalse(StatementCounterpartyCode.objects.filter(pk=rule.pk).exists())
        self.assertEqual(StatementIdentifierSkip.objects.filter(profile="ebl_bank").count(), 2)
        self.assertEqual(StatementCounterpartyCode.objects.filter(pk__in=[rule.pk for rule in supported_rules]).count(), 2)
        supported_row.refresh_from_db()
        self.assertEqual(supported_row.source_code, CODE)
        self.assertTrue(StatementCounterpartyCode.objects.filter(pk=keep.pk).exists())
        self.assertEqual(row.state, "posted")
        self.assertEqual(row.transaction_id, entry.pk)
        entry.refresh_from_db()
        self.assertEqual(entry.amount, Decimal("100.00"))
        self.assertEqual(entry.note, "Preserve posted movement")
        self.assertEqual(Transaction.objects.count(), 1)
