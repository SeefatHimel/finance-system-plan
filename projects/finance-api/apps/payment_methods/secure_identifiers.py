"""Keep exact identifiers encrypted while normal API responses remain masked."""

import json

from apps.messages.identifiers import sanitize_financial_identifier
from config.secure_data import decrypt_bytes, encrypt_bytes


def originals_for(method):
    if not method.encrypted_identifiers:
        return {"identifier": "", "additional_identifiers": []}
    return json.loads(decrypt_bytes(method.encrypted_identifiers).decode("utf-8"))


def retain_originals(method, raw):
    """Update only supplied identifier fields, preserving originals on a partial edit."""
    if "identifier" not in raw and "additional_identifiers" not in raw:
        return
    originals = originals_for(method)
    changed = False
    if "identifier" in raw:
        incoming = str(raw["identifier"]).strip()
        if incoming != method.identifier or not originals["identifier"]:
            originals["identifier"] = incoming
        changed = True
    if "additional_identifiers" in raw:
        previous = originals["additional_identifiers"]
        retained = []
        for item in raw["additional_identifiers"]:
            value = str(item["value"]).strip()
            preserved = next(
                (
                    old["value"] for old in previous
                    if old["kind"] == item["kind"]
                    and value == sanitize_financial_identifier(old["value"])
                ),
                None,
            )
            if preserved is not None:
                value = preserved
            retained.append({"kind": str(item["kind"]), "value": value, "label": str(item.get("label", ""))})
        originals["additional_identifiers"] = retained
        changed = True
    if changed:
        method.encrypted_identifiers = encrypt_bytes(json.dumps(originals).encode("utf-8"))
        method.save(update_fields=("encrypted_identifiers", "updated_at"))
