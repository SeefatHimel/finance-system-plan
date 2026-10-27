"""Deterministic suggestions and review-only draft reconciliation."""

import hashlib
import re
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from difflib import SequenceMatcher

from django.db.models import prefetch_related_objects

from .models import StatementMapping
from .shared_suggestions import shared_category_name

BKASH_BANK_ACCOUNT_NAMES = {
    "city_bank": ("city bank", "citybank", "city touch"),
    "ebl": ("ebl", "eastern bank"),
}


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
    from .counterparties import code_for_row
    from .ebl_identifiers import OPERATION

    if row.batch.profile == "ebl_bank" and OPERATION.search(row.extracted.get("description", "")):
        return None, ""
    # Citytouch's first reference part is unique per movement while its second
    # part recurs. A generic description pattern would collapse unrelated payees.
    if code_for_row(row):
        return None, ""
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
        getattr(row, "reviewed_source_direction", None) or row.extracted.get("direction"),
    ]
    return hashlib.sha256(repr(source).encode()).hexdigest(), label


def bkash_funding_bank(description):
    """Only a trailing bank label in funding details is an issuer hint."""
    match = re.search(r"/\s*(city(?:\s+bank)?|ebl|eastern\s+bank(?:\s+limited)?)\s*$", description, re.IGNORECASE)
    if not match:
        return ""
    return "city_bank" if match[1].casefold().startswith("city") else "ebl"


