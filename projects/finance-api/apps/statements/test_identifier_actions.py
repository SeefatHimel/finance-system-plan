"""Synthetic tests for optional identification and targeted cleanup."""

from copy import deepcopy
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.transactions.models import Transaction

from .bkash_identifiers import mapping_code
from .counterparties import code_suggestions
from .models import (
    StatementCounterpartyCode,
    StatementIdentifierSkip,
    StatementImport,
    StatementRow,
)


class IdentifierActionsTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-skip")
        self.other = get_user_model().objects.create_user(username="synthetic-foreign")
        self.bank = Account.objects.create(user=self.user, name="Synthetic bank", type="bank", currency="BDT")
        self.wallet = Account.objects.create(user=self.user, name="Synthetic wallet", type="mobile_wallet", currency="BDT")
        self.client.force_authenticate(self.user)
        self.batch = self.batch_for(self.bank, "city_bank", "a")
        self.row = self.make_row(self.batch, "***5678", "CT-FT-***1111-***5678")
        self.skip_url = reverse("statement-identifier-skip")
        self.directory_url = reverse("statement-counterparty-codes")
        self.cleanup_url = reverse("retired-ebl-cleanup")

    def batch_for(self, account, profile, digest):
        return StatementImport.objects.create(user=account.user, account=account, profile=profile,
            file_digest=digest * 64, parser_version="2", currency="BDT", account_identity="synthetic", page_count=1)

    def make_row(self, batch, code, description, position=1):
        return StatementRow.objects.create(batch=batch, position=position, component="principal",
            source_code=code, extracted={"description": description, "date": "2026-01-02", "direction": "debit", "amount": "100.00", "balance_after": "900.00"},
            source_fingerprint=f"synthetic-{batch.pk}-{position}", date=date(2026, 1, 2), direction="debit", amount="100.00", balance_after="900.00", type="expense", note="Keep this decision")

    def payload(self, **updates):
        return {"account": str(self.bank.pk), "profile": "city_bank", "code": "5678", "direction": "debit", "skipped": True, **updates}

    def rule(self, account, profile, code):
        return StatementCounterpartyCode.objects.create(user=account.user, account=account, profile=profile,
            code=mapping_code(profile, account.pk, code), direction="debit", party_kind="external", label="Synthetic party", suggested_type="expense")

    def test_skip_needs_no_name_persists_for_later_imports_and_restores(self):
        for _ in range(2):
            response = self.client.post(self.skip_url, self.payload(), format="json")
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(StatementIdentifierSkip.objects.count(), 1)
        self.make_row(self.batch, "***5678", "CT-FT-***2222-***5678", 2)
        item = self.client.get(self.directory_url).data["results"][0]
        self.assertTrue(item["skipped"])
        self.assertEqual(item["count"], 2)
        self.assertIsNone(item["mapping"])
        for _ in range(2):
            self.assertEqual(self.client.post(self.skip_url, self.payload(skipped=False), format="json").status_code, 200)
        self.assertFalse(self.client.get(self.directory_url).data["results"][0]["skipped"])
        self.assertEqual(Transaction.objects.count(), 0)

    def test_skip_pauses_a_saved_rule_and_restore_resumes_it(self):
        rule = self.rule(self.bank, "city_bank", "5678")
        self.assertIn(self.row.pk, code_suggestions([self.row]))
        self.client.post(self.skip_url, self.payload(), format="json")
        self.assertEqual(code_suggestions([self.row]), {})
        self.assertTrue(StatementCounterpartyCode.objects.filter(pk=rule.pk).exists())
        self.client.post(self.skip_url, self.payload(skipped=False), format="json")
        self.assertIn(self.row.pk, code_suggestions([self.row]))

    def test_saving_a_mapping_explicitly_unskips_it(self):
        self.client.post(self.skip_url, self.payload(), format="json")
        payload = {**self.payload(), "party_kind": "external", "label": "Named later", "suggested_type": "expense"}
        payload.pop("skipped")
        response = self.client.post(self.directory_url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(StatementIdentifierSkip.objects.count(), 0)
        self.assertIn(self.row.pk, code_suggestions([self.row]))

    def test_scope_rejects_foreign_unobserved_and_other_direction_requests(self):
        for updates in [{"code": "9999"}, {"direction": "credit"}, {"profile": "ebl_bank"}, {"account": str(self.wallet.pk)}]:
            self.assertEqual(self.client.post(self.skip_url, self.payload(**updates), format="json").status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(self.skip_url, self.payload(), format="json").status_code, 400)
        self.assertEqual(StatementIdentifierSkip.objects.count(), 0)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(self.skip_url, self.payload(), format="json").status_code, 401)

    def test_private_recipient_skip_is_stored_as_a_scoped_digest(self):
        batch = self.batch_for(self.wallet, "bkash", "b")
        code = "send:phone:01700000000"
        self.make_row(batch, code, "Send Money / synthetic masked details")
        response = self.client.post(self.skip_url, self.payload(account=str(self.wallet.pk), profile="bkash", code=code), format="json")
        self.assertEqual(response.status_code, 200, response.data)
        saved = StatementIdentifierSkip.objects.get()
        self.assertEqual(len(saved.code), 64)
        self.assertNotIn("01700000000", saved.code)
        self.assertEqual(self.client.get(self.directory_url)["Cache-Control"], "no-store")

    def ebl_fixture(self):
        batch = self.batch_for(self.bank, "ebl_bank", "c")
        old = self.make_row(batch, "npsb:code:765432109876", "NPSB TRANSFER 111122****123*||***9876|DC")
        correct = self.make_row(batch, "npsb:masked:111122****123*", "NPSB TRANSFER 111122****123*||***9877|DC", 2)
        rule = self.rule(self.bank, "ebl_bank", "npsb:code:765432109876")
        return old, correct, rule

    def test_cleanup_preview_is_read_only_and_only_clears_retired_metadata(self):
        old, correct, rule = self.ebl_fixture()
        foreign_bank = Account.objects.create(user=self.other, name="Foreign synthetic bank", type="bank")
        foreign_batch = self.batch_for(foreign_bank, "ebl_bank", "d")
        foreign_row = self.make_row(foreign_batch, "npsb:code:765432109877", "NPSB TRANSFER 111122****124*")
        foreign_rule = self.rule(foreign_bank, "ebl_bank", "npsb:code:765432109877")
        self.rule(self.bank, "city_bank", "5678")
        entry = Transaction.objects.create(user=self.user, account=self.bank, date=old.date, type="expense", direction="debit", amount="100.00", note="Posted note")
        old.transaction = entry; old.state = "posted"; old.classification_confirmed = True; old.save()
        source, version, correct_version = deepcopy(old.extracted), old.version, correct.version
        preview = self.client.get(self.cleanup_url)
        self.assertEqual(preview.data["retired_identifiers"], 1)
        self.assertEqual(preview.data["retired_rules"], 1)
        self.assertEqual(preview["Cache-Control"], "no-store")
        old.refresh_from_db()
        self.assertEqual(old.source_code, "npsb:code:765432109876")
        self.assertTrue(StatementCounterpartyCode.objects.filter(pk=rule.pk).exists())
        result = self.client.post(self.cleanup_url, {"revision": preview.data["revision"]}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data, {"cleared_identifiers": 1, "deleted_rules": 1})
        old.refresh_from_db(); correct.refresh_from_db(); entry.refresh_from_db()
        self.assertEqual(old.source_code, "")
        self.assertEqual(old.version, version + 1)
        self.assertEqual(old.extracted, source)
        self.assertEqual(old.state, "posted")
        self.assertTrue(old.classification_confirmed)
        self.assertEqual(old.transaction_id, entry.pk)
        self.assertEqual(old.note, "Keep this decision")
        self.assertEqual(str(entry.amount), "100.00")
        self.assertEqual(entry.note, "Posted note")
        self.assertEqual(correct.source_code, "npsb:masked:111122****123*")
        self.assertEqual(correct.version, correct_version)
        self.assertEqual(StatementCounterpartyCode.objects.get(user=self.user).profile, "city_bank")
        foreign_row.refresh_from_db()
        self.assertEqual(foreign_row.source_code, "npsb:code:765432109877")
        self.assertTrue(StatementCounterpartyCode.objects.filter(pk=foreign_rule.pk).exists())
        self.assertEqual(AuditLogEntry.objects.filter(metadata__operation="retired_ebl_identifier_cleanup").count(), 1)
        empty = self.client.get(self.cleanup_url).data
        self.assertEqual(empty["retired_identifiers"], 0)
        self.assertEqual(self.client.post(self.cleanup_url, {"revision": empty["revision"]}, format="json").data, {"cleared_identifiers": 0, "deleted_rules": 0})

    def test_cleanup_rejects_stale_tampered_expired_and_cross_owner_previews(self):
        old, _, _ = self.ebl_fixture()
        preview = self.client.get(self.cleanup_url).data
        for revision in ["bad", preview["revision"] + "changed"]:
            self.assertEqual(self.client.post(self.cleanup_url, {"revision": revision}, format="json").status_code, 409)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(self.cleanup_url, {"revision": preview["revision"]}, format="json").status_code, 409)
        self.assertEqual(self.client.get(self.cleanup_url).data["retired_identifiers"], 0)
        self.client.force_authenticate(self.user)
        with patch("django.core.signing.time.time", return_value=4102444800):
            self.assertEqual(self.client.post(self.cleanup_url, {"revision": preview["revision"]}, format="json").status_code, 409)
        old.version += 1; old.save(update_fields=["version"])
        self.assertEqual(self.client.post(self.cleanup_url, {"revision": preview["revision"]}, format="json").status_code, 409)
        old.refresh_from_db()
        self.assertEqual(old.source_code, "npsb:code:765432109876")

    def test_ebl_clues_can_be_skipped_without_creating_a_party(self):
        self.ebl_fixture()
        response = self.client.post(self.skip_url, self.payload(
            profile="ebl_bank", code="npsb:masked:111122****123*",
        ), format="json")
        self.assertEqual(response.status_code, 200, response.data)
        clue = next(row for row in self.client.get(self.directory_url).data["results"] if row["profile"] == "ebl_bank")
        self.assertTrue(clue["skipped"])
        self.assertIsNone(clue["mapping"])

    def test_verified_mask_mapping_preserves_skip_scope_and_survives_cleanup(self):
        old, correct, _ = self.ebl_fixture()
        skip = self.payload(profile="ebl_bank", code="npsb:masked:111122****123*")
        self.client.post(self.skip_url, skip, format="json")
        saved = self.client.post(self.directory_url, {
            **skip, "party_kind": "external", "label": "Verified masked party",
            "suggested_type": "expense", "note_template": "Reviewed note suggestion",
        }, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertFalse(StatementIdentifierSkip.objects.exists())
        verified = StatementCounterpartyCode.objects.get(pk=saved.data["id"])
        self.assertTrue(verified.ebl_mask_verified)
        self.assertIn(correct.pk, code_suggestions([correct]))
        self.client.post(self.skip_url, skip, format="json")
        self.assertEqual(code_suggestions([correct]), {})
        self.client.post(self.skip_url, {**skip, "skipped": False}, format="json")
        self.assertIn(correct.pk, code_suggestions([correct]))

        preview = self.client.get(self.cleanup_url).data
        self.assertEqual(preview["retired_rules"], 1)
        result = self.client.post(self.cleanup_url, {"revision": preview["revision"]}, format="json")
        self.assertEqual(result.status_code, 200, result.data)
        verified.refresh_from_db()
        self.assertTrue(verified.ebl_mask_verified)
        self.assertEqual(verified.note_template, "Reviewed note suggestion")
        self.assertIn(correct.pk, code_suggestions([correct]))
        self.assertEqual(self.client.get(self.cleanup_url).data["retired_rules"], 0)
        old.refresh_from_db()
        self.assertEqual(old.source_code, "")
        self.assertEqual(Transaction.objects.count(), 0)

    def test_cleanup_preview_cannot_delete_a_subsequently_verified_mask_rule(self):
        self.ebl_fixture()
        legacy = self.rule(self.bank, "ebl_bank", "npsb:masked:111122****123*")
        preview = self.client.get(self.cleanup_url).data
        saved = self.client.post(self.directory_url, {
            "account": str(self.bank.pk), "profile": "ebl_bank",
            "code": "npsb:masked:111122****123*", "direction": "debit",
            "party_kind": "external", "label": "Newly verified party",
        }, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["id"], str(legacy.pk))
        result = self.client.post(self.cleanup_url, {"revision": preview["revision"]}, format="json")
        self.assertEqual(result.status_code, 409)
        legacy.refresh_from_db()
        self.assertTrue(legacy.ebl_mask_verified)
