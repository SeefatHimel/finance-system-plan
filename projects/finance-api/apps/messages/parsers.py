import re
from decimal import Decimal, InvalidOperation

from apps.payment_methods.models import PaymentMethod

from .models import ParsedMessageCandidate, SenderRule

_AMOUNT_PATTERN = re.compile(
    r"(?:tk|bdt)\.?\s*([0-9][0-9,]*(?:\.\d{1,2})?)|"
    r"(?<![-/])\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:tk|bdt)\.?",
    re.IGNORECASE,
)
_BALANCE_PATTERN = re.compile(
    r"(?:balance|bal)\s*(?:is|:)?\s*(?:(?:tk|bdt)\.?\s*)?"
    r"([0-9][0-9,]*(?:\.\d{1,2})?)|"
    r"(?:(?:tk|bdt)\.?\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)\s*"
    r"(?:available\s+)?(?:balance|bal)\b",
    re.IGNORECASE,
)
_FEE_PATTERN = re.compile(r"(?:charge|fee)\s*(?:is|:)?\s*(?:(?:tk|bdt)\.?\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE)
_REFERENCE_PATTERN = re.compile(r"\b(?:trxid|trx id|txnid|txn id|ref|reference)\b\s*[:#-]?\s*([a-z0-9-]+)", re.IGNORECASE)
_PROVIDER_TIMESTAMP_PATTERN = re.compile(
    r"\b(?:date|time|on)\b\s*[:#-]?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}(?:\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:am|pm)?)?)",
    re.IGNORECASE,
)
_TILL_COUNTER_PATTERN = re.compile(r"\b(counter|till|terminal|merchant\s+no)\b\s*[:#-]?\s*([a-z0-9-]+)", re.IGNORECASE)
_OTP_SECURITY_PATTERN = re.compile(
    r"\b(?:otp|one[ -]time password|verification code|security code|login code)\b",
    re.IGNORECASE,
)
_TRANSACTION_ACTIVITY_PATTERN = re.compile(
    r"\b(?:debited|credited|deposit(?:ed)?|purchase|withdraw(?:al|n)?|txn|transaction|transfer(?:red)?|payment|paid|cash[ -]?(?:in|out)|sent|received|fee|refund|reversal)\b",
    re.IGNORECASE,
)
_NUMERIC_CONTENT_PATTERN = re.compile(r"\d")


def has_numeric_content(body: str) -> bool:
    return _NUMERIC_CONTENT_PATTERN.search(body) is not None


def find_sender_rule(*, user, sender: str):
    rules = SenderRule.objects.filter(user=user, is_active=True).select_related(
        "account",
        "payment_method",
        "category",
    )

    for rule in rules:
        if _matches_rule(rule=rule, sender=sender):
            return rule
    return None


def parse_raw_message(raw_message):
    sender_rule = find_sender_rule(user=raw_message.user, sender=raw_message.sender)
    provider = _detect_provider(sender_rule=sender_rule, sender=raw_message.sender)
    excluded_kind = classify_message_kind_for_capture(raw_message.body)

    if excluded_kind:
        parsed = _parse_non_transaction_message(
            raw_message=raw_message,
            sender_rule=sender_rule,
            provider=provider,
            message_kind=excluded_kind,
        )
    elif provider == SenderRule.Provider.BKASH:
        parsed = _parse_bkash_message(raw_message=raw_message, sender_rule=sender_rule)
    elif provider in (SenderRule.Provider.EBL, SenderRule.Provider.CITY_BANK):
        parsed = _parse_bank_card_message(
            raw_message=raw_message,
            sender_rule=sender_rule,
            provider=provider,
        )
    elif provider == SenderRule.Provider.PATHAO_PAY:
        parsed = _parse_pathao_pay_message(raw_message=raw_message, sender_rule=sender_rule)
    else:
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

        parsed = {
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

    parsed["category"] = sender_rule.category if sender_rule else None
    if sender_rule and sender_rule.default_transaction_type:
        parsed["transaction_type"] = sender_rule.default_transaction_type
        parsed["parser_notes"] = f"{parsed['parser_notes']} Applied the saved transaction type for this sender."
    return parsed


def classify_message_kind_for_capture(body: str) -> str:
    if _OTP_SECURITY_PATTERN.search(body):
        return ParsedMessageCandidate.MessageKind.OTP_OR_SECURITY

    normalized = _normalize_text(body)
    has_balance_wording = any(
        phrase in normalized
        for phrase in ("available balance", "account balance", "balance is", "balance:")
    )
    if has_balance_wording and not _TRANSACTION_ACTIVITY_PATTERN.search(body):
        return ParsedMessageCandidate.MessageKind.BALANCE_NOTICE

    return ""


def _parse_non_transaction_message(*, raw_message, sender_rule, provider: str, message_kind: str):
    label = "OTP/security" if message_kind == ParsedMessageCandidate.MessageKind.OTP_OR_SECURITY else "balance notice"
    return {
        "account": sender_rule.account if sender_rule else None,
        "amount": None,
        "balance_after": _extract_balance(raw_message.body),
        "confidence": Decimal("0.95"),
        "counterparty_text": "",
        "destination_account": None,
        "destination_payment_method": None,
        "fee_amount": None,
        "message_kind": message_kind,
        "payment_method": sender_rule.payment_method if sender_rule else None,
        "possible_internal_transfer": False,
        "provider": provider,
        "reference": _extract_reference(raw_message.body),
        "parser_name": "non_transaction_classifier",
        "parser_notes": f"Classified as {label} before transaction parsing.",
        "sender_rule": sender_rule,
        "transaction_type": ParsedMessageCandidate.TransactionType.EXPENSE,
    }


def _matches_rule(*, rule: SenderRule, sender: str) -> bool:
    rule_sender = rule.sender.strip()
    incoming_sender = sender.strip()

    if rule.match_type == SenderRule.MatchType.EXACT:
        return incoming_sender.lower() == rule_sender.lower()
    if rule.match_type == SenderRule.MatchType.CONTAINS:
        return (rule.pattern or rule_sender).strip().lower() in incoming_sender.lower()
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

    if _contains_any_phrase(normalized, ("cash in", "cash-in", "add money")):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_IN
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.88") if amount is not None else Decimal("0.60")
        notes.append("Detected bKash cash-in/add-money wording.")
    elif _contains_any_phrase(normalized, ("cash out", "cash-out")):
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
    elif _contains_any_phrase(normalized, ("received", "receive money")):
        message_kind = ParsedMessageCandidate.MessageKind.RECEIVE_MONEY
        transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected bKash receive-money wording.")
    elif _contains_any_phrase(normalized, ("payment", "paid to", "merchant")):
        message_kind = ParsedMessageCandidate.MessageKind.PURCHASE
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected bKash payment/purchase wording.")

    counterparty_text = _extract_counterparty_text(body)
    till_or_counter = _extract_till_or_counter(body)
    provider_timestamp = _extract_provider_timestamp_text(body)
    if till_or_counter:
        notes.append(f"Detected bKash till/counter: {till_or_counter}.")
    if provider_timestamp:
        notes.append(f"Detected provider timestamp: {provider_timestamp}.")
    matched_payment_method = _find_payment_method_hint(
        user=raw_message.user,
        text=counterparty_text or body,
        excluded_account_id=sender_rule.account_id if sender_rule else None,
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
    account = sender_rule.account if sender_rule else None
    payment_method = sender_rule.payment_method if sender_rule else None
    destination_account = None
    destination_payment_method = None

    if sender_rule:
        notes.append(f"Matched sender rule: {sender_rule.name}.")
    else:
        notes.append("No active sender rule matched this bank/card-like message.")

    if _contains_any_phrase(normalized, ("reversed", "reversal", "void")):
        message_kind = ParsedMessageCandidate.MessageKind.REVERSAL
        transaction_type = ParsedMessageCandidate.TransactionType.REFUND
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected bank/card reversal wording.")
    elif _contains_any_phrase(normalized, ("refund", "refunded", "cashback")):
        message_kind = ParsedMessageCandidate.MessageKind.REFUND
        transaction_type = ParsedMessageCandidate.TransactionType.REFUND
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected bank/card refund wording.")
    elif _contains_any_phrase(normalized, ("fee", "charge", "vat")):
        message_kind = ParsedMessageCandidate.MessageKind.FEE
        transaction_type = ParsedMessageCandidate.TransactionType.FEE
        confidence = Decimal("0.80") if amount is not None else Decimal("0.48")
        notes.append("Detected bank/card fee or charge wording.")
    elif _contains_any_phrase(
        normalized,
        ("atm txn", "atm withdrawal", "cash withdrawal", "withdrawal", "withdrawn"),
    ):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_OUT
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.86") if amount is not None else Decimal("0.54")
        notes.append("Detected ATM cash-withdrawal wording.")
    elif _contains_any_phrase(normalized, ("used for", "purchase", "spent", "pos", "at")):
        message_kind = ParsedMessageCandidate.MessageKind.CARD_PURCHASE
        transaction_type = ParsedMessageCandidate.TransactionType.EXPENSE
        confidence = Decimal("0.84") if amount is not None else Decimal("0.52")
        notes.append("Detected bank/card purchase wording.")
    elif _contains_any_phrase(normalized, ("deposit", "deposited")):
        message_kind = ParsedMessageCandidate.MessageKind.BANK_TRANSFER_IN
        transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        confidence = Decimal("0.86") if amount is not None else Decimal("0.54")
        notes.append("Detected bank deposit wording.")
    elif _contains_any_phrase(normalized, ("card payment", "payment received", "bill payment")):
        message_kind = ParsedMessageCandidate.MessageKind.CARD_PAYMENT
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.82") if amount is not None else Decimal("0.50")
        notes.append("Detected card payment wording.")
    elif _contains_any_phrase(
        normalized,
        ("transfer", "transferred", "fund transfer", "debited", "credited"),
    ):
        if _contains_any_phrase(normalized, ("credited", "received")):
            message_kind = ParsedMessageCandidate.MessageKind.BANK_TRANSFER_IN
            transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        else:
            message_kind = ParsedMessageCandidate.MessageKind.BANK_TRANSFER_OUT
            transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
            possible_internal_transfer = True
        confidence = Decimal("0.78") if amount is not None else Decimal("0.48")
        notes.append("Detected bank transfer wording.")

    counterparty_text = _extract_merchant_text(body) or _extract_counterparty_text(body)
    matched_payment_method = _find_payment_method_hint(
        user=raw_message.user,
        text=counterparty_text or body,
        excluded_account_id=sender_rule.account_id if sender_rule else None,
    )
    if matched_payment_method:
        if message_kind == ParsedMessageCandidate.MessageKind.BANK_TRANSFER_IN:
            account = matched_payment_method.account
            payment_method = matched_payment_method
            destination_account = sender_rule.account if sender_rule else None
            destination_payment_method = sender_rule.payment_method if sender_rule else None
            transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
            possible_internal_transfer = True
            confidence = max(confidence, Decimal("0.86"))
            notes.append("Matched bank transfer source payment method from message text.")
        elif message_kind in (
            ParsedMessageCandidate.MessageKind.BANK_TRANSFER_OUT,
            ParsedMessageCandidate.MessageKind.CARD_PAYMENT,
        ):
            destination_account = matched_payment_method.account
            destination_payment_method = matched_payment_method
            transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
            possible_internal_transfer = True
            confidence = max(confidence, Decimal("0.86"))
            notes.append("Matched bank transfer destination payment method from message text.")

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

    if _contains_any_phrase(normalized, ("top up", "top-up", "add money", "cash in")):
        message_kind = ParsedMessageCandidate.MessageKind.CASH_IN
        transaction_type = ParsedMessageCandidate.TransactionType.TRANSFER
        possible_internal_transfer = True
        confidence = Decimal("0.84") if amount is not None else Decimal("0.52")
        notes.append("Detected Pathao Pay top-up/add-money wording.")
    elif _contains_any_phrase(normalized, ("withdraw", "cash out", "cash-out")):
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
    elif _contains_any_phrase(normalized, ("received", "receive money")):
        message_kind = ParsedMessageCandidate.MessageKind.RECEIVE_MONEY
        transaction_type = ParsedMessageCandidate.TransactionType.INCOME
        confidence = Decimal("0.80") if amount is not None else Decimal("0.50")
        notes.append("Detected Pathao Pay receive-money wording.")
    elif _contains_any_phrase(normalized, ("payment", "paid", "purchase")):
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

    decimal_text = next((group for group in match.groups() if group), "")
    try:
        return Decimal(decimal_text.replace(",", ""))
    except (InvalidOperation, ValueError):
        return None


def _extract_counterparty_text(body: str) -> str:
    match = re.search(
        r"\b(?:to|from)\s+(.+?)(?:\s+successful\b|\.| trxid| txnid| ref| balance| fee| charge|$)",
        body,
        flags=re.IGNORECASE,
    )
    if not match:
        return ""
    return match.group(1).strip()[:255]


def _extract_provider_timestamp_text(body: str) -> str:
    match = _PROVIDER_TIMESTAMP_PATTERN.search(body)
    return match.group(1).strip()[:120] if match else ""


def _extract_till_or_counter(body: str) -> str:
    matches = [
        f"{match.group(1).strip()}: {match.group(2).strip()}"
        for match in _TILL_COUNTER_PATTERN.finditer(body)
    ]
    return "; ".join(matches)[:120]


def _extract_merchant_text(body: str) -> str:
    match = re.search(r"\bat\s+(.+?)(?:\s+on\b|\.| ref\b| balance\b| available\b|$)", body, flags=re.IGNORECASE)
    if not match:
        return ""
    return match.group(1).strip()[:255]


def _find_payment_method_hint(*, user, text: str, excluded_account_id=None):
    if not text:
        return None

    normalized_text = _normalize_identifier(text)
    if not normalized_text:
        return None

    payment_methods = PaymentMethod.objects.filter(user=user, is_active=True).select_related("account")
    for payment_method in payment_methods:
        if excluded_account_id and payment_method.account_id == excluded_account_id:
            continue
        identifier = _normalize_identifier(payment_method.identifier)
        if len(identifier) >= 4 and identifier in normalized_text:
            return payment_method
    return None


def _normalize_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _normalize_text(value: str) -> str:
    return " ".join(value.lower().replace("-", " ").split())


def _contains_any_phrase(normalized_text: str, phrases: tuple[str, ...]) -> bool:
    return any(
        re.search(
            rf"(?<!\w){re.escape(_normalize_text(phrase))}(?!\w)",
            normalized_text,
        )
        is not None
        for phrase in phrases
    )
