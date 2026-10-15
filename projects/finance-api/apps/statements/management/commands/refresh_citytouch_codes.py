"""One-time, guarded recovery of printed Citytouch codes from an archived PDF."""

import os
from uuid import UUID

from cryptography.fernet import InvalidToken
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.statements.code_refresh import code_refresh_plan
from apps.statements.models import StatementImport, StatementOriginalFile, StatementRow
from apps.statements.services import file_digest
from apps.statements.views import extract_pdf_bytes
from apps.transactions.transfers import lock_transfer_user
from config.secure_data import decrypt_bytes


class Command(BaseCommand):
    help = "Dry-run or apply a one-time Citytouch code refresh; never replaces drafts or ledger entries."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--batch-id", required=True, type=UUID)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--digest", help="Digest printed by the dry-run; required with --apply.")
        parser.add_argument("--password-env", help="Environment variable containing this PDF's unlock password.")

    def handle(self, *args, **options):
        if os.environ.get("ALLOW_STATEMENT_CODE_REFRESH") != "1":
            raise CommandError("This temporary maintenance command is disabled. Set ALLOW_STATEMENT_CODE_REFRESH=1 for this invocation only.")
        if options["apply"] and not options["digest"]:
            raise CommandError("Run a dry-run first, then pass its digest with --apply.")
        if options["digest"] and not options["apply"]:
            raise CommandError("--digest is only used with --apply.")
        batch = StatementImport.objects.filter(
            id=options["batch_id"], user__username=options["username"]
        ).select_related("user").first()
        if not batch:
            raise CommandError("This import was not found for that user.")
        if batch.profile != "city_bank":
            raise CommandError("Citytouch code refresh applies only to City Bank imports.")
        source = StatementOriginalFile.objects.filter(batch=batch).first()
        if not source:
            raise CommandError("The original PDF is unavailable. Re-upload the identical PDF to the same account first.")
        try:
            pdf = decrypt_bytes(source.ciphertext)
        except InvalidToken as error:
            raise CommandError("The original PDF could not be decrypted with the configured key.") from error
        if len(pdf) != source.size or file_digest(pdf) != batch.file_digest:
            raise CommandError("The original PDF failed its integrity check.")
        password = os.environ.get(options["password_env"], "") if options["password_env"] else ""
        try:
            preview = extract_pdf_bytes(pdf, password)
        except ValidationError as error:
            raise CommandError("The PDF could not be unlocked or extracted. Check its password and layout.") from error
        if isinstance(preview, Response):
            raise CommandError("The PDF worker could not complete this refresh.")
        rows = list(batch.rows.filter(component="principal").order_by("position"))
        try:
            plan = code_refresh_plan(batch, preview, rows)
        except ValidationError as error:
            raise CommandError(str(error.detail)) from error
        if not options["apply"]:
            self.stdout.write(
                f"Dry run: {plan['changed_count']} of {plan['row_count']} source codes can gain visible digits. "
                "No draft, matched row, or transaction was changed."
            )
            self.stdout.write(f"Digest: {plan['digest']}")
            if plan["changed_count"]:
                self.stdout.write("Reverify any old suffix mappings; they are not copied to longer codes.")
            if not plan["changed_count"]:
                self.stdout.write("If the PDF prints only four digits, no additional digits can be recovered.")
            return
        if options["digest"] != plan["digest"]:
            raise CommandError("The dry-run digest is stale or incorrect. Run the dry-run again.")
        with transaction.atomic():
            lock_transfer_user(batch.user)
            locked = StatementImport.objects.select_for_update().get(pk=batch.pk)
            if locked.file_digest != file_digest(pdf):
                raise CommandError("The import source changed since the archived PDF was checked.")
            locked_rows = list(
                StatementRow.objects.select_for_update()
                .filter(batch=locked, component="principal")
                .order_by("position")
            )
            try:
                fresh = code_refresh_plan(locked, preview, locked_rows)
            except ValidationError as error:
                raise CommandError(str(error.detail)) from error
            if fresh["digest"] != options["digest"]:
                raise CommandError("Saved rows changed since the dry-run. Run it again.")
            if fresh["changed_count"]:
                now = timezone.now()
                for item in fresh["changes"]:
                    row = item["row"]
                    row.source_code = item["after"]
                    row.version += 1
                    row.updated_at = now
                StatementRow.objects.bulk_update(
                    [item["row"] for item in fresh["changes"]],
                    ["source_code", "version", "updated_at"],
                )
                locked.updated_at = now
                locked.save(update_fields=["updated_at"])
                create_audit_log(
                    user=locked.user, action=AuditLogEntry.Action.UPDATED, entity=locked,
                    after={"citytouch_codes_refreshed": fresh["changed_count"]},
                )
        self.stdout.write(f"Applied {fresh['changed_count']} code improvements. Drafts and ledger entries were preserved.")
