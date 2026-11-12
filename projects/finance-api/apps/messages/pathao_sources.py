"""Same-ID Pathao notifications are source evidence, not extra money movements."""

import hashlib
import json
import re
from datetime import timedelta

from django.core import signing
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.transactions.models import Transaction
from apps.transactions.transfers import sms_reporting_account

from .models import ParsedMessageCandidate, SmsCapturePreference
from .references import reference_facts
from .sender_groups import sender_group

SALT = "pathao-sms-source-review-v1"
MAX_SOURCES = 100


class SourceConflict(APIException):
    status_code = 409
    default_detail = "These SMS sources changed. Refresh and compare them again."


def original_id(body):
    facts = reference_facts(body)
    value = facts["transaction_id"] or facts["message_reference"]
    if not re.fullmatch(r"[a-zA-Z0-9-]{6,120}", value) or not re.search(r"\d", value):
        return ""
    return value.casefold()


def source_id(candidate):
    if not sender_group(candidate.provider, candidate.raw_message.sender):
        return ""
    return candidate.source_transaction_id or original_id(candidate.raw_message.body)


def direction(candidate):
    from apps.statements.unified import sms_observation

    return sms_observation(candidate)[1]


def source_plan(candidate):
    account = sms_reporting_account(candidate)
    identity = source_id(candidate)
    plan = {"sources": [candidate], "records": [], "blockers": [], "identity": identity}
    if not identity or not account or candidate.amount is None:
        return plan
    day = timezone.localtime(candidate.raw_message.received_at).date()
    query = (
        ParsedMessageCandidate.objects.filter(
            user_id=candidate.user_id,
            provider="pathao_pay",
            status__in=("needs_review", "confirmed"),
        )
        .filter(Q(account_id=account.pk) | Q(destination_account_id=account.pk))
        .filter(
            Q(source_transaction_id=identity)
            | (
                Q(source_transaction_id="")
                & (
                    Q(
                        amount=candidate.amount,
                        raw_message__received_at__date__gte=day - timedelta(days=3),
                        raw_message__received_at__date__lte=day + timedelta(days=3),
                    )
                    | Q(reference__iexact=identity)
                )
            )
        )
        .select_related("raw_message", "account", "destination_account", "transaction")
        .order_by("raw_message__received_at", "pk")
    )
    possible = list(query[: MAX_SOURCES + 1])
    if len(possible) > MAX_SOURCES:
        plan["blockers"].append(
            "Too many notifications to compare safely. Review a shorter period first."
        )
        return plan
    if any(
        item.raw_message.redacted_at
        and not item.source_transaction_id
        and item.reference.casefold() == identity
        for item in possible
    ):
        plan["blockers"].append(
            "An older matching SMS was redacted before its provider ID was retained. Review its existing ledger entry; do not record another copy."
        )
    sources = [
        item
        for item in possible
        if source_id(item) == identity and sms_reporting_account(item).pk == account.pk
    ]
    if candidate.pk not in {item.pk for item in sources}:
        sources.append(candidate)
    plan["sources"] = sources
    days = [timezone.localtime(item.raw_message.received_at).date() for item in sources]
    if days and max(days) - min(days) > timedelta(days=3):
        plan["blockers"].append(
            "This reference appears on notifications more than three days apart. Compare the dates before treating them as one movement."
        )
    for label, values in (
        ("amount", {item.amount for item in sources}),
        ("debit/credit", {direction(item) for item in sources}),
        (
            "reported balance",
            {item.balance_after for item in sources if item.balance_after is not None},
        ),
        ("fee", {item.fee_amount for item in sources if item.fee_amount is not None}),
    ):
        if len(values) > 1:
            plan["blockers"].append(
                f"The same reference has conflicting {label} values. Review the originals; they were not combined."
            )
    if any(item.status == "confirmed" and not item.transaction_id for item in sources):
        plan["blockers"].append(
            "A previously confirmed notification has no ledger entry. Review its history first."
        )
    ids = {item.transaction_id for item in sources if item.transaction_id}
    # A statement may already have recorded this Pathao movement before any SMS
    # was reviewed. Match its original printed ID, not just the ledger's note.
    from apps.statements.models import StatementRow

    statement_ids = (
        StatementRow.objects.filter(
            batch__user_id=candidate.user_id,
            batch__account_id=account.pk,
            batch__profile="pathao_pay",
            component="principal",
            transaction__isnull=False,
        )
        .filter(Q(extracted__reference__iexact=identity))
        .values_list("transaction_id", flat=True)[: MAX_SOURCES + 1]
    )
    ids.update(statement_ids)
    if len(ids) > 10:
        plan["blockers"].append(
            "More than ten saved entries claim this reference. Review smaller groups in Transactions first."
        )
    plan["records"] = list(
        Transaction.objects.filter(user_id=candidate.user_id, pk__in=ids)
        .select_related("account", "transfer_account")
        .order_by("created_at", "pk")
    )
    for record in plan["records"]:
        if not record_agrees(record, candidate):
            plan["blockers"].append(
                "A saved transaction disagrees with this SMS account, direction, amount, date or balance. Review the saved entry first."
            )
    return plan


