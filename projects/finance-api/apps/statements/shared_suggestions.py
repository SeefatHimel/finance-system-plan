"""Conservative provider-wide category hints from public merchant names.

These rules never identify a user's account, recipient, or transfer path. A
verified per-user statement mapping takes precedence in the review service.
"""

import re


_PAYMENT_MERCHANT_CATEGORIES = (
    (re.compile(r"^foodi\s+express\s+limited(?:\s*[-/]|$)", re.IGNORECASE), "Food & Dining"),
    (re.compile(r"^shohoj\s+limited(?:\s*[-/]|$)", re.IGNORECASE), "Transport"),
    (re.compile(r"^daraz(?:\s+bangladesh(?:\s+limited)?)?(?:\s*[-/]|$)", re.IGNORECASE), "Shopping & Personal"),
)


def shared_category_name(row):
    """Return a broad category for an unedited bKash merchant payment only."""
    if (
        row.batch.profile != "bkash"
        or row.component != "principal"
        or row.direction != "debit"
        or row.type != "expense"
        or row.category_id is not None
        or row.state != "pending"
        or row.transaction_id is not None
        or str(row.extracted.get("provider_type") or "").strip().casefold() != "payment"
    ):
        return None
    details = str(row.extracted.get("description") or "").strip()
    for merchant, category in _PAYMENT_MERCHANT_CATEGORIES:
        if merchant.search(details):
            return category
    return None
