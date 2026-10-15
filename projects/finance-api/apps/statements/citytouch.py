"""Recognize the complete second Citytouch code printed in a statement row."""

import re

# The first group identifies the movement; only the second group can recur as
# a counterparty clue. Never infer digits hidden by the bank's mask.
CITYTOUCH_REFERENCE = re.compile(
    r"(?<![A-Z0-9])CT[-\s]*FT[-\s]*\*{2,}\d{3,24}[-\s]*(\*{2,}(\d{4,24}))(?![A-Z0-9])",
    re.IGNORECASE,
)


def citytouch_code(description):
    match = CITYTOUCH_REFERENCE.search(description or "")
    return match.group(2) if match else None


def citytouch_printed_code(description):
    """Return the masked second part exactly as printed in the PDF."""
    match = CITYTOUCH_REFERENCE.search(description or "")
    return match.group(1) if match else None


def visible_code(printed):
    match = re.fullmatch(r"\*{2,}(\d{4,24})", printed or "")
    return match.group(1) if match else None
