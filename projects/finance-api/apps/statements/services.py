"""Saved review and explicit, atomic decisions. Matching never posts money."""

import hashlib
import json
import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.db import transaction as db_transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.transactions.models import Transaction
from apps.transactions.serializers import TransactionSerializer
from apps.transactions.transfers import add_transfer_evidence, lock_transfer_user

from .insights import analyze, match_signals, remember
from .models import StatementImport, StatementRow

MAX_MATCH_HISTORY = 10000
MATCH_DAYS = 3


class ReviewConflict(APIException):
    status_code = 409
    default_detail = "This row changed. Reload it before deciding."


def transfer_hint(row):
    text = f"{row.extracted.get('provider_type', '')} {row.extracted.get('description', '')}"
    return row.component == "principal" and bool(
        re.search(
            r"transfer|npsb|eft|card\s*to\s*bkash|add\s*money|send\s*money",
            text,
            re.IGNORECASE,
        )
    )


def resolved(row):
    return row.state == "skipped" or row.transaction_id is not None


def ledger_money(value):
    if value is None:
        return None
    number = Decimal(value)
    return (
        number if number.is_finite() and abs(number) < Decimal(1000000000000) else None
    )


def source_fingerprint(original, component):
    # Supporting evidence, never a uniqueness key. Identical repeat movements
    # stay separate; changing file bytes or page geometry does not change it.
    values = {
        key: original.get(key)
        for key in (
            "date",
            "time",
            "value_date",
            "direction",
            "amount",
            "signed_fee",
            "balance_after",
            "reference",
            "description",
            "provider_type",
        )
    }
    return hashlib.sha256(
        json.dumps([component, values], sort_keys=True).encode()
    ).hexdigest()


@db_transaction.atomic
def save_import(*, user, account, digest, preview):
    # Same lock order as ledger/SMS writers. Extraction has already finished.
    lock_transfer_user(user)
    existing = StatementImport.objects.filter(
        user=user, account=account, file_digest=digest
    ).first()
    if existing:
        return existing, False
    batch = StatementImport.objects.create(
        user=user,
        account=account,
        file_digest=digest,
        **{
            k: preview[k]
            for k in (
                "profile",
                "parser_version",
                "currency",
                "account_hint",
                "account_identity",
                "period_start",
                "period_end",
                "page_count",
                "checks",
                "warnings",
            )
        },
        opening_balance=ledger_money(preview["opening_balance"]),
        closing_balance=ledger_money(preview["closing_balance"]),
    )
    records = []
    for position, original in enumerate(preview["rows"], 1):
        original = {**original, "issues": list(original["issues"])}
        if any(
            original[key] is not None and ledger_money(original[key]) is None
            for key in ("amount", "balance_after", "signed_fee")
        ):
            original["issues"].append(
                "A source value exceeds the ledger limit. Correct it before recording."
            )
        direction = original["direction"]
        kind = "income" if direction == "credit" else "expense"
        if direction == "credit" and re.search(
            r"reverse|refund|reversal", original["description"], re.IGNORECASE
        ):
            kind = "refund"
        common = {
            "batch": batch,
            "position": position,
            "extracted": original,
            "date": original["date"],
            "time": original["time"],
            "value_date": original["value_date"],
            "balance_after": ledger_money(original["balance_after"]),
            "reference": original["reference"],
            "counterparty_text": original["description"][:255],
            "note": original["description"],
        }
        records.append(
            StatementRow(
                component="principal",
                source_fingerprint=source_fingerprint(original, "principal"),
                direction=direction,
                amount=ledger_money(original["amount"]),
                type=kind,
                **common,
            )
        )
        fee = Decimal(original["signed_fee"])
        if fee:
            records.append(
                StatementRow(
                    component="fee",
                    source_fingerprint=source_fingerprint(original, "fee"),
                    direction="debit" if fee < 0 else "credit",
                    amount=ledger_money(abs(fee)),
                    type="fee" if fee < 0 else "refund",
                    note="Statement inline charge · " + original["description"],
                    **{k: v for k, v in common.items() if k != "note"},
                )
            )
    StatementRow.objects.bulk_create(records)
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.CREATED,
        entity=batch,
        after={
            "account": str(account.id),
            "profile": batch.profile,
            "rows": len(records),
        },
    )
    return batch, True


