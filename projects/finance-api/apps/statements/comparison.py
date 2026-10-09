"""Read-only, account-scoped statement/ledger coverage. Absence is not deletion."""

from collections import Counter, defaultdict
from copy import copy
from datetime import date, time
from decimal import Decimal

from django.db.models import Q

from apps.transactions.models import Transaction

from .insights import analyze
from .link_validation import accepted_link_issues
from .services import (
    MAX_MATCH_HISTORY,
    financial_issues,
    find_matches,
    ledger_money,
    review_context,
)


def original_coverage_row(row):
    """A read-only view of printed values, independent of corrected draft fields."""
    candidate = copy(row)
    source = row.extracted
    candidate.date = date.fromisoformat(source["date"]) if source.get("date") else None
    candidate.value_date = (
        date.fromisoformat(source["value_date"]) if source.get("value_date") else None
    )
    candidate.time = time.fromisoformat(source["time"]) if source.get("time") else None
    fee = Decimal(source.get("signed_fee", "0"))
    candidate.amount = (
        ledger_money(abs(fee))
        if row.component == "fee"
        else ledger_money(source.get("amount"))
    )
    candidate.direction = (
        ("debit" if fee < 0 else "credit")
        if row.component == "fee"
        else source["direction"]
    )
    candidate.balance_after = ledger_money(source.get("balance_after"))
    candidate.reference = source.get("reference", "")
    candidate.counterparty_text = source.get("description", "")[:255]
    candidate.note = source.get("description", "")
    candidate.type = "income" if candidate.direction == "credit" else "expense"
    candidate.other_account_id = None
    candidate.transaction_id = None
    candidate.state = "pending"
    return candidate


def matching_values_changed(row, original):
    return any(
        getattr(row, field) != getattr(original, field)
        for field in (
            "date",
            "value_date",
            "time",
            "amount",
            "direction",
            "balance_after",
            "reference",
        )
    )


def compare(batch, rows, offset=0, limit=50, bounds=None):
    draft_summary = analyze(batch, rows)
    source_rows = [original_coverage_row(row) for row in rows]
    source_matches, source_truncated = find_matches(source_rows)
    draft_matches, draft_truncated = find_matches(rows)
    truncated = source_truncated or draft_truncated
    invalid_links = {r.id for r in rows if accepted_link_issues(r)}
    linked = {
        r.transaction_id for r in rows if r.transaction_id and r.id not in invalid_links
    }
    # Either view may explain a recorded movement. Corrections never erase what
    # was printed, and corrected draft candidates remain available for review.
    suggested = {
        m["id"]
        for matches in (source_matches, draft_matches)
        for values in matches.values()
        for m in values
    }
    # A historical fingerprint still explains where an invalid link came from,
    # but must not hide a financially incompatible movement as covered.
    coverage_by_amount = defaultdict(list)
    for candidate in rows + source_rows:
        coverage_by_amount[candidate.amount].append(candidate)
    for row in rows:
        if row.id not in invalid_links:
            continue
        compatible_source = False
        for candidate in coverage_by_amount[row.transaction.amount]:
            if not accepted_link_issues(candidate, row.transaction):
                compatible_source = True
                break
        if not compatible_source:
            suggested.discard(str(row.transaction_id))
    counts = Counter()
    for row in rows:
        if row.id in invalid_links:
            state = "needs_review"
        elif row.transaction_id:
            state = "matched"
        elif row.state == "skipped":
            state = "skipped"
        elif (
            draft_matches[row.id]
            or source_matches[row.id]
            or (
                review_context(row, [], truncated)["review_state"] == "needs_correction"
                or truncated
            )
        ):
            state = "needs_review"
        else:
            state = "statement_only"
        counts[state] += 1
    warnings = []
    complete = not truncated
    if invalid_links:
        complete = False
        warnings.append(
            "Some linked ledger entries changed their financial values or account path. Unlink and review those rows; accepted evidence is preserved and coverage remains provisional."
        )
    if truncated:
        warnings.append(
            "Matching history exceeded the limit; ledger-only results are unavailable."
        )
    suggestions_limited = any(
        len(values) >= 8
        for matches in (source_matches, draft_matches)
        for values in matches.values()
    )
    if suggestions_limited:
        complete = False
        warnings.append(
            "Some rows reached the suggestion limit; absence cannot be established safely."
        )
    if any(
        matching_values_changed(row, original)
        for row, original in zip(rows, source_rows, strict=True)
    ):
        complete = False
        warnings.append(
            "Saved draft matching values differ from the original PDF. PDF coverage and corrected posting values were compared separately; absence remains provisional."
        )
    if draft_summary["discrepancy_count"]:
        complete = False
        warnings.append(
            "Saved draft balances or totals do not reconcile. Review the import summary before treating unmatched ledger entries as absent."
        )
    if any(financial_issues(r) for r in rows + source_rows):
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
    unavailable = truncated or suggestions_limited
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
    if bounds:
        results = [row for row in results if bounds[0] <= row["date"] <= bounds[1]]
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
