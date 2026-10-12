"""Synthetic fixtures only: short suffixes suggest choices, never prove ownership."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Account
from apps.messages.identifiers import sanitize_financial_identifier
from apps.messages.identity_suggestions import short_identity_suggestions
from apps.messages.models import ParsedMessageCandidate, SenderRule
from apps.transactions.models import Transaction

from .models import PaymentMethod
from .resolution import (
    identifier_score,
    matching_methods,
    statement_account_suggestion,
    text_identifier_evidence,
    unique_method,
)


class ShortIdentifierTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="synthetic-short-identity"
        )
        self.client.force_authenticate(self.user)
        self.bank = Account.objects.create(
            user=self.user, name="Synthetic bank", type="bank"
        )
        self.card = PaymentMethod.objects.create(
            user=self.user,
            account=self.bank,
            name="Synthetic card",
            provider="ebl",
            identifier_kind="card",
            identifier="123456**1723",
        )
        SenderRule.objects.create(
            user=self.user,
            account=self.bank,
            name="Synthetic sender",
            provider="ebl",
            sender="EBL",
        )

    def import_sms(self, body):
        response = self.client.post(
            reverse("raw-message-import"),
            {
                "sender": "EBL",
                "body": body,
                "received_at": "2026-01-02T10:30:00+06:00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["candidate"]

    def test_masking_accepts_three_ending_digits_but_never_one_or_two(self):
        for value in ("723", "***723", "123456**723"):
            self.assertEqual(sanitize_financial_identifier(value), value)
        for value in ("72", "**72", "123456**72", "1234xx", "1234567890**72", "1234567890**2"):
            self.assertEqual(sanitize_financial_identifier(value), "")
        self.assertEqual(sanitize_financial_identifier("1234567890123456"), "3456")
        self.assertEqual(sanitize_financial_identifier("1234567890123456x"), "3456")

    def test_short_overlap_is_always_weak_and_conflicting_visible_digits_reject(self):
        self.assertEqual(identifier_score("123456**1723", "123456**723"), 10)
        self.assertEqual(identifier_score("723", "1723"), 10)
        self.assertEqual(identifier_score("1723", "8723"), 0)
        self.assertEqual(identifier_score("123456**1723", "654321**723"), 0)
        self.assertEqual(identifier_score("1723", "23"), 0)
        self.assertEqual(identifier_score("1723", "***1723"), 30)

    def test_unique_short_match_still_does_not_resolve_account(self):
        kwargs = {
            "user": self.user,
            "evidence": [("card", "***723")],
            "provider": "ebl",
        }
        self.assertEqual([m.pk for m in matching_methods(**kwargs)], [self.card.pk])
        self.assertIsNone(unique_method(**kwargs))
        self.card.refresh_from_db()
        self.assertEqual(self.card.identifier, "123456**1723")

    def test_choices_scope_provider_kind_ownership_and_active_accounts(self):
        other = get_user_model().objects.create_user(username="synthetic-other")
        foreign = Account.objects.create(user=other, name="Foreign", type="bank")
        inactive = Account.objects.create(
            user=self.user, name="Inactive", type="bank", is_active=False
        )
        for account, provider, kind in [
            (foreign, "ebl", "card"),
            (inactive, "ebl", "card"),
            (self.bank, "city_bank", "card"),
            (self.bank, "ebl", "account"),
        ]:
            PaymentMethod.objects.create(
                user=account.user,
                account=account,
                name=f"Synthetic {account.name} {provider} {kind}",
                provider=provider,
                identifier_kind=kind,
                identifier="8723",
            )
        hints = short_identity_suggestions(
            {
                "provider": "ebl",
                "message_kind": "card_purchase",
                "sender_card_identifier": "***723",
            },
            user=self.user,
        )
        self.assertEqual(
            [c["payment_method"] for c in hints[0]["choices"]], [str(self.card.pk)]
        )

    def test_collision_shows_all_accounts_and_independent_long_evidence_can_corroborate(
        self,
    ):
        second = Account.objects.create(
            user=self.user, name="Synthetic second", type="bank"
        )
        method = PaymentMethod.objects.create(
            user=self.user,
            account=second,
            name="Synthetic second card",
            provider="ebl",
            identifier_kind="card",
            identifier="8723",
        )
        kwargs = {"user": self.user, "evidence": [("card", "723")], "provider": "ebl"}
        self.assertEqual(
            {m.pk for m in matching_methods(**kwargs)}, {self.card.pk, method.pk}
        )
        self.assertIsNone(unique_method(**kwargs))
        self.card.additional_identifiers = [
            {"kind": "account", "value": "4816", "label": "Synthetic account"}
        ]
        self.card.save()
        kwargs["evidence"].append(("account", "4816"))
        self.assertEqual(unique_method(**kwargs).account_id, self.bank.pk)
        kwargs["evidence"] = [("card", "723"), ("account", "8723")]
        self.assertIsNone(unique_method(**kwargs))

    def test_import_keeps_short_identifier_and_blocks_sender_rule_fallback_until_choice(
        self,
    ):
        candidate = self.import_sms(
            "EBL CARDS: Purchase BDT 25 using Card ending in 723 at SYNTHETIC SHOP."
        )
        self.assertEqual(candidate["sender_card_identifier"], "723")
        self.assertIsNone(candidate["account"])
        self.assertIsNone(candidate["payment_method"])
        self.assertEqual(
            candidate["identity_suggestions"][0]["choices"][0]["account"],
            str(self.bank.pk),
        )
        url = reverse(
            "message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}
        )
        # Older candidates may already have an incorrect sender-rule default.
        ParsedMessageCandidate.objects.filter(pk=candidate["id"]).update(
            account=self.bank
        )
        response = self.client.post(url, {"type": "expense"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("account", response.data)
        self.assertEqual(Transaction.objects.count(), 0)
        response = self.client.post(
            url,
            {
                "type": "expense",
                "account": str(self.bank.pk),
                "payment_method": str(self.card.pk),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_incoming_short_receiver_does_not_prefill_a_sender_rule_account(self):
        candidate = self.import_sms(
            "EBL CARDS: Payment of BDT 25 credited to Card ***723. Balance: BDT 100."
        )
        self.assertEqual(candidate["receiver_card_identifier"], "***723")
        self.assertIsNone(candidate["account"])
        self.assertIsNone(candidate["destination_account"])
        self.assertEqual(candidate["identity_suggestions"][0]["role"], "receiver")
        response = self.client.post(
            reverse(
                "message-candidate-confirm", kwargs={"candidate_id": candidate["id"]}
            ),
            {
                "type": "transfer",
                "account": str(self.bank.pk),
                "direction": "credit",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("account_perspective", response.data)

    def test_short_saved_identifier_against_long_observation_is_still_review_only(self):
        self.card.identifier = "723"
        self.card.save()
        hints = short_identity_suggestions(
            {
                "provider": "ebl",
                "message_kind": "card_purchase",
                "sender_card_identifier": "***1723",
            },
            user=self.user,
        )
        self.assertEqual(len(hints), 1)
        self.assertIsNone(unique_method(user=self.user, evidence=[("card", "***1723")]))

    def test_statement_short_header_requires_manual_choice_even_if_unique(self):
        self.card.identifier_kind = "account"
        self.card.save()
        suggestion = statement_account_suggestion(
            user=self.user, profile="ebl_bank", hint="***723"
        )
        self.assertIsNone(suggestion["account"])
        self.assertTrue(suggestion["requires_review"])
        self.assertFalse(suggestion["ambiguous"])
        self.assertEqual(
            suggestion["choices"],
            [{"account": str(self.bank.pk), "name": self.bank.name}],
        )

    def test_arbitrary_reference_or_amount_is_not_an_identity(self):
        self.assertEqual(text_identifier_evidence("Reference 723 BDT 723.00"), [])
        self.assertEqual(
            text_identifier_evidence("Card ending in 723"), [("card", "723")]
        )

    def test_profile_api_accepts_three_digits_and_rejects_two(self):
        url = reverse("payment-method-list")
        payload = {
            "account": str(self.bank.pk),
            "name": "Synthetic short",
            "provider": "ebl",
            "identifier_kind": "card",
            "identifier": "723",
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        response = self.client.post(
            url,
            {**payload, "name": "Synthetic invalid", "identifier": "72"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("identifier", response.data)

    def test_statement_parser_preserves_short_header_without_promoting_to_match(self):
        from apps.statements.parser import extract_statement
        from apps.statements.tests import synthetic_pdf

        preview = extract_statement(synthetic_pdf(account_identifier="***723"))
        self.assertEqual(preview["account_hint"], "***723")
        self.card.identifier_kind = "account"
        self.card.save()
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.post(
            reverse("statement-preview"),
            {
                "account": str(self.bank.pk),
                "file": SimpleUploadedFile(
                    "synthetic.pdf",
                    synthetic_pdf(account_identifier="***723"),
                    content_type="application/pdf",
                ),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["account_identity"], "verify")
        self.assertIsNone(response.data["account_suggestion"]["account"])
        self.assertTrue(response.data["account_suggestion"]["requires_review"])

    def test_outgoing_short_destination_does_not_remove_strong_source(self):
        receiver = Account.objects.create(
            user=self.user, name="Synthetic destination", type="bank"
        )
        PaymentMethod.objects.create(
            user=self.user,
            account=receiver,
            name="Synthetic destination account",
            provider="ebl",
            identifier_kind="account",
            identifier="8723",
        )
        candidate = self.import_sms(
            "EBL CARDS: NPSB Fund Transfer BDT 25 using Card 123456**1723 to Account ***723. Balance BDT 100."
        )
        self.assertEqual(candidate["account"], self.bank.pk)
        self.assertEqual(candidate["receiver_account_identifier"], "***723")
        self.assertIsNone(candidate["destination_account"])
        self.assertEqual(candidate["identity_suggestions"][0]["role"], "receiver")
        response = self.client.post(
            reverse("transaction-transfer-matches"),
            {
                "candidate": candidate["id"],
                "draft": {
                    "account": str(self.bank.pk),
                    "account_perspective": True,
                    "direction": "debit",
                    "type": "transfer",
                },
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("transfer_account", response.data)

    def test_statement_rows_do_not_fall_back_to_names_for_unresolved_short_evidence(
        self,
    ):
        from types import SimpleNamespace

        from apps.statements.insights import suggestions

        reserve = Account.objects.create(
            user=self.user, name="Synthetic reserve", type="bank"
        )
        PaymentMethod.objects.create(
            user=self.user,
            account=reserve,
            name="Synthetic reserve card",
            provider="ebl",
            identifier_kind="card",
            identifier="8723",
            aliases=["Synthetic reserve"],
        )
        batch = SimpleNamespace(
            user_id=self.user.pk,
            account_id=self.bank.pk,
            profile="ebl_bank",
            currency="BDT",
        )
        row = SimpleNamespace(
            id="synthetic-row",
            batch=batch,
            component="principal",
            direction="debit",
            extracted={
                "description": "NPSB TRANSFER Card ***723 Synthetic reserve",
                "direction": "debit",
            },
        )
        self.assertEqual(suggestions([row]), {})
        row.extracted["description"] = "NPSB TRANSFER Card ***999 Synthetic reserve"
        self.assertEqual(suggestions([row]), {})
        row.extracted["description"] = "NPSB TRANSFER Card ***8723 Synthetic reserve"
        self.assertEqual(suggestions([row])[row.id]["other_account"], str(reserve.pk))

    def test_incoming_short_sender_preserves_independently_identified_receiver(self):
        self.card.additional_identifiers = [
            {"kind": "account", "value": "4816", "label": "Synthetic receiving account"}
        ]
        self.card.save()
        source = Account.objects.create(
            user=self.user, name="Synthetic source", type="bank"
        )
        PaymentMethod.objects.create(
            user=self.user,
            account=source,
            name="Synthetic source account",
            provider="ebl",
            identifier_kind="account",
            identifier="8723",
        )
        candidate = self.import_sms(
            "Fund Transfer BDT 25 credited from Account ***723 to Account ****4816."
        )
        self.assertEqual(candidate["account"], self.bank.pk)
        self.assertIsNone(candidate["destination_account"])
        self.assertEqual(candidate["identity_suggestions"][0]["role"], "sender")

    def test_older_numeric_suffixes_with_separators_remain_compatible(self):
        self.assertEqual(identifier_score("17-23", "723"), 10)
        self.assertEqual(identifier_score("7-2-3", "723"), 10)
        self.assertEqual(identifier_score("17-23", "1723"), 30)
        self.assertEqual(identifier_score("17-23", "87-23"), 0)
