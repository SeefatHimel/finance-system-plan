"""Explicit duplicate consolidation. Source linking alone never removes money."""

import hashlib
import json
from datetime import timedelta

from django.core import signing
from django.db import transaction
from django.db.models import F
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.bulk_imports.models import BulkImportRow
from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.messages.references import reference_facts
from apps.quick_add.models import QuickEntryReceipt
from apps.reports.models import ReportMembership
from apps.statements.models import StatementRow

from .models import LedgerMergeReceipt, MergedLedgerEntry, Transaction, TransferEvidence
from .recovery import ActionRecorder, describe, freeze, related_fingerprint
from .reference_comparison import sms_reference_facts
from .transfers import lock_transfer_user

SALT = "ledger-duplicate-merge-v1"


class MergeConflict(APIException):
    status_code = 409
    default_detail = (
        "These entries or their sources changed. Refresh the merge preview."
    )


class MergePreviewRequest(serializers.Serializer):
    transactions = serializers.ListField(
        child=serializers.UUIDField(), min_length=2, max_length=10
    )
    keep = serializers.UUIDField()
    statement_row = serializers.UUIDField(required=False, allow_null=True)

    def validate(self, attrs):
        ids = attrs["transactions"]
        if len(set(ids)) != len(ids) or attrs["keep"] not in ids:
            raise ValidationError("Choose distinct entries and one of them to keep.")
        return attrs


class MergeRequest(MergePreviewRequest):
    preview_token = serializers.CharField(max_length=2000)
    request_id = serializers.UUIDField()
    confirmed = serializers.BooleanField()

    def validate_confirmed(self, value):
        if not value:
            raise ValidationError(
                "Confirm that all selected entries describe the same movement."
            )
        return value


def entry_summary(record):
    return {
        "id": str(record.pk),
        "account": str(record.account_id),
        "account_name": record.account.name,
        "currency": record.account.currency,
        "transfer_account_name": record.transfer_account.name
        if record.transfer_account_id
        else None,
        "date": str(record.date),
        "time": str(record.time) if record.time else None,
        "type": record.type,
        "direction": record.direction,
        "amount": str(record.amount),
        "balance_after": str(record.balance_after)
        if record.balance_after is not None
        else None,
        "reference": record.reference,
        "description": record.counterparty_text,
        "note": record.note,
        "source": record.source,
    }


def sources_for(record):
    sources = []
    ids = set(record.parsed_message_candidates.values_list("raw_message_id", flat=True))
    observed_accounts = dict(
        record.transfer_evidence.exclude(raw_message=None).values_list(
            "raw_message_id", "account_id"
        )
    )
    ids.update(observed_accounts)
    ids.update(
        record.merged_entries.exclude(raw_message=None).values_list(
            "raw_message_id", flat=True
        )
    )
    if record.raw_message_id:
        ids.add(record.raw_message_id)
    messages = list(
        RawMessage.objects.filter(user=record.user, pk__in=ids)
        .select_related("candidate__account", "candidate__destination_account")
        .order_by("id")[:101]
    )
    if len(messages) != len(ids):
        raise ValidationError(
            "An original SMS is unavailable in this account. Review its source link first."
        )
    for message in messages:
        candidate = getattr(message, "candidate", None)
        from .transfers import sms_reporting_account

        reporting_account = sms_reporting_account(candidate) if candidate else None
        account_id = (
            reporting_account.pk
            if reporting_account
            else record.account_id
            if record.type != "transfer"
            else None
        )
        observed_account = observed_accounts.get(message.pk)
        if observed_account:
            account_id = observed_account
        sources.append(
            {
                "kind": "SMS",
                "id": str(message.pk),
                "account": str(account_id) if account_id else None,
                "text": message.body
                if not message.redacted_at
                else "Original SMS redacted",
                **sms_reference_facts(
                    message, candidate.reference if candidate else record.reference
                ),
            }
        )
    for row in record.statement_rows.select_related("batch").order_by("id")[:101]:
        sources.append(statement_source(row))
    for row in record.bulk_import_rows.order_by("id")[:101]:
        sources.append(
            {
                "kind": "Spreadsheet",
                "id": str(row.pk),
                "account": str(record.account_id),
                "text": " · ".join(
                    f"{key.replace('_', ' ').title()}: {value}"
                    for key, value in row.normalized.items()
                    if value is not None
                ),
                **reference_facts("", row.normalized.get("reference", "")),
            }
        )
    for item in record.merged_entries.order_by("id")[:101]:
        sources.append(
            {
                "kind": "Merged ledger original",
                "id": str(item.original_id),
                "account": item.snapshot.get("account"),
                "text": " · ".join(
                    f"{key.replace('_', ' ').title()}: {item.snapshot.get(key)}"
                    for key in (
                        "date",
                        "time",
                        "type",
                        "amount",
                        "balance_after",
                        "reference",
                        "note",
                    )
                ),
                **reference_facts("", item.snapshot.get("reference", "")),
            }
        )
    if len(sources) > 100:
        raise ValidationError(
            "More than 100 attached records need review. Merge smaller groups first."
        )
    return sources


