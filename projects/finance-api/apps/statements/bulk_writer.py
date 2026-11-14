"""Atomic writes for strictly validated, new ordinary SMS/PDF movements.

Transfers and multi-SMS/retention decisions retain canonical confirmation. This
path uses the transaction serializer, original audit transitions and ActionRecorder;
it batches database writes, never client-authored validation or recovery state.
"""

from collections import defaultdict
from copy import copy

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import build_audit_log, transaction_snapshot
from apps.messages.identifiers import sanitize_financial_identifier
from apps.messages.models import (
    ParsedMessageCandidate,
    RawMessage,
    SmsCapturePreference,
)
from apps.messages.pathao_sources import source_plan
from apps.transactions.models import MergedLedgerEntry, Transaction
from apps.transactions.serializers import TransactionSerializer

from .models import StatementImport, StatementRow
from .services import ReviewConflict, find_matches, row_snapshot

ORDINARY_TYPES = {
    "expense",
    "income",
    "refund",
    "lend",
    "borrow",
    "repayment_received",
    "repayment_paid",
}
IDENTIFIERS = (
    "sender_account_identifier",
    "sender_card_identifier",
    "receiver_account_identifier",
    "receiver_card_identifier",
)


class ResolvedRelation(serializers.Field):
    """Resolve an exact owner-scoped, locked object; retain fallback validation."""

    def __init__(self, original, objects):
        super().__init__(
            required=original.required,
            allow_null=original.allow_null,
            default=original.default,
            validators=original.validators,
        )
        self.original, self.objects = original, objects

    def to_internal_value(self, value):
        obj = self.objects.get(str(value))
        return obj if obj is not None else self.original.to_internal_value(value)

    def to_representation(self, value):
        return self.original.to_representation(value)


class PreparedTransactionSerializer(TransactionSerializer):
    def get_fields(self):
        fields = super().get_fields()
        for name, objects in self.context["resolved_relations"].items():
            fields[name] = ResolvedRelation(fields[name], objects)
        return fields