def record_agrees(record, candidate):
    account = sms_reporting_account(candidate)
    if (
        not account
        or record.amount != candidate.amount
        or record.account.currency != account.currency
    ):
        return False
    if (
        abs(
            (
                record.date
                - timezone.localtime(candidate.raw_message.received_at).date()
            ).days
        )
        > 3
    ):
        return False
    expected = direction(candidate)
    if record.type == "transfer":
        if not (
            expected == "debit"
            and record.account_id == account.pk
            or expected == "credit"
            and record.transfer_account_id == account.pk
        ):
            return False
        from apps.transactions.balance_reports import (
            has_unattributed_legacy_balance,
            reported_values,
        )

        if has_unattributed_legacy_balance(record):
            return False
        balance = reported_values(record).get(account.pk)
    else:
        if record.account_id != account.pk or record.direction != expected:
            return False
        balance = record.balance_after
    return (
        balance is None
        or candidate.balance_after is None
        or balance == candidate.balance_after
    )


def assert_plan(plan, *, allow_multiple=False):
    if plan["blockers"]:
        raise SourceConflict(" ".join(plan["blockers"]))
    if len(plan["records"]) > 1 and not allow_multiple:
        raise SourceConflict(
            "This Pathao movement was recorded more than once. Open Compare SMS and merge the existing entries before recording again."
        )


def attach_sources(candidate, record, *, plan=None):
    plan = plan or source_plan(candidate)
    if not plan["identity"]:
        return []
    assert_plan(plan)
    if any(item.pk != record.pk for item in plan["records"]) or not record_agrees(
        record, candidate
    ):
        raise SourceConflict(
            "A matching Pathao SMS already belongs to another entry or disagrees with this result. Compare its sources before saving."
        )
    attached = []
    for item in plan["sources"]:
        if not item.source_transaction_id:
            item.source_transaction_id = source_id(item)
            item.save(update_fields=("source_transaction_id",))
        if item.transaction_id == record.pk and item.status == "confirmed":
            continue
        if item.transaction_id or item.status != "needs_review":
            raise SourceConflict()
        item.transaction = record
        item.status = "confirmed"
        item.save(update_fields=("transaction", "status", "updated_at"))
        if record.type == "transfer":
            from apps.transactions.transfers import (
                add_transfer_evidence,
                sms_external_key,
            )

            local = timezone.localtime(item.raw_message.received_at)
            add_transfer_evidence(
                record,
                {
                    "account": sms_reporting_account(item),
                    "direction": direction(item),
                    "date": local.date(),
                    "time": local.time().replace(tzinfo=None),
                    "balance_after": item.balance_after,
                    "reference": item.reference,
                    "provider": "pathao_pay",
                    "source": "sms",
                    "external_key": sms_external_key(item),
                    "note": "Pathao Pay duplicate notification",
                },
                item,
            )
        attached.append(str(item.pk))
    preference = SmsCapturePreference.objects.filter(user_id=candidate.user_id).first()
    if preference and preference.raw_sms_retention_days == 0:
        for item in plan["sources"]:
            if not item.raw_message.redacted_at:
                item.raw_message.redact(reason="retention")
    if attached:
        create_audit_log(
            user=candidate.user,
            action=AuditLogEntry.Action.UPDATED,
            entity=record,
            metadata={"pathao_sms_sources_attached": attached},
        )
    candidate.transaction = record
    candidate.status = "confirmed"
    return attached


