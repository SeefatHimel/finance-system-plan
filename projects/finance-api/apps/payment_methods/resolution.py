"""Shared, read-only identity hints. These never change a ledger transaction."""

import re

from .models import PaymentMethod
from .secure_identifiers import originals_for


def identifiers(method):
    if method.identifier:
        yield {
            "kind": method.identifier_kind,
            "value": method.identifier,
            "label": method.name,
        }
    yield from method.additional_identifiers


def identifier_suffix(value):
    value = re.sub(r"\s+", "", value).lower().replace("x", "*")
    if not re.search(r"[*•…]", value):
        # Older saved numeric suffixes may contain separators. Masks still need
        # contiguous ending digits so a visible prefix cannot inflate the suffix.
        return re.sub(r"[^0-9]", "", value)[-4:]
    match = re.search(r"\d+$", value)
    return match[0][-4:] if match else ""


def identifier_score(saved, observed):
    """Compare safe suffixes; reject contradictory visible prefixes."""
    a, b = (re.sub(r"\s+", "", v).lower().replace("x", "*") for v in (saved, observed))
    ad, bd = (re.sub(r"\D", "", v) for v in (a, b))
    at, bt = identifier_suffix(a), identifier_suffix(b)
    length = min(len(at), len(bt))
    if length < 3 or at[-length:] != bt[-length:]:
        return 0

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
    if length == 3:
        return 10  # Always review-only, even with a matching visible prefix.
    if a == b and len(ad) > 4:
        return 100
    return 60 if ap and bp else 30


def exact_original_score(method, kind, observed):
    """Use an exact full value only when the source exposes one; never reveal it."""
    observed = re.sub(r"[\s-]+", "", observed)
    if not re.fullmatch(r"\+?\d{7,}", observed):
        return 0
    observed_digits = re.sub(r"\D", "", observed)
    originals = originals_for(method)
    candidates = [
        (method.identifier_kind, originals["identifier"]),
        *((item["kind"], item["value"]) for item in originals["additional_identifiers"]),
    ]
    for saved_kind, saved_value in candidates:
        if saved_kind not in {"any", kind} and kind != "any":
            continue
        compact = re.sub(r"[\s-]+", "", saved_value)
        if re.fullmatch(r"\+?\d{7,}", compact) and re.sub(r"\D", "", compact) == observed_digits:
            return 120
    return 0


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
        if method.user_id == getattr(user, "pk", user)
        and method.is_active
        and method.account.is_active
        and (
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
            masked_score = max(
                (
                    identifier_score(saved["value"], value)
                    for saved in identifiers(method)
                    if saved["kind"] == "any" or kind == "any" or saved["kind"] == kind
                ),
                default=0,
            )
            score = max(masked_score, exact_original_score(method, kind, value))
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
    if len({m.account_id for m in matches}) != 1:
        return None
    # A unique short suffix is not proof. Independent longer evidence can
    # corroborate the same account, but conflicting observations remain unresolved.
    strong = any(
        identifier_score(saved["value"], value) >= 30
        for method in matches
        for saved in identifiers(method)
        for kind, value in kwargs["evidence"]
        if saved["kind"] == "any" or kind == "any" or saved["kind"] == kind
    )
    return matches[0] if strong else None


def text_identifier_evidence(text):
    """Only explicit account/card wording or masked tokens; never arbitrary references."""
    result = []
    covered = []
    for match in re.finditer(
        r"\b(account|a/c|acc|card|wallet|phone|mobile)\s*(?:no\.?|number|ending(?:\s+in)?)?\s*[:#-]?\s*([\d*Xx•…-]{3,})",
        text,
        re.IGNORECASE,
    ):
        result.append(("card" if match[1].lower() == "card" else "account", match[2]))
        covered.append(match.span())
    for match in re.finditer(r"(?<!\w)(?:\d+)?[*Xx•…]+\d{3,}(?!\w)", text):
        if not any(start <= match.start() < end for start, end in covered):
            result.append(("any", match[0]))
    return result


def statement_account_suggestion(*, user, profile, hint, methods=None):
    eligible_types = (
        {"mobile_wallet"} if profile == "bkash"
        else {"credit_card"} if profile == "ebl_credit_card"
        else {"bank", "savings"}
    )
    provider = "ebl" if profile in {"ebl_bank", "ebl_credit_card"} else profile
    evidence_kind = "card" if profile == "ebl_credit_card" else "account"
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
        evidence=[(evidence_kind, hint)],
        provider=provider,
        methods=methods,
    )
    accounts = {m.account_id for m in matches}
    if not accounts:
        return None
    choices = [
        {"account": str(m.account_id), "name": m.account.name}
        for m in {m.account_id: m for m in matches}.values()
    ]
    if not unique_method(
        user=user,
        evidence=[(evidence_kind, hint)],
        provider=provider,
        methods=methods,
    ):
        return {
            "account": None,
            "name": "",
            "choices": choices,
            "requires_review": True,
            "reason": (
                "Only three ending digits overlap. Check the statement header and choose an account."
                if len(accounts) == 1
                else "Several saved accounts share this identifier. Check the statement header and choose manually."
            ),
            "ambiguous": len(accounts) > 1,
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