@transaction.atomic
def write_ordinary_pairs(*, user, results, rows, messages, request):
    """Called only after locked bulk inspection has reproduced the signed proof."""
    preference = (
        SmsCapturePreference.objects.select_for_update().filter(user=user).first()
    )
    if preference and preference.raw_sms_retention_days == 0:
        return {}  # Canonical confirmation performs the requested redaction.
    selected = []
    for item in results:
        row, sms = rows[item["statement"]["id"]], messages[item["sms"]["id"]]
        if (
            not item["ready"]
            or row.state != "pending"
            or row.transaction_id
            or sms.status != "needs_review"
            or sms.transaction_id
        ):
            raise ReviewConflict(
                "A selected source is no longer ready. Refresh the review."
            )
        if row.type not in ORDINARY_TYPES:
            continue
        if any(
            sanitize_financial_identifier(getattr(sms, name)) != getattr(sms, name)
            for name in IDENTIFIERS
        ):
            continue  # Preserve canonical handling of legacy identifier values.
        plan = source_plan(sms)
        if plan["blockers"] or plan["records"] or len(plan["sources"]) != 1:
            continue  # Keep canonical alias/source resolution.
        selected.append((item, row, sms))
    if not selected:
        return {}
    accounts = {
        str(account.pk): account
        for account in Account.objects.select_for_update()
        .filter(
            user=user,
            pk__in={row.batch.account_id for _, row, _ in selected},
            is_active=True,
        )
        .order_by("pk")
    }
    raws = {
        str(raw.pk): raw
        for raw in RawMessage.objects.select_for_update()
        .filter(
            user=user,
            pk__in={sms.raw_message_id for _, _, sms in selected},
        )
        .order_by("pk")
    }
    keys = {f"statement-row:{row.pk}" for _, row, _ in selected}
    if (
        Transaction.objects.filter(user=user, external_key__in=keys).exists()
        or MergedLedgerEntry.objects.filter(user=user, external_key__in=keys).exists()
    ):
        raise ReviewConflict(
            "A statement source was already recorded or merged. Refresh the review."
        )
    categories = {
        str(row._bulk_final_category.pk): row._bulk_final_category
        for _, row, _ in selected
    }
    relations = {"account": accounts, "category": categories, "raw_message": raws}
    staged, audits = [], []
    now = timezone.now()

    def audit(action, entity, before=None, after=None, metadata=None):
        audits.append(
            build_audit_log(
                user=user,
                action=action,
                entity=entity,
                before=before,
                after=after,
                metadata=metadata,
            )
        )

    def touch(row, before, metadata):
        row.version += 1
        row.updated_at = now
        audit("updated", row, before, row_snapshot(row), metadata)

    for item, row, sms in selected:
        account = accounts.get(str(row.batch.account_id))
        raw = raws.get(str(sms.raw_message_id))
        if (
            account is None
            or raw is None
            or account.updated_at != row.batch.account.updated_at
            or account.currency != row.batch.currency
            or raw.body_hash != sms.raw_message.body_hash
            or raw.redacted_at != sms.raw_message.redacted_at
        ):
            raise ReviewConflict(
                "An account or original SMS changed. Refresh the review."
            )
        before_draft = row_snapshot(row)
        row.category = row._bulk_final_category
        row.counterparty_text, row.note = (
            item["final"]["description"],
            item["final"]["note"],
        )
        if row_snapshot(row) != before_draft:
            touch(row, before_draft, {"decision": "unified_draft_edit"})
        serializer = PreparedTransactionSerializer(
            data={
                "account": str(account.pk),
                "category": str(row.category_id),
                "raw_message": str(raw.pk),
                "type": row.type,
                "direction": row.direction,
                "amount": str(row.amount),
                "date": row.date.isoformat(),
                "time": row.time.isoformat() if row.time else None,
                "balance_after": (
                    str(row.balance_after) if row.balance_after is not None else None
                ),
                "reference": row.reference,
                "counterparty_text": row.counterparty_text,
                "note": row.note,
                "source": "import",
                "external_key": f"statement-row:{row.pk}",
                **{name: getattr(sms, name) for name in IDENTIFIERS},
            },
            context={"request": request, "resolved_relations": relations},
        )
        serializer.is_valid(raise_exception=True)
        record = Transaction(user=user, **serializer.validated_data)
        # New ordinary records have no transfer evidence; avoid per-audit reads.
        record._prefetched_objects_cache = {"transfer_evidence": []}
        imported = copy(record)
        imported.raw_message = None
        for name in IDENTIFIERS:
            setattr(imported, name, "")
        audit(
            "created",
            record,
            after=transaction_snapshot(imported),
            metadata={"statement_row": str(row.pk)},
        )
        record.source = "sms"
        record.balance_after = (
            sms.balance_after if item["balance_source"] == "sms" else row.balance_after
        )
        staged.append((item, row, sms, record))
    Transaction.objects.bulk_create([record for _, _, _, record in staged])
    # Re-read the ledger after staging, including all new movements. Own records
    # are expected; any other match (including a cross-pair duplicate) aborts all.
    grouped = defaultdict(list)
    for _, row, _, record in staged:
        grouped[row.batch_id].append((row, record))
    for group in grouped.values():
        found, truncated = find_matches(
            [row for row, _ in group], context_rows=group[0][0]._bulk_statement_rows
        )
        if truncated or any(
            any(match["id"] != str(record.pk) for match in found[row.pk])
            for row, record in group
        ):
            raise ReviewConflict(
                "Ledger matches changed. Nothing was approved. Refresh the review."
            )
    for item, row, sms, record in staged:
        before = row_snapshot(row)
        row.transaction, row.state, row.classification_confirmed = (
            record,
            "posted",
            True,
        )
        touch(
            row,
            before,
            {
                "decision": "create",
                "acknowledge_issues": True,
                "acknowledge_conflict": False,
                "allow_separate": False,
                "remember_choices": False,
                "balance_resolution": None,
                "category_resolution": None,
                "amount_resolution": None,
                "updated_details": [],
                "dismissed_ledger_matches": [],
            },
        )
        row.state = "linked"
        touch(
            row,
            before,
            {
                "decision": "unified_match",
                "sms_candidate": str(sms.pk),
                "balance_source": item["balance_source"],
                "filled_report_from": None,
            },
        )
        sms.transaction, sms.status, sms.updated_at = record, "confirmed", now
        audit(
            "updated",
            record,
            after=transaction_snapshot(record),
            metadata={
                "rounding_policy": "higher_bdt_under_1",
                "source_amounts": {
                    "statement": str(row.amount),
                    "sms": str(sms.amount),
                },
                "statement_row": str(row.pk),
                "sms_candidate": str(sms.pk),
                "decision": "unified_match",
                "reviewed_sms_account_correction": None,
                "dismissed_ledger_matches": [],
            },
        )
    StatementRow.objects.bulk_update(
        [row for _, row, _, _ in staged],
        [
            "category",
            "counterparty_text",
            "note",
            "transaction",
            "state",
            "classification_confirmed",
            "version",
            "updated_at",
        ],
    )
    ParsedMessageCandidate.objects.bulk_update(
        [sms for _, _, sms, _ in staged], ["transaction", "status", "updated_at"]
    )
    StatementImport.objects.filter(pk__in=grouped).update(updated_at=now)
    AuditLogEntry.objects.bulk_create(audits)
    return {item["id"]: record for item, _, _, record in staged}
