"""Review before writing: source rows never become a second ledger."""

from datetime import datetime
from decimal import Decimal
from hashlib import sha256

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework import status
from rest_framework.exceptions import APIException

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.reconciliation.models import BalanceSnapshot
from apps.reconciliation.services import snapshot_status_for_difference
from apps.reconciliation.timing import checkpoint_expected
from apps.transactions.models import Transaction
from apps.transactions.serializers import TransactionSerializer
from apps.transactions.transfers import lock_transfer_user
from config.secure_data import encrypt_bytes
from .models import BulkImport, BulkImportRow, BulkImportCheckpoint
from .parsing import table


from .sources import digest, json_values
from .review import preview, compatible


class ChangedReview(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The import or matching entries changed. Refresh the preview and review the highlighted rows."


def create_batch(user, data):
    account = get_object_or_404(Account, pk=data["account"], user=user, is_active=True)
    text = data["text"].removeprefix("\ufeff").replace("\r\n", "\n").strip("\n")
    _, _, mapping = table(text)
    with transaction.atomic():
        lock_transfer_user(user)
        batch, _ = BulkImport.objects.get_or_create(
            user=user,
            account=account,
            source_hash=sha256(text.encode()).hexdigest(),
            defaults={
                "filename": data["filename"],
                "original": encrypt_bytes(data["text"].encode("utf-8")),
                "configuration": {"mapping": mapping},
            },
        )
    return batch


def review_batch(user, pk, data):
    with transaction.atomic():
        lock_transfer_user(user)
        batch = get_object_or_404(
            BulkImport.objects.select_for_update().select_related("account"),
            pk=pk,
            user=user,
        )
        if batch.state != "draft" or data["version"] != batch.version:
            raise ChangedReview()
        configuration = json_values(
            {key: value for key, value in data.items() if key != "version"}
        )
        configuration.setdefault("mapping", batch.configuration.get("mapping", {}))
        batch.configuration = configuration
        batch.version += 1
        result = preview(batch)
        batch.save(update_fields=["configuration", "version", "updated_at"])
        return result


def record_fingerprint(record):
    return digest(
        {
            "snapshot": transaction_snapshot(record),
            "updated_at": record.updated_at.isoformat(),
        }
    )


def commit_batch(user, pk, data, request):
    with transaction.atomic():
        lock_transfer_user(user)
        batch = get_object_or_404(
            BulkImport.objects.select_for_update().select_related("account"),
            pk=pk,
            user=user,
        )
        if batch.state == "committed":
            return {"id": str(batch.pk), "state": batch.state, "receipt": batch.receipt}
        if batch.state != "draft" or batch.version != data["version"]:
            raise ChangedReview()
        result = preview(batch)
        if result["review_token"] != data["review_token"]:
            raise ChangedReview()
        if result["errors"] or result["summary"]["needs_review"]:
            raise ValidationError(
                {
                    "detail": "Fix or skip the highlighted rows and resolve checkpoint timing before importing."
                }
            )
        row_ids = {}
        for row in result["rows"]:
            if row["action"] == "skip":
                continue
            values = row["values"]
            if row["action"] == "link":
                record = get_object_or_404(
                    Transaction.objects.select_for_update(),
                    pk=row["transaction"],
                    user=user,
                )
                if not compatible(record, values, batch.account):
                    raise ChangedReview()
            else:
                note = values["notes"]
                if row["source_category"]:
                    note = (
                        f"{note}\nImported category: {row['source_category']}".strip()
                    )
                serializer = TransactionSerializer(
                    data={
                        "account": str(batch.account_id),
                        "transfer_account": values["other_account"]
                        if values["type"] == "transfer"
                        else None,
                        "date": values["date"],
                        "time": values["time"],
                        "amount": values["amount"],
                        "balance_after": values["balance_after"],
                        "type": values["type"],
                        "direction": values["direction"],
                        "category": values["category"],
                        "counterparty_text": values["description"],
                        "note": note,
                        "source": "import",
                        "external_key": f"bulk:{batch.pk}:{row['number']}",
                    },
                    context={"request": request},
                )
                serializer.is_valid(raise_exception=True)
                record = serializer.save(user=user)
                create_audit_log(
                    user=user,
                    action=AuditLogEntry.Action.CREATED,
                    entity=record,
                    after=transaction_snapshot(record),
                    metadata={"bulk_import": str(batch.pk)},
                )
            row_ids[f"row:{row['number']}"] = str(record.pk)
            BulkImportRow.objects.create(
                batch=batch,
                number=row["number"],
                transaction=record,
                ledger_identity=record.pk,
                created_entry=row["action"] == "new",
                saved_fingerprint=record_fingerprint(record),
                normalized=values,
            )
        snapshot_ids = []
        for check in result["checkpoints"]:
            timing_order = {
                (
                    row_ids[key] if key.startswith("row:") else key.split(":", 1)[1]
                ): position
                for key, position in check["timing_order"].items()
            }
            checked_at = datetime.fromisoformat(check["checked_at"])
            expected = checkpoint_expected(
                batch.account, checked_at, check["precision"], timing_order
            )
            if expected != Decimal(check["expected_balance"]):
                raise ChangedReview()
            snapshot = BalanceSnapshot.objects.create(
                user=user,
                account=batch.account,
                checked_at=checked_at,
                precision=check["precision"],
                timing_order=timing_order,
                actual_balance=check["balance"],
                expected_balance=expected,
                difference=Decimal(check["balance"]) - expected,
                status=snapshot_status_for_difference(
                    Decimal(check["balance"]) - expected
                ),
                note=check["note"],
            )
            snapshot.refresh_from_db()
            create_audit_log(
                user=user,
                action=AuditLogEntry.Action.CREATED,
                entity=snapshot,
                after=json_values(snapshot_state(snapshot)),
                metadata={"bulk_import": str(batch.pk)},
            )
            BulkImportCheckpoint.objects.create(
                batch=batch,
                snapshot=snapshot,
                original=check,
                saved_fingerprint=digest(snapshot_state(snapshot)),
            )
            snapshot_ids.append(str(snapshot.pk))
        batch.state = "committed"
        batch.receipt = {
            **result["summary"],
            "snapshot_ids": snapshot_ids,
            "recorded_at": timezone.now().isoformat(),
        }
        batch.save(update_fields=["state", "receipt", "updated_at"])
        create_audit_log(
            user=user,
            action=AuditLogEntry.Action.CREATED,
            entity=batch,
            after=batch.receipt,
        )
        return {"id": str(batch.pk), "state": batch.state, "receipt": batch.receipt}


def snapshot_state(snapshot):
    return {
        field: getattr(snapshot, field)
        for field in (
            "account_id",
            "checked_at",
            "actual_balance",
            "note",
            "precision",
            "timing_order",
            "updated_at",
        )
    }


def undo_batch(user, pk):
    with transaction.atomic():
        lock_transfer_user(user)
        batch = get_object_or_404(
            BulkImport.objects.select_for_update(), pk=pk, user=user
        )
        if batch.state == "undone":
            return {"id": str(batch.pk), "state": "undone", "receipt": batch.receipt}
        if batch.state != "committed":
            raise ValidationError({"detail": "Only a recorded import can be undone."})
        created = list(
            batch.entries.filter(created_entry=True).select_related("transaction")
        )
        checks = list(batch.checkpoints.select_related("snapshot"))
        for entry in created:
            record = entry.transaction
            if (
                record is None
                or record_fingerprint(record) != entry.saved_fingerprint
                or record.statement_rows.exists()
                or record.parsed_message_candidates.exists()
                or BulkImportRow.objects.filter(transaction=record)
                .exclude(batch=batch)
                .exists()
            ):
                raise ChangedReview(
                    "An imported entry was edited, deleted or linked to another source. Review it in Transactions; this batch cannot be safely undone automatically."
                )
            from apps.transactions.payments import has_payments

            if has_payments(record):
                raise ChangedReview(
                    "An imported entry is attached to a payment. Review its payment before undoing this batch."
                )
        for check in checks:
            if (
                check.snapshot is None
                or digest(snapshot_state(check.snapshot)) != check.saved_fingerprint
            ):
                raise ChangedReview(
                    "A balance checkpoint was edited or deleted. Review it before undoing this batch."
                )
        for entry in created:
            create_audit_log(
                user=user,
                action=AuditLogEntry.Action.DELETED,
                entity=entry.transaction,
                before=transaction_snapshot(entry.transaction),
                metadata={"bulk_import": str(batch.pk)},
            )
            entry.transaction.delete()
        for check in checks:
            create_audit_log(
                user=user,
                action=AuditLogEntry.Action.DELETED,
                entity=check.snapshot,
                before=json_values(snapshot_state(check.snapshot)),
                metadata={"bulk_import": str(batch.pk)},
            )
            check.snapshot.delete()
        # Detach imported evidence from pre-existing entries; never delete them.
        batch.entries.update(transaction=None)
        batch.state = "undone"
        batch.save(update_fields=["state", "updated_at"])
        create_audit_log(
            user=user,
            action=AuditLogEntry.Action.UPDATED,
            entity=batch,
            before={"state": "committed"},
            after={"state": "undone"},
        )
        return {"id": str(batch.pk), "state": "undone", "receipt": batch.receipt}


def reopen_batch(user, pk, version):
    with transaction.atomic():
        lock_transfer_user(user)
        batch = get_object_or_404(
            BulkImport.objects.select_for_update().select_related("account"),
            pk=pk,
            user=user,
        )
        if batch.state == "draft":
            return preview(batch)
        if batch.state != "undone" or batch.version != version:
            raise ChangedReview(
                "Undo this batch before reopening it. Already recorded entries must not be imported again."
            )
        create_audit_log(
            user=user,
            action=AuditLogEntry.Action.UPDATED,
            entity=batch,
            before={
                "state": batch.state,
                "configuration": batch.configuration,
                "receipt": batch.receipt,
            },
            after={"state": "draft"},
        )
        batch.entries.all().delete()
        batch.checkpoints.all().delete()
        batch.state = "draft"
        batch.version += 1
        batch.receipt = {}
        batch.save(update_fields=["state", "version", "receipt", "updated_at"])
        return preview(batch)