def statement_source(row):
    return {
        "kind": "Statement",
        "id": str(row.pk),
        "account": str(row.batch.account_id),
        "text": str(row.extracted.get("description", ""))
        + " · "
        + " · ".join(
            f"{key.replace('_', ' ').title()}: {row.extracted.get(key)}"
            for key in ("date", "time", "amount", "direction", "balance_after")
        ),
        **reference_facts(
            str(row.extracted.get("description", "")),
            row.extracted.get("reference") or row.reference,
            statement=True,
        ),
    }


def allowed_relations():
    return {
        TransferEvidence,
        ParsedMessageCandidate,
        StatementRow,
        BulkImportRow,
        QuickEntryReceipt,
        ReportMembership,
        MergedLedgerEntry,
    }


def context(user, data):
    ids = [str(value) for value in data["transactions"]]
    entries = list(
        Transaction.objects.filter(user=user, pk__in=ids)
        .select_related("account", "transfer_account", "category")
        .order_by("id")
    )
    if len(entries) != len(ids):
        raise ValidationError("One or more entries are unavailable in your account.")
    keep = next(item for item in entries if str(item.pk) == str(data["keep"]))
    blockers = []
    for item in entries:
        if (
            item.account.user_id != user.pk
            or (item.transfer_account_id and item.transfer_account.user_id != user.pk)
            or (
                item.transfer_account_id
                and item.transfer_account.currency != item.account.currency
            )
            or item.amount != keep.amount
            or item.account_id != keep.account_id
            or item.transfer_account_id != keep.transfer_account_id
            or item.direction != keep.direction
            or (item.type == "transfer") != (keep.type == "transfer")
            or abs((item.date - keep.date).days) > 3
        ):
            blockers.append(
                "Entries must have the same amount, direction and account path, within three days."
            )
    # Unknown future dependencies fail closed, rather than disappearing on delete.
    for relation in Transaction._meta.related_objects:
        linked = relation.related_model.objects.filter(
            **{f"{relation.field.name}_id__in": ids}
        )
        if len(list(linked.values_list("pk", flat=True)[:201])) > 200:
            raise ValidationError(
                "Too many related records for one merge. Review a smaller group."
            )
        if relation.related_model not in allowed_relations() and linked.exists():
            blockers.append(
                "An entry has a payment, reconciliation or other protected link. Resolve that link before merging."
            )
        if relation.related_model in allowed_relations():
            owner = (
                "batch__user"
                if relation.related_model in {StatementRow, BulkImportRow}
                else "report__user"
                if relation.related_model is ReportMembership
                else "user"
            )
            if linked.exclude(**{owner: user}).exists():
                raise ValidationError(
                    "An attached record has inconsistent ownership. Resolve the source link first."
                )
    if keep.type == "transfer":
        from .balance_reports import has_unattributed_legacy_balance

        if any(has_unattributed_legacy_balance(entry) for entry in entries):
            blockers.append(
                "A legacy transfer balance has no established reporting account. Review its source account before merging."
            )
    rows = list(
        StatementRow.objects.filter(transaction_id__in=ids).select_related("batch")
    )
    row = None
    if data.get("statement_row"):
        row = get_object_or_404(
            StatementRow.objects.select_related("batch__account"),
            pk=data["statement_row"],
            batch__user=user,
        )
        if row.transaction_id or row.state != "pending":
            blockers.append(
                "The statement row is no longer pending. Refresh its review."
            )
        from apps.reconciliation.evidence import identity_issues

        blockers.extend(
            identity_issues(
                record=keep,
                user_id=user.pk,
                account=row.batch.account,
                currency=row.batch.currency,
                amount=row.amount,
                direction=row.direction,
                other_id=row.other_account_id,
            )
        )
        if (
            not row.date
            or min(abs((row.date - item.date).days) for item in entries) > 3
        ):
            blockers.append(
                "The statement date is outside this movement's review window."
            )
        rows.append(row)
    batches = [item.batch_id for item in rows]
    if len(batches) != len(set(batches)):
        blockers.append(
            "Two rows from the same statement cannot describe one movement. Review the original PDF first."
        )
    memberships = list(
        ReportMembership.objects.filter(transaction_id__in=ids).values(
            "report_id", "included"
        )
    )
    for report in {item["report_id"] for item in memberships}:
        if sum(item["report_id"] == report for item in memberships) > 1:
            blockers.append(
                "A saved report has explicit choices for multiple selected entries. Remove those overrides before merging."
            )
    summaries = [
        {**entry_summary(item), "sources": sources_for(item)} for item in entries
    ]
    all_sources = [source for item in summaries for source in item["sources"]]
    if row:
        all_sources.append(statement_source(row))
    # IDs from opposite sides of a transfer belong to different account namespaces.
    for account in {source["account"] for source in all_sources if source["account"]}:
        known = {
            source["transaction_id"].casefold()
            for source in all_sources
            if source["account"] == account and source["transaction_id"]
        }
        if len(known) > 1:
            blockers.append(
                "Original sources have different transaction IDs for the same account. Correct the source link before merging."
            )
    result = {
        "entries": summaries,
        "keep": str(keep.pk),
        "statement": statement_source(row) if row else None,
        "blockers": sorted(set(blockers)),
        "removed_count": len(entries) - 1,
        "retained_fields": "The chosen entry keeps its date, time, type, category, note, reference and reported balance. Other originals remain attached.",
    }
    fingerprint = {
        "preview": result,
        "related": related_fingerprint(user, ids),
        "records": [transaction_snapshot(item) for item in entries],
        "statement_version": row.version if row else None,
    }
    digest = hashlib.sha256(
        json.dumps(freeze(fingerprint), sort_keys=True).encode()
    ).hexdigest()
    return result, digest, entries, keep, row


