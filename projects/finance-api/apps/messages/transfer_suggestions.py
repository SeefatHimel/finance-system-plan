"""Explainable account hints; suggestions never post or link ledger entries."""

import re

from django.db.models import Q

from apps.accounts.models import Account
from apps.payment_methods.models import PaymentMethod
from apps.payment_methods.resolution import matching_methods, named_methods

from .models import ParsedMessageCandidate, TransferCounterpartyMapping

INCOMING = {"bank_transfer_in", "cash_in", "receive_money"}
TRANSFER_KINDS = INCOMING | {"bank_transfer_out", "card_payment", "send_money"}
PROVIDER_ALIASES = {
    "pathao_pay": ("pathaopay", "pathao pay", "pathao"),
    "bkash": ("bkash", "b kash"),
    "nagad": ("nagad",),
    "rocket": ("rocket",),
    "ebl": ("ebl", "eastern bank"),
    "city_bank": ("city bank", "citybank"),
}


def normalized_name(value):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def counterparty_key(value):
    text = normalized_name(value)
    # Normalize only known provider aliases and their location suffixes. Never
    # collapse an arbitrary person/merchant into a broad provider-wide rule.
    for provider, aliases in PROVIDER_ALIASES.items():
        for alias in aliases:
            if text == alias or text in {f"{alias} dhaka bd", f"{alias} dhaka bangladesh", f"{alias} bd"}:
                return provider
    return text[:255]


def mentioned(text, name):
    name = normalized_name(name)
    return len(name.replace(" ", "")) >= 4 and bool(re.search(rf"(?<!\w){re.escape(name)}(?!\w)", text))


def named_match(text, name):
    if mentioned(text, name):
        return True
    provider = counterparty_key(text)
    return any(mentioned(normalized_name(name), alias) for alias in PROVIDER_ALIASES.get(provider, ()))


def unique_named_account(user, text, reporting_account):
    raw_text = text
    text = normalized_name(text)
    methods = PaymentMethod.objects.filter(user=user, is_active=True, account__is_active=True).exclude(account=reporting_account).select_related("account")
    accounts = {}
    for method in named_methods(raw_text, methods):
        accounts[method.account_id] = method.account
    for account in Account.objects.filter(user=user, is_active=True).exclude(pk=reporting_account.pk):
        if named_match(text, account.name):
            accounts[account.pk] = account
    for method in methods:
        if named_match(text, method.name) or any(mentioned(text, alias) for alias in (*method.aliases, *PROVIDER_ALIASES.get(method.provider, ()))):
            accounts[method.account_id] = method.account
    if len(accounts) == 1:
        return next(iter(accounts.values())), "Matched a saved account/payment-method name or provider alias."
    if len(accounts) > 1:
        return None, "Several saved accounts match this counterparty. Choose the other account."
    return None, ""


