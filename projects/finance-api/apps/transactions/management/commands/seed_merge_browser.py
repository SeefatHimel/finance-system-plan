"""Optional synthetic merge fixtures. Never runs against a deployed database."""

from datetime import datetime

from config.secure_data import encrypt_bytes
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Account
from apps.bulk_imports.models import BulkImport, BulkImportRow
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.statements.models import StatementImport, StatementRow
from apps.transactions.models import Transaction


class Command(BaseCommand):
    help = "Add optional desktop/mobile merge fixtures to finance_e2e_* only."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Replace only this command's synthetic merge fixtures.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if not str(settings.DATABASES["default"]["NAME"]).startswith("finance_e2e_"):
            raise CommandError(
                "Use a disposable finance_e2e_* database. No changes made."
            )
        user = get_user_model().objects.get(username="synthetic-browser")
        if options["reset"]:
            names = [
                f"Synthetic duplicate {surface}" for surface in ("desktop", "mobile")
            ]
            StatementImport.objects.filter(user=user, account__name__in=names).delete()
            BulkImport.objects.filter(user=user, account__name__in=names).delete()
            Transaction.objects.filter(user=user, account__name__in=names).delete()
            RawMessage.objects.filter(
                user=user, body_hash__startswith="synthetic-merge-"
            ).delete()
        for surface in ("desktop", "mobile"):
            account, _ = Account.objects.get_or_create(
                user=user,
                name=f"Synthetic duplicate {surface}",
                defaults={"type": "mobile_wallet"},
            )
            if Transaction.objects.filter(account=account).exists():
                continue
            primary = Transaction.objects.create(
                user=user,
                account=account,
                date="2026-08-15",
                time="14:00",
                type="repayment_received",
                direction="credit",
                amount="100",
                balance_after="800",
                reference="TESTMERGE123",
                note="Synthetic spreadsheet note",
                counterparty_text="Synthetic repayment",
                source="import",
            )
            message = RawMessage.objects.create(
                user=user,
                sender="SYNTHETIC",
                received_at=timezone.make_aware(datetime(2026, 8, 15, 14)),
                body="Received Tk 100. Ref: gift TrxID: TESTMERGE123. Balance Tk 800.",
                body_hash=f"synthetic-merge-{surface}",
            )
            secondary = Transaction.objects.create(
                user=user,
                account=account,
                date=primary.date,
                time=primary.time,
                type=primary.type,
                direction="credit",
                amount="100",
                balance_after="800",
                reference="gift",
                note="Synthetic SMS note",
                counterparty_text="Synthetic repayment",
                raw_message=message,
                source="sms",
            )
            ParsedMessageCandidate.objects.create(
                user=user,
                raw_message=message,
                account=account,
                transaction=secondary,
                status="confirmed",
                transaction_type=primary.type,
                message_kind="money_received",
                source_direction="credit",
                amount="100",
                balance_after="800",
                reference="gift",
            )
            bulk = BulkImport.objects.create(
                user=user,
                account=account,
                source_hash=f"synthetic-merge-{surface}",
                state="recorded",
                original=encrypt_bytes(
                    b"Date\tDescription\tAmount\n2026-08-15\tSynthetic repayment\t100\n"
                ),
            )
            BulkImportRow.objects.create(
                batch=bulk,
                number=1,
                transaction=primary,
                ledger_identity=primary.pk,
                normalized={
                    "date": "2026-08-15",
                    "description": "Synthetic repayment",
                    "amount": "100",
                    "notes": "Synthetic spreadsheet note",
                    "reference": "TESTMERGE123",
                },
            )
            batch = StatementImport.objects.create(
                user=user,
                account=account,
                file_digest=f"synthetic-merge-{surface}",
                profile="bkash",
                parser_version="test",
                currency="BDT",
                account_identity="verify",
                page_count=1,
                period_start="2026-08-15",
                period_end="2026-08-15",
            )
            extracted = {
                "id": "synthetic-row",
                "page": 1,
                "row": 1,
                "date": "2026-08-15",
                "time": "14:00:00",
                "posting_date": None,
                "value_date": None,
                "description": "Synthetic repayment / TRX ID: TESTMERGE123",
                "provider_type": "Received Money",
                "reference": "TESTMERGE123",
                "direction": "credit",
                "amount": "100.00",
                "signed_fee": "0.00",
                "balance_after": "800.00",
                "issues": [],
                "bounds": [],
            }
            StatementRow.objects.create(
                batch=batch,
                position=1,
                component="principal",
                extracted=extracted,
                source_fingerprint=f"synthetic-merge-{surface}",
                date="2026-08-15",
                time="14:00:00",
                direction="credit",
                type=primary.type,
                amount="100",
                balance_after="800",
                reference="TESTMERGE123",
                counterparty_text="Synthetic repayment",
            )
        self.stdout.write(
            "Synthetic duplicate-merge fixtures ready; no real financial data was used."
        )