def financial_issues(row):
    issues = []
    if row.date is None:
        issues.append("Enter a transaction date.")
    if row.amount is None or row.amount <= 0:
        issues.append("Enter a positive amount.")
    return issues


def posting_issues(row):
    issues = financial_issues(row)
    if not row.batch.account.is_active:
        issues.append("The reporting account is inactive.")
    if row.batch.account.currency != row.batch.currency:
        issues.append(
            "The reporting account currency changed; choose the correct statement account."
        )
    if row.type == "transfer":
        if not row.other_account_id:
            issues.append("Choose the other owned account for this transfer.")
        elif (
            row.other_account_id == row.batch.account_id
            or not row.other_account.is_active
            or row.other_account.currency != row.batch.currency
        ):
            issues.append("Choose a different active account in the same currency.")
    elif row.other_account_id:
        issues.append("Only transfers can have another account.")
    if row.type not in {
        "transfer",
        "adjustment",
    } and row.direction != Transaction.default_direction_for_type(row.type):
        issues.append(
            "Debit/credit does not agree with the selected type. Correct the type or direction."
        )
    if row.category_id and not row.category.is_active:
        issues.append("Choose an active category or clear the category.")
    if transfer_hint(row) and not row.classification_confirmed:
        issues.append(
            "Review the transfer wording and confirm whether this involves your own accounts."
        )
    return issues


def dates_for(row):
    return [d for d in (row.date, row.value_date) if d is not None]


def reporting_observations(record, account_id):
    """Keep reporting-account evidence intact; never borrow another side's fields."""
    if record.type != "transfer":
        return [record]
    observations = [
        e for e in record.transfer_evidence.all() if e.account_id == account_id
    ]
    if observations:
        return observations
    if record.account_id == account_id:
        return [record]  # Legacy source-account report.
    # Without receiving-account evidence, the source date is only a search hint.
    return [
        SimpleNamespace(
            id=record.id,
            date=record.date,
            time=None,
            balance_after=None,
            reference="",
            note="",
            source=record.source,
            date_is_fallback=True,
        )
    ]


def evaluate_observation(row, record, observation, compatible_fields, previously_seen):
    distance = min(abs((d - observation.date).days) for d in dates_for(row))
    if distance > MATCH_DAYS and not previously_seen:
        return None
    reference_matches = bool(row.reference.strip()) and (
        row.reference.strip().casefold() == observation.reference.strip().casefold()
    )
    reported_balance = observation.balance_after
    balance_matches = (
        row.balance_after is not None and row.balance_after == reported_balance
    )
    conflict = (
        row.balance_after is not None
        and reported_balance is not None
        and not balance_matches
    )
    signals, reasons, extra_score = match_signals(
        row,
        record,
        observation,
        distance,
        reference_matches,
        balance_matches,
        conflict or not compatible_fields,
        previously_seen,
    )
    score = (
        extra_score
        + (300 if previously_seen else 0)
        + (100 if reference_matches else 0)
        + (30 if balance_matches else 0)
        - distance
    )
    return {
        "observation": observation,
        "distance": distance,
        "reference_matches": reference_matches,
        "balance_matches": balance_matches,
        "reported_balance": reported_balance,
        "conflict": conflict,
        "signals": signals,
        "extra_reasons": reasons,
        "score": score,
    }


