"""Masked EBL card/account evidence, separate from movement references and payees."""

import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation

CODE = re.compile(r"^npsb:masked:\d{4,6}\*{2,}\d{2,4}\*?$")
RETIRED_CODE = re.compile(r"^npsb:code:\d{6,24}$")
OPERATION = re.compile(r"\bNPSB\s+(?:FUND\s+)?TRANSFER\b", re.IGNORECASE)
PRINTED = re.compile(r"(?<![A-Za-z0-9*])(\d{4,6}\*{2,}\d{2,4}\*?)(?![A-Za-z0-9*])")
REFERENCE = re.compile(r"//\s*([A-Z0-9][A-Z0-9-]{5,63})(?![A-Z0-9-])", re.IGNORECASE)


def identifier(description):
    """Retain the printed mask, including its trailing star; never infer its owner."""
    if not OPERATION.search(description or ""):
        return None
    found = set(PRINTED.findall(description or ""))
    return f"npsb:masked:{next(iter(found))}" if len(found) == 1 else None


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
