"""Repeatable bKash statement clues, separate from per-movement TRX IDs."""

import hashlib
import re

PHONE = re.compile(r"(?<!\d)01[3-9]\d{8}(?!\d)")
TRX_ID = re.compile(r"\bTRX\s*ID\s*:", re.IGNORECASE)
KINDS = {
    "mobile recharge": "recharge",
    "send money": "send",
    "payment": "payment",
    "pay bill": "bill",
}
CODE = re.compile(r"^(?:recharge:phone|send:phone|payment:phone|payment:name|bill:name):[A-Z0-9][A-Z0-9 .-]{2,119}$")


def identifier(provider_type, details, *, reporting_number=""):
    """Return one stable, typed clue only when the printed details are unambiguous."""
    kind = KINDS.get(" ".join((provider_type or "").casefold().split()))
    if not kind:
        return None
    stable = TRX_ID.split(details or "", maxsplit=1)[0].strip(" /-")
    if not stable:
        return None
    phones = set(PHONE.findall(stable))
    if len(phones) > 1:
        return None
    if reporting_number in phones:
        return None
    if kind in {"recharge", "send"}:
        return f"{kind}:phone:{next(iter(phones))}" if len(phones) == 1 else None
    if kind == "payment" and phones:
        return f"payment:phone:{next(iter(phones))}"
    # Biller and merchant names are hints, not proof of an owned account.
    name = stable.split("/", maxsplit=1)[0]
    name = re.sub(r"\b\d{7,}\b", " ", name)
    name = re.sub(r"[^A-Za-z0-9 .-]+", " ", name).strip(" .-")
    name = " ".join(name.upper().split())[:120]
    if len(name) < 4 or not re.search(r"[A-Z]", name):
        return None
    return f"{kind}:name:{name}"


def mapping_code(profile, account_id, code):
    """Store no raw bKash phone in the mapping's indexed code field."""
    if profile != "bkash":
        return code
    return hashlib.sha256(f"bkash\0{account_id}\0{code}".encode()).hexdigest()
