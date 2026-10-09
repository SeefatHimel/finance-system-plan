"""Deterministic suggestions and review-only draft reconciliation."""

import hashlib
import re
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from difflib import SequenceMatcher

from django.db.models import prefetch_related_objects

from .models import StatementMapping


def merchant_text(value):
    value = re.sub(
        r"(?:trx\s*id|reference|ref|value date)\s*[:/#].*",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b|\*+\d+|\b\d{6,}\b", " ", value)
    words = re.findall(r"[^\W\d_]+", value.casefold(), flags=re.UNICODE)
    return " ".join(
        w
        for w in words
        if w
        not in {
            "purchase",
            "card",
            "payment",
            "transfer",
            "npsb",
            "eft",
            "from",
            "to",
            "bank",
            "bdt",
            "bd",
            "dhaka",
        }
    )[:180]


def pattern(row):
    label = merchant_text(row.extracted.get("description", ""))
    if len(label) < 4:
        return None, ""
    # A fee and principal can share bank wording. Do not learn generic transfer
    # descriptions; keep their classification explicit until richer evidence exists.
    if (
        re.search(
            r"npsb|eft|transfer", row.extracted.get("description", ""), re.IGNORECASE
        )
        and len(label.split()) < 2
    ):
        return None, ""
    source = [
        label,
        row.component,
        row.extracted.get("provider_type"),
        row.extracted.get("direction"),
    ]
    return hashlib.sha256(repr(source).encode()).hexdigest(), label


def suggestions(rows):
    if not rows:
        return {}
    batch = rows[0].batch
    keys = {pattern(row)[0] for row in rows} - {None}
    mappings = {
        m.pattern_key: m
        for m in StatementMapping.objects.filter(
            user_id=batch.user_id,
            account_id=batch.account_id,
            profile=batch.profile,
            pattern_key__in=keys,
        ).select_related("category", "other_account")
    }
    result = {}
    for row in rows:
        mapping = mappings.get(pattern(row)[0])
        if not mapping or mapping.direction != row.direction:
            continue
        if mapping.category and not mapping.category.is_active:
            continue
        if mapping.type == "transfer" and (
            not mapping.other_account
            or not mapping.other_account.is_active
            or mapping.other_account.currency != batch.currency
        ):
            continue
        result[row.id] = {
            "type": mapping.type,
            "category": str(mapping.category_id) if mapping.category_id else None,
            "other_account": str(mapping.other_account_id)
            if mapping.other_account_id
            else None,
            "reason": f"Choices you confirmed for {mapping.pattern_label} in this account.",
        }
    return result


def remember(row, user):
    key, label = pattern(row)
    if key:
        StatementMapping.objects.update_or_create(
            user=user,
            account=row.batch.account,
            profile=row.batch.profile,
            pattern_key=key,
            defaults={
                "pattern_label": label,
                "type": row.type,
                "direction": row.direction,
                "category": row.category,
                "other_account": row.other_account,
            },
        )


def match_signals(
    row,
    record,
    observation,
    distance,
    reference_matches,
    balance_matches,
    conflict,
    previously_seen,
):
    left = merchant_text(row.extracted.get("description", ""))
    merchant = (
        max(
            (
                SequenceMatcher(None, left, merchant_text(text)).ratio()
                for text in [record.counterparty_text, observation.note]
            ),
            default=0,
        )
        if left
        else 0
    )
    observations_with_time = [(observation.date, observation.time)]
    minutes = (
        min(
            (
                abs(
                    (
                        datetime.combine(day, row.time)
                        - datetime.combine(other_day, reported_time)
                    ).total_seconds()
                )
                / 60
                for day in (row.date, row.value_date)
                if day is not None
                for other_day, reported_time in observations_with_time
                if reported_time is not None
            ),
            default=None,
        )
        if row.time
        else None
    )
    corroboration = sum(
        [
            reference_matches,
            balance_matches,
            merchant >= 0.8,
            minutes is not None and minutes <= 10 and distance == 0,
        ]
    )
    strong = not conflict and (
        previously_seen
        or (balance_matches and distance == 0)
        or (corroboration >= 2 and distance <= 1)
    )
    reasons = []
    if merchant >= 0.6:
        reasons.append(
            "Merchant wording closely agrees."
            if merchant >= 0.8
            else "Merchant wording partially agrees."
        )
    if minutes is not None:
        reasons.append(
            f"Reported time difference: {round(minutes, 1)} minutes (same-date times are stronger evidence)."
        )
    return (
        {
            "strength": "strong" if strong else "possible",
            "merchant_similarity": round(merchant, 2),
            "time_difference_minutes": round(minutes, 1)
            if minutes is not None
            else None,
        },
        reasons,
        round(merchant * 25)
        + (15 if minutes is not None and minutes <= 10 and distance == 0 else 0),
    )


def analyze(batch, rows):
    """Full draft arithmetic, independently of immutable extraction checks.

    Skips remain part of statement arithmetic; disposition totals describe which
    movements actually entered this ledger. No source checks are rewritten.
    """
    from .link_validation import accepted_link_issues

    prefetch_related_objects(
        rows, "batch__account", "transaction__account", "transaction__transfer_account"
    )
    groups = defaultdict(list)
    totals = {
        kind: {"debit": Decimal(0), "credit": Decimal(0)}
        for kind in ("principal", "fee")
    }
    states = {
        s: {"count": 0, "debit": Decimal(0), "credit": Decimal(0)}
        for s in ("posted", "linked", "skipped", "unresolved")
    }
    issues = defaultdict(list)
    checks = []
    source_net = Decimal(0)
    draft_net = Decimal(0)
    valid = True
    source_valid = True
    for row in rows:
        groups[row.position].append(row)
        state = (
            row.state
            if row.state == "skipped"
            or (row.transaction_id and not accepted_link_issues(row))
            else "unresolved"
        )
        states[state]["count"] += 1
        if row.amount is None:
            valid = False
            issues[row.id].append(
                "Draft amount is missing; reconciliation is incomplete."
            )
        else:
            totals[row.component][row.direction] += row.amount
            states[state][row.direction] += row.amount
            draft_net += row.amount * (1 if row.direction == "credit" else -1)
        if row.component == "principal":
            raw = row.extracted
            if raw.get("amount") is None:
                source_valid = False
            if raw.get("amount") is not None:
                source_net += Decimal(raw["amount"]) * (
                    1 if raw["direction"] == "credit" else -1
                ) + Decimal(raw.get("signed_fee", "0"))
    previous = batch.opening_balance
    derived = False
    if previous is None and groups:
        first = next(iter(groups.values()))[0].extracted
        if first.get("balance_after") is not None and first.get("amount") is not None:
            previous = (
                Decimal(first["balance_after"])
                - Decimal(first["amount"])
                * (1 if first["direction"] == "credit" else -1)
                - Decimal(first.get("signed_fee", "0"))
            )
            derived = True
    opening = previous
    for position, components in sorted(groups.items()):
        final = next((r for r in components if r.component == "fee"), components[0])
        net = sum(
            (
                r.amount * (1 if r.direction == "credit" else -1)
                for r in components
                if r.amount is not None
            ),
            Decimal(0),
        )
        complete = all(r.amount is not None for r in components)
        expected = previous + net if previous is not None and complete else None
        passed = (
            expected == final.balance_after
            if expected is not None and final.balance_after is not None
            else None
        )
        checks.append(
            {
                "label": f"Source row {position} draft balance",
                "expected": str(expected) if expected is not None else None,
                "observed": str(final.balance_after)
                if final.balance_after is not None
                else None,
                "passed": passed,
            }
        )
        if passed is False:
            for row in components:
                issues[row.id].append(
                    f"Draft balance disagrees: expected {expected}, entered {final.balance_after}."
                )
        if (
            len(components) > 1
            and len(
                {r.balance_after for r in components if r.balance_after is not None}
            )
            > 1
        ):
            for row in components:
                issues[row.id].append(
                    "Principal and inline fee have different final reported balances; the fee report is used when posting."
                )
        previous = final.balance_after if final.balance_after is not None else expected
    checks.append(
        {
            "label": "Draft net movement versus source",
            "expected": str(source_net) if source_valid else None,
            "observed": str(draft_net) if valid else None,
            "passed": draft_net == source_net if valid and source_valid else None,
        }
    )
    if valid and source_valid and draft_net != source_net:
        for row in rows:
            raw_amount = (
                row.extracted.get("amount")
                if row.component == "principal"
                else str(abs(Decimal(row.extracted.get("signed_fee", "0"))))
            )
            raw_direction = (
                row.extracted["direction"]
                if row.component == "principal"
                else (
                    "debit"
                    if Decimal(row.extracted.get("signed_fee", "0")) < 0
                    else "credit"
                )
            )
            if raw_amount is not None and (
                row.amount != Decimal(raw_amount) or row.direction != raw_direction
            ):
                issues[row.id].append(
                    "Your correction changes the statement's net movement. Review the draft totals before posting."
                )
    if opening is not None and batch.closing_balance is not None:
        checks.append(
            {
                "label": "Draft closing balance",
                "expected": str(batch.closing_balance),
                "observed": str(opening + draft_net) if valid else None,
                "passed": opening + draft_net == batch.closing_balance
                if valid
                else None,
            }
        )
    for row in rows:
        row._draft_issues = issues[row.id]
    stringify = lambda data: {
        k: str(v) if isinstance(v, Decimal) else v for k, v in data.items()
    }
    return {
        "totals": {k: stringify(v) for k, v in totals.items()},
        "dispositions": {k: stringify(v) for k, v in states.items()},
        "source_net": str(source_net) if source_valid else None,
        "draft_net": str(draft_net) if valid else None,
        "opening_is_derived": derived,
        "checks": checks,
        "discrepancy_count": sum(c["passed"] is False for c in checks),
        "incomplete_count": sum(c["passed"] is None for c in checks),
        "remaining_count": states["unresolved"]["count"],
    }


def prepare(rows):
    if rows:
        analyze(rows[0].batch, rows)
        learned = suggestions(rows)
        for row in rows:
            row._suggestion = learned.get(row.id)
