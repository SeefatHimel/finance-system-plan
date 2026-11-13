"""Explicit, source-bound account review; original extraction stays unchanged."""

import hashlib
import json
import re

from django.core import signing
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from apps.audit_logs.models import AuditLogEntry
from apps.audit_logs.services import create_audit_log
from apps.transactions.transfers import lock_transfer_user

from .models import StatementImport
from .services import ReviewConflict

ACCOUNT_WARNING = (
    "Verify the selected account against the masked statement identifier. "
    "A suffix match is only a hint, not proof of ownership."
)
SALT = "statements.review-reporting-account"
MAX_AGE = 900


def account_context(batch):
    return hashlib.sha256(
        json.dumps(
            {
                "batch": str(batch.pk),
                "file": batch.file_digest,
                "account": str(batch.account_id),
                "account_revision": batch.account.updated_at.isoformat(),
                "profile": batch.profile,
                "currency": batch.currency,
                "hint": batch.account_hint,
                "identity": batch.account_identity,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


def is_verified(batch):
    return bool(
        batch.account_verified_at
        and batch.reviewed_account_fingerprint == account_context(batch)
    )


def verification_summary(batch):
    verified = is_verified(batch)
    digits = re.sub(r"\D", "", batch.account_hint)
    return {
        "id": str(batch.pk),
        "account_name": batch.account.name,
        "account_hint": f"•••• {digits[-4:]}" if digits else "Not reported",
        "profile": batch.profile,
        "verified": verified,
        "verified_at": batch.account_verified_at.isoformat() if verified else None,
        "token": signing.dumps(
            {
                "user": str(batch.user_id),
                "batch": str(batch.pk),
                "context": account_context(batch),
            },
            salt=SALT,
        ),
    }


@transaction.atomic
def verify_account(*, user, token):
    lock_transfer_user(user)
    try:
        selected = signing.loads(token, salt=SALT, max_age=MAX_AGE)
    except signing.BadSignature as error:
        raise ReviewConflict(
            "The account review expired. Refresh the bulk preview."
        ) from error
    if selected.get("user") != str(user.pk):
        raise NotFound("This statement account review is not available.")
    batch = (
        StatementImport.objects.select_for_update(of=("self",))
        .select_related("account")
        .filter(pk=selected.get("batch"), user=user)
        .first()
    )
    if batch is None:
        raise NotFound("This statement is no longer available.")
    if selected.get("context") != account_context(batch):
        raise ReviewConflict(
            "The statement or selected account changed. Refresh and verify it again."
        )
    if not batch.account.is_active or batch.account.currency != batch.currency:
        raise ValidationError(
            "Choose an active reporting account in the statement currency first."
        )
    if not is_verified(batch):
        batch.reviewed_account_fingerprint = account_context(batch)
        batch.account_verified_at = timezone.now()
        batch.save(
            update_fields=("reviewed_account_fingerprint", "account_verified_at")
        )
        create_audit_log(
            user=user,
            action=AuditLogEntry.Action.UPDATED,
            entity=batch,
            after={
                "account": str(batch.account_id),
                "account_confirmed_at": batch.account_verified_at.isoformat(),
            },
            metadata={"decision": "statement_account_review"},
        )
    return verification_summary(batch)
