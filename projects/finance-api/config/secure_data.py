"""Encrypt retained financial source material before it reaches the database."""

import base64
import hashlib

from cryptography.fernet import Fernet, MultiFernet
from django.conf import settings
from django.db import models

SMS_PREFIX = "finance-sms-v1:"
STATEMENT_CODE_PREFIX = "finance-statement-code-v1:"


def _cipher():
    # Domain separation keeps archive encryption independent of Django signing.
    secrets = [settings.SECRET_KEY, *settings.SECRET_KEY_FALLBACKS]
    return MultiFernet(
        [
            Fernet(
                base64.urlsafe_b64encode(
                    hashlib.sha256(b"finance-source-v1\0" + secret.encode()).digest()
                )
            )
            for secret in secrets
        ]
    )


def encrypt_bytes(value):
    return _cipher().encrypt(value)


def decrypt_bytes(value):
    return _cipher().decrypt(bytes(value))


class EncryptedSmsTextField(models.TextField):
    """Encrypt SMS bodies at the ORM boundary; legacy plaintext stays readable during migration."""

    def from_db_value(self, value, expression, connection):
        if value is None or not value.startswith(SMS_PREFIX):
            return value
        return decrypt_bytes(value[len(SMS_PREFIX):].encode("ascii")).decode("utf-8")

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None:
            return None
        return SMS_PREFIX + encrypt_bytes(value.encode("utf-8")).decode("ascii")


class EncryptedStatementCodeField(models.TextField):
    """Encrypt separately retained printed statement codes at the ORM boundary."""

    def from_db_value(self, value, expression, connection):
        if not value or not value.startswith(STATEMENT_CODE_PREFIX):
            return value
        return decrypt_bytes(value[len(STATEMENT_CODE_PREFIX):].encode("ascii")).decode("utf-8")

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if not value:
            return value
        return STATEMENT_CODE_PREFIX + encrypt_bytes(value.encode("utf-8")).decode("ascii")
