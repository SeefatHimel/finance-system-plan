import re
from decimal import Decimal, InvalidOperation

from apps.payment_methods.models import PaymentMethod

from .models import ParsedMessageCandidate, SenderRule

_AMOUNT_PATTERN = re.compile(r"(?:tk|bdt)\s*([0-9][0-9,]*(?:\.\d{1,2})?)|([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:tk|bdt)", re.IGNORECASE)
_BALANCE_PATTERN = re.compile(r"(?:balance|bal)\s*(?:is|:)?\s*(?:tk|bdt)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE)
_FEE_PATTERN = re.compile(r"(?:charge|fee)\s*(?:is|:)?\s*(?:tk|bdt)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE)
_REFERENCE_PATTERN = re.compile(r"\b(?:trxid|trx id|txnid|txn id|ref|reference)\b\s*[:#-]?\s*([a-z0-9-]+)", re.IGNORECASE)


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
    provider = _detect_provider(sender_rule=sender_rule, sender=raw_message.sender)

    if provider == SenderRule.Provider.BKASH:
        return _parse_bkash_message(raw_message=raw_message, sender_rule=sender_rule)
    if provider in (SenderRule.Provider.EBL, SenderRule.Provider.CITY_BANK):
        return _parse_bank_card_message(
            raw_message=raw_message,
            sender_rule=sender_rule,
            provider=provider,
        )
    if provider == SenderRule.Provider.PATHAO_PAY:
        return _parse_pathao_pay_message(raw_message=raw_message, sender_rule=sender_rule)

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
        "balance_after": _extract_balance(raw_message.body),
        "confidence": Decimal("0.70") if sender_rule and amount is not None else Decimal("0.30"),
        "counterparty_text": "",
        "destination_account": None,
        "destination_payment_method": None,
        "fee_amount": _extract_fee(raw_message.body),
        "message_kind": ParsedMessageCandidate.MessageKind.UNKNOWN,
        "payment_method": sender_rule.payment_method if sender_rule else None,
        "possible_internal_transfer": False,
        "provider": provider,
        "reference": _extract_reference(raw_message.body),
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


def _parse_bkash_message(*, raw_message, sender_rule):
    body = raw_message.body
    normalized = _normalize_text(body)
    amount = _extract_amount(body)
    message_kind = ParsedMessageCandidate.MessageKind.UNKNOWN
    transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
    possible_internal_transfer = False
    confidence = Decimal("0.75") if sender_rule and amount is not None else Decimal("0.45")
    notes = []
    account = sender_rule.account if sender_rule else None
    payment_method = sender_rule.payment_method if sender_rule else None
    destination_account = None
    destination_payment_method = None

    if sender_rule:
        notes.append(f"Matched sender rule: {sender_rule.name}.")
    else:
        notes.append("No active sender rule matched this bKash-like message.")

    if any(keyword in normalized for keyword in ("cash in", "cash-in", "add money")):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_IN
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.88") if amount is not None else Decimal("0.60")
        notes.append("Detected bKash cash-in/add-money wording.")
    elif any(keyword in normalized for keyword in ("cash out", "cash-out")):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_OUT
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.84") if amount is not None else Decimal("0.55")
        notes.append("Detected bKash cash-out wording.")
    elif "send money" in normalized:
        message_kind = ParsedMessageCandidate.MessageKind.SEND_MONEY
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected bKash send-money wording.")
    elif any(keyword in normalized for keyword in ("received", "receive money")):
        message_kind = ParsedMessageCandidate.MessageKind.RECEIVE_MONEY
        transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected bKash receive-money wording.")
    elif any(keyword in normalized for keyword in ("payment", "paid to", "merchant")):
        message_kind = ParsedMessageCandidate.MessageKind.PURCHASE
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected bKash payment/purchase wording.")

    counterparty_text = _extract_counterparty_text(body)
    matched_payment_method = _find_payment_method_hint(
        user=raw_message.user,
        text=counterparty_text or body,
    )
    if matched_payment_method and (
        sender_rule is None or matched_payment_method.account_id != sender_rule.account_id
    ):
        if message_kind in (
            ParsedMessageCandidate.MessageKind.CASH_IN,
            ParsedMessageCandidate.MessageKind.RECEIVE_MONEY,
        ):
            account = matched_payment_method.account
            payment_method = matched_payment_method
            destination_account = sender_rule.account if sender_rule else None
            destination_payment_method = sender_rule.payment_method if sender_rule else None
            transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
            possible_internal_transfer = True
            confidence = max(confidence, Decimal("0.90"))
            notes.append("Matched bKash transfer source payment method from counterparty text.")
        elif message_kind in (
            ParsedMessageCandidate.MessageKind.CASH_OUT,
            ParsedMessageCandidate.MessageKind.SEND_MONEY,
        ):
            destination_account = matched_payment_method.account
            destination_payment_method = matched_payment_method
            transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
            possible_internal_transfer = True
            confidence = max(confidence, Decimal("0.88"))
            notes.append("Matched bKash transfer destination payment method from counterparty text.")

    if amount is None:
        notes.append("Could not extract an amount with the Tk/BDT parser.")
    else:
        notes.append("Extracted amount with the Tk/BDT parser.")

    return {
        "account": account,
        "amount": amount,
        "balance_after": _extract_balance(body),
        "confidence": confidence,
        "counterparty_text": counterparty_text,
        "destination_account": destination_account,
        "destination_payment_method": destination_payment_method,
        "fee_amount": _extract_fee(body),
        "message_kind": message_kind,
        "payment_method": payment_method,
        "possible_internal_transfer": possible_internal_transfer,
        "provider": SenderRule.Provider.BKASH,
        "reference": _extract_reference(body),
        "parser_name": "bkash_sms_parser",
        "parser_notes": " ".join(notes),
        "sender_rule": sender_rule,
        "transaction_type": transaction_type,
    }


def _parse_bank_card_message(*, raw_message, sender_rule, provider: str):
    body = raw_message.body
    normalized = _normalize_text(body)
    amount = _extract_amount(body)
    message_kind = ParsedMessageCandidate.MessageKind.UNKNOWN
    transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
    possible_internal_transfer = False
    confidence = Decimal("0.72") if sender_rule and amount is not None else Decimal("0.42")
    notes = []

    if sender_rule:
        notes.append(f"Matched sender rule: {sender_rule.name}.")
    else:
        notes.append("No active sender rule matched this bank/card-like message.")

    if any(keyword in normalized for keyword in ("reversed", "reversal", "void")):
        message_kind = ParsedMessageCandidate.MessageKind.REVERSAL
        transaction_type = ParsedMessageCandidate.TransactionType.REFUND
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected bank/card reversal wording.")
    elif any(keyword in normalized for keyword in ("refund", "refunded", "cashback")):
        message_kind = ParsedMessageCandidate.MessageKind.REFUND
        transaction_type = ParsedMessageCandidate.TransactionType.REFUND
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected bank/card refund wording.")
    elif any(keyword in normalized for keyword in ("fee", "charge", "vat")):
        message_kind = ParsedMessageCandidate.MessageKind.FEE
        transaction_type = ParsedMessageCandidate.TransactionType.FEE
        confidence = Decimal("0.80") if amount is not None else Decimal("0.48")
        notes.append("Detected bank/card fee or charge wording.")
    elif any(keyword in normalized for keyword in ("used for", "purchase", "spent", "pos", "at ")):
        message_kind = ParsedMessageCandidate.MessageKind.CARD_PURCHASE
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.84") if amount is not None else Decimal("0.52")
        notes.append("Detected bank/card purchase wording.")
    elif any(keyword in normalized for keyword in ("card payment", "payment received", "bill payment")):
        message_kind = ParsedMessageCandidate.MessageKind.CARD_PAYMENT
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected card payment wording.")
    elif any(keyword in normalized for keyword in ("transfer", "fund transfer", "debited", "credited")):
        if any(keyword in normalized for keyword in ("credited", "received")):
            message_kind = ParsedMessageCandidate.MessageKind.BANK_TRANSFER_IN
            transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        else:
            message_kind = ParsedMessageCandidate.MessageKind.BANK_TRANSFER_OUT
            transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
            possible_internal_transfer = True
        confidence = Decimal("0.78") if amount is not None else Decimal("0.48")
        notes.append("Detected bank transfer wording.")

    if amount is None:
        notes.append("Could not extract an amount with the Tk/BDT parser.")
    else:
        notes.append("Extracted amount with the Tk/BDT parser.")

    return {
        "account": sender_rule.account if sender_rule else None,
        "amount": amount,
        "balance_after": _extract_balance(body),
        "confidence": confidence,
        "counterparty_text": _extract_merchant_text(body) or _extract_counterparty_text(body),
        "destination_account": None,
        "destination_payment_method": None,
        "fee_amount": _extract_fee(body),
        "message_kind": message_kind,
        "payment_method": sender_rule.payment_method if sender_rule else None,
        "possible_internal_transfer": possible_internal_transfer,
        "provider": provider,
        "reference": _extract_reference(body),
        "parser_name": f"{provider}_card_sms_parser",
        "parser_notes": " ".join(notes),
        "sender_rule": sender_rule,
        "transaction_type": transaction_type,
    }


def _parse_pathao_pay_message(*, raw_message, sender_rule):
    body = raw_message.body
    normalized = _normalize_text(body)
    amount = _extract_amount(body)
    message_kind = ParsedMessageCandidate.MessageKind.UNKNOWN
    transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
    possible_internal_transfer = False
    confidence = Decimal("0.72") if sender_rule and amount is not None else Decimal("0.42")
    notes = []

    if sender_rule:
        notes.append(f"Matched sender rule: {sender_rule.name}.")
    else:
        notes.append("No active sender rule matched this Pathao Pay-like message.")

    if any(keyword in normalized for keyword in ("top up", "top-up", "add money", "cash in")):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_IN
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.84") if amount is not None else Decimal("0.52")
        notes.append("Detected Pathao Pay top-up/add-money wording.")
    elif any(keyword in normalized for keyword in ("withdraw", "cash out", "cash-out")):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_OUT
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected Pathao Pay withdraw/cash-out wording.")
    elif "send money" in normalized:
        message_kind = ParsedMessageCandidate.MessageKind.SEND_MONEY
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected Pathao Pay send-money wording.")
    elif any(keyword in normalized for keyword in ("received", "receive money")):
        message_kind = ParsedMessageCandidate.MessageKind.RECEIVE_MONEY
        transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected Pathao Pay receive-money wording.")
    elif any(keyword in normalized for keyword in ("payment", "paid", "purchase")):
        message_kind = ParsedMessageCandidate.MessageKind.PURCHASE
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected Pathao Pay payment/purchase wording.")

    if amount is None:
        notes.append("Could not extract an amount with the Tk/BDT parser.")
    else:
        notes.append("Extracted amount with the Tk/BDT parser.")

    return {
        "account": sender_rule.account if sender_rule else None,
        "amount": amount,
        "balance_after": _extract_balance(body),
        "confidence": confidence,
        "counterparty_text": _extract_counterparty_text(body),
        "destination_account": None,
        "destination_payment_method": None,
        "fee_amount": _extract_fee(body),
        "message_kind": message_kind,
        "payment_method": sender_rule.payment_method if sender_rule else None,
        "possible_internal_transfer": possible_internal_transfer,
        "provider": SenderRule.Provider.PATHAO_PAY,
        "reference": _extract_reference(body),
        "parser_name": "pathao_pay_sms_parser",
        "parser_notes": " ".join(notes),
        "sender_rule": sender_rule,
        "transaction_type": transaction_type,
    }


def _detect_provider(*, sender_rule, sender: str) -> str:
    if sender_rule:
        return sender_rule.provider

    normalized_sender = sender.strip().lower().replace(" ", "")
    if "bkash" in normalized_sender:
        return SenderRule.Provider.BKASH
    if normalized_sender == "ebl" or "easternbank" in normalized_sender:
        return SenderRule.Provider.EBL
    if "city" in normalized_sender:
        return SenderRule.Provider.CITY_BANK
    if "pathao" in normalized_sender:
        return SenderRule.Provider.PATHAO_PAY
    return SenderRule.Provider.OTHER


def _extract_balance(body: str):
    return _extract_decimal_with_pattern(_BALANCE_PATTERN, body)


def _extract_fee(body: str):
    return _extract_decimal_with_pattern(_FEE_PATTERN, body)


def _extract_reference(body: str) -> str:
    match = _REFERENCE_PATTERN.search(body)
    return match.group(1).strip() if match else ""


def _extract_decimal_with_pattern(pattern, body: str):
    match = pattern.search(body)
    if not match:
        return None

    try:
        return Decimal(match.group(1).replace(",", ""))
    except (InvalidOperation, ValueError):
        return None


def _extract_counterparty_text(body: str) -> str:
    match = re.search(r"\b(?:to|from)\s+(.+?)(?:\.| trxid| txnid| ref| balance| fee| charge|$)", body, flags=re.IGNORECASE)
    if not match:
        return ""
    return match.group(1).strip()[:255]


def _extract_merchant_text(body: str) -> str:
    match = re.search(r"\bat\s+(.+?)(?:\s+on\b|\.| ref\b| balance\b| available\b|$)", body, flags=re.IGNORECASE)
    if not match:
        return ""
    return match.group(1).strip()[:255]


def _find_payment_method_hint(*, user, text: str):
    if not text:
        return None

    normalized_text = _normalize_identifier(text)
    if not normalized_text:
        return None

    payment_methods = PaymentMethod.objects.filter(user=user, is_active=True).select_related("account")
    for payment_method in payment_methods:
        identifier = _normalize_identifier(payment_method.identifier)
        if len(identifier) >= 4 and identifier in normalized_text:
            return payment_method
    return None


def _normalize_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _normalize_text(value: str) -> str:
    return " ".join(value.lower().replace("-", " ").split())
