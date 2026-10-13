"""Existing pending statement drafts can receive safe merchant cleanup."""

from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.db import connection
from rest_framework.test import APITestCase

from apps.transactions.models import Transaction

from .test_imports import SavedStatementTests


class PendingMerchantReapplyTests(APITestCase):
    setUp = SavedStatementTests.setUp
    upload = SavedStatementTests.upload

    def test_reapplies_only_untouched_pending_merchants(self):
        rows = list(self.upload().rows.order_by("position"))
        legacy, corrected, skipped = rows
        legacy.counterparty_text = legacy.extracted["description"]
        legacy.save(update_fields=["counterparty_text"])
        corrected.counterparty_text = "My chosen shop"
        corrected.save(update_fields=["counterparty_text"])
        skipped.counterparty_text = skipped.extracted["description"]
        skipped.state = "skipped"
        skipped.save(update_fields=["counterparty_text", "state"])

        migration = import_module(
            "apps.statements.migrations.0003_reapply_pending_merchants"
        )
        migration.reapply_pending_merchant_cleanup(
            apps, SimpleNamespace(connection=connection)
        )

        legacy.refresh_from_db()
        corrected.refresh_from_db()
        skipped.refresh_from_db()
        self.assertEqual(legacy.counterparty_text, "SYNTH SHOP")
        self.assertEqual(legacy.version, 2)
        self.assertEqual(legacy.note, legacy.extracted["description"])
        self.assertEqual(corrected.counterparty_text, "My chosen shop")
        self.assertEqual(corrected.version, 1)
        self.assertEqual(skipped.counterparty_text, skipped.extracted["description"])
        self.assertEqual(skipped.version, 1)
        self.assertEqual(Transaction.objects.count(), 0)

        migration.reapply_pending_merchant_cleanup(
            apps, SimpleNamespace(connection=connection)
        )
        legacy.refresh_from_db()
        self.assertEqual(legacy.version, 2)
