"""Read-only category defaults and account-scoped Pathao service learning."""

import hashlib
import re

from .models import SenderRule, SenderRuleMapping


def pathao_group(merchant):
    services = set(
        re.findall(
            r"\bpathao[\s·_-]+(car|bike|cng|rides?|food)\b",
            merchant or "",
            re.IGNORECASE,
        )
    )
    groups = {"food" if service.lower() == "food" else "rides" for service in services}
    return next(iter(groups)) if len(groups) == 1 else ""


def pathao_key(group):
    return hashlib.sha256(f"pathao-category-v1:{group}".encode()).hexdigest()


def sms_pathao_group(candidate):
    if candidate.provider != "pathao_pay" or candidate.message_kind != "purchase":
        return ""
    raw = candidate.raw_message
    if raw.status == "redacted" or raw.redacted_at or raw.exclusion_reason:
        return ""
    from .parsers import _extract_counterparty_text

    return pathao_group(_extract_counterparty_text(raw.body))


def compatible(category, kind, user_id):
    if not category or category.user_id != user_id or not category.is_active:
        return False
    allowed = {
        "expense": {"expense", "fee"},
        "income": {"income", "refund"},
        "transfer": {"transfer"},
        "debt": {"lend", "borrow", "repayment_received", "repayment_paid"},
        "system": {kind},
    }
    return kind in allowed.get(category.kind, set())


class CategorySuggestions:
    """One batched lookup per rule family, reused by a candidate serializer page."""

    def __init__(self, user_id):
        from apps.statements.models import StatementMapping

        self.user_id = user_id
        self.general = {
            (mapping.sender_rule_id, mapping.message_kind): mapping
            for mapping in (
                SenderRuleMapping.objects.filter(
                    user_id=user_id,
                    sender_rule__user_id=user_id,
                    sender_rule__is_active=True,
                    account__user_id=user_id,
                    account__is_active=True,
                    category__user_id=user_id,
                    category__is_active=True,
                ).select_related("category")
            )
        }
        self.pathao = {
            (mapping.account_id, mapping.pattern_key): mapping
            for mapping in (
                StatementMapping.objects.filter(
                    user_id=user_id,
                    account__user_id=user_id,
                    account__is_active=True,
                    profile="pathao_pay",
                    type="expense",
                    direction="debit",
                    pattern_key__in=[pathao_key("rides"), pathao_key("food")],
                    other_account__isnull=True,
                    category__user_id=user_id,
                    category__is_active=True,
                ).select_related("category")
            )
        }
        self.pathao_rules = (
            dict(
                SenderRule.objects.filter(
                    user_id=user_id, is_active=True, provider="pathao_pay"
                ).values_list("pk", "account_id")
            )
            if self.pathao
            else {}
        )

    def category(self, candidate):
        if candidate.user_id != self.user_id:
            return None
        if candidate.status != "needs_review":
            return (
                candidate.category
                if compatible(
                    candidate.category, candidate.transaction_type, self.user_id
                )
                else None
            )
        if (
            not candidate.account_id
            or not candidate.account.is_active
            or candidate.account.user_id != self.user_id
        ):
            return None
        if candidate.provider == "pathao_pay" and candidate.message_kind == "purchase":
            # A retired sender-wide purchase rule cannot distinguish rides from Food.
            group = sms_pathao_group(candidate)
            if self.pathao_rules.get(candidate.sender_rule_id) != candidate.account_id:
                return None
            mapping = (
                self.pathao.get((candidate.account_id, pathao_key(group)))
                if group
                else None
            )
            return (
                mapping.category
                if mapping
                and candidate.transaction_type == "expense"
                and compatible(mapping.category, "expense", self.user_id)
                else None
            )
        mapping = self.general.get((candidate.sender_rule_id, candidate.message_kind))
        if (
            mapping
            and mapping.account_id == candidate.account_id
            and mapping.transaction_type == candidate.transaction_type
            and compatible(mapping.category, candidate.transaction_type, self.user_id)
        ):
            return mapping.category
        return (
            candidate.category
            if compatible(candidate.category, candidate.transaction_type, self.user_id)
            else None
        )


def remember_pathao_category(candidate, record, *, replace=False):
    """Reuse statement mappings so SMS and PDF review share the same saved category."""
    from rest_framework.exceptions import ValidationError

    from apps.statements.models import StatementMapping

    group = sms_pathao_group(candidate)
    if (
        not group
        or not candidate.sender_rule
        or not candidate.sender_rule.is_active
        or candidate.sender_rule.provider != "pathao_pay"
        or candidate.sender_rule.user_id != candidate.user_id
        or candidate.sender_rule.account_id != record.account_id
        or candidate.account_id != record.account_id
        or record.user_id != candidate.user_id
        or record.type != "expense"
        or record.direction != "debit"
        or candidate.source_direction != "debit"
        or not record.account.is_active
        or not compatible(record.category, "expense", candidate.user_id)
    ):
        raise ValidationError(
            {
                "detail": "A Pathao category needs a verified ride or Food payment, its active reporting account, and a compatible category."
            }
        )
    existing = (
        StatementMapping.objects.select_for_update()
        .filter(
            user_id=candidate.user_id,
            account_id=record.account_id,
            profile="pathao_pay",
            pattern_key=pathao_key(group),
        )
        .first()
    )
    if existing and existing.category_id != record.category_id and not replace:
        return False
    StatementMapping.objects.update_or_create(
        user_id=candidate.user_id,
        account_id=record.account_id,
        profile="pathao_pay",
        pattern_key=pathao_key(group),
        defaults={
            "pattern_label": f"Pathao {group}",
            "type": "expense",
            "direction": "debit",
            "category": record.category,
            "other_account": None,
            "note_template": "",
        },
    )
    return True
