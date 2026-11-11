"""Cash observations, source archives and atomic retries. No money adjustments."""

import csv
import io
import json
import re
from collections import Counter

from config.secure_data import encrypt_bytes
from django.db import transaction
from django.db.models import Q, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import Account
from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.bulk_imports.parsing import clock, day, money, table
from apps.bulk_imports.services import ChangedReview
from apps.bulk_imports.sources import digest, json_values
from apps.transactions.transfers import lock_transfer_user

from .cash_math import CASH_TYPES, boundary, period, project, snapshot_point, snapshots
from .models import BalanceSnapshot, CashCountBatch
from .services import snapshot_status_for_difference

FIELDS = {
    "account": {"storage account", "account", "wallet"},
    "date": {"date", "count date"},
    "time": {"time", "count time"},
    "balance": {"counted balance", "actual balance", "counted cash", "balance"},
    "note": {"note", "notes"},
    "source_expected": {"expected balance", "spreadsheet expected balance"},
}


def source_rows(data):
    if data.get("rows"):
        return [], {}, data["rows"]
    text = data["text"]
    # Also accept the table commonly copied from chat. Preserve the unmodified
    # input in the archive; conversion is only for deterministic parsing.
    if text.lstrip().startswith("|"):
        lines = []
        for line in text.splitlines():
            cells = [
                cell.strip().strip("*") for cell in line.strip().strip("|").split("|")
            ]
            if all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                continue
            lines.append(cells)
        output = io.StringIO()
        csv.writer(output, delimiter="\t").writerows(lines)
        text = output.getvalue()
    headers, cells, _ = table(text)
    if len(cells) > 100:
        raise ValidationError({"text": "Import at most 100 cash counts at once."})
    automatic = {
        field: next((h for h in headers if h.casefold() in aliases), "")
        for field, aliases in FIELDS.items()
    }
    mapping = data.get("mapping") or automatic
    if set(mapping) - FIELDS.keys() or any(
        h and h not in headers for h in mapping.values()
    ):
        raise ValidationError({"mapping": "Choose columns from this table."})
    used = [h for h in mapping.values() if h]
    if len(used) != len(set(used)):
        raise ValidationError({"mapping": "Each column can map to only one field."})
    rows = [
        {
            field: dict(zip(headers, values)).get(mapping.get(field, ""), "").strip()
            for field in FIELDS
        }
        for values in cells
    ]
    return headers, mapping, rows


def serialize_point(point):
    account = point.get("account")
    previous = point.get("previous")
    return {
        "number": point["number"],
        "original": point["original"],
        "action": point["action"],
        "account": str(account.pk) if account else None,
        "account_name": account.name if account else "Choose cash account",
        "currency": account.currency if account else "",
        "date": str(point.get("date", "")),
        "time": str(point["time"]) if point.get("time") else None,
        "balance": str(point.get("balance", "")),
        "note": point.get("note", ""),
        "source_expected": point["original"].get("source_expected", ""),
        "expected_balance": str(point["expected"]) if "expected" in point else None,
        "difference": str(point["difference"]) if "difference" in point else None,
        "errors": point["errors"],
        "unknown": point.get("unknown", []),
        "duplicate": point.get("duplicate"),
        "previous": {
            "id": previous.get("key"),
            "date": str(previous["date"]),
            "balance": str(previous["balance"]),
            "difference": str(previous["difference"])
            if "difference" in previous
            else None,
            "errors": previous["errors"],
        }
        if previous
        else None,
        "difference_change": str(point["difference"] - previous["difference"])
        if previous and "difference" in previous and "difference" in point
        else None,
    }


