"""Reviewable enrichment of saved Citytouch evidence from an archived PDF.

The saved extraction and every reviewed/posted field remain immutable here.
Only a separately stored, printed counterparty code may be upgraded.
"""

import hashlib
import json

from rest_framework.exceptions import ValidationError

from .citytouch import citytouch_printed_code, visible_code

SOURCE_KEYS = (
    "id", "page", "row", "date", "time", "value_date", "direction",
    "amount", "signed_fee", "balance_after", "reference",
)


def code_refresh_plan(batch, preview, rows):
    if batch.profile != "city_bank" or preview["profile"] != batch.profile:
        raise ValidationError({"detail": "Only the original City Bank layout can refresh Citytouch codes."})
    if (
        preview["account_hint"] != batch.account_hint
        or preview["currency"] != batch.currency
        or preview["page_count"] != batch.page_count
    ):
        raise ValidationError({"detail": "The archived PDF no longer matches this import. No rows were changed."})
    originals = preview["rows"]
    if len(rows) != len(originals):
        raise ValidationError({"detail": "The statement row count changed during extraction. No rows were changed."})
    changes = []
    for position, (row, original) in enumerate(zip(rows, originals, strict=True), 1):
        if row.position != position or any(
            row.extracted.get(key) != original.get(key) for key in SOURCE_KEYS
        ):
            raise ValidationError({"detail": "A saved row differs from the new extraction. No rows were changed."})
        previous = row.source_code or citytouch_printed_code(row.extracted.get("description", "")) or ""
        printed = original.get("citytouch_printed_code") or ""
        previous_digits = visible_code(previous) or ""
        printed_digits = visible_code(printed) or ""
        if previous_digits and printed_digits and not printed_digits.endswith(previous_digits):
            raise ValidationError({"detail": "A Citytouch code conflicts with the saved evidence. No rows were changed."})
        # Never discard more detailed evidence if a later parser sees less.
        if len(printed_digits) > len(previous_digits):
            changes.append({"row": row, "before": previous, "after": printed})
    digest_source = [
        [str(row.id), row.version, row.source_code, row.extracted.get("description", "")]
        for row in rows
    ] + [[str(item["row"].id), item["after"]] for item in changes]
    digest = hashlib.sha256(json.dumps(digest_source, sort_keys=True).encode()).hexdigest()
    return {
        "changed_count": len(changes),
        "row_count": len(rows),
        "changes": changes,
        "digest": digest,
    }
