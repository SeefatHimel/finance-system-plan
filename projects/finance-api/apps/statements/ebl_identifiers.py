"""Useful EBL description clues; own-card masks and NPSB references are excluded."""

import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation

# Retained only to remove legacy own-card and movement-field metadata.
RETIRED_CODE = re.compile(r"^npsb:(?:code:\d{6,24}|masked:\d{4,6}\*{2,}\d{2,4}\*?)$")
CODE = re.compile(r"^ebl:(?:keyword:(?:salary|patapay|bkash)|bkash:phone:01[3-9]\d{8})$")
OPERATION = re.compile(r"\bNPSB\s+(?:FUND\s+)?TRANSFER\b", re.IGNORECASE)
REFERENCE = re.compile(r"//\s*([A-Z0-9][A-Z0-9-]{5,63})(?![A-Z0-9-])", re.IGNORECASE)
SALARY = re.compile(r"\b(?:salary|payroll)\b", re.IGNORECASE)
SALARY_EXCLUSIONS = re.compile(r"\b(?:loan|advance|reversal|reversed|refund|return|returned)\b", re.IGNORECASE)
REFERENCE_SECTION = re.compile(r"//|\b(?:reference|ref|trx\s*id)\s*[:#=]", re.IGNORECASE)
BKASH = re.compile(r"\b(?:bkash|bikash)\b", re.IGNORECASE)
# Only numbers explicitly introduced as a recipient, never a card/account mask
# or a number merely adjacent to a movement/reference field.
BKASH_RECIPIENT = re.compile(r"\b(?:to|recipient|beneficiary)\s*(?:bkash\s*)?(?:no\.?\s*[:=-]?\s*)?[:=-]?\s*(01[3-9]\d{8})(?![\d*])", re.IGNORECASE)


def salary_description(description):
    text = REFERENCE_SECTION.split(description or "", maxsplit=1)[0]
    return bool(SALARY.search(text) and not SALARY_EXCLUSIONS.search(text))


def identifier(description, *, direction=None):
    """Return review-only wording/recipient clues, never the reporting card."""
    text = REFERENCE_SECTION.split(description or "", maxsplit=1)[0]
    if salary_description(text):
        return "ebl:keyword:salary" if direction in (None, "credit") else None
    if OPERATION.search(text):
        return None
    if re.search(r"\bpata\s*pay\b", text, re.IGNORECASE):
        return "ebl:keyword:patapay"
    if BKASH.search(text) and re.search(r"\b(?:transfer|fund|to)\b", text, re.IGNORECASE):
        recipients = set(BKASH_RECIPIENT.findall(text))
        if len(recipients) == 1:
            return f"ebl:bkash:phone:{next(iter(recipients))}"
        # A generic service clue never pretends to identify an individual.
        return "ebl:keyword:bkash"
    return None


def movement_reference(description):
    found = {value.upper() for value in REFERENCE.findall(description or "")}
    return next(iter(found)) if len(found) == 1 else None


def possible_fee_ids(rows):
    """A review hint only: two adjacent debits, same date/reference, exact balance step.

    Use immutable source values, not edited drafts. A small amount alone cannot
    qualify. Ambiguous groups, missing values and non-BDT sources are excluded.
    The printed rows always remain separate; this never changes ledger money.
    """
    groups = defaultdict(list)
    for row in rows:
        if (
            row.batch.profile != "ebl_bank"
            or row.batch.currency != "BDT"
            or row.component != "principal"
        ):
            continue
        source = row.extracted
        ref = movement_reference(source.get("description", ""))
        if (
            ref
            and OPERATION.search(source.get("description", ""))
            and source.get("date")
            and source.get("direction") == "debit"
        ):
            groups[(row.batch_id, source["date"], ref)].append(row)
    result = set()
    for group in groups.values():
        if len(group) != 2:
            continue
        principal, fee = sorted(group, key=lambda row: row.position)
        if (
            principal.source_code
            and fee.source_code
            and principal.source_code != fee.source_code
        ) or fee.position != principal.position + 1:
            continue
        try:
            amount = Decimal(str(principal.extracted.get("amount")))
            charge = Decimal(str(fee.extracted.get("amount")))
            before = Decimal(str(principal.extracted.get("balance_after")))
            after = Decimal(str(fee.extracted.get("balance_after")))
            if (
                all(value.is_finite() for value in (amount, charge, before, after))
                and Decimal(0) < charge < amount
                and charge <= 100
                and before - charge == after
            ):
                result.add(fee.pk)
        except (InvalidOperation, TypeError, ValueError):
            continue
    return result


def mark_possible_fees(rows, *, complete=False):
    rows = list(rows)
    batches = {row.batch_id for row in rows if row.batch.profile == "ebl_bank"}
    if not batches:
        return
    if complete:
        sources = rows
    else:
        from .models import StatementRow

        sources = list(
            StatementRow.objects.filter(
                batch_id__in=batches, component="principal"
            ).select_related("batch")
        )
    fees = possible_fee_ids(sources)
    principal_positions = {
        (row.batch_id, row.position - 1) for row in sources if row.pk in fees
    }
    paired = fees | {
        row.pk for row in sources if (row.batch_id, row.position) in principal_positions
    }
    for row in rows:
        row._ebl_possible_fee = row.pk in fees
        row._ebl_has_companion = row.pk in paired
