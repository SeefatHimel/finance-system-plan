"""Shared monetary semantics. This module has no ORM or frontend dependencies."""

CREDIT_TYPES = frozenset({"income", "refund", "borrow", "repayment_received"})
DEBIT_TYPES = frozenset({"expense", "fee", "lend", "repayment_paid"})
SPENDING_TYPES = frozenset({"expense", "fee"})
FINANCING_TYPES = frozenset({"borrow", "lend", "repayment_received", "repayment_paid"})
TRANSACTION_TYPES = CREDIT_TYPES | DEBIT_TYPES | {"transfer", "adjustment"}


def default_direction(transaction_type):
    return "credit" if transaction_type in CREDIT_TYPES else "debit"