def build_preview(user, data):
    headers, mapping, sources = source_rows(data)
    accounts = list(
        Account.objects.filter(user=user, type__in=CASH_TYPES, is_active=True)
    )
    ids = {str(account.pk): account for account in accounts}
    names = {}
    for account in accounts:
        names.setdefault(account.name.strip().casefold(), []).append(account)
    decisions = data.get("decisions", {})
    if any(not key.isdigit() or not 1 <= int(key) <= len(sources) for key in decisions):
        raise ValidationError({"decisions": "Choose a row in this count table."})
    points = []
    for number, source in enumerate(sources, 1):
        values = {**source, **decisions.get(str(number), {})}
        label = str(source.get("account", ""))
        selected = values.get("account", "")
        if str(number) not in decisions or "account" not in decisions[str(number)]:
            selected = data.get("account_map", {}).get(label, selected)
        exact = names.get(str(selected).strip().casefold(), [])
        account = ids.get(str(selected)) or (exact[0] if len(exact) == 1 else None)
        point = {
            "number": number,
            "original": source,
            "account": account,
            "action": values.get("action", "add"),
            "replace_id": str(values["replace_id"])
            if values.get("replace_id")
            else None,
            "errors": [],
            "note": values.get("note", ""),
            "timing_order": values.get("timing_order", {}),
            "unknown_position": values.get("unknown_position", "unresolved"),
            "time": None,
        }
        points.append(point)
        if point["action"] == "skip":
            continue
        if account is None:
            point["errors"].append(
                "Choose an active physical cash account that belongs to you."
            )
        try:
            point["date"] = day(values.get("date", ""), data["date_order"])
            point["time"] = clock(values.get("time", ""))
            point["balance"] = money(
                values.get("balance", ""),
                currency=account.currency if account else "BDT",
                allow_zero=True,
                signed=False,
            )
            point["cutoff"] = boundary(point["date"], point["time"])
            if point["time"] is None and not data["end_of_day"]:
                point["errors"].append(
                    "Confirm that date-only counts are end-of-day balances."
                )
            if len(point["note"]) > 2000:
                point["errors"].append("Use a note of at most 2,000 characters.")
        except ValueError as error:
            point["errors"].append(str(error))
    valid = [p for p in points if not p["errors"] and p["action"] != "skip"]
    repeated = Counter((p["account"].pk, p["cutoff"]) for p in valid)
    target_ids = {
        p["replace_id"] for p in valid if p["action"] == "replace" and p["replace_id"]
    }
    query = Q(pk__in=target_ids)
    base = snapshots(user)
    for point in valid:
        owned = base.filter(account=point["account"]).exclude(pk__in=target_ids)
        previous_id = (
            owned.filter(period(point, earlier=True))
            .order_by("-count_day", "-count_time", "-created_at", "-pk")
            .values("pk")[:1]
        )
        following_id = (
            owned.filter(period(point, later=True))
            .order_by("count_day", "count_time", "created_at", "pk")
            .values("pk")[:1]
        )
        query |= (
            Q(pk=Subquery(previous_id))
            | Q(pk=Subquery(following_id))
            | (Q(account=point["account"]) & period(point))
        )
    records = (
        list(
            base.filter(query)
            .select_related("account")
            .order_by("-checked_at", "-created_at", "-pk")[:301]
        )
        if valid
        else []
    )
    if len(records) > 300:
        raise ValidationError(
            {
                "counts": "Too many saved counts share these periods. Preview fewer dates or review the old duplicate counts first."
            }
        )
    existing = [
        dict(
            snapshot_point(record),
            record=record,
            cutoff=boundary(
                timezone.localtime(record.checked_at).date(),
                timezone.localtime(record.checked_at).time().replace(tzinfo=None)
                if record.precision == "instant"
                else None,
            ),
        )
        for record in records
    ]
    for point in valid:
        key = point["account"].pk
        duplicates = [
            p
            for p in existing
            if p["account"].pk == key and p["cutoff"] == point["cutoff"]
        ]
        if point["replace_id"] and point["action"] == "replace":
            target = next(
                (p for p in existing if p.get("key") == point["replace_id"]), None
            )
            if any(p.get("key") != point["replace_id"] for p in duplicates):
                point["errors"].append(
                    "Another saved count already uses the new account/date/time. Review that count before moving this one."
                )
            duplicates = [target] if target else []
        if repeated[(key, point["cutoff"])] > 1:
            point["errors"].append(
                "This count period appears more than once. Skip a duplicate or correct its date/time."
            )
        if duplicates:
            point["duplicate"] = {
                "id": str(duplicates[0]["record"].pk),
                "balance": str(duplicates[0]["balance"]),
                "updated_at": duplicates[0]["record"].updated_at.isoformat(),
            }
            if len(duplicates) > 1:
                point["errors"].append(
                    "Multiple saved counts use this period. Review them before replacing a count."
                )
            elif (
                point["action"] == "replace"
                and duplicates[0]["record"].adjustment_transaction_id
            ):
                point["errors"].append(
                    "This saved count has a ledger adjustment. Review its adjustment separately before correcting the count."
                )
            elif point["action"] != "replace":
                point["errors"].append(
                    "This period already has a saved count. Skip it or explicitly correct the saved count."
                )
        elif point["action"] == "replace":
            point["errors"].append("The saved count changed. Refresh the preview.")
        preceding = [
            p
            for p in existing + valid
            if p is not point
            and p["account"]
            and p["account"].pk == key
            and p.get("cutoff")
            and p.get("key") not in target_ids
            and p["cutoff"] < point["cutoff"]
            and not p["errors"]
        ]
        # A corrected count in this batch supersedes the older saved version
        # when comparing a later row in the same batch.
        point["previous"] = max(
            preceding, key=lambda p: (p["cutoff"], "number" in p), default=None
        )
    replacements = Counter(
        p["duplicate"]["id"]
        for p in valid
        if p["action"] == "replace" and p.get("duplicate")
    )
    for point in valid:
        if (
            point["action"] == "replace"
            and point.get("duplicate")
            and replacements[point["duplicate"]["id"]] > 1
        ):
            point["errors"].append(
                "A saved count can be corrected only once in a batch. Skip a repeated correction."
            )
    project(user, valid + existing)
    rows = [serialize_point(p) for p in points]
    context = [
        {
            "key": p.get("key"),
            "revision": p.get("revision"),
            "expected": str(p.get("expected")),
            "errors": p["errors"],
        }
        for p in valid + existing
    ]
    result = {
        "headers": headers,
        "mapping": mapping,
        "rows": rows,
        "timezone": timezone.get_current_timezone_name(),
        "ready": bool(valid)
        and all(p["action"] == "skip" or not p["errors"] for p in points),
    }
    result["review_token"] = digest({"input": data, "rows": rows, "context": context})
    return result, points


