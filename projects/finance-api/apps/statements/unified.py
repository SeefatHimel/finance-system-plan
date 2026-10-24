"""Pending-source suggestions and an atomic, explicit SMS/PDF decision."""

import base64
import binascii
import json
from copy import copy
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log, transaction_snapshot
from apps.messages.models import (
    ParsedMessageCandidate,
)
from apps.transactions.balance_reports import (
    account_reports,
    can_fill_missing_transfer_balance,
    select_effective_account_report,
)
from apps.transactions.models import Transaction
from apps.transactions.transfers import (
    INCOMING_KINDS,
    add_transfer_evidence,
    ensure_transfer_evidence,
    lock_transfer_user,
    sms_recorded_elsewhere,
    sms_reporting_account,
)

from .insights import merchant_text
from .link_validation import accepted_link_issues
from .rounding import (
    amount_candidates,
    automatic_balance_choice,
    equivalent_amount,
    has_separate_fee,
    mark_fee_rows,
    nearby_amount,
    nearby_candidates,
)
from .services import (
    ReviewConflict,
    dates_for,
    delayed_ebl_posting,
    decide_locked,
    find_matches,
    row_snapshot,
    touch,
)

MAX_PENDING = 2000
NON_FINANCIAL = {"unknown", "otp_or_security", "balance_notice", "promotional"}


def insignificant_bdt_balance_difference(left, right, currency):
    """Sub-taka BDT reports automatically use the higher exact value."""
    return (
        currency == "BDT"
        and left is not None
        and right is not None
        and Decimal("0.00") < abs(left - right) < Decimal("1.00")
    )


def sms_observation(candidate):
    received = timezone.localtime(candidate.raw_message.received_at)
    incoming = (
        candidate.suggested_transfer_direction == "credit"
        if candidate.suggested_transfer_direction
        else candidate.message_kind in INCOMING_KINDS
    )
    direction = getattr(candidate, "source_direction", "") or (
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
        or not candidate.amount or candidate.amount <= 0 or row.amount <= 0
        or not equivalent_amount(row.amount, candidate.amount, row.batch.currency)
        or not dates_for(row)
    ):
        return None
    if row.amount != candidate.amount and has_separate_fee(row):
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
    late_posting = delayed_ebl_posting(row, received.date())
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
        not late_posting and
        row.balance_after is not None and row.balance_after == candidate.balance_after
    )
    near_balance = not late_posting and insignificant_bdt_balance_difference(
        row.balance_after, candidate.balance_after, row.batch.currency
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
    if not (
        same_reference or same_balance or near_balance or same_merchant or same_counterpart
    ):
        return None
    if distance > 1 and not (same_reference or same_balance or near_balance):
        return None
    if not late_posting and nearby_amount(row.amount, candidate.amount, row.batch.currency) and (
        row.balance_after is not None and candidate.balance_after is not None
        and not equivalent_amount(row.balance_after, candidate.balance_after, row.batch.currency)
    ):
        return None
    conflict = (
        not late_posting
        and
        row.balance_after is not None and candidate.balance_after is not None
        and not equivalent_amount(row.balance_after, candidate.balance_after, row.batch.currency)
    )
    reasons = [
        "Same reporting account, currency and debit/credit direction; amounts agree within the BDT rounding rule.",
        f"Date difference: {distance} days.",
    ]
    if row.amount != candidate.amount:
        reasons.append(f"Amounts: statement {row.amount}, SMS {candidate.amount}. Difference under BDT 1; using {max(row.amount, candidate.amount)} automatically.")
    if same_reference:
        reasons.append("Reference agrees.")
    if same_balance:
        reasons.append("Reported balances agree.")
    elif near_balance:
        reasons.append("Reported balances differ by less than BDT 1.")
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
    if late_posting:
        reasons.append("EBL posted after its value date. SMS and statement balances describe different times and remain separate.")
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
        "late_posting": late_posting,
        "reasons": reasons,
    }


