"""Read-only short-suffix choices; never learn or select an account from three digits."""

from decimal import Decimal

from apps.payment_methods.models import PaymentMethod
from apps.payment_methods.resolution import (
    identifier_suffix,
    matching_methods,
    unique_method,
)

INCOMING = {"bank_transfer_in", "cash_in", "receive_money"}


def reporting_role(candidate):
    get = (
        candidate.get
        if isinstance(candidate, dict)
        else lambda key, default=None: getattr(candidate, key, default)
    )
    direction = get("suggested_transfer_direction", "")
    return (
        "receiver"
        if direction == "credit" or (not direction and get("message_kind") in INCOMING)
        else "sender"
    )


def short_identity_suggestions(candidate, *, user, methods=None):
    get = (
        candidate.get
        if isinstance(candidate, dict)
        else lambda key, default=None: getattr(candidate, key, default)
    )
    if not any(
        get(f"{role}_{kind}_identifier", "")
        for role in ("sender", "receiver")
        for kind in ("account", "card")
    ):
        return []
    methods = list(
        methods
        if methods is not None
        else PaymentMethod.objects.filter(
            user=user, is_active=True, account__is_active=True
        ).select_related("account")
    )
    result = []
    for role in ("sender", "receiver"):
        evidence = [
            (kind, get(f"{role}_{kind}_identifier", "")) for kind in ("account", "card")
        ]
        provider = get("provider", "") if role == reporting_role(candidate) else ""
        kwargs = {
            "user": user,
            "evidence": evidence,
            "provider": provider,
            "methods": methods,
        }
        matches = matching_methods(**kwargs)
        if unique_method(**kwargs):
            continue
        short = any(
            len(identifier_suffix(value)) == 3 for _, value in evidence if value
        )
        if not short:
            from apps.payment_methods.resolution import identifier_score, identifiers

            short = any(
                identifier_score(saved["value"], value) == 10
                for method in matches
                for saved in identifiers(method)
                for kind, value in evidence
                if saved["kind"] in {"any", kind}
            )
        if not short:
            continue
        choices = []
        seen = set()
        for method in matches:
            if method.pk in seen:
                continue
            seen.add(method.pk)
            choices.append(
                {
                    "account": str(method.account_id),
                    "name": method.account.name,
                    "payment_method": str(method.pk),
                    "method_name": method.name,
                    "provider": method.provider,
                }
            )
        result.append(
            {
                "role": role,
                "reason": (
                    "Only three ending digits overlap. This is a weak match; choose the account after checking the SMS."
                    if choices
                    else "The SMS shows only three ending digits. No compatible saved identifier was found; choose the account after checking the SMS."
                ),
                "observed_identifiers": [value for _, value in evidence if value],
                "choices": choices,
            }
        )
    return result


def require_short_identity_review(parsed, user):
    for hint in short_identity_suggestions(parsed, user=user):
        # Incoming reports may store the receiver in account until both endpoints
        # are known; outgoing reports always store it in destination_account.
        if hint["role"] == "receiver" and reporting_role(parsed) == "receiver":
            parsed["account"] = None
            parsed["payment_method"] = None
            parsed["destination_account"] = None
            parsed["destination_payment_method"] = None
        elif not (
            hint["role"] == "sender"
            and reporting_role(parsed) == "receiver"
            and not parsed.get("destination_account")
        ):
            # With only the incoming receiver identified, account holds that
            # receiver. An unresolved sender must not clear the strong receiver.
            field = "account" if hint["role"] == "sender" else "destination_account"
            method = (
                "payment_method"
                if hint["role"] == "sender"
                else "destination_payment_method"
            )
            parsed[field] = None
            parsed[method] = None
        parsed["transfer_suggestion_reason"] = hint["reason"]
        parsed["confidence"] = min(parsed["confidence"], Decimal("0.60"))
        parsed["parser_notes"] += " " + hint["reason"]


def validate_short_identity_choices(candidate, payload):
    """Require explicit account choices even for candidates parsed by older versions."""
    from rest_framework.exceptions import ValidationError

    hints = short_identity_suggestions(candidate, user=candidate.user_id)
    if not hints:
        return
    is_transfer = payload.get("type", candidate.transaction_type) == "transfer"
    direction = payload.get(
        "direction", "credit" if reporting_role(candidate) == "receiver" else "debit"
    )
    role = "receiver" if direction == "credit" else "sender"
    for hint in hints:
        field = "account" if hint["role"] == role else "transfer_account"
        if field == "transfer_account" and not is_transfer:
            continue
        if not payload.get(field):
            raise ValidationError(
                {
                    field: "Choose this account explicitly; a three-digit suffix is only a weak hint."
                }
            )
        if is_transfer and not payload.get("account_perspective"):
            raise ValidationError(
                {
                    "account_perspective": "Review short identifiers using the selected account's debit/credit perspective."
                }
            )
