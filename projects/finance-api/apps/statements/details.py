"""Reviewable metadata suggestions; never rewrite financial identity or source text."""

import re

from rest_framework.exceptions import ValidationError

from apps.messages.identifiers import sanitize_financial_identifier

DETAIL_FIELDS = {
    "counterparty_text": ("Merchant / counterparty", 255),
    "reference": ("Reference", 120),
    "note": ("Note", 4000),
    "sender_account_identifier": ("Sender account identifier", 120),
    "sender_card_identifier": ("Sender card identifier", 120),
    "receiver_account_identifier": ("Receiver account identifier", 120),
    "receiver_card_identifier": ("Receiver card identifier", 120),
}
IDENTIFIER_FIELDS = {field for field in DETAIL_FIELDS if field.endswith("_identifier")}
CARD_PREFIX = re.compile(
    r"^\s*(?:(?:reverse|reversal|refund)\s+)?(?:"
    r"(?:debit\s+|credit\s+)?card\s+purchase|purchase\s+(?:by\s+)?card|pos\s+purchase)\b[\s:/.\-]*",
    re.IGNORECASE,
)
IDENTIFIER_VALUE = r"([0-9*Xx•…][0-9*Xx•…\-]{1,35}[0-9])(?![0-9*Xx•…\-]|\s+[0-9*Xx•…])"


def clean_merchant(description):
    """Strip anchored transaction labels, retaining merchant case/punctuation."""
    value = CARD_PREFIX.sub("", description, count=1)
    value = re.split(
        r"\b(?:trx\s*id|reference|ref|value\s*date)\s*[:/#]"
        r"|\b(?:(?:sender|receiver|your)\s+(?:card|account|a/c)|card\s*(?:no\.?|number)|a/c|account(?:\s*(?:no\.?|number))?|card\s*[:#])\s*[:#]?\s*(?=[0-9*Xx•…])"
        r"|\bcard\s+(?=[0-9*Xx•…]*[*Xx•…][0-9*Xx•…]*[0-9]{3,})",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return re.sub(r"\s+", " ", value).strip(" :/-,")[:255]


def draft_merchant(row):
    original = row.extracted.get("description", "")[:255]
    # A user's saved draft correction takes priority over parser cleanup.
    if row.counterparty_text and row.counterparty_text != original:
        return row.counterparty_text
    return clean_merchant(row.extracted.get("description", ""))


def identifier_suggestions(row):
    text = row.extracted.get("description", "")
    observed = {}
    for side, prefix in (("sender", r"sender|from"), ("receiver", r"receiver|to")):
        for kind, label in (("card", r"card"), ("account", r"a/c|acc(?:ount)?")):
            field = f"{side}_{kind}_identifier"
            values = {
                sanitize_financial_identifier(m[1])
                for m in re.finditer(
                    rf"\b(?:{prefix})\s+(?:{label})(?:\s*(?:no\.?|number))?\s*[:#]?\s*{IDENTIFIER_VALUE}",
                    text,
                    re.IGNORECASE,
                )
            } - {""}
            if values:
                observed[field] = next(iter(values)) if len(values) == 1 else ""
    own_side = "receiver" if row.direction == "credit" else "sender"
    own_account = f"{own_side}_account_identifier"
    if own_account not in observed:
        observed[own_account] = sanitize_financial_identifier(row.batch.account_hint)
    # Unqualified card numbers are attributable only in card-purchase rows.
    # Transfer descriptions need an explicit sender/receiver label.
    if row.type != "transfer" and CARD_PREFIX.match(text):
        own_card = f"{own_side}_card_identifier"
        values = {
            sanitize_financial_identifier(m[1])
            for m in re.finditer(
                rf"\bcard(?:\s*(?:no\.?|number))?\s*[:#]?\s*{IDENTIFIER_VALUE}",
                text,
                re.IGNORECASE,
            )
        } - {""}
        if own_card not in observed and len(values) == 1:
            observed[own_card] = next(iter(values))
    return observed


def current_detail(record, field):
    value = getattr(record, field) or ""
    return sanitize_financial_identifier(value) if field in IDENTIFIER_FIELDS else value


def detail_suggestions(row, record):
    merchant = draft_merchant(row)
    note = row.note
    if note == row.extracted.get("description", "")[:2000] and merchant:
        note = f"{row.extracted.get('provider_type') or row.type.replace('_', ' ').title()} · {merchant}"
    incoming = {
        "counterparty_text": merchant,
        "reference": row.reference,
        "note": note,
        **identifier_suggestions(row),
    }
    return [
        {
            "field": field,
            "label": label,
            "existing_value": current_detail(record, field),
            "suggested_value": incoming.get(field, "")[:limit],
        }
        for field, (label, limit) in DETAIL_FIELDS.items()
    ]


def apply_detail_choices(row, record, choices):
    changes = {}
    for choice in choices:
        field = choice["field"]
        if current_detail(record, field) != choice["existing_value"]:
            # Imported lazily to keep suggestion helpers independent of decisions.
            from .services import ReviewConflict

            raise ReviewConflict(
                "Transaction details changed. Reload the row and review your selections again."
            )
        value = choice["value"]
        if field in IDENTIFIER_FIELDS:
            value = sanitize_financial_identifier(value)
            if not value:
                raise ValidationError(
                    {
                        "detail_choices": "Enter a masked identifier or a safe suffix with at least three ending digits."
                    }
                )
        if len(value) > DETAIL_FIELDS[field][1]:
            raise ValidationError(
                {"detail_choices": f"{DETAIL_FIELDS[field][0]} is too long."}
            )
        changes[field] = value
    if changes:
        for field, value in changes.items():
            setattr(record, field, value)
        record.save(update_fields=(*changes, "updated_at"))
    return list(changes)