def has_competing_sources(row, candidate):
    """Check a selected pair without loading the user's entire pending queue."""
    from .models import StatementRow

    days = dates_for(row)
    low, high = min(days) - timedelta(days=3), max(days) + timedelta(days=3)
    candidates = amount_candidates(ParsedMessageCandidate.objects.filter(
        user_id=row.batch.user_id,
        status="needs_review",
        transaction__isnull=True,
        raw_message__received_at__date__range=(low, high),
    ), [row.amount], row.batch.currency).exclude(pk=candidate.pk).select_related(
        "account", "destination_account", "raw_message"
    )
    if any(pair_signals(row, item) for item in candidates.iterator()):
        return True
    received = timezone.localtime(candidate.raw_message.received_at).date()
    low, high = received - timedelta(days=3), received + timedelta(days=3)
    rows = amount_candidates(StatementRow.objects.filter(
        batch__user_id=row.batch.user_id,
        batch__account_id=row.batch.account_id,
        state="pending",
        transaction__isnull=True,
    ), [candidate.amount], row.batch.currency).filter(
        Q(date__range=(low, high)) | Q(value_date__range=(low, high))
    ).exclude(pk=row.pk).select_related("batch__account", "other_account")
    return any(pair_signals(item, candidate) for item in rows.iterator())


def competing_sources(row, candidate):
    """Return the other pending sources that could claim the selected movement.

    The tokens include source revisions so an explicit choice cannot silently
    survive a competing source being edited between preview and confirmation.
    """
    from .models import StatementRow

    days = dates_for(row)
    low, high = min(days) - timedelta(days=3), max(days) + timedelta(days=3)
    candidates = amount_candidates(ParsedMessageCandidate.objects.filter(
        user_id=row.batch.user_id,
        status="needs_review",
        transaction__isnull=True,
        raw_message__received_at__date__range=(low, high),
    ), [row.amount], row.batch.currency).exclude(pk=candidate.pk).select_related(
        "account", "destination_account", "raw_message"
    )
    received = timezone.localtime(candidate.raw_message.received_at).date()
    low, high = received - timedelta(days=3), received + timedelta(days=3)
    rows = amount_candidates(StatementRow.objects.filter(
        batch__user_id=row.batch.user_id,
        batch__account_id=row.batch.account_id,
        state="pending",
        transaction__isnull=True,
    ), [candidate.amount], row.batch.currency).filter(
        Q(date__range=(low, high)) | Q(value_date__range=(low, high))
    ).exclude(pk=row.pk).select_related("batch__account", "other_account")

    found = []
    for item in candidates.iterator():
        if pair_signals(row, item):
            found.append({
                "source": summary(item),
                "source_text": item.raw_message.body if not item.raw_message.redacted_at else "",
                "token": f"sms:{item.pk}:{item.updated_at.isoformat()}",
            })
            if len(found) > 20:
                raise ValidationError({"match": "Too many competing sources to review here. Narrow the statement period and retry."})
    for item in rows.iterator():
        if pair_signals(item, candidate):
            found.append({
                "source": summary(item),
                "source_text": item.extracted.get("description", ""),
                "token": f"statement:{item.pk}:{item.version}",
            })
            if len(found) > 20:
                raise ValidationError({"match": "Too many competing sources to review here. Narrow the statement period and retry."})
    return sorted(found, key=lambda item: item["token"])


def validate_competing_decision(row, candidate, payload):
    current = competing_sources(row, candidate)
    expected = [item["token"] for item in current]
    submitted = sorted(payload.get("competing_source_tokens", []))
    if submitted != expected:
        raise ReviewConflict("Competing sources changed. Reload and compare them before pairing.")
    if current and not payload.get("acknowledge_competing_sources"):
        raise ValidationError({"acknowledge_competing_sources": "Compare the other possible sources and confirm your selected pair."})
    return current