def find_matches(rows):
    """One bounded history query, then bucket by amount and account perspective."""
    pending = [r for r in rows if not resolved(r) and not financial_issues(r)]
    results = {r.id: [] for r in rows}
    if not pending:
        return results, False
    batch = pending[0].batch
    days = [d for r in pending for d in dates_for(r)]
    amounts = {r.amount for r in pending}
    history = list(
        Transaction.objects.filter(
            user_id=batch.user_id,
            amount__in=amounts,
        )
        .filter(
            Q(
                date__range=(
                    min(days) - timedelta(days=MATCH_DAYS),
                    max(days) + timedelta(days=MATCH_DAYS),
                )
            )
            | Q(
                transfer_evidence__account_id=batch.account_id,
                transfer_evidence__date__range=(
                    min(days) - timedelta(days=MATCH_DAYS),
                    max(days) + timedelta(days=MATCH_DAYS),
                ),
            )
        )
        .filter(
            Q(account_id=batch.account_id)
            | Q(type="transfer", transfer_account_id=batch.account_id)
        )
        .select_related("account", "transfer_account", "category")
        .prefetch_related("transfer_evidence")
        .order_by("date", "id")
        .distinct()[: MAX_MATCH_HISTORY + 1]
    )
    if len(history) > MAX_MATCH_HISTORY:
        return results, True
    previous_sources = list(
        StatementRow.objects.filter(
            batch__user_id=batch.user_id,
            batch__account_id=batch.account_id,
            source_fingerprint__in={r.source_fingerprint for r in pending},
            transaction__isnull=False,
        )
        .values_list("source_fingerprint", "transaction_id")
        .order_by()
        .distinct()[: MAX_MATCH_HISTORY + 1]
    )
    if len(previous_sources) > MAX_MATCH_HISTORY:
        return results, True
    known_ids = {record_id for _, record_id in previous_sources}
    seen = {record.id for record in history}
    additional = (
        Transaction.objects.filter(user_id=batch.user_id, id__in=known_ids - seen)
        .select_related("account", "transfer_account", "category")
        .prefetch_related("transfer_evidence")
    )
    history.extend(additional)
    by_id = {record.id: record for record in history}
    by_fingerprint = defaultdict(dict)
    for fingerprint, record_id in previous_sources:
        if record_id in by_id:
            by_fingerprint[fingerprint][record_id] = by_id[record_id]
    occupied = set(
        batch.rows.filter(transaction__isnull=False).values_list(
            "transaction_id", flat=True
        )
    )
    buckets = defaultdict(list)
    for record in history:
        if record.account.currency != batch.currency:
            continue
        perspective = (
            "credit"
            if record.type == "transfer"
            and record.transfer_account_id == batch.account_id
            else record.direction
        )
        buckets[(record.amount, perspective)].append(record)
    for row in pending:
        candidates = []
        possible = {
            record.id: record for record in buckets[(row.amount, row.direction)]
        }
        possible.update(by_fingerprint[row.source_fingerprint])
        for record in possible.values():
            previously_seen = record.id in by_fingerprint[row.source_fingerprint]
            perspective = (
                "credit"
                if record.type == "transfer"
                and record.transfer_account_id == batch.account_id
                else record.direction
            )
            compatible_fields = (
                record.amount == row.amount
                and perspective == row.direction
                and record.account.currency == batch.currency
                and (
                    record.account_id == batch.account_id
                    or (
                        record.type == "transfer"
                        and record.transfer_account_id == batch.account_id
                    )
                )
            )
            if record.type == "transfer":
                if (
                    record.transfer_account is None
                    or record.transfer_account.currency != batch.currency
                ):
                    if not previously_seen:
                        continue
                    compatible_fields = False
                other_id = (
                    record.account_id
                    if row.direction == "credit"
                    else record.transfer_account_id
                )
                if row.other_account_id and other_id != row.other_account_id:
                    if not previously_seen:
                        continue
                    compatible_fields = False
            elif row.other_account_id:
                if not previously_seen:
                    continue
                compatible_fields = False
            evaluations = [
                result
                for observation in reporting_observations(record, batch.account_id)
                if (
                    result := evaluate_observation(
                        row, record, observation, compatible_fields, previously_seen
                    )
                )
                is not None
            ]
            if not evaluations:
                continue
            selected = max(
                evaluations,
                key=lambda result: (
                    result["signals"]["strength"] == "strong",
                    not result["conflict"],
                    result["score"],
                    -result["distance"],
                    str(result["observation"].id),
                ),
            )
            observation = selected["observation"]
            distance = selected["distance"]
            reference_matches = selected["reference_matches"]
            balance_matches = selected["balance_matches"]
            reported_balance = selected["reported_balance"]
            conflict = selected["conflict"]
            reasons = [
                "Same account perspective, currency, direction and amount."
                if compatible_fields
                else "This previously seen source has corrected ledger fields. Correct the draft to match its amount, account and direction before linking.",
                f"Date difference: {distance} days.",
            ]
            if previously_seen:
                reasons.append(
                    "Previously linked statement evidence has identical source values. It remains a suggestion, not a unique identity."
                )
            if reference_matches:
                reasons.append("Reference also agrees; references can be reused.")
            if balance_matches:
                reasons.append("Reported balance also agrees.")
            if conflict:
                reasons.append(
                    f"Reported balances differ: statement {row.balance_after}, ledger observation {reported_balance}, difference {row.balance_after - reported_balance:+.2f}. Explicitly review this conflict."
                )
            if record.id in occupied:
                reasons.append(
                    "Another row in this statement is already attached to this movement."
                )
            signals = selected["signals"]
            reasons.extend(selected["extra_reasons"])
            if getattr(observation, "date_is_fallback", False):
                reasons.append(
                    "No receiving-account observation exists. The sender's date is only a search hint; its time, reference and balance were not used."
                )
            elif record.type == "transfer":
                reasons.append(
                    "Date, time, reference and balance were evaluated together from one reporting-account observation."
                )
            if row.value_date:
                reasons.append(
                    f"Posting date {row.date}; printed value date {row.value_date}. Both were considered."
                )
            score = selected["score"]
            candidates.append(
                (
                    score,
                    str(record.id),
                    {
                        **signals,
                        "id": str(record.id),
                        "date": observation.date.isoformat(),
                        "time": observation.time.isoformat()
                        if observation.time
                        else None,
                        "type": record.type,
                        "source": observation.source,
                        "amount": str(record.amount),
                        "account_name": record.account.name,
                        "transfer_account_name": record.transfer_account.name
                        if record.transfer_account
                        else None,
                        "category_name": record.category.name
                        if record.category
                        else None,
                        "reference": observation.reference,
                        "note": observation.note[:500],
                        "balance_after": str(reported_balance)
                        if reported_balance is not None
                        else None,
                        "conflict": conflict,
                        "can_link": compatible_fields and record.id not in occupied,
                        "reasons": reasons,
                    },
                )
            )
        results[row.id] = [
            item[2]
            for item in sorted(candidates, key=lambda item: (-item[0], item[1]))[:8]
        ]
    # A corroborated candidate shared by two source rows is still ambiguous.
    claims = defaultdict(set)
    for row in pending:
        for match in results[row.id]:
            if match["can_link"]:
                claims[match["id"]].add(row.id)
    for row in pending:
        for match in results[row.id]:
            if match["strength"] == "strong" and len(claims[match["id"]]) > 1:
                match["strength"] = "possible"
                match["reasons"].append(
                    "Multiple statement rows suggest this movement; confirm one-to-one correspondence."
                )
        strong = [
            m for m in results[row.id] if m["strength"] == "strong" and m["can_link"]
        ]
        if len(strong) > 1:
            for match in strong:
                match["strength"] = "possible"
                match["reasons"].append(
                    "Multiple corroborated movements exist; inspect them individually."
                )
    return results, False


