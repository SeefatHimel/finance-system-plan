import re


_MASK_MARKERS = ("*", "x", "X", "•", "…")


def sanitize_financial_identifier(value: str) -> str:
    """Keep provider masking, or reduce an unmasked identifier to its last four digits."""
    compact = re.sub(r"\s+", "", value).strip("-:")
    digits = re.sub(r"[^0-9]", "", compact)
    if len(digits) < 4:
        return ""
    # A mask character must not let an almost-complete card number through.
    # Retain up to six prefix and four suffix digits; reduce longer evidence.
    if len(digits) > 10 or (
        not any(marker in compact for marker in _MASK_MARKERS) and len(digits) > 4
    ):
        return digits[-4:]
    return compact[:120]
