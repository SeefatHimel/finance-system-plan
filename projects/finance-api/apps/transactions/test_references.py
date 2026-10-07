from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.models import ParsedMessageCandidate, RawMessage

from .models import Transaction, TransferEvidence
from .services import calculate_account_balance_summaries


class ReferenceReuseTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="reference-test")
        self.client.force_authenticate(self.user)
        self.a = Account.objects.create(user=self.user, name="Demo A", type="bank", starting_balance="1000.00")
        self.b = Account.objects.create(user=self.user, name="Demo B", type="bank")
        self.day = timezone.localdate()

    def candidate(self, *, transfer=False, incoming=False, **changes):
        raw = RawMessage.objects.create(
            user=self.user, sender="DEMO-BANK", body="Synthetic reference evidence",
            body_hash=str(uuid4()), received_at=timezone.now(),
        )
        return ParsedMessageCandidate.objects.create(
            user=self.user, raw_message=raw, provider="bank", reference="DEMO-REUSED",
            account=self.a, destination_account=self.b if transfer else None,
            transaction_type="transfer" if transfer else "expense",
            message_kind=("bank_transfer_in" if incoming else "bank_transfer_out") if transfer else "card_purchase",
            amount="100.00", **changes,
        )

    def confirm(self, candidate, **payload):
        return self.client.post(
            reverse("message-candidate-confirm", kwargs={"candidate_id": candidate.pk}),
            payload, format="json",
        )

    def draft(self, **changes):
        return {
            "account": str(self.a.pk), "transfer_account": str(self.b.pk),
            "date": self.day.isoformat(), "type": "transfer", "amount": "100.00",
            "reference": "DEMO-REUSED", **changes,
        }

    def link(self, **payload):
        return self.client.post(reverse("transaction-link-transfer"), payload, format="json")

    def test_separate_purchases_can_reuse_references_on_same_account(self):
        first = self.candidate()
        second = self.candidate()
        self.assertEqual(self.confirm(first).status_code, 200)
        self.assertEqual(self.confirm(second).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(set(Transaction.objects.values_list("reference", flat=True)), {"DEMO-REUSED"})
        self.assertEqual(
            calculate_account_balance_summaries(accounts=[self.a])[self.a.pk].ledger_balance,
            Decimal("800.00"),
        )

    def test_new_transfer_can_reuse_a_legacy_provider_reference_key(self):
        first = self.candidate(transfer=True)
        self.assertEqual(self.confirm(first).status_code, 200)
        record = Transaction.objects.get()
        record.external_key = "sms:bank:demo-reused"
        record.save()
        evidence = record.transfer_evidence.get()
        evidence.external_key = "legacy-evidence-key"
        evidence.save()
        second = self.candidate(transfer=True)
        self.assertEqual(self.confirm(second).status_code, 200)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(TransferEvidence.objects.count(), 2)
        record.refresh_from_db()
        self.assertEqual(record.external_key, "sms:bank:demo-reused")

    def test_two_pending_pairs_with_same_reference_create_two_movements_only_on_acceptance(self):
        for _ in range(2):
            outgoing = self.candidate(transfer=True)
            incoming = self.candidate(transfer=True, incoming=True)
            response = self.link(candidate=str(incoming.pk), match_candidate=str(outgoing.pk))
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertEqual(TransferEvidence.objects.count(), 4)
        balances = calculate_account_balance_summaries(accounts=[self.a, self.b])
        self.assertEqual(balances[self.a.pk].ledger_balance, Decimal("800.00"))
        self.assertEqual(balances[self.b.pk].ledger_balance, Decimal("200.00"))

    def test_same_capture_cannot_be_confirmed_again_after_reference_correction(self):
        candidate = self.candidate()
        self.assertEqual(self.confirm(candidate).status_code, 200)
        record = Transaction.objects.get()
        record.reference = "DEMO-CORRECTED"
        record.external_key = "sms:bank:demo-reused"  # Existing records need no migration.
        record.save()
        candidate.status = "needs_review"
        candidate.save()
        response = self.confirm(candidate, reference="DEMO-ANOTHER")
        self.assertEqual(response.status_code, 400)
        self.assertIn("SMS", response.data["detail"])
        self.assertEqual(Transaction.objects.count(), 1)

    def test_link_retry_reuses_legacy_raw_evidence_and_cannot_attach_to_another_record(self):
        candidate = self.candidate(transfer=True)
        self.assertEqual(self.confirm(candidate).status_code, 200)
        record = Transaction.objects.get()
        evidence = record.transfer_evidence.get()
        evidence.external_key = "legacy-observation-key"
        evidence.save()
        candidate.status = "needs_review"
        candidate.save()
        response = self.link(candidate=str(candidate.pk), match_transaction=str(record.pk), draft={"reference": "DEMO-CHANGED"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TransferEvidence.objects.count(), 1)
        other = self.client.post(reverse("transaction-list"), self.draft(), format="json")
        self.assertEqual(other.status_code, 201, other.data)
        candidate.status = "needs_review"
        candidate.save()
        denied = self.link(candidate=str(candidate.pk), match_transaction=str(other.data["id"]))
        self.assertEqual(denied.status_code, 400)
        self.assertEqual(TransferEvidence.objects.filter(transaction=record).count(), 1)

    def test_transfer_sms_cannot_be_reconfirmed_as_expense_with_another_reference(self):
        candidate = self.candidate(transfer=True)
        self.assertEqual(self.confirm(candidate).status_code, 200)
        candidate.status = "needs_review"
        candidate.transaction_type = "expense"
        candidate.destination_account = None
        candidate.save()
        response = self.confirm(candidate, type="expense", transfer_account=None, reference="DEMO-OTHER")
        self.assertEqual(response.status_code, 400)
        self.assertIn("SMS", response.data["detail"])
        self.assertEqual(Transaction.objects.count(), 1)

    def test_manual_references_are_optional_and_can_repeat(self):
        for reference in ("DEMO-REUSED", "DEMO-REUSED", ""):
            response = self.client.post(reverse("transaction-list"), self.draft(reference=reference), format="json")
            self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Transaction.objects.count(), 3)

    def test_reference_alone_never_overrides_amount_date_or_currency(self):
        record = self.client.post(reverse("transaction-list"), self.draft(), format="json").data
        for changes in (
            {"amount": "150.00"},
            {"date": (self.day + timedelta(days=4)).isoformat()},
        ):
            response = self.client.post(reverse("transaction-transfer-matches"), {"draft": self.draft(**changes)}, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, [])
        self.b.currency = "USD"
        self.b.save()
        matches = self.client.post(reverse("transaction-transfer-matches"), {"draft": self.draft()}, format="json")
        self.assertEqual(matches.data, [])
        self.assertEqual(self.link(match_transaction=str(record["id"]), draft=self.draft()).status_code, 400)

    def test_matching_reference_is_supporting_evidence_without_auto_linking(self):
        record = self.client.post(reverse("transaction-list"), self.draft(reference="DEMO-PRIMARY"), format="json").data
        self.assertEqual(self.link(match_transaction=str(record["id"]), draft=self.draft()).status_code, 200)
        response = self.client.post(reverse("transaction-transfer-matches"), {"draft": self.draft(reference=" demo-reused ")}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Reference also matches", response.data[0]["reason"])
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(TransferEvidence.objects.count(), 2)
