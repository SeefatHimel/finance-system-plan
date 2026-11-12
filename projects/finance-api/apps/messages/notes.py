"""Short, editable ledger-note suggestions; never copy the whole SMS."""

import re


def bank_purpose(body):
    match = re.search(
        r"\b(?:debited|credited)\s+with\s+(?:BDT|Tk)\.?\s*[\d,.]+\s+as\s+"
        r"(.{1,180}?)\s+on\s+\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4}\b",
        " ".join((body or "").split()), re.IGNORECASE,
    )
    if not match:
        return ""
    purpose = " ".join(match[1].split()).strip(" .;")
    return re.sub(r"\b\d{7,}\b", lambda m: "***" + m[0][-4:], purpose)


def suggested_note(candidate):
    raw = candidate.raw_message
    purpose = bank_purpose(raw.body) if (
        candidate.provider in {"ebl", "city_bank", "bank"}
        and raw.status != "redacted" and not raw.redacted_at and not raw.exclusion_reason
    ) else ""
    if purpose:
        return purpose
    parts = [candidate.get_message_kind_display()]
    if candidate.counterparty_text:
        parts.append(candidate.counterparty_text)
    return " · ".join(parts)
