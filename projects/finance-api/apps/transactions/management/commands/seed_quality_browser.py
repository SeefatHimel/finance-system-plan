"""Create deterministic synthetic browser fixtures only in disposable databases."""

import os
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from django.db import transaction
from apps.accounts.models import Account
from apps.transactions.models import Transaction


class Command(BaseCommand):
    help = "Seed synthetic browser data; refuses databases outside finance_e2e_*."

    @transaction.atomic
    def handle(self, *args, **options):
        if not str(settings.DATABASES["default"]["NAME"]).startswith("finance_e2e_"):
            raise CommandError(
                "Use a disposable database named finance_e2e_*. No changes made."
            )
        password = os.environ.get("FINANCE_E2E_PASSWORD", "")
        if len(password) < 16:
            raise CommandError(
                "Set FINANCE_E2E_PASSWORD to a synthetic test-only password of 16+ characters."
            )
        user, _ = get_user_model().objects.get_or_create(username="synthetic-browser")
        user.set_password(password)
        user.save(update_fields=("password",))
        account, _ = Account.objects.get_or_create(
            user=user, name="Synthetic QA Bank", defaults={"type": "bank"}
        )
        Account.objects.get_or_create(
            user=user, name="Synthetic QA Cash", defaults={"type": "cash"}
        )
        if not Transaction.objects.filter(user=user).exists():
            Transaction.objects.bulk_create(
                [
                    Transaction(
                        user=user,
                        account=account,
                        date="2026-01-01",
                        type="expense",
                        direction="debit",
                        amount="1.25",
                        note=f"Synthetic pagination {n:03}",
                    )
                    for n in range(143)
                ]
            )
        self.stdout.write(
            "Synthetic browser fixture ready. Credentials were not printed."
        )
