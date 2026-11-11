from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction, DatabaseError


class Command(BaseCommand):
    help = "Explicitly validate staged PostgreSQL checks after reviewing historical exceptions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reviewed",
            action="store_true",
            help="Confirm the read-only audit and historical exceptions have been reviewed.",
        )

    def handle(self, *args, **options):
        if not options["reviewed"]:
            raise CommandError(
                "Run audit_financial_integrity first, review exceptions, then pass --reviewed. No changes made."
            )
        if connection.vendor != "postgresql":
            raise CommandError("Staged validation is only needed on PostgreSQL.")
        try:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '5s'")
                cursor.execute("SET LOCAL statement_timeout = '30s'")
                for name in ("ledger_amount_positive", "ledger_distinct_accounts"):
                    cursor.execute(
                        f'ALTER TABLE "transactions_transaction" VALIDATE CONSTRAINT "{name}"'
                    )
        except DatabaseError as error:
            raise CommandError(
                "Validation failed or exceeded its deadline. Review the audit and retry; financial values were not changed."
            ) from error
        self.stdout.write(
            "Both ledger constraints validated. No financial values changed."
        )
