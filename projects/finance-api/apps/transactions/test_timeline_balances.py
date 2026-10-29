from datetime import time
from copy import deepcopy
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from apps.accounts.models import Account
from apps.statements.models import StatementImport, StatementRow
from .models import Transaction, TimelineBalanceAllocation, TransferEvidence


class SharedStatementBalanceTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="shared-balance-owner")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(user=self.user, name="Example bank", type="bank")
        self.anchor = self.movement(50, 1000, "debit", time(10), day="2026-06-01")
        self.principal = self.movement(100, 1115, "credit", time(14))
        self.fee = self.movement(15, 1115, "credit", time(14))
        self.batch = StatementImport.objects.create(user=self.user, account=self.account, profile="ebl_bank", file_digest="a" * 64,
            parser_version="1", currency="BDT", account_identity="verified", page_count=1)
        self.original = {"date": "2026-06-02", "amount": "100.00", "signed_fee": "15.00", "balance_after": "1115.00", "direction": "credit"}
        self.sources = [StatementRow.objects.create(batch=self.batch, position=1, component=component, extracted=deepcopy(self.original), source_fingerprint=component,
            date="2026-06-02", time=time(14), amount=amount, balance_after=1115, type="refund", direction="credit", state="linked", transaction=entry)
            for component, amount, entry in [("principal", 100, self.principal), ("fee", 15, self.fee)]]
        self.url = f"/api/timeline-balances/{self.principal.pk}/"
    def movement(self, amount, balance, direction, at, day="2026-06-02"):
        return Transaction.objects.create(user=self.user, account=self.account, date=day, time=at, amount=amount, balance_after=balance, type="refund", direction=direction)
    def listing(self):
        response = self.client.get("/api/timeline-balances/?start_date=2026-06-02&end_date=2026-06-02")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["results"]
    def decide(self, preview, action="apply"):
        return self.client.post(self.url, {"revision": preview["revision"], "fingerprint": preview["fingerprint"], "action": action}, format="json")
    def test_exact_source_linked_pair_apply_and_undo_never_change_originals(self):
        original = list(Transaction.objects.values())
        sources = list(StatementRow.objects.values())
        preview = self.listing()[0]
        self.assertEqual(preview["status"], "suggested")
        self.assertEqual(preview["balances"], {str(self.principal.pk): "1100.00", str(self.fee.pk): "1115.00"})
        self.assertEqual(self.decide(preview).status_code, 200)
        confirmed = self.listing()[0]
        self.assertEqual(confirmed["status"], "confirmed")
        self.assertEqual(self.decide(confirmed, "undo").status_code, 200)
        self.assertEqual(self.listing()[0]["status"], "suggested")
        self.assertEqual(list(Transaction.objects.values()), original)
        self.assertEqual(list(StatementRow.objects.values()), sources)
        self.assertEqual(self.user.audit_log_entries.count(), 2)
    def test_arithmetic_alone_and_different_printed_rows_never_qualify(self):
        self.sources[1].position = 2
        self.sources[1].save()
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.decide({"revision": 0, "fingerprint": "x"}).status_code, 400)
    def test_wrong_total_and_one_cent_difference_decline(self):
        self.anchor.balance_after = "1000.01"
        self.anchor.save()
        self.assertEqual(self.listing(), [])
    def test_source_amount_or_direction_changes_decline(self):
        for field, value in [("amount", "101"), ("direction", "debit"), ("balance_after", "1116")]:
            entry = self.sources[0]
            before = getattr(entry, field)
            setattr(entry, field, value); entry.save()
            self.assertEqual(self.listing(), [])
            setattr(entry, field, before); entry.save()
    def test_missing_time_unknown_intervening_movement_and_tied_anchor_decline(self):
        self.principal.time = None; self.principal.save()
        self.assertEqual(self.listing(), [])
        self.principal.time = time(14); self.principal.save()
        extra = self.movement(1, None, "debit", None)
        self.assertEqual(self.listing(), [])
        extra.delete()
        extra = self.movement(1, None, "debit", time(10), day="2026-06-01")
        self.assertEqual(self.listing(), [])
    def test_unrelated_same_time_row_declines_even_when_math_reconciles(self):
        self.movement(1, None, "credit", time(14))
        self.assertEqual(self.listing(), [])
    def test_later_movements_do_not_block_proven_previous_interval(self):
        self.movement(10, 1105, "debit", time(15))
        self.assertEqual(len(self.listing()), 1)
    def test_missing_anchor_card_currency_and_cross_account_decline(self):
        for field, value in [("type", "credit_card"), ("currency", "USD")]:
            old = getattr(self.account, field)
            setattr(self.account, field, value); self.account.save()
            self.assertEqual(self.listing(), [])
            setattr(self.account, field, old); self.account.save()
        self.anchor.balance_after = None; self.anchor.save()
        self.assertEqual(self.listing(), [])
    def test_conflicting_second_statement_source_declines(self):
        batch = StatementImport.objects.create(user=self.user, account=self.account, profile="ebl_bank", file_digest="b" * 64,
            parser_version="1", currency="BDT", account_identity="verified", page_count=1)
        StatementRow.objects.create(batch=batch, position=1, component="principal", extracted={}, source_fingerprint="second", date="2026-06-02", type="refund", direction="credit", transaction=self.principal)
        self.assertEqual(self.listing(), [])
    def test_changed_source_invalidates_and_undo_still_works(self):
        preview = self.listing()[0]
        self.assertEqual(self.decide(preview).status_code, 200)
        self.sources[0].note = "Reviewed source changed"; self.sources[0].version += 1; self.sources[0].save()
        stale = self.listing()[0]
        self.assertEqual(stale["status"], "stale")
        self.assertEqual(self.decide(preview).status_code, 400)
        self.assertEqual(self.decide(stale, "undo").status_code, 200)
    def test_no_longer_eligible_confirmation_withholds_values(self):
        preview = self.listing()[0]; self.decide(preview)
        self.fee.amount = 16; self.fee.save()
        stale = self.listing()[0]
        self.assertEqual(stale["status"], "stale")
        self.assertEqual(stale["balances"], {})
        self.assertEqual(self.decide(stale, "undo").status_code, 200)
    def test_deleted_fee_removes_suggestion_and_stales_confirmation(self):
        self.decide(self.listing()[0]); self.fee.delete()
        self.assertEqual(self.listing()[0]["status"], "stale")
    def test_preview_fingerprint_revision_and_user_isolation(self):
        preview = self.listing()[0]
        self.anchor.balance_after = 1001; self.anchor.save()
        self.assertEqual(self.decide(preview).status_code, 400)
        self.anchor.balance_after = 1000; self.anchor.save()
        self.assertEqual(self.decide(preview).status_code, 400)  # version still changed
        other = get_user_model().objects.create_user(username="shared-balance-other")
        self.client.force_authenticate(other)
        self.assertEqual(self.listing(), [])
        self.assertEqual(self.decide(preview).status_code, 404)
    def test_debit_principal_and_fee_are_supported_without_percentage_guessing(self):
        self.principal.direction = "debit"; self.principal.balance_after = 883; self.principal.save()
        self.fee.direction = "debit"; self.fee.amount = 17; self.fee.balance_after = 883; self.fee.save()
        for source, amount in zip(self.sources, [100, 17]):
            source.direction = "debit"; source.amount = amount; source.balance_after = 883
            source.extracted = {**self.original, "direction": "debit", "signed_fee": "-17.00", "balance_after": "883.00"}; source.save()
        self.assertEqual(self.listing()[0]["balances"][str(self.principal.pk)], "900.00")
    def test_invalid_range_and_revision_type_fail(self):
        self.assertEqual(self.client.get("/api/timeline-balances/?start_date=bad&end_date=bad").status_code, 400)
        self.assertEqual(self.client.get("/api/timeline-balances/?start_date=2026-06-02&end_date=2026-05-01").status_code, 400)
        self.assertEqual(self.client.post(self.url, {"revision": True, "action": "apply"}, format="json").status_code, 400)

    def test_moved_pair_keeps_saved_revision_and_requires_new_confirmation(self):
        self.decide(self.listing()[0])
        for entry in [self.principal, self.fee]:
            entry.date = "2026-06-03"; entry.save()
        for source in self.sources:
            source.date = "2026-06-03"; source.extracted = {**self.original, "date": "2026-06-03"}; source.save()
        response = self.client.get("/api/timeline-balances/?start_date=2026-06-03&end_date=2026-06-03")
        preview = response.data["results"][0]
        self.assertEqual(preview["status"], "stale")
        self.assertEqual(preview["revision"], 1)
        self.assertEqual(self.decide(preview).status_code, 200)

    def test_no_authentication_cannot_read_or_apply(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/timeline-balances/?start_date=2026-06-02&end_date=2026-06-02").status_code, 401)
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 401)

    def test_malformed_json_and_action_are_validation_errors(self):
        self.assertEqual(self.client.post(self.url, [], format="json").status_code, 400)
        self.assertEqual(self.client.post(self.url, {"revision": 0, "action": [], "fingerprint": ""}, format="json").status_code, 400)

    def test_conflicting_independent_sms_report_declines(self):
        TransferEvidence.objects.create(user=self.user, transaction=self.principal, account=self.account,
            date=self.principal.date, time=self.principal.time, direction="credit", source="sms", balance_after=1100)
        self.assertEqual(self.listing(), [])

    def test_earliest_supported_date_does_not_overflow_lookback(self):
        response = self.client.get("/api/timeline-balances/?start_date=0001-01-01&end_date=0001-01-01")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])