def pending_sources(user, account_id=None, filters=None):
    from .models import StatementRow

    filters = filters or {}
    start, end = filters.get("start_date"), filters.get("end_date")
    source = filters.get("source", "all")
    rows = StatementRow.objects.filter(
        batch__user=user, state="pending", transaction__isnull=True
    ).select_related("batch__account", "other_account", "category")
    candidates = ParsedMessageCandidate.objects.filter(
        user=user, status="needs_review", transaction__isnull=True
    ).select_related("account", "destination_account", "raw_message")
    if account_id:
        rows = rows.filter(batch__account_id=account_id)
        # Incoming SMS can name its receiving account in either relation.
        candidates = candidates.filter(
            Q(account_id=account_id) | Q(destination_account_id=account_id)
        )
    if start and end:
        # Keep nearby sources for matching while the final list uses the exact
        # requested dates. A narrow date filter must work on a large backlog.
        near_start, near_end = start - timedelta(days=3), end + timedelta(days=3)
        rows = rows.filter(
            Q(date__range=(near_start, near_end))
            | Q(value_date__range=(near_start, near_end))
        )
        candidates = candidates.filter(
            raw_message__received_at__date__range=(near_start, near_end)
        )
    if source == "statement":
        rows = list(rows.order_by("id")[: MAX_PENDING + 1])
        amounts = {row.amount for row in rows if row.amount is not None}
        days = [day for row in rows for day in dates_for(row)]
        candidates = amount_candidates(candidates, amounts)
        if days:
            candidates = candidates.filter(
                raw_message__received_at__date__range=(
                    min(days) - timedelta(days=3), max(days) + timedelta(days=3)
                )
            )
        else:
            candidates = candidates.none()
        candidates = list(candidates.order_by("id")[: MAX_PENDING + 1])
    elif source == "sms":
        candidates = list(candidates.order_by("id")[: MAX_PENDING + 1])
        amounts = {candidate.amount for candidate in candidates if candidate.amount is not None}
        days = [timezone.localtime(candidate.raw_message.received_at).date() for candidate in candidates]
        rows = amount_candidates(rows, amounts)
        if days:
            low, high = min(days) - timedelta(days=3), max(days) + timedelta(days=3)
            rows = rows.filter(Q(date__range=(low, high)) | Q(value_date__range=(low, high)))
        else:
            rows = rows.none()
        rows = list(rows.order_by("id")[: MAX_PENDING + 1])
    else:
        rows, candidates = (
            list(rows.order_by("id")[: MAX_PENDING + 1]),
            list(candidates.order_by("id")[: MAX_PENDING + 1]),
        )
    if len(rows) > MAX_PENDING or len(candidates) > MAX_PENDING:
        raise ValidationError(
            {
                "queue": "Too many pending sources to compare safely. Choose an account or shorter date range, or resolve some items first."
            }
        )
    mark_fee_rows(rows)
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
    if not signals or has_competing_sources(row, candidate):
        return None
    return signals


