"""Read-only typed identifiers for comparing retained source observations."""

from apps.messages.references import reference_facts


def sms_reference_facts(message, reference=""):
    text = message.body if message and not message.redacted_at else ""
    return reference_facts(text, reference)


def prepare_reference_messages(records, user_id):
    """Resolve legacy SMS captures once, never one query per match observation.

    The statement matcher already prefetches candidates and transfer evidence.
    Reuse those candidate captures, and fetch only orphan legacy captures in one
    owner-scoped query. The map is private to this read, never a persisted copy.
    """
    from apps.messages.models import RawMessage

    messages, required = {}, set()
    for record in records:
        if record.raw_message_id:
            required.add(record.raw_message_id)
        for item in record.transfer_evidence.all():
            if item.raw_message_id:
                required.add(item.raw_message_id)
        for candidate in record.parsed_message_candidates.all():
            messages[candidate.raw_message_id] = candidate.raw_message
    missing = required - messages.keys()
    if missing:
        messages.update(
            {
                item.pk: item
                for item in RawMessage.objects.filter(
                    user_id=user_id, pk__in=missing
                ).only("id", "user_id", "body", "redacted_at")
            }
        )
    for record in records:
        record._reference_messages = messages


def observation_references(record, observation):
    """Read retained originals, never rewrite an old saved interpretation."""
    if observation.source != "sms":
        return reference_facts(
            "", observation.reference, statement=observation.source == "import"
        )
    message_id = getattr(observation, "raw_message_id", None)
    candidate = next(
        (
            item
            for item in record.parsed_message_candidates.all()
            if item.pk == observation.id
            or message_id
            and item.raw_message_id == message_id
        ),
        None,
    )
    if candidate:
        message = candidate.raw_message
    elif hasattr(record, "_reference_messages"):
        message = record._reference_messages.get(message_id)
    else:
        message = getattr(observation, "raw_message", None)
    return sms_reference_facts(message, observation.reference)
