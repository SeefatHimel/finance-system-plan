"""Recurring statement identifiers and explicit, review-only party suggestions."""

from collections import defaultdict

from .bkash_identifiers import CODE as BKASH_CODE
from .bkash_identifiers import mapping_code
from .citytouch import citytouch_code, citytouch_printed_code, visible_code
from .models import StatementCounterpartyCode, StatementRow


def code_for_row(row):
    if row.component != "principal":
        return None
    if row.batch.profile == "city_bank":
        return visible_code(row.source_code) or citytouch_code(
            row.extracted.get("description", "")
        )
    if row.batch.profile == "bkash" and BKASH_CODE.fullmatch(row.source_code or ""):
        return row.source_code
    return None


def observed_codes(user):
    """Aggregate saved, encrypted statement identifiers without rereading PDFs."""
    rows = (
        StatementRow.objects.filter(
            batch__user=user, batch__profile__in=["city_bank", "bkash"], component="principal"
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
            "source_code",
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
        key = (row.batch.account_id, row.batch.profile, code, row.direction)
        item = grouped[key]
        item["account_name"] = row.batch.account.name
        if item["printed_code"] is None and row.batch.profile == "city_bank":
            item["printed_code"] = row.source_code or citytouch_printed_code(
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
    keys = {
        (row.batch.account_id, row.batch.profile, code_for_row(row), row.direction)
        for row in rows
    }
    keys = {key for key in keys if key[2]}
    if not keys:
        return {}
    user_id = rows[0].batch.user_id
    mappings = StatementCounterpartyCode.objects.filter(
        user_id=user_id,
        account_id__in={key[0] for key in keys},
        code__in={mapping_code(key[1], key[0], key[2]) for key in keys},
        profile__in={key[1] for key in keys},
    ).select_related("other_account", "category")
    mapped = {(m.account_id, m.profile, m.code, m.direction): m for m in mappings}
    result = {}
    for row in rows:
        code = code_for_row(row)
        mapping = mapped.get((
            row.batch.account_id, row.batch.profile,
            mapping_code(row.batch.profile, row.batch.account_id, code), row.direction,
        )) if code else None
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
            "note": mapping.note_template,
            "reason": f"Verified statement identifier for {mapping.label}. Check this transaction before applying.",
        }
    return result
