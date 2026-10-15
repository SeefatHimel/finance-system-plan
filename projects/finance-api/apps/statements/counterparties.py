"""Citytouch reference observations and explicit, review-only party suggestions."""

import re
from collections import defaultdict

from .models import StatementCounterpartyCode, StatementRow

# The first group varies per movement and is never identity evidence. Only the
# recurring second group is a candidate party code, scoped to one statement
# account and direction. Retain every visible digit in that group: two codes
# can share their last four digits. Masked digits cannot be recovered.
CITYTOUCH_REFERENCE = re.compile(
    r"(?<![A-Z0-9])CT[-\s]*FT[-\s]*\*{2,}\d{3,24}[-\s]*(\*{2,}(\d{4,24}))(?![A-Z0-9])",
    re.IGNORECASE,
)


def citytouch_code(description):
    match = CITYTOUCH_REFERENCE.search(description or "")
    return match.group(2) if match else None


def citytouch_printed_code(description):
    """Return the complete masked second part exactly as printed in the row."""
    match = CITYTOUCH_REFERENCE.search(description or "")
    return match.group(1) if match else None


def code_for_row(row):
    if row.component != "principal" or row.batch.profile != "city_bank":
        return None
    return citytouch_code(row.extracted.get("description", ""))


def observed_codes(user):
    """Aggregate saved statement evidence; original PDFs and full IDs stay out."""
    rows = (
        StatementRow.objects.filter(
            batch__user=user, batch__profile="city_bank", component="principal"
        )
        .select_related("batch__account")
        .only(
            "id",
            "batch__account__name",
            "batch__account_id",
            "batch__profile",
            "direction",
            "date",
            "amount",
            "extracted",
            "state",
            "transaction_id",
        )
        .order_by("-date", "-position")
    )
    grouped = defaultdict(
        lambda: {
            "count": 0,
            "pending_count": 0,
            "last_seen": None,
            "printed_code": None,
            "examples": [],
        }
    )
    for row in rows.iterator():
        code = code_for_row(row)
        if not code:
            continue
        key = (row.batch.account_id, code, row.direction)
        item = grouped[key]
        item["account_name"] = row.batch.account.name
        if item["printed_code"] is None:
            item["printed_code"] = citytouch_printed_code(
                row.extracted.get("description", "")
            )
        item["count"] += 1
        item["pending_count"] += row.state == "pending" and row.transaction_id is None
        if len(item["examples"]) < 3:
            item["examples"].append(
                {
                    "date": row.date,
                    "amount": row.amount,
                    "description": row.extracted.get("description", "")[:180],
                }
            )
        if row.date and (item["last_seen"] is None or row.date > item["last_seen"]):
            item["last_seen"] = row.date
    return grouped


def code_suggestions(rows):
    """Only explicit mappings suggest metadata; nothing changes a saved draft."""
    keys = {(row.batch.account_id, code_for_row(row), row.direction) for row in rows}
    keys = {key for key in keys if key[1]}
    if not keys:
        return {}
    user_id = rows[0].batch.user_id
    mappings = StatementCounterpartyCode.objects.filter(
        user_id=user_id,
        account_id__in={key[0] for key in keys},
        code__in={key[1] for key in keys},
        profile="city_bank",
    ).select_related("other_account", "category")
    mapped = {(m.account_id, m.code, m.direction): m for m in mappings}
    result = {}
    for row in rows:
        code = code_for_row(row)
        mapping = mapped.get((row.batch.account_id, code, row.direction))
        if not mapping:
            continue
        owned = mapping.party_kind == "owned" and mapping.other_account_id
        if mapping.suggested_type == "transfer" and not owned:
            continue
        other = mapping.other_account if owned else None
        if owned and (not other.is_active or other.currency != row.batch.currency):
            continue
        if mapping.category and not mapping.category.is_active:
            continue
        suggested_type = mapping.suggested_type or row.type
        same_type = suggested_type == row.type
        category_id = mapping.category_id or (row.category_id if same_type else None)
        other_account_id = (
            other.id
            if owned and mapping.suggested_type == "transfer"
            else row.other_account_id
            if not mapping.suggested_type and row.type == "transfer"
            else None
        )
        result[row.id] = {
            "type": suggested_type,
            "category": str(category_id) if category_id else None,
            "other_account": str(other_account_id) if other_account_id else None,
            "counterparty_text": mapping.label,
            "reason": f"Verified Citytouch second code {code}: {mapping.label}. Check this transaction before applying.",
        }
    return result