def preview(user, data):
    result, digest, *_ = context(user, data)
    result["preview_token"] = signing.dumps(
        {"user": user.pk, "digest": digest}, salt=SALT, compress=True
    )
    return result


def reassign_auxiliary(ids, keep):
    BulkImportRow.objects.filter(transaction_id__in=ids).update(
        transaction=keep, ledger_identity=keep.pk
    )
    QuickEntryReceipt.objects.filter(transaction_id__in=ids).update(transaction=keep)
    MergedLedgerEntry.objects.filter(transaction_id__in=ids).update(transaction=keep)
    for item in ReportMembership.objects.filter(transaction_id__in=ids).order_by("pk"):
        existing = (
            ReportMembership.objects.filter(report_id=item.report_id, transaction=keep)
            .exclude(pk=item.pk)
            .first()
        )
        if existing:
            item.delete()
        else:
            item.transaction = keep
            item.save(update_fields=("transaction",))


@transaction.atomic
def apply(user, data):
    lock_transfer_user(user)
    identity = {
        key: freeze(data.get(key))
        for key in ("transactions", "keep", "statement_row", "preview_token")
    }
    request_digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True).encode()
    ).hexdigest()
    receipt = (
        LedgerMergeReceipt.objects.select_related("action")
        .filter(user=user, request_id=data["request_id"])
        .first()
    )
    if receipt:
        if (
            receipt.digest != request_digest
            or not receipt.action
            or receipt.action.undone_at
        ):
            raise MergeConflict(
                "This request was already used or undone. Start a new merge preview."
            )
        return {**receipt.result, "undo_action": describe(receipt.action, check=True)}
    try:
        token = signing.loads(data["preview_token"], salt=SALT, max_age=900)
    except signing.BadSignature as exc:
        raise MergeConflict(
            "This preview expired. Refresh and review the entries again."
        ) from exc
    # Lock the financial entries as well as the shared user mutation lock.
    list(
        Transaction.objects.select_for_update()
        .filter(user=user, pk__in=data["transactions"])
        .order_by("id")
    )
    try:
        result, digest, entries, keep, row = context(user, data)
    except (ValidationError, Http404) as exc:
        raise MergeConflict(
            "A selected entry or source is no longer available. Refresh the merge preview."
        ) from exc
    if token != {"user": user.pk, "digest": digest}:
        raise MergeConflict()
    if result["blockers"]:
        raise ValidationError({"merge": result["blockers"]})
    ids = [item.pk for item in entries]
    recorder = ActionRecorder(
        user,
        transaction_ids=ids,
        statement_ids=[row.pk] if row else [],
        merge_sources=True,
    )
    removed = [item for item in entries if item.pk != keep.pk]
    if keep.type == "transfer":
        from .balance_reports import account_reports, has_unattributed_legacy_balance
        from .transfers import ensure_transfer_evidence

        if has_unattributed_legacy_balance(keep):
            raise ValidationError(
                "Review which account owns the saved transfer balance before merging."
            )
        for entry in entries:
            ensure_transfer_evidence(entry)
        reports, _ = account_reports(keep)
        for report in reports.values():
            report.is_effective_balance = True
            report.save(update_fields=("is_effective_balance",))
    # Archive scalar choices, including legacy SMS links which lack candidates.
    for item in removed:
        MergedLedgerEntry.objects.create(
            user=user,
            transaction=keep,
            original_id=item.pk,
            external_key=item.external_key,
            snapshot={
                **transaction_snapshot(item),
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            },
            raw_message=item.raw_message,
        )
    others = [item.pk for item in removed]
    TransferEvidence.objects.filter(transaction_id__in=others).update(
        is_effective_balance=False
    )
    TransferEvidence.objects.filter(transaction_id__in=others).update(transaction=keep)
    ParsedMessageCandidate.objects.filter(transaction_id__in=others).update(
        transaction=keep
    )
    StatementRow.objects.filter(transaction_id__in=others).update(
        transaction=keep, version=F("version") + 1, updated_at=timezone.now()
    )
    reassign_auxiliary(others, keep)
    if row:
        row.transaction = keep
        row.state = "linked"
        row.version += 1
        row.save(update_fields=("transaction", "state", "version", "updated_at"))
        if keep.type == "transfer":
            from .transfers import add_transfer_evidence

            add_transfer_evidence(
                keep,
                {
                    "account": row.batch.account,
                    "direction": row.direction,
                    "date": row.date,
                    "time": row.time,
                    "balance_after": row.balance_after,
                    "reference": row.reference,
                    "provider": row.batch.profile,
                    "source": "import",
                    "external_key": f"statement-row:{row.pk}",
                    "note": row.note,
                },
            )
    Transaction.objects.filter(user=user, pk__in=others).delete()
    action = recorder.finish(keep, "duplicate_merge")
    for item, original in zip(
        removed, [recorder.before["transactions"][str(item.pk)] for item in removed]
    ):
        create_audit_log(
            user=user,
            action=AuditLogEntry.Action.DELETED,
            entity=item,
            before=original,
            metadata={"merged_into": str(keep.pk)},
        )
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=keep,
        metadata={
            "duplicate_merge": [str(item) for item in others],
            "statement_row": str(row.pk) if row else None,
        },
    )
    response = {
        "transaction": str(keep.pk),
        "removed": [str(item) for item in others],
        "statement_row": str(row.pk) if row else None,
    }
    LedgerMergeReceipt.objects.create(
        user=user,
        request_id=data["request_id"],
        digest=request_digest,
        action=action,
        result=response,
    )
    return {**response, "undo_action": describe(action)}


