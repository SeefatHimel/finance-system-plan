"""Shared, read-only identity hints. These never change a ledger transaction."""

import re

from .models import PaymentMethod


def identifiers(method):
    if method.identifier:
        yield {
            "kind": method.identifier_kind,
            "value": method.identifier,
            "label": method.name,
        }
    yield from method.additional_identifiers


def identifier_score(saved, observed):
    """Compare safe suffixes; reject contradictory visible prefixes."""
    a, b = (re.sub(r"\s+", "", v).lower().replace("x", "*") for v in (saved, observed))
    ad, bd = (re.sub(r"\D", "", v) for v in (a, b))
    if len(ad) < 4 or len(bd) < 4 or ad[-4:] != bd[-4:]:
        return 0
    if a == b and len(ad) > 4:
        return 100

    def prefix(value, digits):
        masked = re.match(r"^\d+(?=[*•…])", value)
        return (
            masked[0]
            if masked
            else digits[:-4]
            if value.isdigit() and len(digits) > 4
            else ""
        )

    ap, bp = prefix(a, ad), prefix(b, bd)
    if ap and bp and not (ap.startswith(bp) or bp.startswith(ap)):
        return 0
    return 60 if ap and bp else 30


def matching_methods(
    *, user, evidence, provider="", excluded_account_id=None, methods=None
):
    if not any(value for _, value in evidence):
        return []
    if methods is None:
        methods = PaymentMethod.objects.filter(
            user=user, is_active=True, account__is_active=True
        ).select_related("account")
    methods = [
        method
        for method in methods
        if (
            not provider
            or method.provider in {provider, "bank", "card", "manual", "other"}
        )
        and method.account_id != excluded_account_id
    ]
    groups = []
    scores = {}
    for kind, value in evidence:
        if not value:
            continue
        matches = []
        for method in methods:
            score = max(
                (
                    identifier_score(saved["value"], value)
                    for saved in identifiers(method)
                    if saved["kind"] == "any" or kind == "any" or saved["kind"] == kind
                ),
                default=0,
            )
            if score:
                matches.append((score, method))
        if not matches:
            continue
        strongest = max(score for score, _ in matches)
        group = []
        for score, method in matches:
            if score == strongest:
                group.append(method)
                scores[method.id] = max(scores.get(method.id, 0), score)
        groups.append(group)
    if not groups:
        return []
    # Independent account and card observations must agree. A second identifier
    # can disambiguate a suffix, but cannot override a contradictory identity.
    account_sets = [{method.account_id for method in group} for group in groups]
    agreed = set.intersection(*account_sets)
    allowed = agreed or set.union(*account_sets)
    by_id = {
        method.id: method
        for group in groups
        for method in group
        if method.account_id in allowed
    }
    return sorted(by_id.values(), key=lambda method: (-scores[method.id], method.name))


def unique_method(**kwargs):
    matches = matching_methods(**kwargs)
    return matches[0] if len({m.account_id for m in matches}) == 1 else None


def text_identifier_evidence(text):
    """Only explicit account/card wording or masked tokens; never arbitrary references."""
    result = []
    covered = []
    for match in re.finditer(
        r"\b(account|a/c|acc|card|wallet|phone|mobile)\s*(?:no\.?|number)?\s*[:#-]?\s*([\d*Xx•…-]{4,})",
        text,
        re.IGNORECASE,
    ):
        result.append(("card" if match[1].lower() == "card" else "account", match[2]))
        covered.append(match.span())
    for match in re.finditer(r"(?<!\w)(?:\d+)?[*Xx•…]+\d{4,}(?!\w)", text):
        if not any(start <= match.start() < end for start, end in covered):
            result.append(("any", match[0]))
    return result


def statement_account_suggestion(*, user, profile, hint, methods=None):
    eligible_types = {"mobile_wallet"} if profile == "bkash" else {"bank", "savings"}
    if methods is None:
        methods = PaymentMethod.objects.filter(
            user=user,
            is_active=True,
            account__is_active=True,
            account__type__in=eligible_types,
            account__currency="BDT",
        ).select_related("account")
    else:
        methods = [
            m
            for m in methods
            if m.account.type in eligible_types and m.account.currency == "BDT"
        ]
    matches = matching_methods(
        user=user,
        evidence=[("account", hint)],
        provider="ebl" if profile == "ebl_bank" else profile,
        methods=methods,
    )
    accounts = {m.account_id for m in matches}
    if not accounts:
        return None
    if len(accounts) > 1:
        return {
            "account": None,
            "name": "",
            "reason": "Several saved accounts share this identifier. Choose manually.",
            "ambiguous": True,
        }
    method = matches[0]
    return {
        "account": str(method.account_id),
        "name": method.account.name,
        "reason": "Matched a saved account identifier. Verify the statement header.",
        "ambiguous": False,
    }


def named_methods(text, methods, excluded_account_id=None):
    text = " ".join(re.sub(r"[\W_]+", " ", text.casefold()).split())
    matches = []
    for method in methods:
        if method.account_id == excluded_account_id:
            continue
        for value in (method.name, *method.aliases):
            name = " ".join(re.sub(r"[\W_]+", " ", value.casefold()).split())
            if len(name.replace(" ", "")) >= 4 and re.search(
                rf"(?<!\w){re.escape(name)}(?!\w)", text
            ):
                matches.append(method)
                break
    return matches