def apply_transfer_suggestion(parsed, user, reporting_account, evidence_accounts):
    if parsed["message_kind"] not in TRANSFER_KINDS or not reporting_account or not reporting_account.is_active:
        return
    source, destination, source_method, destination_method = evidence_accounts
    incoming = (parsed["suggested_transfer_direction"] == "credit" if parsed["suggested_transfer_direction"]
                else parsed["message_kind"] in INCOMING)
    other_role = "sender" if incoming else "receiver"
    identifier_matches = matching_methods(user=user, evidence=[
        (kind, parsed.get(f"{other_role}_{kind}_identifier", "")) for kind in ("account", "card")
    ], excluded_account_id=reporting_account.pk)
    if len({method.account_id for method in identifier_matches}) > 1:
        parsed["transfer_suggestion_reason"] = "Several saved accounts match the other account's identifiers. Choose the transfer path manually."
        return
    other = source if incoming and destination else destination if not incoming else None
    if other and other.pk != reporting_account.pk and (not parsed["transfer_suggestion_reason"] or parsed["transfer_suggestion_reason"].startswith("Matched saved payment-method identifiers")):
        # Two identified endpoints are stronger than learned or name-based hints.
        parsed.update(account=source, destination_account=destination, payment_method=source_method, destination_payment_method=destination_method)
        parsed["transfer_suggestion_reason"] = "Matched saved payment-method identifiers. Verify the transfer path."
        return
    key = counterparty_key(parsed["counterparty_text"])
    if not key:
        return
    direction = "credit" if incoming else "debit"
    rule = TransferCounterpartyMapping.objects.filter(
        user=user, sender_rule=parsed["sender_rule"], message_kind=parsed["message_kind"],
        reporting_account=reporting_account, counterparty_key=key,
        other_account__user=user, other_account__is_active=True,
    ).exclude(other_account=reporting_account).select_related("other_account", "category").first()
    reason = ""
    if rule:
        other, direction = rule.other_account, rule.direction
        parsed["category"] = rule.category
        reason = "Matches choices remembered for this reporting account and counterparty."
    else:
        # Existing confirmed records can suggest a path, but conflicting history
        # is never resolved by picking the latest or by amount alone.
        history = ParsedMessageCandidate.objects.filter(
            user=user, sender_rule=parsed["sender_rule"], message_kind=parsed["message_kind"],
            status="confirmed", transaction__user=user, transaction__type="transfer",
        ).filter(Q(transaction__account=reporting_account) | Q(transaction__transfer_account=reporting_account)).select_related(
            "transaction__account", "transaction__transfer_account",
        ).order_by("-updated_at")[:200]
        paths = {}
        for candidate in history:
            record = candidate.transaction
            if counterparty_key(record.counterparty_text or candidate.counterparty_text) != key:
                continue
            candidate_direction = "debit" if record.account_id == reporting_account.pk else "credit"
            account = record.transfer_account if candidate_direction == "debit" else record.account
            if account and account.user_id == user.pk and account.is_active and account.pk != reporting_account.pk:
                paths[(account.pk, candidate_direction)] = account
        if len(paths) == 1:
            (_, direction), other = next(iter(paths.items()))
            reason = "Matches a previously confirmed transfer for this reporting account and counterparty."
        elif len(paths) > 1:
            parsed["transfer_suggestion_reason"] = "Previously confirmed transfers have different paths. Choose the other account."
            return
        else:
            other, reason = unique_named_account(user, parsed["counterparty_text"], reporting_account)
    parsed["transfer_suggestion_reason"] = reason
    if not other:
        return
    reporting_method = destination_method if incoming and destination else source_method
    parsed.update(
        account=other if direction == "credit" else reporting_account,
        destination_account=reporting_account if direction == "credit" else other,
        payment_method=None if direction == "credit" else reporting_method,
        destination_payment_method=reporting_method if direction == "credit" else None,
        transaction_type="transfer", possible_internal_transfer=True,
        suggested_transfer_direction=direction,
    )
    parsed["parser_notes"] += f" {reason}"


def remember_transfer_path(candidate, record, observation):
    key = counterparty_key(observation.get("counterparty_text", candidate.counterparty_text))
    reporting_account = observation.get("account")
    if not candidate.sender_rule_id or not key or not reporting_account:
        return
    direction = observation["direction"]
    other = record.account if direction == "credit" else record.transfer_account
    if not other or other == reporting_account:
        return
    TransferCounterpartyMapping.objects.update_or_create(
        user=candidate.user, sender_rule=candidate.sender_rule, message_kind=candidate.message_kind,
        reporting_account=reporting_account, counterparty_key=key,
        defaults={"direction": direction, "other_account": other, "category": record.category},
    )
    # Apply the same resolver to pending items, including redacted candidates;
    # unrelated counterparties, accounts and explicit endpoints remain untouched.
    pending = ParsedMessageCandidate.objects.filter(
        user=candidate.user, sender_rule=candidate.sender_rule, message_kind=candidate.message_kind, status="needs_review",
    ).select_related("account", "destination_account", "payment_method", "destination_payment_method")
    fields = ("account", "destination_account", "payment_method", "destination_payment_method", "category",
              "transaction_type", "possible_internal_transfer", "suggested_transfer_direction", "transfer_suggestion_reason", "parser_notes")
    for item in pending:
        if counterparty_key(item.counterparty_text) != key:
            continue
        incoming = item.suggested_transfer_direction == "credit" if item.suggested_transfer_direction else item.message_kind in INCOMING
        observed = (item.destination_account or item.account) if incoming else item.account
        if observed != reporting_account:
            continue
        parsed = {field: getattr(item, field) for field in fields}
        parsed.update(message_kind=item.message_kind, sender_rule=item.sender_rule, counterparty_text=item.counterparty_text)
        apply_transfer_suggestion(parsed, item.user, observed, (item.account, item.destination_account, item.payment_method, item.destination_payment_method))
        for field in fields:
            setattr(item, field, parsed[field])
        item.save(update_fields=(*fields, "updated_at"))
