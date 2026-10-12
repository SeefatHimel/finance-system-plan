"""Atomic undo of the latest action, never a blind delete or client snapshot."""

import hashlib
import json
from datetime import date, datetime, time, timedelta

from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.messages.models import (
    ParsedMessageCandidate,
    SenderRuleMapping,
    TransferCounterpartyMapping,
)
from apps.statements.models import StatementRow

from .models import Transaction, TransactionAction, TransferEvidence

CANDIDATE_FIELDS = (
    "id",
    "user_id",
    "status",
    "transaction_id",
    "account_id",
    "destination_account_id",
    "payment_method_id",
    "destination_payment_method_id",
    "category_id",
    "transaction_type",
    "possible_internal_transfer",
    "suggested_transfer_direction",
    "transfer_suggestion_reason",
    "parser_notes",
    "updated_at",
)
MODELS = {
    "transactions": Transaction,
    "evidence": TransferEvidence,
    "candidates": ParsedMessageCandidate,
    "statement_rows": StatementRow,
    "sender_mappings": SenderRuleMapping,
    "counterparty_mappings": TransferCounterpartyMapping,
}
LABELS = {
    "create": "Transaction added",
    "update": "Transaction updated",
    "confirm": "SMS added",
    "link": "Transfer linked",
    "merge": "Transfers merged",
}


class UndoConflict(APIException):
    status_code = 409
    default_detail = (
        "This action changed since it was saved. Refresh before making corrections."
    )
    default_code = "undo_conflict"


class RecoveryEncoder(DjangoJSONEncoder):
    def default(self, value):
        if isinstance(value, (date, datetime, time)):
            return value.isoformat()
        return super().default(value)


def freeze(value):
    return json.loads(json.dumps(value, cls=RecoveryEncoder, sort_keys=True))


def rows(queryset, fields=()):
    return {
        str(row["id"]): row
        for row in freeze(list(queryset.order_by("pk").values(*fields)))
    }


def related_fingerprint(user, ids, *, lock=False):
    # Also detect newly attached evidence and changes to related rows which the
    # original action did not modify. Raw SMS bodies are never copied or restored.
    def protected(queryset):
        return queryset.select_for_update(of=("self",)) if lock else queryset

    values = {
        "evidence": rows(
            protected(
                TransferEvidence.objects.filter(user=user, transaction_id__in=ids)
            )
        ),
        "candidates": rows(
            protected(
                ParsedMessageCandidate.objects.filter(user=user, transaction_id__in=ids)
            ),
            CANDIDATE_FIELDS,
        ),
        "statement_rows": rows(
            protected(
                StatementRow.objects.filter(batch__user=user, transaction_id__in=ids)
            )
        ),
    }
    known = {TransferEvidence, ParsedMessageCandidate, StatementRow}
    for relation in Transaction._meta.related_objects:
        if relation.related_model in known:
            continue
        queryset = relation.related_model.objects.filter(
            **{f"{relation.field.name}_id__in": ids}
        )
        values[f"{relation.related_model._meta.label_lower}:{relation.field.name}"] = (
            rows(protected(queryset))
        )
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


class ActionRecorder:
    def __init__(self, user, *, transaction_ids=(), candidate_ids=(), remember=False):
        self.user = user
        self.ids = {str(value) for value in transaction_ids if value}
        self.candidate_ids = {str(value) for value in candidate_ids if value}
        self.rules = (
            list(
                ParsedMessageCandidate.objects.filter(
                    user=user, pk__in=self.candidate_ids
                ).values_list("sender_rule_id", "message_kind")
            )
            if remember
            else []
        )
        self.before = self.capture(lock=True)

    def capture(self, *, lock=False):
        candidates = Q(transaction_id__in=self.ids) | Q(pk__in=self.candidate_ids)
        for rule, kind in self.rules:
            if rule:
                candidates |= Q(
                    sender_rule_id=rule, message_kind=kind, status="needs_review"
                )
        rule_ids = [rule for rule, _ in self.rules if rule]

        def protected(queryset):
            return queryset.select_for_update(of=("self",)) if lock else queryset

        return {
            "transactions": rows(
                protected(Transaction.objects.filter(user=self.user, pk__in=self.ids))
            ),
            "evidence": rows(
                protected(
                    TransferEvidence.objects.filter(
                        user=self.user, transaction_id__in=self.ids
                    )
                )
            ),
            "candidates": rows(
                protected(
                    ParsedMessageCandidate.objects.filter(candidates, user=self.user)
                ),
                CANDIDATE_FIELDS,
            ),
            "statement_rows": rows(
                protected(
                    StatementRow.objects.filter(
                        batch__user=self.user, transaction_id__in=self.ids
                    )
                )
            ),
            "sender_mappings": rows(
                protected(
                    SenderRuleMapping.objects.filter(
                        user=self.user, sender_rule_id__in=rule_ids
                    )
                )
            ),
            "counterparty_mappings": rows(
                protected(
                    TransferCounterpartyMapping.objects.filter(
                        user=self.user, sender_rule_id__in=rule_ids
                    )
                )
            ),
        }

    def finish(self, record, kind):
        self.ids.add(str(record.pk))
        after = self.capture()
        before_delta, after_delta = {}, {}
        for name in MODELS:
            changed = {
                key
                for key in self.before[name].keys() | after[name].keys()
                if self.before[name].get(key) != after[name].get(key)
            }
            if name == "candidates":
                # Approval never creates SMS captures. Preserve messages which
                # arrived concurrently rather than deleting them during Undo.
                changed = {key for key in changed if key in self.before[name]}
            before_delta[name] = {key: self.before[name].get(key) for key in changed}
            after_delta[name] = {key: after[name].get(key) for key in changed}
        if not any(after_delta.values()):
            record.undo_action = None
            return None
        after_delta["_transaction_ids"] = sorted(self.ids)
        after_delta["_related_fingerprint"] = related_fingerprint(self.user, self.ids)
        action = TransactionAction.objects.create(
            user=self.user,
            kind=kind,
            transaction_id=record.pk,
            before=before_delta,
            after=after_delta,
            expires_at=timezone.now() + timedelta(hours=24),
        )
        # Only the latest action is undoable. Keep metadata for audits/retries,
        # but discard recovery payloads which can no longer be used.
        TransactionAction.objects.filter(user=self.user).exclude(pk=action.pk).update(
            before={}, after={}
        )
        record.undo_action = describe(action)
        return action


