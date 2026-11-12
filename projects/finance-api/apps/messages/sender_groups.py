"""Exact provider aliases, without rewriting users' existing sender rules."""

PATHAO_SENDERS = ("Pathao.Pay", "Pathao Pay.", "PathaoPay.", "PathaoPay")
PATHAO_NORMALIZED = frozenset(value.casefold() for value in PATHAO_SENDERS)


def sender_group(provider, sender):
    return (
        "pathao_pay"
        if provider == "pathao_pay" and sender.strip().casefold() in PATHAO_NORMALIZED
        else ""
    )


def rule_group(rule):
    return (
        sender_group(rule.provider, rule.sender) if rule.match_type == "exact" else ""
    )
