"""Direction observed in SMS wording, independent of the chosen ledger type."""

INCOMING_KINDS = frozenset({
    "cash_in", "receive_money", "bank_transfer_in", "refund",
})
OUTGOING_KINDS = frozenset({
    "purchase", "bill_payment", "cash_out", "send_money", "bank_transfer_out",
    "card_purchase", "fee",
})


def source_direction_for_kind(message_kind: str) -> str:
    """Return no direction when the original SMS classification is ambiguous."""
    if message_kind in INCOMING_KINDS:
        return "credit"
    if message_kind in OUTGOING_KINDS:
        return "debit"
    return ""