def unchanged(action, *, lock=False):
    for name, model in MODELS.items():
        expected = action.after[name]
        if not expected:
            continue
        fields = next((tuple(row) for row in expected.values() if row), ())
        queryset = model.objects.filter(pk__in=expected)
        if lock:
            queryset = queryset.select_for_update(of=("self",))
        current = rows(queryset, fields)
        if any(current.get(key) != value for key, value in expected.items()):
            return False
    return (
        related_fingerprint(action.user, action.after["_transaction_ids"], lock=lock)
        == action.after["_related_fingerprint"]
    )


def describe(action, *, check=False):
    latest = True
    if check:
        latest = (
            TransactionAction.objects.filter(user=action.user).first().pk == action.pk
        )
    exists = Transaction.objects.filter(
        user=action.user, pk=action.transaction_id
    ).exists()
    allowed = not action.undone_at and action.expires_at > timezone.now() and latest
    if check and allowed:
        allowed = unchanged(action)
    return {
        "id": str(action.pk),
        "kind": action.kind,
        "label": LABELS[action.kind],
        "transaction": str(action.transaction_id) if exists else None,
        "created_at": action.created_at.isoformat(),
        "expires_at": action.expires_at.isoformat(),
        "can_undo": bool(allowed),
        "undone": bool(action.undone_at),
    }


@transaction.atomic
def undo_action(*, user, action_id):
    from .transfers import lock_transfer_user

    lock_transfer_user(user)
    action = get_object_or_404(
        TransactionAction.objects.select_for_update(), user=user, pk=action_id
    )
    if action.undone_at:
        return action  # An interrupted/retried Undo has no additional effect.
    latest = TransactionAction.objects.filter(user=user).first()
    if latest.pk != action.pk:
        raise UndoConflict("Only your latest transaction action can be undone.")
    if action.expires_at <= timezone.now():
        raise UndoConflict(
            "Undo is available for 24 hours. Edit the transaction to make a correction."
        )
    if not unchanged(action, lock=True):
        raise UndoConflict(
            "The transaction or its linked records changed. Undo was not applied; review it with Edit."
        )
    parents = {}
    restored = {
        name: {key for key, value in action.before[name].items() if value is not None}
        for name in MODELS
    }
    for name, model in MODELS.items():
        for row in action.before[name].values():
            if row is None:
                continue
            for field in model._meta.fields:
                if field.many_to_one and row.get(field.attname) is not None:
                    parents.setdefault(field.related_model, set()).add(
                        str(row[field.attname])
                    )
    for parent, ids in parents.items():
        if parent is Transaction:
            ids -= restored["transactions"]
        found = {
            str(pk)
            for pk in parent.objects.filter(pk__in=ids)
            .select_for_update(of=("self",))
            .values_list("pk", flat=True)
        }
        if found != ids:
            raise UndoConflict(
                "A related account or record was removed. Undo was not applied; review the transaction with Edit."
            )
    try:
        with transaction.atomic():
            # Recreate a merged-away transaction before moving its related rows back.
            for name in MODELS:
                model = MODELS[name]
                for key, row in action.before[name].items():
                    if row is None:
                        continue
                    values = {
                        field: value for field, value in row.items() if field != "id"
                    }
                    if name == "statement_rows":
                        current_version = (
                            model.objects.filter(pk=key)
                            .values_list("version", flat=True)
                            .first()
                        )
                        values["version"] = (current_version or values["version"]) + 1
                    model.objects.update_or_create(pk=key, defaults=values)
                    if "updated_at" in values:
                        values["updated_at"] = timezone.now()
                    model.objects.filter(pk=key).update(**values)
            # Unlink/reopen related records before removing records created by the action.
            for name in (
                *[key for key in MODELS if key != "transactions"],
                "transactions",
            ):
                removed = [
                    key for key, row in action.before[name].items() if row is None
                ]
                MODELS[name].objects.filter(pk__in=removed).delete()
    except IntegrityError as exc:
        raise UndoConflict(
            "Related records changed. Undo was not applied; refresh and review the transaction."
        ) from exc
    action.undone_at = timezone.now()
    action.save(update_fields=("undone_at",))
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=action,
        metadata={
            "undo": True,
            "kind": action.kind,
            "transaction": str(action.transaction_id),
        },
    )
    return action
