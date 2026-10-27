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
CODE = "npsb:masked:111122****123*"
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
        self, position, *, amount="100.00", balance="900.00", ref="SYNTH-ONE", code=CODE,
        movement_code="765432109876",
    ):
        printed = PRINTED.replace("765432109876", movement_code)
        description = f"NPSB FUND TRANSFER {printed} TO NPSB ACCOUNT //{ref}"
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
            source_code=code,
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

    def test_extracts_mask_including_trailing_star_never_movement_field(self):
        self.assertEqual(identifier(f"NPSB FUND TRANSFER {PRINTED}"), CODE)
        self.assertEqual(identifier(f"NPSB TRANSFER {PRINTED} {PRINTED}"), CODE)
        self.assertEqual(identifier(PRINTED.replace("765432109876", "765432109877") + " NPSB TRANSFER"), CODE)
        self.assertEqual(identifier("NPSB TRANSFER 111122****123*||765432109876||DC"), CODE)
        for text in [
            "NPSB FUND TRANSFER //999VMT123456789",
            "NPSB FUND TRANSFER ||765432109876|DC",
            "NPSB FUND TRANSFER 765432109876",
            "NPSB FUND TRANSFER ||***9876||",
            f"CARD PURCHASE {PRINTED}",
            f"NPSB TRANSFER {PRINTED} 111122****124*",
        ]:
            self.assertIsNone(identifier(text), text)
        self.assertEqual(movement_reference("//SYNTH-ONE //SYNTH-ONE"), "SYNTH-ONE")
        self.assertIsNone(movement_reference("//SYNTH-ONE //SYNTH-TWO"))

    def test_private_parser_retention_does_not_leak_into_preview_or_fingerprint(self):
        pdf = synthetic_pdf("ebl_bank", ebl_details=PRINTED)
        public = extract_statement(pdf)
        private = extract_statement(pdf, include_private_identifiers=True)
        self.assertEqual(private["rows"][0]["ebl_identifier"], CODE)
        self.assertNotIn("765432109876", str(public))
        self.assertNotIn("ebl_identifier", public["rows"][0])
        self.assertEqual(
            source_fingerprint(public["rows"][0], "principal"),
            source_fingerprint(private["rows"][0], "principal"),
        )

    def test_legacy_rules_stay_disabled_until_mask_mapping_is_explicitly_saved(self):
        from .bkash_identifiers import mapping_code
        from .counterparties import code_suggestions

        principal = self.row(1, code=RETIRED)
        fee = self.row(2, amount="9.99", balance="890.01", code=RETIRED)
        url = reverse("statement-counterparty-codes")
        for code in [RETIRED, CODE]:
            StatementCounterpartyCode.objects.create(
                user=self.user, account=self.bank, profile="ebl_bank",
                code=mapping_code("ebl_bank", self.bank.pk, code), direction="debit",
                party_kind="owned", label="Obsolete synthetic recipient",
                other_account=self.wallet, suggested_type="transfer",
            )
        self.assertEqual(self.client.post(url, self.payload(code=RETIRED), format="json").status_code, 400)
        listed = self.client.get(url)
        self.assertEqual(listed.data["count"], 1)
        self.assertEqual(listed.data["results"][0]["code"], CODE)
        self.assertIsNone(listed.data["results"][0]["mapping"])
        self.assertEqual(code_suggestions([principal, fee]), {})
        result = suggestions([principal, fee])
        self.assertNotIn(principal.pk, result)
        self.assertEqual(result[fee.pk]["type"], "fee")
        self.assertIsNone(result[fee.pk]["other_account"])

        saved = self.client.post(url, self.payload(), format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        rule = StatementCounterpartyCode.objects.get(pk=saved.data["id"])
        self.assertTrue(rule.ebl_mask_verified)
        self.assertEqual(rule.code, mapping_code("ebl_bank", self.bank.pk, CODE))
        self.assertEqual(len(rule.code), 64)
        self.assertNotIn("111122", rule.code)
        self.assertEqual(self.client.get(url).data["results"][0]["mapping"]["label"], self.payload()["label"])
        self.assertEqual(code_suggestions([principal, fee])[principal.pk]["type"], "expense")
        self.assertNotIn(fee.pk, code_suggestions([principal, fee]))
        self.assertEqual(suggestions([principal, fee])[fee.pk]["type"], "fee")
        fee.refresh_from_db()
        self.assertEqual(fee.type, "expense")
        self.assertEqual(fee.amount, Decimal("9.99"))
        self.assertEqual(Transaction.objects.count(), 0)
        fee.classification_confirmed = True
        fee.save(update_fields=["classification_confirmed"])
        self.assertNotIn(fee.pk, suggestions([fee]))

    def test_mask_mapping_supports_owned_routes_categories_notes_edit_and_forget(self):
        from .counterparties import code_suggestions

        row = self.row(1)
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

    def test_mask_mapping_does_not_cross_reporting_accounts_or_directions(self):
        from .counterparties import code_suggestions

        principal = self.row(1)
        credit = self.row(2, ref="SYNTH-CREDIT")
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
        other_row = self.row(3, ref="SYNTH-OTHER")
        other_row.batch = other_batch
        other_row.save()
        saved = self.client.post(reverse("statement-counterparty-codes"), self.payload(), format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(set(code_suggestions([principal, credit, other_row])), {principal.pk})

    def test_mask_mapping_validates_observation_ownership_direction_and_account_path(self):
        self.row(1)
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
        principal.source_code = CODE
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
        fee.source_code = CODE
        extra = self.row(3, amount="1.00", balance="897.00")
        self.assertEqual(possible_fee_ids([principal, fee, extra]), set())

    def test_independent_references_count_as_separate_movements(self):
        self.row(1)
        self.row(2, amount="2.00", balance="898.00")
        for position, amount, balance in [(3, "200.00", "698.00"), (4, "2.00", "696.00")]:
            self.row(position, ref="SYNTH-TWO", amount=amount, balance=balance,
                     code="npsb:code:765432109877", movement_code="765432109877")
        response = self.client.get(reverse("statement-counterparty-codes"))
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], CODE)
        self.assertEqual(response.data["results"][0]["count"], 2)

    def test_ebl_clues_are_owner_scoped_and_derive_from_immutable_masks(self):
        row = self.row(1, code=RETIRED)
        row.counterparty_text = "Edited merchant"
        row.note = "Edited note"
        row.save(update_fields=["counterparty_text", "note"])
        url = reverse("statement-counterparty-codes")
        listed = self.client.get(url)
        self.assertEqual(listed.data["results"][0]["code"], CODE)
        self.assertNotIn("765432109876", str(listed.data))
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(url).data["count"], 0)

    def test_import_and_archived_refresh_preserve_decisions_and_ledger(self):
        batch, pdf = self.upload()
        row = batch.rows.get(position=1, component="principal")
        self.assertEqual(row.source_code, CODE)
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
        self.assertEqual(row.source_code, CODE)
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
        self.assertEqual(row.source_code, CODE)
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
        self.assertEqual(row.source_code, CODE)

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
