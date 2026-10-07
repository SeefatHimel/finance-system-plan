from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SenderRule,
    SenderRuleMapping,
)
from apps.messages.parsers import parse_raw_message
from apps.payment_methods.models import PaymentMethod

from .models import Transaction, TransferEvidence
from .services import calculate_account_balance_summaries


class TransferMatchingTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="transfer-test")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(
            user=self.user, name="A", type="bank", starting_balance="10000.00"
        )
        self.b = Account.objects.create(
            user=self.user, name="B", type="bank", starting_balance="2000.00"
        )
        self.day = timezone.localdate().isoformat()

    def draft(self, **changes):
        return {
            "account": str(self.a.id),
            "transfer_account": str(self.b.id),
            "amount": "1000.00",
            "date": self.day,
            "type": "transfer",
            "direction": "debit",
            **changes,
        }

    def post_transfer(self, **changes):
        response = self.client.post(
            reverse("transaction-list"), self.draft(**changes), format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def candidate(
        self, incoming=False, known_source=True, reference="TEST", provider="city_bank"
    ):
        raw = RawMessage.objects.create(
            user=self.user,
            sender=provider,
            body="Synthetic evidence",
            body_hash=reference,
            received_at=timezone.now(),
        )
        return ParsedMessageCandidate.objects.create(
            user=self.user,
            raw_message=raw,
            provider=provider,
            reference=reference,
            account=self.a if known_source else self.b,
            destination_account=self.b if known_source else None,
            amount="1000.00",
            transaction_type="transfer",
            possible_internal_transfer=True,
            message_kind="bank_transfer_in" if incoming else "bank_transfer_out",
            balance_after="3000.00" if incoming else "9000.00",
        )

    def matches(self, **payload):
        response = self.client.post(
            reverse("transaction-transfer-matches"), payload, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def link(self, **payload):
        return self.client.post(
            reverse("transaction-link-transfer"), payload, format="json"
        )

    def test_manual_incoming_suggests_and_links_once(self):
        saved = self.post_transfer(balance_after="9000.00")
        incoming = self.draft(
            account=str(self.b.id),
            transfer_account=str(self.a.id),
            direction="credit",
            balance_after="3000.00",
            reference="B-REF",
        )
        self.assertEqual(self.matches(draft=incoming)[0]["id"], saved["id"])
        response = self.link(match_transaction=saved["id"], draft=incoming)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(len(response.data["transfer_evidence"]), 2)
        balances = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(balances[self.a.id].ledger_balance, Decimal("9000.00"))
        self.assertEqual(balances[self.b.id].ledger_balance, Decimal("3000.00"))
        self.assertEqual(
            balances[self.a.id].latest_reported_balance, Decimal("9000.00")
        )
        self.assertEqual(
            balances[self.b.id].latest_reported_balance, Decimal("3000.00")
        )

    def test_real_reverse_transfer_is_not_a_match(self):
        self.post_transfer()
        self.assertEqual(
            self.matches(
                draft=self.draft(
                    account=str(self.b.id), transfer_account=str(self.a.id)
                )
            ),
            [],
        )

    def receiving_review_draft(self, **changes):
        return {
            "account_perspective": True,
            "account": str(self.b.id),
            "transfer_account": str(self.a.id),
            "direction": "credit",
            "type": "transfer",
            **changes,
        }

    def test_receiving_sms_review_matches_existing_transfer_from_selected_account(self):
        saved = self.post_transfer(balance_after="9000.00")
        incoming = self.candidate(incoming=True)
        draft = self.receiving_review_draft()
        self.assertEqual(
            self.matches(candidate=str(incoming.id), draft=draft)[0]["id"], saved["id"]
        )
        response = self.link(
            candidate=str(incoming.id), draft=draft, match_transaction=saved["id"]
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        evidence = TransferEvidence.objects.get(raw_message=incoming.raw_message)
        self.assertEqual(
            (evidence.account_id, evidence.direction), (self.b.id, "credit")
        )
        self.assertEqual(evidence.balance_after, Decimal("3000.00"))
        balances = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(balances[self.a.id].ledger_balance, Decimal("9000.00"))
        self.assertEqual(balances[self.b.id].ledger_balance, Decimal("3000.00"))

    def test_receiving_sms_confirm_normalizes_accounts_and_payment_method(self):
        incoming = self.candidate(incoming=True, known_source=False)
        method = PaymentMethod.objects.create(
            user=self.user, account=self.b, name="Synthetic card"
        )
        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": incoming.id}),
            self.receiving_review_draft(payment_method=str(method.id)),
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        record = Transaction.objects.get()
        self.assertEqual(
            (record.account_id, record.transfer_account_id, record.direction),
            (self.a.id, self.b.id, "debit"),
        )
        self.assertIsNone(record.payment_method)
        self.assertEqual(TransferEvidence.objects.get().account_id, self.b.id)

    def test_explicit_receiving_direction_overrides_detected_outgoing_kind(self):
        saved = self.post_transfer()
        candidate = self.candidate(incoming=False)
        response = self.link(
            candidate=str(candidate.id),
            draft=self.receiving_review_draft(),
            match_transaction=saved["id"],
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            TransferEvidence.objects.get(raw_message=candidate.raw_message).account_id,
            self.b.id,
        )

    def test_debit_from_card_is_still_a_real_reverse_transfer(self):
        self.post_transfer()
        incoming = self.candidate(incoming=True)
        self.assertEqual(
            self.matches(
                candidate=str(incoming.id),
                draft=self.receiving_review_draft(direction="debit"),
            ),
            [],
        )

    def test_receiving_review_rejects_payment_method_of_other_account(self):
        incoming = self.candidate(incoming=True)
        method = PaymentMethod.objects.create(
            user=self.user, account=self.a, name="Synthetic bank"
        )
        response = self.client.post(
            reverse("transaction-transfer-matches"),
            {
                "candidate": str(incoming.id),
                "draft": self.receiving_review_draft(payment_method=str(method.id)),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_receiving_review_can_link_when_other_account_is_unknown(self):
        saved = self.post_transfer()
        incoming = self.candidate(incoming=True, known_source=False)
        draft = self.receiving_review_draft(transfer_account=None)
        self.assertEqual(
            self.matches(candidate=str(incoming.id), draft=draft)[0]["id"], saved["id"]
        )
        response = self.link(
            candidate=str(incoming.id), draft=draft, match_transaction=saved["id"]
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_standalone_receiving_review_requires_other_account(self):
        incoming = self.candidate(incoming=True, known_source=False)
        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": incoming.id}),
            self.receiving_review_draft(transfer_account=None),
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("transfer_account", response.data)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_learned_source_does_not_replace_identified_receiving_account(self):
        method = PaymentMethod.objects.create(
            user=self.user,
            account=self.b,
            name="Synthetic card",
            provider="city_bank",
            identifier="****2222",
        )
        rule = SenderRule.objects.create(
            user=self.user,
            account=self.b,
            payment_method=method,
            provider="city_bank",
            sender="SYNTHETIC-CARD",
            name="Synthetic rule",
        )
        SenderRuleMapping.objects.create(
            user=self.user,
            sender_rule=rule,
            account=self.a,
            message_kind="bank_transfer_in",
            transaction_type="transfer",
        )
        raw = RawMessage(
            user=self.user,
            sender="SYNTHETIC-CARD",
            body="BDT 1,000.00 credited to A/C ****2222. Balance BDT 3,000.",
            received_at=timezone.now(),
        )
        parsed = parse_raw_message(raw)
        self.assertEqual(parsed["account"], self.b)
        self.assertEqual(parsed["payment_method"], method)
        self.assertEqual(parsed["transaction_type"], "transfer")

    def test_remembering_receiving_review_preserves_pending_receivers(self):
        incoming = self.candidate(incoming=True, known_source=False, reference="FIRST")
        pending = self.candidate(incoming=True, known_source=False, reference="NEXT")
        rule = SenderRule.objects.create(
            user=self.user,
            account=self.b,
            provider="city_bank",
            sender="SYNTHETIC-CARD",
            name="Synthetic rule",
        )
        for candidate in (incoming, pending):
            candidate.sender_rule = rule
            candidate.save()
        response = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": incoming.id}),
            self.receiving_review_draft(remember_mapping=True),
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        pending.refresh_from_db()
        self.assertEqual(pending.account_id, self.b.id)
        self.assertEqual(pending.status, "needs_review")

    def test_manual_credit_normalizes_to_source_destination(self):
        saved = self.post_transfer(
            account=str(self.b.id),
            transfer_account=str(self.a.id),
            direction="credit",
            balance_after="3000.00",
        )
        self.assertEqual(str(saved["account"]), str(self.a.id))
        self.assertEqual(str(saved["transfer_account"]), str(self.b.id))
        self.assertEqual(saved["direction"], "debit")
        self.assertEqual(str(saved["transfer_evidence"][0]["account"]), str(self.b.id))

    def test_destination_history_and_direction(self):
        saved = self.post_transfer()
        response = self.client.get(
            reverse("transaction-list"),
            {"account": str(self.b.id), "direction": "credit"},
        )
        self.assertEqual(response.data[0]["id"], saved["id"])
        self.assertEqual(response.data[0]["account_direction"], "credit")
        self.assertEqual(
            self.client.get(
                reverse("transaction-list"),
                {"account": str(self.b.id), "direction": "debit"},
            ).data,
            [],
        )

    def test_same_provider_pending_pair(self):
        outgoing = self.candidate(reference="OUT")
        incoming = self.candidate(incoming=True, reference="IN")
        suggestions = self.matches(candidate=str(incoming.id))
        self.assertEqual(suggestions[0]["id"], str(outgoing.id))
        self.assertEqual(suggestions[0]["kind"], "candidate")
        response = self.link(
            candidate=str(incoming.id), match_candidate=str(outgoing.id)
        )
        self.assertEqual(response.status_code, 200, response.data)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.status, "confirmed")
        self.assertEqual(incoming.transaction_id, outgoing.transaction_id)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            set(TransferEvidence.objects.values_list("reference", flat=True)),
            {"OUT", "IN"},
        )

    def test_late_incoming_sms_without_source_hint(self):
        saved = self.post_transfer()
        incoming = self.candidate(incoming=True, known_source=False)
        self.assertEqual(self.matches(candidate=str(incoming.id))[0]["id"], saved["id"])
        response = self.link(candidate=str(incoming.id), match_transaction=saved["id"])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(
            TransferEvidence.objects.get(raw_message=incoming.raw_message).account_id,
            self.b.id,
        )

    def test_same_side_messages_are_not_paired(self):
        outgoing = self.candidate(reference="OUT1")
        self.candidate(reference="OUT2")
        self.assertEqual(self.matches(candidate=str(outgoing.id)), [])

    def test_sms_link_retry_is_idempotent(self):
        saved = self.post_transfer()
        record = Transaction.objects.get(pk=saved["id"])
        added_at = record.created_at
        old_updated_at = timezone.now() - timedelta(days=2)
        Transaction.objects.filter(pk=record.pk).update(updated_at=old_updated_at)
        incoming = self.candidate(incoming=True)
        payload = {"candidate": str(incoming.id), "match_transaction": saved["id"]}
        self.assertEqual(self.link(**payload).status_code, 200)
        record.refresh_from_db()
        linked_at = record.updated_at
        self.assertGreater(linked_at, old_updated_at)
        self.assertEqual(record.created_at, added_at)
        self.assertEqual(self.link(**payload).status_code, 200)
        record.refresh_from_db()
        self.assertEqual(record.updated_at, linked_at)
        self.assertEqual(TransferEvidence.objects.count(), 2)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_mismatched_and_cross_user_targets_rejected(self):
        saved = self.post_transfer()
        self.assertEqual(
            self.link(
                match_transaction=saved["id"], draft=self.draft(amount="2000.00")
            ).status_code,
            400,
        )
        user = get_user_model().objects.create_user(username="other-transfer-user")
        other = Transaction.objects.create(
            user=user,
            account=Account.objects.create(user=user, name="Other", type="bank"),
            transfer_account=Account.objects.create(
                user=user, name="Other2", type="bank"
            ),
            amount="1000.00",
            date=self.day,
            type="transfer",
        )
        self.assertEqual(
            self.link(match_transaction=str(other.id), draft=self.draft()).status_code,
            404,
        )
        self.assertEqual(TransferEvidence.objects.count(), 1)

    def test_repeated_transfers_stay_separate_until_accepted(self):
        self.post_transfer()
        self.post_transfer()
        self.assertEqual(len(self.matches(draft=self.draft())), 2)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_merge_posted_transfers_preserves_evidence_and_audit(self):
        first = self.post_transfer(reference="OUT", balance_after="9000.00")
        old_updated_at = timezone.now() - timedelta(days=2)
        Transaction.objects.filter(pk=first["id"]).update(updated_at=old_updated_at)
        second = self.post_transfer(
            account=str(self.b.id),
            transfer_account=str(self.a.id),
            direction="credit",
            reference="IN",
            balance_after="3000.00",
        )
        response = self.client.post(
            reverse("transaction-merge-transfer", kwargs={"pk": first["id"]}),
            {"transaction": second["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(len(response.data["transfer_evidence"]), 2)
        record = Transaction.objects.get(pk=first["id"])
        self.assertGreater(record.updated_at, old_updated_at)
        self.assertEqual(response.data["created_at"], first["created_at"])
        deleted_audit = AuditLogEntry.objects.get(metadata__merged_into=first["id"])
        self.assertEqual(len(deleted_audit.before["transfer_evidence"]), 1)
        self.assertEqual(
            calculate_account_balance_summaries(accounts=[self.b])[
                self.b.id
            ].ledger_balance,
            Decimal("3000.00"),
        )

    def test_pending_target_confirmed_by_other_client_reuses_transfer(self):
        outgoing = self.candidate(reference="OUT")
        incoming = self.candidate(incoming=True, reference="IN")
        confirm = self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": outgoing.id}),
            {},
            format="json",
        )
        self.assertEqual(confirm.status_code, 200, confirm.data)
        response = self.link(
            candidate=str(incoming.id), match_candidate=str(outgoing.id)
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_report_transfer_count_and_income_expenses(self):
        saved = self.post_transfer()
        self.assertEqual(
            self.link(match_transaction=saved["id"], draft=self.draft()).status_code,
            200,
        )
        report = self.client.get(
            reverse("monthly-report"), {"month": self.day[:7]}
        ).data
        self.assertEqual(report["income_total"], "0.00")
        self.assertEqual(report["expense_total"], "0.00")
        accounts = {row["name"]: row for row in report["accounts"]}
        self.assertEqual(accounts["A"]["money_out"], "1000.00")
        self.assertEqual(accounts["B"]["money_in"], "1000.00")

    def test_old_dates_not_suggested(self):
        self.post_transfer(date=(timezone.localdate() - timedelta(days=4)).isoformat())
        self.assertEqual(self.matches(draft=self.draft()), [])

    def test_same_provider_same_reference_preserves_both_balances(self):
        outgoing = self.candidate(reference="SHARED-REF")
        incoming = self.candidate(incoming=True, reference="SECOND-RAW")
        incoming.reference = outgoing.reference
        incoming.save()
        response = self.link(
            candidate=str(incoming.id), match_candidate=str(outgoing.id)
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TransferEvidence.objects.count(), 2)
        balances = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(
            balances[self.a.id].latest_reported_balance, Decimal("9000.00")
        )
        self.assertEqual(
            balances[self.b.id].latest_reported_balance, Decimal("3000.00")
        )

    def test_manual_link_retry_key_does_not_duplicate_evidence(self):
        saved = self.post_transfer()
        payload = {
            "match_transaction": saved["id"],
            "draft": self.draft(external_key="synthetic-retry-key"),
        }
        self.assertEqual(self.link(**payload).status_code, 200)
        self.assertEqual(self.link(**payload).status_code, 200)
        self.assertEqual(TransferEvidence.objects.count(), 2)

    def test_manual_create_retry_key_does_not_duplicate_transfer(self):
        self.post_transfer(external_key="synthetic-create-key")
        self.post_transfer(external_key="synthetic-create-key")
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(AuditLogEntry.objects.filter(action="created").count(), 1)

    def test_rejection_and_wrong_side_do_not_attach_evidence(self):
        saved = self.post_transfer()
        incoming = self.candidate(incoming=True)
        incoming.status = "ignored"
        incoming.save()
        self.assertEqual(
            self.link(
                candidate=str(incoming.id), match_transaction=saved["id"]
            ).status_code,
            400,
        )
        self.assertEqual(TransferEvidence.objects.count(), 1)

    def test_linked_amount_edit_is_rejected(self):
        saved = self.post_transfer()
        self.link(match_transaction=saved["id"], draft=self.draft(reference="OTHER"))
        response = self.client.patch(
            reverse("transaction-detail", kwargs={"pk": saved["id"]}),
            {"amount": "2000.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            Transaction.objects.get(pk=saved["id"]).amount, Decimal("1000.00")
        )

    def test_merging_an_expense_is_rejected(self):
        saved = self.post_transfer()
        expense = Transaction.objects.create(
            user=self.user,
            account=self.a,
            amount="1000.00",
            date=self.day,
            type="expense",
        )
        response = self.client.post(
            reverse("transaction-merge-transfer", kwargs={"pk": saved["id"]}),
            {"transaction": str(expense.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Transaction.objects.count(), 2)

    def test_backfill_preserves_incoming_balance_ownership(self):
        from importlib import import_module

        from django.apps import apps
        from django.db import connection

        incoming = self.candidate(incoming=True)
        record = Transaction.objects.create(
            user=self.user,
            account=self.a,
            transfer_account=self.b,
            raw_message=incoming.raw_message,
            amount="1000.00",
            balance_after="3000.00",
            date=timezone.localdate(),
            type="transfer",
            direction="credit",
        )
        incoming.transaction = record
        incoming.status = "confirmed"
        incoming.save()
        backfill = import_module(
            "apps.transactions.migrations.0006_backfill_transfer_evidence"
        ).backfill
        backfill(apps, connection.schema_editor())
        record.refresh_from_db()
        self.assertEqual(record.direction, "debit")
        self.assertEqual(
            TransferEvidence.objects.get(transaction=record).account_id, self.b.id
        )
        balances = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(balances[self.a.id].ledger_balance, Decimal("9000.00"))
        self.assertIsNone(balances[self.a.id].latest_reported_balance)
        self.assertEqual(
            balances[self.b.id].latest_reported_balance, Decimal("3000.00")
        )

    def test_search_finds_incoming_reference_once_and_export_preserves_evidence(self):
        import csv
        import io
        import json

        saved = self.post_transfer(reference="OUT-SEARCH")
        incoming = self.draft(
            account=str(self.b.id),
            transfer_account=str(self.a.id),
            direction="credit",
            reference="IN-SEARCH",
            balance_after="3000.00",
        )
        self.link(match_transaction=saved["id"], draft=incoming)
        response = self.client.get(reverse("transaction-list"), {"search": "SEARCH"})
        self.assertEqual(len(response.data), 1)
        response = self.client.get(reverse("transaction-list"), {"search": "IN-SEARCH"})
        self.assertEqual(response.data[0]["id"], saved["id"])
        export = self.client.get(
            reverse("transaction-export"), {"account": str(self.b.id)}
        )
        rows = list(csv.DictReader(io.StringIO(export.content.decode())))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["account_direction"], "credit")
        self.assertEqual(len(json.loads(rows[0]["transfer_evidence"])), 2)

    def test_merged_legacy_transfers_without_evidence_keep_both_references(self):
        first = Transaction.objects.create(
            user=self.user,
            account=self.a,
            transfer_account=self.b,
            date=timezone.localdate(),
            amount="1000.00",
            type="transfer",
            reference="LEGACY-OUT",
        )
        second = Transaction.objects.create(
            user=self.user,
            account=self.a,
            transfer_account=self.b,
            date=timezone.localdate(),
            amount="1000.00",
            type="transfer",
            reference="LEGACY-IN",
        )
        response = self.client.post(
            reverse("transaction-merge-transfer", kwargs={"pk": first.id}),
            {"transaction": str(second.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            set(TransferEvidence.objects.values_list("reference", flat=True)),
            {"LEGACY-OUT", "LEGACY-IN"},
        )


from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless

from django.db import close_old_connections, connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient


@skipUnless(
    connection.vendor == "postgresql", "Row-lock concurrency requires PostgreSQL"
)
class ConcurrentTransferLinkTests(TransactionTestCase):
    def test_opposite_clients_accepting_same_pair_post_once(self):
        user = get_user_model().objects.create_user(username="concurrent-transfer-test")
        a = Account.objects.create(user=user, name="A", type="bank")
        b = Account.objects.create(user=user, name="B", type="bank")
        candidates = []
        for kind, reference in [
            ("bank_transfer_out", "OUT"),
            ("bank_transfer_in", "IN"),
        ]:
            raw = RawMessage.objects.create(
                user=user,
                sender="Demo",
                body="Synthetic concurrent evidence",
                body_hash=reference,
                received_at=timezone.now(),
            )
            candidates.append(
                ParsedMessageCandidate.objects.create(
                    user=user,
                    raw_message=raw,
                    provider="city_bank",
                    reference=reference,
                    account=a,
                    destination_account=b,
                    amount="1000.00",
                    transaction_type="transfer",
                    possible_internal_transfer=True,
                    message_kind=kind,
                )
            )
        barrier = Barrier(2)

        def accept_pair(index):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(user)
            barrier.wait(timeout=10)
            try:
                return client.post(
                    reverse("transaction-link-transfer"),
                    {
                        "candidate": str(candidates[index].id),
                        "match_candidate": str(candidates[1 - index].id),
                    },
                    format="json",
                ).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(accept_pair, [0, 1]))
        self.assertEqual(statuses, [200, 200])
        self.assertEqual(Transaction.objects.filter(user=user).count(), 1)
        self.assertEqual(TransferEvidence.objects.filter(user=user).count(), 2)
