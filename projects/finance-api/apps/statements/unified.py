"""Pending-source suggestions and an atomic, explicit SMS/PDF decision."""

import base64
import binascii
import json
from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import ParsedMessageCandidate, SmsCapturePreference
from apps.transactions.models import Transaction
from apps.transactions.transfers import (
    INCOMING_KINDS,
    add_transfer_evidence,
    lock_transfer_user,
    sms_recorded_elsewhere,
    sms_reporting_account,
)

from .insights import merchant_text
from .link_validation import accepted_link_issues
from .services import (
    ReviewConflict,
    dates_for,
    decide_locked,
    find_matches,
    row_snapshot,
    touch,
)

MAX_PENDING = 2000
NON_FINANCIAL = {"unknown", "otp_or_security", "balance_notice", "promotional"}


def sms_observation(candidate):
    received = timezone.localtime(candidate.raw_message.received_at)
    incoming = (
        candidate.suggested_transfer_direction == "credit"
        if candidate.suggested_transfer_direction
        else candidate.message_kind in INCOMING_KINDS
    )
    direction = (
        ("credit" if incoming else "debit")
        if candidate.transaction_type == "transfer"
        or candidate.message_kind
        in INCOMING_KINDS | {"bank_transfer_out", "send_money", "cash_out"}
        else Transaction.default_direction_for_type(candidate.transaction_type)
    )
    return sms_reporting_account(candidate), direction, received


def pair_signals(row, candidate):
    account, direction, received = sms_observation(candidate)
    if (
        candidate.status != "needs_review"
        or candidate.transaction_id
        or row.state != "pending"
        or row.transaction_id
        or row.component != "principal"
        or candidate.message_kind in NON_FINANCIAL
        or not account
        or account.pk != row.batch.account_id
        or account.currency != row.batch.currency
        or direction != row.direction
        or not row.amount
        or row.amount != candidate.amount
        or not dates_for(row)
    ):
        return None
    other_account = (
        candidate.account
        if direction == "credit" and candidate.destination_account_id
        else candidate.destination_account
        if direction == "debit"
        else None
    )
    if (
        row.other_account_id
        and other_account
        and row.other_account_id != other_account.pk
    ):
        return None
    distance = min(abs((day - received.date()).days) for day in dates_for(row))
    if distance > 3:
        return None
    left, right = (
        row.reference.strip().casefold(),
        candidate.reference.strip().casefold(),
    )
    if left and right and left != right:
        return None
    same_reference = bool(left and left == right)
    same_balance = (
        row.balance_after is not None and row.balance_after == candidate.balance_after
    )
    merchant = merchant_text(
        row.counterparty_text or row.extracted.get("description", "")
    )
    sms_merchant = merchant_text(candidate.counterparty_text)
    same_merchant = bool(merchant and merchant == sms_merchant)
    merchant_conflict = bool(merchant and sms_merchant and merchant != sms_merchant)
    same_counterpart = bool(
        row.other_account_id
        and other_account
        and row.other_account_id == other_account.pk
    )
    # Exact amount/date alone is common enough to create believable false matches.
    # Unified review therefore requires an independent source signal as well.
    if not (same_reference or same_balance or same_merchant or same_counterpart):
        return None
    if distance > 1 and not (same_reference or same_balance):
        return None
    conflict = (
        row.balance_after is not None
        and candidate.balance_after is not None
        and row.balance_after != candidate.balance_after
    )
    reasons = [
        "Same reporting account, currency, amount and debit/credit direction.",
        f"Date difference: {distance} days.",
    ]
    if same_reference:
        reasons.append("Reference agrees.")
    if same_balance:
        reasons.append("Reported balances agree.")
    if same_merchant:
        reasons.append("Counterparty wording agrees.")
    elif merchant_conflict:
        reasons.append("Counterparty wording differs.")
    if same_counterpart:
        reasons.append("Transfer counterpart account agrees.")
    if conflict:
        reasons.append(
            f"Reported balance difference: {row.balance_after - candidate.balance_after:+.2f}."
        )
    reasons.append(
        "SMS date/time is its received timestamp; verify the original message."
    )
    return {
        "strength": "strong"
        if distance == 0
        and (same_reference or same_balance or same_counterpart)
        and not conflict
        and not merchant_conflict
        else "possible",
        "conflict": conflict,
        "reasons": reasons,
    }