def review_context(row, matches, truncated=False):
    if resolved(row) and not hasattr(row, "_draft_issues"):
        row._draft_issues = []
    if not hasattr(row, "_draft_issues"):
        records = list(row.batch.rows.select_related("batch"))
        analyze(row.batch, records)
        row._draft_issues = next(
            (r._draft_issues for r in records if r.id == row.id), []
        )
    draft_issues = row._draft_issues
    issues = posting_issues(row) if not resolved(row) else []
    orphaned = row.state in {"posted", "linked"} and row.transaction_id is None
    if truncated and not resolved(row):
        issues.append(
            "Too much matching history. Open this row individually to search its date window."
        )
    if resolved(row):
        state = row.state
    else:
        state = (
            "possible_match"
            if matches
            else "needs_correction"
            if issues or draft_issues or row.extracted.get("issues") or orphaned
            else "new"
        )
    return {
        "issues": issues,
        "draft_issues": draft_issues,
        "suggestion": getattr(row, "_suggestion", None),
        "review_state": state,
        "matches": matches,
        "matching_truncated": truncated,
        "requires_acknowledgement": bool(draft_issues)
        or orphaned
        or bool(row.extracted.get("issues"))
        or any(c.get("passed") is False for c in row.batch.checks),
    }


def row_snapshot(row):
    return {
        "state": row.state,
        "version": row.version,
        "type": row.type,
        "direction": row.direction,
        "amount": str(row.amount) if row.amount is not None else None,
        "date": row.date.isoformat() if isinstance(row.date, date) else row.date,
        "time": str(row.time) if row.time else None,
        "balance_after": str(row.balance_after)
        if row.balance_after is not None
        else None,
        "value_date": row.value_date.isoformat()
        if isinstance(row.value_date, date)
        else row.value_date,
        "classification_confirmed": row.classification_confirmed,
        "reference": row.reference,
        "category": str(row.category_id) if row.category_id else None,
        "other_account": str(row.other_account_id) if row.other_account_id else None,
        "counterparty_text": row.counterparty_text,
        "note": row.note,
        "transaction": str(row.transaction_id) if row.transaction_id else None,
    }


