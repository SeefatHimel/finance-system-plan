"""User-scoped ledger search shared by list and CSV export."""

import re
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Case, CharField, Exists, OuterRef, Q, Value, When
from django.db.models.functions import Cast, Replace, TruncSecond
from django.utils.text import smart_split, unescape_string_literal
from rest_framework.exceptions import ValidationError

from .models import Transaction, TransferEvidence


SEARCH_DESCRIPTION = (
    "Search all ledger fields: account/category/payment-method names, currency, "
    "type, direction, source, amount, reported balance, ISO dates/times, review "
    "status, identifiers, reference, counterparty, note, IDs and external keys, "
    "including linked transfer evidence. Case-insensitive partial matches; every "
    "space-separated term must match somewhere. Quote phrases to keep them together. "
    "Formatted amounts accept thousands separators. Existing filters still apply. "
    "IDs accept full values or hexadecimal fragments of at least 8 characters. "
    "Maximum 256 characters and 12 terms. Raw SMS bodies are not searched."
)

LEDGER_TEXT_FIELDS = (
    "reference", "counterparty_text", "note", "external_key", "type", "direction", "source",
    "sender_account_identifier", "sender_card_identifier",
    "receiver_account_identifier", "receiver_card_identifier",
    "account__name", "account__type", "account__currency",
    "transfer_account__name", "transfer_account__type", "transfer_account__currency",
    "category__name", "category__kind", "category__parent__name",
    "payment_method__name", "payment_method__provider", "payment_method__identifier",
    "account__identity_method__name", "account__identity_method__provider",
    "account__identity_method__identifier",
    "transfer_account__identity_method__name", "transfer_account__identity_method__provider",
    "transfer_account__identity_method__identifier",
)
EVIDENCE_TEXT_FIELDS = (
    "reference", "note", "external_key", "provider", "source", "direction",
    "account__name", "account__type", "account__currency",
)
LEDGER_IDS = ("id", "account_id", "transfer_account_id", "category_id", "payment_method_id", "raw_message_id")
EVIDENCE_IDS = ("id", "account_id", "raw_message_id")


def searchable_values(queryset, scalar_fields, id_fields, timestamp_fields=()):
    aliases = {f"search_{field}": Cast(field, CharField()) for field in scalar_fields}
    # UUID storage differs between PostgreSQL and SQLite; normalize both to hex.
    aliases.update({
        f"search_{field}": Replace(Cast(field, CharField()), Value("-"), Value(""))
        for field in id_fields
    })
    aliases.update({
        f"search_{field}": Cast(TruncSecond(field, tzinfo=ZoneInfo("Asia/Dhaka")), CharField())
        for field in timestamp_fields
    })
    return queryset.alias(**aliases), tuple(aliases)


def term_filter(term, text_fields, aliases, id_fields, numeric_fields):
    normalized = term
    number = None
    if re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", term):
        normalized = term.replace(",", "")
        number = Decimal(normalized)
    hex_term = term.replace("-", "")
    is_id = bool(re.fullmatch(r"[a-fA-F0-9-]+", term)) and len(hex_term) >= 8
    predicate = Q()
    for field in text_fields:
        predicate |= Q(**{f"{field}__icontains": term})
        if " " in term and (field in {"type", "direction", "source", "provider"}
                            or field.endswith(("__type", "__provider", "__kind"))):
            predicate |= Q(**{f"{field}__icontains": "_".join(term.split())})
    for field in aliases:
        if field in id_fields:
            if is_id:
                predicate |= Q(**{f"{field}__icontains": hex_term})
        else:
            predicate |= Q(**{f"{field}__icontains": normalized})
    if number is not None:
        for field in numeric_fields:
            predicate |= Q(**{field: number})
    return predicate


def filter_transaction_search(queryset, query, *, user):
    query = (query or "").replace("\x00", "").strip()
    if not query:
        return queryset
    if len(query) > 1600:
        raise ValidationError({"search": "Search is too long."})
    # Report drill-through must match the contributing merchant, not notes or IDs.
    if query.startswith('merchant:'):
        merchant = query[len('merchant:'):]
        if len(merchant) >= 2 and merchant[0] == merchant[-1] == '"':
            import json
            try:
                merchant = json.loads(merchant)
            except ValueError as exc:
                raise ValidationError({"search": "Use a quoted merchant name."}) from exc
        if not isinstance(merchant, str) or len(merchant) > 255:
            raise ValidationError({"search": "Use a merchant name."})
        from django.db.models.functions import Trim
        return queryset.alias(merchant_trimmed=Trim("counterparty_text")).filter(merchant_trimmed__iexact=merchant.strip())
    if len(query) > 256:
        raise ValidationError({"search": "Use at most 256 characters."})
    terms = [unescape_string_literal(term) if term[:1] in {"'", '"'} and term[-1:] == term[:1]
             else term for term in smart_split(query)]
    terms = [term for term in terms if term]
    if not terms:
        return queryset
    if len(terms) > 12:
        raise ValidationError({"search": "Use at most 12 search terms."})

    queryset, ledger_aliases = searchable_values(
        queryset, ("amount", "balance_after", "date", "time"), LEDGER_IDS,
        ("created_at", "updated_at"),
    )
    queryset = queryset.alias(search_review=Case(
        When(needs_review=True, then=Value("needs review true yes")),
        default=Value("reviewed false no"), output_field=CharField(),
    ), search_category_state=Case(
        When(category__isnull=True, then=Value("Uncategorized")),
        default=Value(""), output_field=CharField(),
    ))
    evidence, evidence_aliases = searchable_values(
        TransferEvidence.objects.filter(user=user, transaction_id=OuterRef("pk")),
        ("balance_after", "fee_amount", "date", "time"), EVIDENCE_IDS, ("created_at",),
    )
    for index, term in enumerate(terms):
        ledger = term_filter(term, LEDGER_TEXT_FIELDS, (*ledger_aliases, "search_review", "search_category_state"),
                             {f"search_{field}" for field in LEDGER_IDS}, ("amount", "balance_after"))
        linked = term_filter(term, EVIDENCE_TEXT_FIELDS, evidence_aliases,
                             {f"search_{field}" for field in EVIDENCE_IDS}, ("balance_after", "fee_amount"))
        # EXISTS keeps multi-observation transfers as one ledger row and avoids
        # multiplying joins when terms match different account observations.
        alias = f"search_evidence_{index}"
        queryset = queryset.alias(**{alias: Exists(evidence.filter(linked))}).filter(ledger | Q(**{alias: True}))
    return queryset