@transaction.atomic
def preview(user, data):
    lock_transfer_user(user)
    return build_preview(
        user,
        {k: v for k, v in data.items() if k not in {"idempotency_key", "review_token"}},
    )[0]


@transaction.atomic
def record(user, data):
    lock_transfer_user(user)
    key = data.get("idempotency_key")
    if not key or not data.get("review_token"):
        raise ValidationError({"detail": "Preview and confirm this cash count first."})
    payload = {
        k: v for k, v in data.items() if k not in {"idempotency_key", "review_token"}
    }
    fingerprint = digest(payload)
    prior = CashCountBatch.objects.filter(user=user, idempotency_key=key).first()
    if prior:
        if prior.input_digest != fingerprint:
            raise ChangedReview(
                "This save key already recorded different counts. Start a new count."
            )
        return prior.receipt
    result, points = build_preview(user, payload)
    if result["review_token"] != data["review_token"]:
        raise ChangedReview(
            "The counts or ledger changed. Refresh the preview and compare again."
        )
    if not result["ready"]:
        raise ValidationError(
            {"detail": "Resolve highlighted rows or skip them before saving."}
        )
    batch = CashCountBatch.objects.create(
        user=user,
        idempotency_key=key,
        input_digest=fingerprint,
        original=encrypt_bytes(
            json.dumps(json_values(payload), ensure_ascii=False).encode()
        ),
        filename=data["filename"],
    )
    saved = []
    for point in points:
        if point["action"] == "skip":
            continue
        values = {
            "checked_at": point["cutoff"],
            "precision": "instant" if point["time"] else "end_of_day",
            "timing_order": point["timing_order"],
            "actual_balance": point["balance"],
            "expected_balance": point["expected"],
            "difference": point["difference"],
            "status": snapshot_status_for_difference(point["difference"]),
            "note": point["note"],
            "cash_count_batch": batch,
            "account": point["account"],
        }
        if point["action"] == "replace":
            item = get_object_or_404(
                BalanceSnapshot.objects.select_for_update(),
                pk=point["duplicate"]["id"],
                user=user,
            )
            before = count_values(item)
            for name, value in values.items():
                setattr(item, name, value)
            item.save()
        else:
            item = BalanceSnapshot.objects.create(user=user, **values)
            before = None
        create_audit_log(
            user=user,
            action=AuditLogEntry.Action.UPDATED
            if before
            else AuditLogEntry.Action.CREATED,
            entity=item,
            before=before,
            after=count_values(item),
            metadata={"cash_count_batch": str(batch.pk)},
        )
        saved.append(
            {
                "id": str(item.pk),
                "number": point["number"],
                "account": str(item.account_id),
                "difference": str(item.difference),
            }
        )
    batch.receipt = {"id": str(batch.pk), "saved": len(saved), "counts": saved}
    batch.save(update_fields=["receipt"])
    return batch.receipt


def count_values(item):
    local = timezone.localtime(item.checked_at)
    return {
        "id": str(item.pk),
        "account": str(item.account_id),
        "date": str(local.date()),
        "time": local.time().isoformat() if item.precision == "instant" else None,
        "precision": item.precision,
        "balance": str(item.actual_balance),
        "expected_balance": str(item.expected_balance),
        "difference": str(item.difference),
        "note": item.note,
        "updated_at": item.updated_at.isoformat(),
    }
