import re
from decimal import Decimal, InvalidOperation

from .models import SenderRule

_AMOUNT_PATTERN = re.compile(r"(?:tk|bdt)\s*([0-9][0-9,]*(?:\.\d{1,2})?)|([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:tk|bdt)", re.IGNORECASE)


def find_sender_rule(*, user, sender: str):
    rules = SenderRule.objects.filter(user=user, is_active=True).select_related(
        "account",
        "payment_method",
    )

    for rule in rules:
        if _matches_rule(rule=rule, sender=sender):
            return rule
    return None


def parse_raw_message(raw_message):
    sender_rule = find_sender_rule(user=raw_message.user, sender=raw_message.sender)
    amount = _extract_amount(raw_message.body)
    parser_notes = []

    if sender_rule is None:
        parser_notes.append("No active sender rule matched this message.")
    else:
        parser_notes.append(f"Matched sender rule: {sender_rule.name}.")

    if amount is None:
        parser_notes.append("Could not extract an amount with the baseline parser.")
    else:
        parser_notes.append("Extracted amount with the baseline Tk/BDT parser.")

    return {
        "account": sender_rule.account if sender_rule else None,
        "amount": amount,
        "confidence": Decimal("0.70") if sender_rule and amount is not None else Decimal("0.30"),
        "payment_method": sender_rule.payment_method if sender_rule else None,
        "parser_name": "baseline_amount_parser",
        "parser_notes": " ".join(parser_notes),
        "sender_rule": sender_rule,
        "transaction_type": "expense",
    }


def _matches_rule(*, rule: SenderRule, sender: str) -> bool:
    rule_sender = rule.sender.strip()
    incoming_sender = sender.strip()

    if rule.match_type == SenderRule.MatchType.EXACT:
        return incoming_sender.lower() == rule_sender.lower()
    if rule.match_type == SenderRule.MatchType.CONTAINS:
        return rule_sender.lower() in incoming_sender.lower()
    if rule.match_type == SenderRule.MatchType.REGEX:
        try:
            return re.search(rule.pattern or rule_sender, incoming_sender, flags=re.IGNORECASE) is not None
        except re.error:
            return False
    return False


def _extract_amount(body: str):
    match = _AMOUNT_PATTERN.search(body)
    if not match:
        return None

    amount_text = next((group for group in match.groups() if group), "").replace(",", "")
    try:
        return Decimal(amount_text)
    except (InvalidOperation, ValueError):
        return None