def pending_sources(user, account_id=None):
    from .models import StatementRow

    rows = StatementRow.objects.filter(
        batch__user=user, state="pending", transaction__isnull=True
    ).select_related("batch__account", "other_account", "category")
    candidates = ParsedMessageCandidate.objects.filter(
        user=user, status="needs_review", transaction__isnull=True
    ).select_related("account", "destination_account", "raw_message")
    if account_id:
        rows = rows.filter(batch__account_id=account_id)
        # Incoming SMS can name its receiving account in either relation.
        from django.db.models import Q

        candidates = candidates.filter(
            Q(account_id=account_id) | Q(destination_account_id=account_id)
        )
    rows, candidates = (
        list(rows.order_by("id")[: MAX_PENDING + 1]),
        list(candidates.order_by("id")[: MAX_PENDING + 1]),
    )
    if len(rows) > MAX_PENDING or len(candidates) > MAX_PENDING:
        raise ValidationError(
            {
                "queue": "Too many pending sources to compare safely. Choose an account or resolve some items first."
            }
        )
    return rows, candidates


def summary(source):
    if isinstance(source, ParsedMessageCandidate):
        account, direction, received = sms_observation(source)
        return {
            "source": "sms",
            "id": str(source.pk),
            "account": str(account.pk) if account else None,
            "account_name": account.name if account else "Account needed",
            "date": received.date().isoformat(),
            "time": received.time().replace(tzinfo=None, microsecond=0).isoformat(),
            "amount": str(source.amount) if source.amount is not None else None,
            "balance_after": str(source.balance_after)
            if source.balance_after is not None
            else None,
            "direction": direction,
            "type": source.transaction_type,
            "description": source.counterparty_text
            or source.get_message_kind_display(),
            "reference": source.reference,
            "updated_at": source.updated_at.isoformat(),
            "version": None,
            "batch": None,
            "currency": account.currency if account else "",
            "needs_correction": not account
            or not source.amount
            or source.message_kind in NON_FINANCIAL,
        }
    return {
        "source": "statement",
        "id": str(source.pk),
        "account": str(source.batch.account_id),
        "account_name": source.batch.account.name,
        "date": source.date.isoformat() if source.date else None,
        "time": source.time.isoformat() if source.time else None,
        "amount": str(source.amount) if source.amount is not None else None,
        "balance_after": str(source.balance_after)
        if source.balance_after is not None
        else None,
        "direction": source.direction,
        "type": source.type,
        "description": source.counterparty_text
        or source.extracted.get("description", ""),
        "reference": source.reference,
        "updated_at": source.updated_at.isoformat(),
        "version": source.version,
        "batch": str(source.batch_id),
        "currency": source.batch.currency,
        "needs_correction": not source.date or not source.amount,
    }


def unique_pair_signals(user, row, candidate):
    """Return signals only when both pending sources claim exactly one another."""

    signals = pair_signals(row, candidate)
    if not signals:
        return None
    rows, candidates = pending_sources(user, row.batch.account_id)
    if sum(pair_signals(row, item) is not None for item in candidates) != 1:
        return None
    if sum(pair_signals(item, candidate) is not None for item in rows) != 1:
        return None
    return signals


def _item_key(item):
    return (
        item["statement"]["date"] or "",
        item["statement"]["time"] or "",
        item["id"],
    )


def _encode_cursor(item):
    value = json.dumps(_item_key(item), separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode_cursor(value):
    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(padded).decode())
        if (
            not isinstance(decoded, list)
            or len(decoded) != 3
            or not all(isinstance(part, str) for part in decoded)
        ):
            raise ValueError
        return tuple(decoded)
    except (
        ValueError,
        TypeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ):
        raise ValidationError({"cursor": "Refresh the review queue and try again."})


def _row_in_date_scope(row, start_date, end_date):
    return not start_date or bool(
        row.date and start_date <= row.date <= end_date
    )


def _candidate_in_date_scope(candidate, start_date, end_date):
    if not start_date:
        return True
    received = timezone.localtime(candidate.raw_message.received_at).date()
    return start_date <= received <= end_date