def candidates(user, pk):
    record = get_object_or_404(
        Transaction.objects.select_related("account", "transfer_account"),
        user=user,
        pk=pk,
    )
    query = Transaction.objects.filter(
        user=user,
        account=record.account,
        transfer_account=record.transfer_account,
        amount=record.amount,
        direction=record.direction,
        date__range=(record.date - timedelta(days=3), record.date + timedelta(days=3)),
    )
    if record.type == "transfer":
        query = query.filter(type="transfer")
    else:
        query = query.exclude(type="transfer")
    return {
        "entry": entry_summary(record),
        "candidates": [
            entry_summary(item)
            for item in query.exclude(pk=pk)
            .select_related("account", "transfer_account")
            .order_by("date", "time", "id")[:25]
        ],
    }


class MergeSourceSerializer(serializers.Serializer):
    kind = serializers.CharField()
    id = serializers.CharField()
    account = serializers.UUIDField(allow_null=True)
    text = serializers.CharField(allow_blank=True)
    transaction_id = serializers.CharField(allow_blank=True)
    message_reference = serializers.CharField(allow_blank=True)
    saved_reference = serializers.CharField(allow_blank=True)


class MergeEntrySerializer(serializers.Serializer):
    id = serializers.UUIDField()
    account = serializers.UUIDField()
    account_name = serializers.CharField()
    currency = serializers.CharField()
    transfer_account_name = serializers.CharField(allow_null=True)
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True)
    type = serializers.CharField()
    direction = serializers.CharField()
    amount = serializers.CharField()
    balance_after = serializers.CharField(allow_null=True)
    reference = serializers.CharField(allow_blank=True)
    description = serializers.CharField(allow_blank=True)
    note = serializers.CharField(allow_blank=True)
    source = serializers.CharField()
    sources = MergeSourceSerializer(many=True, required=False)


class MergeCandidatesSerializer(serializers.Serializer):
    entry = MergeEntrySerializer()
    candidates = MergeEntrySerializer(many=True)


class MergePreviewSerializer(serializers.Serializer):
    entries = MergeEntrySerializer(many=True)
    keep = serializers.UUIDField()
    statement = MergeSourceSerializer(allow_null=True)
    blockers = serializers.ListField(child=serializers.CharField())
    removed_count = serializers.IntegerField()
    retained_fields = serializers.CharField()
    preview_token = serializers.CharField()


class MergeResultSerializer(serializers.Serializer):
    from .serializers import TransactionActionSerializer

    transaction = serializers.UUIDField()
    removed = serializers.ListField(child=serializers.UUIDField())
    statement_row = serializers.UUIDField(allow_null=True)
    undo_action = TransactionActionSerializer()


class MergedSourceSerializer(serializers.Serializer):
    original_id = serializers.UUIDField()
    snapshot = serializers.JSONField()
