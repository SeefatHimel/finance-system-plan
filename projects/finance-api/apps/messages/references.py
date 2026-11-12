"""A transaction ID and a customer's message reference are different facts."""

import re

TRANSACTION_ID = re.compile(
    r"\b(?:trx\s*id|txn\s*id|transaction\s*id)\b\s*[:#-]?\s*([a-z0-9-]+)",
    re.IGNORECASE,
)
MESSAGE_REFERENCE = re.compile(
    r"\b(?:ref|reference)\b\s*[:#-]?\s*([a-z0-9-]+)", re.IGNORECASE
)


def reference_facts(text, saved_reference="", *, statement=False):
    transaction_id = TRANSACTION_ID.search(text or "")
    message_reference = MESSAGE_REFERENCE.search(text or "")
    # Statement parsers extract the printed transaction reference column. SMS
    # references without retained text cannot safely be relabelled as IDs.
    return {
        "transaction_id": transaction_id.group(1)
        if transaction_id
        else (saved_reference if statement else ""),
        "message_reference": message_reference.group(1) if message_reference else "",
        "saved_reference": saved_reference or "",
    }


def preferred_reference(text):
    facts = reference_facts(text)
    return facts["transaction_id"] or facts["message_reference"]
