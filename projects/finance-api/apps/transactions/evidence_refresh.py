"""Bounded recovery of missing, independently observed source directions."""

from django.utils import timezone

from apps.messages.models import ParsedMessageCandidate, RawMessage
from apps.messages.parsers import parse_raw_message
from apps.messages.source_direction import source_direction_for_kind
from apps.statements.models import StatementRow


def refresh_page(*, user, limit, offset):
    """Fill only unknown SMS observations; never infer from drafts or the ledger.

    Statement PDF directions already live in the immutable extracted JSON. We
    count those rows so the UI can identify any legacy extraction that needs
    manual source review instead of copying its editable draft direction.
    """
    candidates = ParsedMessageCandidate.objects.filter(user=user).select_related(
        "raw_message"
    ).order_by("created_at", "id")
    rows = StatementRow.objects.filter(
        batch__user=user, component="principal"
    ).only("id", "extracted").order_by("created_at", "id")
    sms_total, statement_total = candidates.count(), rows.count()
    sms_page = list(candidates[offset:offset + limit])
    statement_page = list(rows[offset:offset + limit])
    sms_updated = sms_known = sms_unknown = 0
    for candidate in sms_page:
        if candidate.source_direction in {"debit", "credit"}:
            sms_known += 1
            continue
        direction = source_direction_for_kind(candidate.message_kind)
        raw = candidate.raw_message
        if not direction and raw.status != RawMessage.Status.REDACTED and not raw.redacted_at and not raw.exclusion_reason:
            direction = parse_raw_message(raw)["source_direction"]
        if direction in {"debit", "credit"}:
            # A concurrent refresh or review may have filled the observation.
            sms_updated += ParsedMessageCandidate.objects.filter(
                pk=candidate.pk, user=user, source_direction=""
            ).update(source_direction=direction, updated_at=timezone.now())
            sms_known += 1
        else:
            sms_unknown += 1

    statement_known = sum(
        row.extracted.get("direction") in {"debit", "credit"}
        for row in statement_page
    )
    return {
        "sms_scanned": len(sms_page),
        "sms_total": sms_total,
        "sms_updated": sms_updated,
        "sms_known": sms_known,
        "sms_unknown": sms_unknown,
        "statement_scanned": len(statement_page),
        "statement_total": statement_total,
        "statement_known": statement_known,
        "statement_unknown": len(statement_page) - statement_known,
        "next_offset": offset + limit if offset + limit < max(sms_total, statement_total) else None,
    }