def touch(row, user, before, metadata=None):
    row.version += 1
    row.save()
    StatementImport.objects.filter(pk=row.batch_id).update(updated_at=timezone.now())
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=row,
        before=before,
        after=row_snapshot(row),
        metadata=metadata,
    )


def decide_locked(*, row, user, payload, request):
    action = payload["action"]
    target = payload.get("transaction")
    if resolved(row) and action not in {"unlink", "reopen"}:
        if (
            (action == "skip" and row.state == "skipped")
            or (action == "create" and row.state == "posted")
            or (action == "link" and target and row.transaction_id == target.pk)
        ):
            return row, "unchanged"
        raise ReviewConflict(
            "This row is already resolved. Unlink its evidence before choosing another decision."
        )
    if payload["version"] != row.version:
        raise ReviewConflict()
    before = row_snapshot(row)
    if action == "reopen":
        if row.state != "skipped":
            raise ValidationError({"action": "Only skipped rows can be reopened."})
        row.state = "pending"
    elif action == "unlink":
        if not row.transaction_id:
            raise ValidationError({"action": "This row has no linked ledger entry."})
        row.transaction = None
        row.state = "pending"
        # Statement transfer observations have their own stable key. Remove only
        # this observation; preserve SMS/manual evidence and the ledger movement.
        from apps.transactions.models import TransferEvidence

        TransferEvidence.objects.filter(
            user=user, external_key=f"statement-row:{row.id}"
        ).delete()
    elif action == "skip":
        row.state = "skipped"
    else:
        base_issues = financial_issues(row)
        # Deletion is an audit warning, rather than an invalid financial value.
        base_issues = [
            issue for issue in base_issues if "previously linked" not in issue
        ]
        if base_issues:
            raise ValidationError({"row": base_issues})
        matches, truncated = find_matches([row])
        if truncated:
            raise ValidationError(
                {
                    "row": "The matching window is too busy to review safely. Narrow the row date."
                }
            )
        records = list(row.batch.rows.select_related("batch"))
        analyze(row.batch, records)
        draft_issues = next((r._draft_issues for r in records if r.id == row.id), [])
        requires_ack = (
            bool(draft_issues)
            or bool(row.extracted.get("issues"))
            or any(c.get("passed") is False for c in row.batch.checks)
            or (row.state in {"posted", "linked"} and row.transaction_id is None)
        )
        if requires_ack and not payload.get("acknowledge_issues"):
            raise ValidationError(
                {
                    "acknowledge_issues": "Review the source discrepancies and confirm your corrected values before recording this row."
                }
            )
        if action == "link":
            match = next(
                (m for m in matches[row.id] if target and m["id"] == str(target.pk)),
                None,
            )
            if not match or not match["can_link"]:
                raise ValidationError(
                    {
                        "transaction": "This movement no longer matches or is already attached to another row in this statement. Refresh the suggestions."
                    }
                )
            if match["conflict"] and not payload.get("acknowledge_conflict"):
                raise ValidationError(
                    {
                        "acknowledge_conflict": "The reported balances differ. Review both observations before linking."
                    }
                )
            row.transaction = Transaction.objects.select_for_update().get(
                pk=target.pk, user=user
            )
            row.state = "linked"
            row.type = row.transaction.type
            row.category = row.transaction.category
            row.other_account_id = (
                (
                    row.transaction.account_id
                    if row.direction == "credit"
                    else row.transaction.transfer_account_id
                )
                if row.transaction.type == "transfer"
                else None
            )
        elif action == "create":
            if Transaction.objects.filter(
                user=user, external_key=f"statement-row:{row.id}"
            ).exists():
                raise ValidationError(
                    {
                        "row": "This row previously created a ledger entry. Link to that entry or delete it in Transactions before adding it again."
                    }
                )
            issues = posting_issues(row)
            issues = [issue for issue in issues if "previously linked" not in issue]
            if issues:
                raise ValidationError({"row": issues})
            if matches[row.id] and not payload.get("allow_separate"):
                raise ValidationError(
                    {
                        "allow_separate": "Possible matches exist. Accept a match or explicitly confirm that this is a separate movement."
                    }
                )
            has_inline_fee = (
                row.component == "principal"
                and row.batch.rows.filter(
                    position=row.position, component="fee"
                ).exists()
            )
            data = {
                "account": str(row.batch.account_id),
                "transfer_account": str(row.other_account_id)
                if row.other_account_id
                else None,
                "category": str(row.category_id) if row.category_id else None,
                "type": row.type,
                "direction": row.direction,
                "amount": str(row.amount),
                "date": row.date.isoformat(),
                "time": row.time.isoformat() if row.time else None,
                "balance_after": None
                if has_inline_fee
                else str(row.balance_after)
                if row.balance_after is not None
                else None,
                "reference": row.reference,
                "counterparty_text": row.counterparty_text,
                "note": row.note,
                "source": "import",
                "external_key": f"statement-row:{row.id}",
            }
            serializer = TransactionSerializer(data=data, context={"request": request})
            serializer.is_valid(raise_exception=True)
            row.transaction = serializer.save(user=user)
            row.state = "posted"
            create_audit_log(
                user=user,
                action=AuditLogEntry.Action.CREATED,
                entity=row.transaction,
                after=transaction_snapshot(row.transaction),
                metadata={"statement_row": str(row.id)},
            )
        if row.transaction.type == "transfer":
            add_transfer_evidence(
                row.transaction,
                {
                    "account": row.batch.account,
                    "direction": row.direction,
                    "date": row.date,
                    "time": row.time,
                    "balance_after": row.balance_after,
                    "reference": row.reference,
                    "source": "import",
                    "note": row.note,
                    "external_key": f"statement-row:{row.id}",
                },
            )
        row.classification_confirmed = True
        if payload.get("remember_choices"):
            remember(row, user)
    touch(
        row,
        user,
        before,
        {
            "decision": action,
            "acknowledge_issues": payload.get("acknowledge_issues", False),
            "acknowledge_conflict": payload.get("acknowledge_conflict", False),
            "allow_separate": payload.get("allow_separate", False),
            "remember_choices": payload.get("remember_choices", False),
        },
    )
    return row, action


def file_digest(data):
    return hashlib.sha256(data).hexdigest()
