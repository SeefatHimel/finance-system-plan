"""Encrypted immutable input and canonical fingerprints."""

import json
from hashlib import sha256
from config.secure_data import decrypt_bytes
from .parsing import table


def digest(value):
    return sha256(
        json.dumps(value, sort_keys=True, default=str, ensure_ascii=False).encode()
    ).hexdigest()


def original_table(batch):
    return table(decrypt_bytes(batch.original).decode("utf-8"))


def json_values(value):
    return json.loads(json.dumps(value, default=str))
