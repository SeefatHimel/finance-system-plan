"""Read-only, account-scoped statement/ledger coverage. Absence is not deletion."""

from collections import Counter
from copy import copy

from django.db.models import Q

from apps.transactions.models import Transaction

from .insights import prepare
from .services import (
    MAX_MATCH_HISTORY,
    financial_issues,
    find_matches,
    review_context,
)


def compare(batch, rows, offset=0, limit=50):
    prepare(rows)
    # Skipping is a posting decision, not evidence that the row was absent from
    # the PDF. Still compare skipped source rows when measuring ledger coverage.
    coverage_rows = []
    for row in rows:
        candidate = copy(row)
        if candidate.state == "skipped":
            candidate.state = "pending"
        coverage_rows.append(candidate)
    matches, truncated = find_matches(coverage_rows)
    linked = {r.transaction_id for r in rows if r.transaction_id}
    suggested = {m["id"] for values in matches.values() for m in values}
    counts = Counter()
    for row in rows:
        if row.transaction_id:
            state = "matched"
        elif row.state == "skipped":
            state = "skipped"
        elif matches[row.id] or (
            review_context(row, [], truncated)["review_state"] == "needs_correction"
            or truncated
        ):
            state = "needs_review"
        else:
            state = "statement_only"
        counts[state] += 1
    warnings = []
    complete = not truncated
    if truncated:
        warnings.append(
            "Matching history exceeded the limit; ledger-only results are unavailable."
        )
    if any(len(values) >= 8 for values in matches.values()):
        complete = False
        warnings.append(
            "Some rows reached the suggestion limit; absence cannot be established safely."
        )
    if any(financial_issues(r) for r in rows):
        complete = False
        warnings.append(
            "Incomplete statement rows may hide matches; absence remains provisional."
        )
    if any(c.get("passed") is False for c in batch.checks):
        complete = False
        warnings.append(
            "Original extraction checks failed; verify the PDF before treating rows as absent."
        )
    start, end = batch.period_start, batch.period_end
    unavailable = truncated or any(len(values) >= 8 for values in matches.values())
    if start is None or end is None:
        warnings.append(
            "A printed statement period is required for ledger-only comparison."
        )
    if start is None or end is None or unavailable:
        return {
            "ledger_only_available": False,
            "counts": dict(counts),
            "period_start": start,
            "period_end": end,
            "complete": False,
            "warnings": warnings,
            "count": 0,
            "offset": offset,
            "limit": limit,
            "results": [],
        }
    history = list(
        Transaction.objects.filter(user_id=batch.user_id)
        .filter(
            Q(account_id=batch.account_id)
            | Q(type="transfer", transfer_account_id=batch.account_id)
        )
        .filter(
            Q(date__range=(start, end))
            | Q(
                transfer_evidence__account_id=batch.account_id,
                transfer_evidence__date__range=(start, end),
            )
        )
        .select_related("account", "transfer_account")
        .prefetch_related("transfer_evidence")
        .order_by("date", "id")
        .distinct()[: MAX_MATCH_HISTORY + 1]
    )
    if len(history) > MAX_MATCH_HISTORY:
        complete = False
        unavailable = True
        warnings.append(
            "Ledger period exceeded the history limit; narrow the statement period."
        )
    results = []
    for record in [] if unavailable else history:
        if (
            record.account.currency != batch.currency
            or record.id in linked
            or str(record.id) in suggested
        ):
            continue
        observations = (
            [
                e
                for e in record.transfer_evidence.all()
                if e.account_id == batch.account_id
            ]
            if record.type == "transfer"
            else []
        )
        # When this account has evidence, its printed dates define coverage, not
        # the canonical date of the other account's observation.
        relevant = [e for e in observations if start <= e.date <= end]
        if observations and not relevant:
            continue
        if not observations and not start <= record.date <= end:
            continue
        observation = relevant[0] if relevant else None
        results.append(
            {
                "id": str(record.id),
                "date": observation.date if observation else record.date,
                "time": observation.time if observation else record.time,
                "direction": "credit"
                if record.type == "transfer"
                and record.transfer_account_id == batch.account_id
                else record.direction,
                "amount": str(record.amount),
                "balance_after": str(observation.balance_after)
                if observation and observation.balance_after is not None
                else str(record.balance_after)
                if not observations
                and record.account_id == batch.account_id
                and record.balance_after is not None
                else None,
                "description": record.counterparty_text or record.note[:500],
                "source": record.source,
            }
        )
    counts["ledger_only"] = len(results)
    return {
        "ledger_only_available": not unavailable,
        "counts": dict(counts),
        "period_start": start,
        "period_end": end,
        "complete": complete,
        "warnings": warnings,
        "count": len(results),
        "offset": offset,
        "limit": limit,
        "results": results[offset : offset + limit],
    }