def suggestions(rows):
    if not rows:
        return {}
    batch = rows[0].batch
    from apps.accounts.models import Account
    from apps.categories.models import Category
    from apps.payment_methods.models import PaymentMethod
    from apps.payment_methods.resolution import (
        exact_original_score,
        identifier_suffix,
        matching_methods,
        named_methods,
        text_identifier_evidence,
        unique_method,
    )

    from .counterparties import code_for_row, code_suggestions
    from .services import bkash_funding_credit, transfer_hint

    methods = list(
        PaymentMethod.objects.filter(
            user_id=batch.user_id, is_active=True, account__is_active=True
        ).select_related("account")
    )
    accounts = []
    if batch.profile == "bkash" and any(
        bkash_funding_credit(row.extracted, batch.profile, row.component) for row in rows
    ):
        accounts = list(Account.objects.filter(
            user_id=batch.user_id, is_active=True, currency=batch.currency,
            type__in=["bank", "savings", "credit_card"],
        ).exclude(pk=batch.account_id))
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
    result = code_suggestions(rows)
    shared_names = {shared_category_name(row) for row in rows} - {None}
    shared_categories = (
        {
            category.name: category
            for category in Category.objects.filter(
                user_id=batch.user_id,
                name__in=shared_names,
                kind="expense",
                is_active=True,
            )
        }
        if shared_names else {}
    )

    def add_shared_category(row):
        name = shared_category_name(row)
        category = shared_categories.get(name)
        if category and row.id not in result:
            result[row.id] = {
                "type": row.type,
                "category": str(category.id),
                "other_account": None,
                "reason": (
                    f"Shared {name} category hint from the printed bKash merchant. "
                    "Check it before applying; your saved choices take priority."
                ),
            }

    for row in rows:
        if getattr(row, "_ebl_possible_fee", False):
            if row.state == "pending" and not row.transaction_id and not row.classification_confirmed and row.type != "fee":
                result[row.id] = {"type": "fee", "category": None, "other_account": None,
                    "reason": "Possible separate EBL bank charge: adjacent debit shares a date and movement reference, and its balance step agrees. Verify the PDF before applying; amounts stay separate."}
            continue
        code = code_for_row(row)
        if code and row.id not in result and batch.profile == "bkash" and code.startswith("send:phone:"):
            number = code.removeprefix("send:phone:")
            exact = [method for method in methods if (
                method.provider == "bkash"
                and method.account.type == "mobile_wallet"
                and method.account.currency == batch.currency
                and method.account_id != batch.account_id
                and exact_original_score(method, "account", number) == 120
            )]
            if len({method.account_id for method in exact}) == 1:
                account = exact[0].account
                result[row.id] = {
                    "type": "transfer", "category": None,
                    "other_account": str(account.id),
                    "counterparty_text": account.name,
                    "note": f"Send Money · {account.name}",
                    "reason": f"The full Send Money recipient matches a saved number for {account.name}. Verify ownership before applying.",
                }
        if code:
            # Unverified or unmapped Citytouch codes never fall through to
            # generic numeric/payment-method or merchant learning.
            # Public bKash merchant wording can still offer a category, but
            # never an identity or transfer path, after a user's code mapping.
            add_shared_category(row)
            continue
        if batch.profile == "ebl_bank":
            from .ebl_identifiers import OPERATION

            if OPERATION.search(row.extracted.get("description", "")):
                continue  # Unverified NPSB wording must not learn an owned-account route.
        # Numeric identity hints require transfer wording. Descriptions remain
        # immutable and the hint never changes a row or its ledger movement.
        if transfer_hint(row):
            identity_matches = matching_methods(
                user=batch.user_id,
                methods=methods,
                evidence=text_identifier_evidence(row.extracted.get("description", "")),
                excluded_account_id=batch.account_id,
            )
            if len({m.account_id for m in identity_matches}) > 1:
                continue
            method = unique_method(
                user=batch.user_id, methods=methods,
                evidence=text_identifier_evidence(row.extracted.get("description", "")),
                excluded_account_id=batch.account_id,
            )
            short_evidence = any(len(identifier_suffix(value)) == 3 for _, value in
                                 text_identifier_evidence(row.extracted.get("description", "")))
            if not method and (identity_matches or short_evidence):
                continue  # Weak numeric hints cannot fall back to a learned account.
            if method and method.account.currency == batch.currency:
                result[row.id] = {
                    "type": "transfer",
                    "category": None,
                    "other_account": str(method.account_id),
                    "reason": f"Matched a saved identifier for {method.account.name}. Verify the transfer path.",
                }
                continue
        if bkash_funding_credit(row.extracted, batch.profile, row.component):
            bank = bkash_funding_bank(row.extracted.get("description", ""))
            bank_label = "City Bank" if bank == "city_bank" else "EBL"
            funding_kind = str(row.extracted.get("provider_type") or "").strip()
            candidates = [
                {"account": str(account.id), "name": account.name}
                for account in accounts
                if bank and (
                    any(method.account_id == account.id and method.provider == bank for method in methods)
                    or any(name in account.name.casefold() for name in BKASH_BANK_ACCOUNT_NAMES[bank])
                )
            ]
            result[row.id] = {
                "type": "transfer", "category": None, "other_account": None,
                "account_candidates": candidates,
                "reason": (
                    f"{funding_kind} is a funded wallet credit. {bank_label} identifies the bank, "
                    "not the exact account. Choose your own funding account, or change the type if someone else funded it."
                    if bank else
                    f"{funding_kind} is a funded wallet credit. Choose your own funding account, "
                    "or change the type if someone else funded it."
                ),
            }
            continue
        mapping = mappings.get(pattern(row)[0])
        if not mapping and transfer_hint(row):
            matches = named_methods(
                row.extracted.get("description", ""), methods, batch.account_id
            )
            if (
                len({m.account_id for m in matches}) == 1
                and matches[0].account.currency == batch.currency
            ):
                result[row.id] = {
                    "type": "transfer",
                    "category": None,
                    "other_account": str(matches[0].account_id),
                    "reason": f"Matched a saved name alias for {matches[0].account.name}. Verify this is your own-account transfer.",
                }
            continue
        if not mapping or mapping.direction != row.direction:
            if not mapping:
                add_shared_category(row)
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
            "note": mapping.note_template,
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
                "note_template": row.note[:500] if row.note and row.note.strip() != str(row.extracted.get("description") or "").strip() else "",
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
                    1 if (row.reviewed_source_direction or raw["direction"]) == "credit" else -1
                ) + Decimal(raw.get("signed_fee", "0"))
    previous = batch.opening_balance
    derived = False
    if previous is None and groups:
        first_row = next(iter(groups.values()))[0]
        first = first_row.extracted
        if first.get("balance_after") is not None and first.get("amount") is not None:
            previous = (
                Decimal(first["balance_after"])
                - Decimal(first["amount"])
                * (1 if (first_row.reviewed_source_direction or first["direction"]) == "credit" else -1)
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
                (row.reviewed_source_direction or row.extracted["direction"])
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
