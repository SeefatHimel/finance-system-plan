"""Recurring statement identifiers and explicit, review-only party suggestions."""

from collections import defaultdict

from .bkash_identifiers import CODE as BKASH_CODE
from .bkash_identifiers import mapping_code
from .citytouch import citytouch_code, citytouch_printed_code, visible_code
from .ebl_identifiers import CODE as EBL_CODE
from .ebl_identifiers import identifier as ebl_identifier
from .ebl_identifiers import mark_possible_fees
from .models import StatementCounterpartyCode, StatementIdentifierSkip, StatementRow


def code_for_row(row):
    if row.component != "principal":
        return None
    if row.batch.profile == "ebl_bank" and (row.type == "fee" or getattr(row, "_ebl_possible_fee", False)):
        return None
    if row.batch.profile == "city_bank":
        return visible_code(row.source_code) or citytouch_code(
            row.extracted.get("description", "")
        )
    if row.batch.profile == "bkash" and BKASH_CODE.fullmatch(row.source_code or ""):
        return row.source_code
    if row.batch.profile == "ebl_bank":
        # Old source_code values used a changing movement field. Ignore them;
        # the original masked description already contains the stable clue.
        return ebl_identifier(row.extracted.get("description", "")) or (
            row.source_code if EBL_CODE.fullmatch(row.source_code or "") else None
        )
    return None


def observed_codes(user):
    """Aggregate saved, encrypted statement identifiers without rereading PDFs."""
    rows = (
        StatementRow.objects.filter(
            batch__user=user, batch__profile__in=["city_bank", "bkash", "ebl_bank"], component="principal"
        )
        .select_related("batch__account")
        .only(
            "id",
            "batch__account__name",
            "batch__account_id",
            "batch__profile",
            "batch__currency",
            "type",
            "position",
            "component",
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
    rows = list(rows)
    mark_possible_fees(rows, complete=True)
    grouped = defaultdict(
        lambda: {
            "count": 0,
            "pending_count": 0,
            "last_seen": None,
            "printed_code": None,
            "examples": [],
        }
    )
    for row in rows:
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
    rows = list(rows)
    mark_possible_fees(rows)
    keys = {
        (row.batch.account_id, row.batch.profile, code_for_row(row), row.direction)
        for row in rows if row.batch.profile != "ebl_bank"
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
    skipped = set(StatementIdentifierSkip.objects.filter(
        user_id=user_id, account_id__in={key[0] for key in keys},
        profile__in={key[1] for key in keys},
        code__in={mapping_code(key[1], key[0], key[2]) for key in keys},
    ).values_list("account_id", "profile", "code", "direction"))
    result = {}
    for row in rows:
        if row.batch.profile == "ebl_bank":
            continue  # A repeated masked reporting card cannot identify a payee.
        code = code_for_row(row)
        key = (
            row.batch.account_id, row.batch.profile,
            mapping_code(row.batch.profile, row.batch.account_id, code), row.direction,
        ) if code else None
        mapping = mapped.get(key) if key not in skipped else None
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
            "note": mapping.note_template or (
                f"{row.extracted.get('provider_type') or 'bKash'} · {mapping.label}"
                if row.batch.profile == "bkash" and ":phone:" in code else ""
            ),
            "reason": f"Verified statement identifier for {mapping.label}. Check this transaction before applying.",
        }
    return result