def statement_matches_for_sms(candidate, draft=None):
    """Bounded, type-independent lookup for an SMS confirmation decision.

    Check the saved SMS as well as the proposed ledger fields. A form edit must
    not make an existing source match disappear before the user reviews it.
    """
    from .models import StatementRow

    variants = [candidate]
    if draft:
        proposed = copy(candidate)
        for field in ("amount", "balance_after", "reference", "counterparty_text", "transaction_type"):
            key = "type" if field == "transaction_type" else field
            if key in draft:
                setattr(proposed, field, draft[key])
        if draft.get("account_perspective") and draft.get("account"):
            if draft.get("type", candidate.transaction_type) == "transfer":
                incoming = sms_observation(candidate)[1] == "credit"
                if incoming:
                    proposed.destination_account = draft["account"]
                    if draft.get("transfer_account"):
                        proposed.account = draft["transfer_account"]
                else:
                    proposed.account = draft["account"]
                    if draft.get("transfer_account"):
                        proposed.destination_account = draft["transfer_account"]
            else:
                proposed.account = draft["account"]
                proposed.destination_account = None
        variants.append(proposed)
    accounts = {account.pk for item in variants if (account := sms_reporting_account(item))}
    amounts = {item.amount for item in variants if item.amount is not None}
    if not accounts or not amounts:
        return [], False
    received = timezone.localtime(candidate.raw_message.received_at).date()
    low, high = received - timedelta(days=3), received + timedelta(days=3)
    rows = list(amount_candidates(StatementRow.objects.filter(
        batch__user_id=candidate.user_id,
        batch__account_id__in=accounts,
        state="pending",
        transaction__isnull=True,
        component="principal",
    ), amounts).filter(
        Q(date__range=(low, high)) | Q(value_date__range=(low, high))
    ).select_related("batch__account", "other_account").order_by("id")[:10001])
    if len(rows) > 10000:
        return [], True
    mark_fee_rows(rows)
    matches = []
    for row in rows:
        signals = next((signals for item in variants if (signals := pair_signals(row, item))), None)
        if signals:
            matches.append({"row": row, "signals": signals, "unique": False})
            if len(matches) > 200:
                return [], True
    if len(matches) == 1 and pair_signals(matches[0]["row"], candidate):
        matches[0]["unique"] = not has_competing_sources(matches[0]["row"], candidate)
    return matches, False