def plan_digest(candidate, plan, keep):
    from apps.transactions.recovery import freeze, related_fingerprint

    values = {
        "candidate": str(candidate.pk),
        "identity": plan["identity"],
        "keep": str(keep) if keep else None,
        "sources": [
            (
                str(item.pk),
                str(item.updated_at),
                item.status,
                str(item.transaction_id),
                str(item.amount),
                direction(item),
                str(item.balance_after),
                str(item.fee_amount),
                source_id(item),
                str(item.raw_message.redacted_at),
                item.raw_message.body_hash,
            )
            for item in plan["sources"]
        ],
        "records": [(str(item.pk), str(item.updated_at)) for item in plan["records"]],
        "related": related_fingerprint(
            candidate.user, [item.pk for item in plan["records"]]
        ),
        "blockers": plan["blockers"],
    }
    return hashlib.sha256(
        json.dumps(freeze(values), sort_keys=True).encode()
    ).hexdigest()


def preview(candidate, keep=None):
    from apps.transactions.duplicate_merge import entry_summary
    from apps.transactions.duplicate_merge import preview as merge_preview

    plan = source_plan(candidate)
    ids = [item.pk for item in plan["records"]]
    if keep and keep not in ids:
        raise ValidationError({"keep": "Choose one of this movement's saved entries."})
    keep = keep or (ids[0] if ids else None)
    merge = None
    merge_blockers = []
    if len(ids) > 1 and not plan["blockers"]:
        try:
            merge = merge_preview(candidate.user, {"transactions": ids, "keep": keep})
            merge_blockers = merge["blockers"]
        except ValidationError:
            merge_blockers = [
                "These saved entries need individual source review before they can be merged."
            ]
    blockers = list(plan["blockers"]) + merge_blockers
    result = {
        "available": bool(
            plan["identity"]
            and sms_reporting_account(candidate)
            and candidate.amount is not None
        ),
        "reference": plan["identity"],
        "keep": str(keep) if keep else None,
        "sources": [
            {
                "id": str(item.pk),
                "sender": item.raw_message.sender,
                "text": item.raw_message.body
                if not item.raw_message.redacted_at
                else "Original SMS redacted",
                "received_at": item.raw_message.received_at.isoformat(),
                "status": item.status,
                "transaction": str(item.transaction_id)
                if item.transaction_id
                else None,
                "amount": str(item.amount) if item.amount is not None else None,
                "direction": direction(item),
                "balance_after": str(item.balance_after)
                if item.balance_after is not None
                else None,
                "fee_amount": str(item.fee_amount)
                if item.fee_amount is not None
                else None,
            }
            for item in plan["sources"]
        ],
        "transactions": [entry_summary(item) for item in plan["records"]],
        "blockers": blockers,
        "can_resolve": bool(
            ids
            and plan["identity"]
            and not blockers
            and (
                len(ids) > 1
                or any(item.status == "needs_review" for item in plan["sources"])
            )
        ),
        "preview_token": signing.dumps(
            {
                "user": candidate.user_id,
                "digest": plan_digest(candidate, plan, keep),
                "keep": str(keep) if keep else None,
            },
            salt=SALT,
            compress=True,
        ),
    }
    return result
