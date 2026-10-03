import re


_MASK_MARKERS = ("*", "x", "X", "•", "…")


def sanitize_financial_identifier(value: str) -> str:
    """Keep provider masking, or reduce an unmasked identifier to its last four digits."""
    compact = re.sub(r"\s+", "", value).strip("-:")
    digits = re.sub(r"[^0-9]", "", compact)
    if len(digits) < 4:
        return ""
    if not any(marker in compact for marker in _MASK_MARKERS) and len(digits) > 4:
        return digits[-4:]
    return compact[:120]