def unique_pending_pairs_for_rows(rows):
    """Find unified one-to-one SMS suggestions for one statement list page.

    A list must use the same type-independent evidence as Unified review. Check
    uniqueness against all pending sources, including other statement imports.
    None means the bounded lookup could not make a reliable determination;
    "ambiguous" means SMS evidence exists but is not one-to-one.
    """
    eligible = [
        row for row in rows
        if row.state == "pending" and not row.transaction_id
        and row.component == "principal" and row.amount is not None
        and dates_for(row)
    ]
    if not eligible:
        return {}
    mark_fee_rows(eligible)
    amounts = {row.amount for row in eligible}
    account_ids = {row.batch.account_id for row in eligible}
    days = [day for row in eligible for day in dates_for(row)]
    candidates = list(
        amount_candidates(ParsedMessageCandidate.objects.filter(
            user_id=eligible[0].batch.user_id,
            status="needs_review",
            transaction__isnull=True,
            raw_message__received_at__date__range=(
                min(days) - timedelta(days=3), max(days) + timedelta(days=3)
            ),
        ), amounts).filter(
            Q(account_id__in=account_ids) | Q(destination_account_id__in=account_ids)
        ).select_related(
            "account", "destination_account", "raw_message"
        ).order_by("id")[:10001]
    )
    if len(candidates) > 10000:
        return {row.pk: None for row in eligible}
    buckets = defaultdict(list)
    for candidate in candidates:
        account, direction, _ = sms_observation(candidate)
        if account and candidate.amount is not None:
            buckets[(account.pk, direction, int(candidate.amount))].append(candidate)
    if sum(
        len(nearby_candidates(buckets, row.batch.account_id, row.direction, row.amount, row.batch.currency))
        for row in eligible
    ) > 50000:
        return {row.pk: None for row in eligible}
    result = {}
    for row in eligible:
        matches = [
            candidate
            for candidate in nearby_candidates(buckets, row.batch.account_id, row.direction, row.amount, row.batch.currency)
            if pair_signals(row, candidate)
        ]
        if len(matches) == 1:
            result[row.pk] = (
                "ambiguous" if has_competing_sources(row, matches[0])
                else str(matches[0].pk)
            )
        else:
            result[row.pk] = "ambiguous" if matches else ""
    return result


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
    rows, candidates = pending_sources(user, filters.get("account"), filters)
    start_date, end_date = filters.get("start_date"), filters.get("end_date")
    buckets = defaultdict(list)
    for candidate in candidates:
        account, direction, _ = sms_observation(candidate)
        if account and candidate.amount:
            buckets[(account.pk, direction, int(candidate.amount))].append(candidate)
    if (
        sum(
            len(nearby_candidates(buckets, row.batch.account_id, row.direction, row.amount, row.batch.currency))
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
        for candidate in nearby_candidates(buckets, row.batch.account_id, row.direction, row.amount, row.batch.currency):
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
        for candidate, signals in matches:
            # Surface contested pairs instead of hiding them. Choosing one pair
            # still requires reviewing every competing source at confirmation.
            ambiguous = (
                len(matches) != 1
                or len(candidate_matches[candidate.pk]) != 1
                or bool(
                    (start_date or filters.get("source", "all") != "all")
                    and has_competing_sources(row, candidate)
                )
            )
            if ambiguous:
                ambiguous_rows.add(row.pk)
                ambiguous_candidates.add(candidate.pk)
            else:
                matched_rows.add(row.pk)
            if not _row_in_date_scope(row, start_date, end_date):
                continue
            statement, sms = summary(row), summary(candidate)
            item = {
                "id": f"{row.pk}:{candidate.pk}",
                "statement": statement,
                "sms": sms,
                "match": signals,
                "needs_correction": statement["needs_correction"]
                or sms["needs_correction"],
                "needs_decision": ambiguous,
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
            condition = filters.get("condition", "all")
            if condition == "needs_decision" and not ambiguous:
                continue
            if condition == "strong" and signals["strength"] != "strong":
                continue
            if condition == "possible" and signals["strength"] != "possible":
                continue
            if condition == "balance_differs" and not signals["conflict"]:
                continue
            if condition == "type_differs" and statement["type"] == sms["type"]:
                continue
            if condition == "needs_correction" and not item["needs_correction"]:
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
    signals = pair_signals(row, candidate)
    if not signals or sms_recorded_elsewhere(candidate):
        raise ReviewConflict(
            "These sources are no longer pending matches. Reload the queue."
        )
    validate_competing_decision(row, candidate, payload)
    original_balance_after = row.balance_after
    late_posting = delayed_ebl_posting(row, timezone.localtime(candidate.raw_message.received_at).date())
    original_balance_needs_review = (
        signals["conflict"]
        and not insignificant_bdt_balance_difference(
            original_balance_after, candidate.balance_after, row.batch.currency
        )
    )
    original_type = row.type
    draft = payload.get("draft")
    draft_changed = False
    if draft:
        if draft["version"] != row.version:
            raise ReviewConflict("The statement draft changed. Reload the pair.")
        before_draft = row_snapshot(row)
        identity_before = (row.date, row.direction, row.amount)
        for field, value in draft.items():
            if field != "version":
                setattr(row, field, value)
        if row_snapshot(row) != before_draft:
            draft_changed = True
            # Merchant, category, balance and note corrections must not erase the
            # evidence that made the two original sources a unique pair. Changes
            # to the movement's date, direction or amount do need a fresh match.
            if (row.date, row.direction, row.amount) != identity_before:
                signals = pair_signals(row, candidate)
                if not signals:
                    raise ValidationError(
                        {"draft": "These edits no longer support the selected SMS and statement match. Correct the sources separately or restore the matching values."}
                    )
                validate_competing_decision(row, candidate, payload)
            touch(row, user, before_draft, {"decision": "unified_draft_edit"})
    type_choice = payload.get("type_choice")
    if original_type != candidate.transaction_type and not type_choice:
        raise ValidationError(
            {"type_choice": "The statement and SMS classify this movement differently. Choose the transaction type before confirming."}
        )
    if (
        original_type != candidate.transaction_type
        and type_choice == "custom"
        and row.type in {original_type, candidate.transaction_type}
    ):
        raise ValidationError(
            {"type_choice": "For one of the suggested types, choose Statement or SMS. Otherwise select a different type."}
        )
    if (type_choice == "statement" and row.type != original_type) or (
        type_choice == "sms" and row.type != candidate.transaction_type
    ):
        raise ValidationError(
            {"type_choice": "The selected type source does not match the edited transaction type."}
        )
    if not payload["acknowledge_match"]:
        raise ValidationError(
            {
                "acknowledge_match": "Confirm that these sources describe the same movement."
            }
        )
    if draft_changed and not payload["acknowledge_issues"]:
        raise ValidationError(
            {"acknowledge_issues": "Review the edited result against both original sources before confirming."}
        )
    edited_balance_needs_review = (
        not late_posting
        and
        row.balance_after is not None
        and candidate.balance_after is not None
        and row.balance_after != candidate.balance_after
        and not insignificant_bdt_balance_difference(
            row.balance_after, candidate.balance_after, row.batch.currency
        )
    )
    if (
        (original_balance_needs_review or edited_balance_needs_review)
        and not payload["acknowledge_conflict"]
    ):
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
    if not target and payload["balance_source"] == "existing":
        raise ValidationError(
            {"balance_source": "Choose SMS or statement for a new transaction."}
        )
    dismissed_ledger_matches = [
        str(item) for item in payload.get("dismissed_ledger_matches", [])
    ]
    if not target:
        matches, truncated = find_matches([row])
        if truncated:
            raise ValidationError(
                {"row": "Too much ledger history to review safely. Narrow the statement period."}
            )
        visible_ids = {match["id"] for match in matches[row.pk]}
        if visible_ids and not dismissed_ledger_matches:
            raise ValidationError(
                {"dismissed_ledger_matches": "Review every suggested ledger entry or link the same movement."}
            )
        if visible_ids != set(dismissed_ledger_matches):
            raise ReviewConflict(
                "Ledger suggestions changed. Reload and compare every suggested movement before recording this pair."
            )
        if visible_ids and not payload.get("acknowledge_distinct_ledger_matches"):
            raise ValidationError(
                {"acknowledge_distinct_ledger_matches": "Confirm that every suggested ledger entry is a different movement."}
            )
    has_fee = row.batch.rows.filter(position=row.position, component="fee").exists()
    incoming_balances = {"sms": candidate.balance_after, "statement": None if has_fee else row.balance_after}
    if late_posting and payload["balance_source"] == "statement":
        raise ValidationError({"balance_source": "This statement balance was reported after EBL posted the transaction. Keep the earlier SMS ledger balance; the statement balance stays attached separately."})
    automatic_source = None if late_posting else automatic_balance_choice(incoming_balances, row.batch.currency)
    balance_source = automatic_source or payload["balance_source"]
    selected_balance = candidate.balance_after if balance_source == "sms" else row.balance_after
    if not target and not late_posting and selected_balance is None and any(value is not None for value in incoming_balances.values()):
        raise ValidationError({"balance_source": "That source has no reported balance. Choose the source that reports one."})
    existing_report = None
    fill_source = None
    can_fill = False
    automatic_target_source = None
    balance_choice = None
    ledger_before = transaction_snapshot(target) if target else None
    if target and target.type == "transfer":
        ensure_transfer_evidence(target)
        existing_report = account_reports(target)[0].get(row.batch.account_id)
        can_fill = can_fill_missing_transfer_balance(target, row.batch.account_id)
    if target:
        from apps.reconciliation.evidence import missing_report_choice

        matches, _ = find_matches([row])
        selected = next((match for match in matches[row.pk] if match["id"] == str(target.pk)), None)
        effective_balance = Decimal(selected["effective_balance_after"]) if selected and selected["effective_balance_after"] is not None else None
        automatic_target_source = None if late_posting else automatic_balance_choice({**incoming_balances, "existing": effective_balance}, row.batch.currency)
        # An intentionally cleared report remains protected. Unknown is not zero.
        if target.type == "transfer" and effective_balance is None and not can_fill:
            automatic_target_source = None
        fill_source = None if late_posting and candidate.balance_after is None else missing_report_choice(
            target, row.batch.account_id, incoming_balances,
            (automatic_target_source or payload["balance_source"]) if can_fill else ("existing" if automatic_target_source else payload["balance_source"]),
            excluded={"statement"} if has_fee else (),
        )
        if selected and not can_fill and not late_posting:
            balance_choice = {"keep": "existing", "existing_balance_after": effective_balance, "statement_balance_after": row.balance_after}
        if effective_balance is not None and candidate.balance_after is not None and not equivalent_amount(effective_balance, candidate.balance_after, row.batch.currency) and not payload["acknowledge_conflict"]:
            raise ValidationError({"acknowledge_conflict": "The SMS and existing ledger report different balances. Review both before linking."})
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
            "allow_separate": bool(dismissed_ledger_matches),
            "dismissed_ledger_matches": dismissed_ledger_matches,
        },
        # This source was verified above and will be attached in the same atomic
        # operation. Ledger-match safeguards remain enabled in decide_locked.
        combining_pending_sms=not target,
        # Unified review confirms the final draft and any existing ledger
        # target together. Preserve the target's category when attaching its
        # statement evidence; direct statement links ask separately.
        require_category_choice=False, source_amounts=(candidate.amount,),
    )
    record = row.transaction
    if has_fee and balance_source == "statement" and not target:
        raise ValidationError(
            {
                "balance_source": "This statement balance includes a separate fee. Choose the SMS report, or review the fee separately."
            }
        )
    if not target:
        record.balance_after = (
            candidate.balance_after if late_posting and record.account_id == row.batch.account_id
            else selected_balance if record.account_id == row.batch.account_id else None
        )
        record.source = "sms"
    elif automatic_target_source and target.type != "transfer":
        record.balance_after = {**incoming_balances, "existing": target.balance_after}[automatic_target_source]
    if not record.raw_message_id and not (target and record.type == "transfer"):
        # Attaching the other account's SMS must not move the primary report.
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
        sms_evidence = add_transfer_evidence(
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
        report_source = (automatic_target_source or fill_source) if target else balance_source
        if report_source == "sms":
            selected_evidence = sms_evidence
        elif report_source == "statement":
            selected_evidence = record.transfer_evidence.get(
                external_key=f"statement-row:{row.pk}"
            )
        else:
            selected_evidence = existing_report
        # No reports means no reviewed null choice to manufacture either.
        if (
            selected_evidence
            and selected_evidence.account_id == row.batch.account_id
            and not (target and can_fill and fill_source is None)
        ):
            select_effective_account_report(record, selected_evidence)
        if target and (fill_source or automatic_target_source):
            _, primary = account_reports(record)
            if primary and record.balance_after != primary.balance_after:
                record.balance_after = primary.balance_after
                record.save(update_fields=("balance_after", "updated_at"))
    from apps.reconciliation.evidence import finish_sms_link

    finish_sms_link(candidate, record)
    row.state = "linked"
    touch(
        row,
        user,
        before,
        {
            "decision": "unified_match",
            "sms_candidate": str(candidate.pk),
            "balance_source": automatic_target_source or balance_source,
            "filled_report_from": fill_source,
        },
    )
    create_audit_log(
        user=user,
        action=AuditLogEntry.Action.UPDATED,
        entity=record,
        before=ledger_before, after=transaction_snapshot(record),
        metadata={
            "rounding_policy": "higher_bdt_under_1",
            "source_amounts": {"statement": str(row.amount), "sms": str(candidate.amount)},
            "statement_row": str(row.pk),
            "sms_candidate": str(candidate.pk),
            "decision": "unified_match",
            "dismissed_ledger_matches": dismissed_ledger_matches,
        },
    )
    return record, False