def queue(user, filters):
    # Build the matching graph before applying the display date range. Otherwise,
    # a competing source just outside the selected range could make an ambiguous
    # relationship look one-to-one in the queue even though confirmation rejects it.
    rows, candidates = pending_sources(user, filters.get("account"))
    start_date, end_date = filters.get("start_date"), filters.get("end_date")
    buckets = defaultdict(list)
    for candidate in candidates:
        account, direction, _ = sms_observation(candidate)
        if account and candidate.amount:
            buckets[(account.pk, direction, candidate.amount)].append(candidate)
    if (
        sum(
            len(buckets[(row.batch.account_id, row.direction, row.amount)])
            for row in rows
        )
        > 50000
    ):
        raise ValidationError(
            {
                "queue": "Too many overlapping pending sources. Choose an account or resolve repeated entries before comparing."
            }
        )
    row_matches = defaultdict(list)
    candidate_matches = defaultdict(list)
    for row in rows:
        for candidate in buckets[(row.batch.account_id, row.direction, row.amount)]:
            signals = pair_signals(row, candidate)
            if signals:
                row_matches[row.pk].append((candidate, signals))
                candidate_matches[candidate.pk].append((row, signals))
    items = []
    matched_rows = set()
    ambiguous_rows = set()
    ambiguous_candidates = set()
    for row in rows:
        matches = row_matches[row.pk]
        if len(matches) != 1:
            if matches:
                ambiguous_rows.add(row.pk)
                ambiguous_candidates.update(candidate.pk for candidate, _ in matches)
            continue
        candidate, signals = matches[0]
        # A pair enters this queue only when both sources claim exactly one another.
        # Repeated equal movements remain in their individual review workflows.
        if len(candidate_matches[candidate.pk]) != 1:
            ambiguous_rows.add(row.pk)
            ambiguous_candidates.add(candidate.pk)
            continue
        if not _row_in_date_scope(row, start_date, end_date):
            continue
        matched_rows.add(row.pk)
        statement, sms = summary(row), summary(candidate)
        item = {
            "id": f"{row.pk}:{candidate.pk}",
            "statement": statement,
            "sms": sms,
            "match": signals,
            "needs_correction": statement["needs_correction"]
            or sms["needs_correction"],
        }
        search = filters.get("search", "").casefold()
        if (
            search
            and search
            not in (
                f"{statement['description']} {statement['reference']} "
                f"{sms['description']} {sms['reference']} {statement['account_name']}"
            ).casefold()
        ):
            continue
        items.append(item)
    items.sort(key=_item_key, reverse=True)
    offset, limit = filters.get("offset", 0), filters.get("limit", 50)
    cursor = filters.get("cursor", "").strip()
    if cursor:
        anchor = _decode_cursor(cursor)
        remaining = [item for item in items if _item_key(item) < anchor]
        page_offset = 0
    else:
        remaining = items[offset:]
        page_offset = offset
    results = remaining[:limit]
    next_cursor = (
        _encode_cursor(results[-1]) if results and len(remaining) > limit else None
    )
    unmatched_rows = {
        row.pk
        for row in rows
        if not row_matches[row.pk] and _row_in_date_scope(row, start_date, end_date)
    }
    unmatched_candidates = {
        candidate.pk
        for candidate in candidates
        if not candidate_matches[candidate.pk]
        and _candidate_in_date_scope(candidate, start_date, end_date)
    }
    scoped_ambiguous_rows = {
        row.pk
        for row in rows
        if row.pk in ambiguous_rows and _row_in_date_scope(row, start_date, end_date)
    }
    scoped_ambiguous_candidates = {
        candidate.pk
        for candidate in candidates
        if candidate.pk in ambiguous_candidates
        and _candidate_in_date_scope(candidate, start_date, end_date)
    }
    return {
        "count": len(items),
        "offset": page_offset,
        "limit": limit,
        "next_cursor": next_cursor,
        "overview": {
            "matched": len(matched_rows),
            "ambiguous": len(scoped_ambiguous_rows)
            + len(scoped_ambiguous_candidates),
            "statement_only": len(unmatched_rows),
            "sms_only": len(unmatched_candidates),
        },
        "results": results,
    }


@transaction.atomic
def confirm_pair(*, user, row, candidate, payload, request):
    lock_transfer_user(user)
    from .models import StatementRow

    row = (
        StatementRow.objects.select_for_update(of=("self",))
        .select_related("batch__account", "category", "other_account", "transaction")
        .get(pk=row.pk, batch__user=user)
    )
    candidate = (
        ParsedMessageCandidate.objects.select_for_update(of=("self",))
        .select_related("account", "destination_account", "raw_message")
        .get(pk=candidate.pk, user=user)
    )
    if (
        row.transaction_id
        and row.transaction_id == candidate.transaction_id
        and candidate.status == "confirmed"
    ):
        if accepted_link_issues(row) or (
            payload.get("transaction")
            and str(row.transaction_id) != str(payload["transaction"])
        ):
            raise ReviewConflict(
                "The attached ledger entry changed. Review its statement evidence before retrying."
            )
        return row.transaction, True
    if (
        row.version != payload["statement_version"]
        or candidate.updated_at != payload["sms_updated_at"]
    ):
        raise ReviewConflict(
            "One source changed. Reload both sources before confirming."
        )
    signals = unique_pair_signals(user, row, candidate)
    if not signals or sms_recorded_elsewhere(candidate):
        raise ReviewConflict(
            "These sources are no longer pending matches. Reload the queue."
        )
    if not payload["acknowledge_match"]:
        raise ValidationError(
            {
                "acknowledge_match": "Confirm that these sources describe the same movement."
            }
        )
    if signals["conflict"] and not payload["acknowledge_conflict"]:
        raise ValidationError(
            {"acknowledge_conflict": "Review both reported balances before matching."}
        )
    # Reuse statement validation, including fresh ledger suggestions and discrepancies.
    target_id = payload.get("transaction")
    target = (
        Transaction.objects.filter(pk=target_id, user=user).first()
        if target_id
        else None
    )
    if target_id and not target:
        raise ValidationError(
            {"transaction": "Choose an existing suggested transaction."}
        )
    if target and payload["balance_source"] != "existing":
        raise ValidationError(
            {"balance_source": "Linking retains the existing ledger balance."}
        )
    if not target and payload["balance_source"] == "existing":
        raise ValidationError(
            {"balance_source": "Choose SMS or statement for a new transaction."}
        )
    balance_choice = None
    if target:
        matches, _ = find_matches([row])
        selected = next(
            (match for match in matches[row.pk] if match["id"] == str(target.pk)), None
        )
        effective_balance = (
            Decimal(selected["effective_balance_after"])
            if selected and selected["effective_balance_after"] is not None
            else None
        )
        if selected:
            # Unified linking preserves the current account report. Ordinary
            # statement review still offers explicit balance/detail replacement.
            balance_choice = {
                "keep": "existing",
                "existing_balance_after": effective_balance,
                "statement_balance_after": row.balance_after,
            }
        if (
            effective_balance is not None
            and candidate.balance_after is not None
            and candidate.balance_after != effective_balance
            and not payload["acknowledge_conflict"]
        ):
            raise ValidationError(
                {
                    "acknowledge_conflict": "The SMS and existing ledger report different balances. Review both before linking."
                }
            )
    before = row_snapshot(row)
    decide_locked(
        row=row,
        user=user,
        request=request,
        payload={
            "action": "link" if target else "create",
            "version": row.version,
            "transaction": target,
            "acknowledge_issues": payload["acknowledge_issues"],
            "acknowledge_conflict": payload["acknowledge_conflict"],
            "remember_choices": payload["remember_choices"],
            "balance_choice": balance_choice,
        },
        # This source was verified above and will be attached in the same atomic
        # operation. Ledger-match safeguards remain enabled in decide_locked.
        combining_pending_sms=not target,
    )
    record = row.transaction
    selected_balance = (
        candidate.balance_after
        if payload["balance_source"] == "sms"
        else row.balance_after
    )
    has_fee = row.batch.rows.filter(position=row.position, component="fee").exists()
    if has_fee and payload["balance_source"] == "statement" and not target:
        raise ValidationError(
            {
                "balance_source": "This statement balance includes a separate fee. Choose the SMS report, or review the fee separately."
            }
        )
    if not target:
        record.balance_after = (
            selected_balance if record.account_id == row.batch.account_id else None
        )
        record.source = "sms"
    if not record.raw_message_id:
        record.raw_message = candidate.raw_message
    for field in (
        "sender_account_identifier",
        "sender_card_identifier",
        "receiver_account_identifier",
        "receiver_card_identifier",
    ):
        if not getattr(record, field):
            setattr(record, field, getattr(candidate, field))
    record.save()
    if record.type == "transfer":
        _, direction, received = sms_observation(candidate)
        add_transfer_evidence(
            record,
            {
                "account": row.batch.account,
                "direction": direction,
                "date": received.date(),
                "time": received.time().replace(tzinfo=None, microsecond=0),
                "balance_after": candidate.balance_after,
                "reference": candidate.reference,
                "source": "sms",
                "note": candidate.counterparty_text,
            },
            candidate,
        )
    candidate.transaction = record
    candidate.status = "confirmed"
    candidate.save(update_fields=("transaction", "status", "updated_at"))
    row.state = "linked"
    touch(
        row,
        user,
        before,
        {
            "decision": "unified_match",
            "sms_candidate": str(candidate.pk),
            "balance_source": payload["balance_source"],
        },
    )
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=record,
        after=transaction_snapshot(record),
        metadata={
            "statement_row": str(row.pk),
            "sms_candidate": str(candidate.pk),
            "decision": "unified_match",
        },
    )
    preference = SmsCapturePreference.objects.filter(user=user).first()
    if preference and preference.raw_sms_retention_days == 0:
        candidate.raw_message.redact()
    return record, False
