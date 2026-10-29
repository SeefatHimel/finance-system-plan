"""Retire EBL own-card rules only; preserve all source and financial decisions."""
import hashlib
import re

from django.db import migrations
from django.db.models import F


KEYWORDS = ("salary", "patapay", "bkash")
RECIPIENT_CODE = re.compile(r"^ebl:bkash:phone:01[3-9]\d{8}$")


def stored_key(account_id, code):
    return hashlib.sha256(f"ebl_bank\0{account_id}\0{code}".encode()).hexdigest()


def retire_own_card_clues(apps, schema_editor):
    alias = schema_editor.connection.alias
    Row = apps.get_model("statements", "StatementRow")
    Mapping = apps.get_model("statements", "StatementCounterpartyCode")
    Skip = apps.get_model("statements", "StatementIdentifierSkip")
    rules = Mapping.objects.using(alias).filter(profile="ebl_bank")
    skips = Skip.objects.using(alias).filter(profile="ebl_bank")
    accounts = set(rules.values_list("account_id", flat=True)) | set(skips.values_list("account_id", flat=True))
    # Preserve supported wording rules even if the API reached a user before
    # this migration during a partial rollout. Stored mapping keys are digests.
    allowed = {(account, stored_key(account, f"ebl:keyword:{word}"))
               for account in accounts for word in KEYWORDS}
    retired_ids = []
    # source_code is encrypted: inspect through the field's decoder, not SQL LIKE.
    rows = Row.objects.using(alias).filter(batch__profile="ebl_bank").values_list("pk", "batch__account_id", "source_code")
    for row_id, account_id, code in rows.iterator():
        if (code or "").startswith(("npsb:masked:", "npsb:code:")):
            retired_ids.append(row_id)
        elif RECIPIENT_CODE.fullmatch(code or ""):
            allowed.add((account_id, stored_key(account_id, code)))
    for offset in range(0, len(retired_ids), 500):
        Row.objects.using(alias).filter(pk__in=retired_ids[offset:offset + 500]).update(source_code="", version=F("version") + 1)
    for records in (rules, skips):
        retired = [pk for pk, account, code in records.values_list("pk", "account_id", "code").iterator()
                   if (account, code) not in allowed]
        for offset in range(0, len(retired), 500):
            records.filter(pk__in=retired[offset:offset + 500]).delete()


class Migration(migrations.Migration):
    dependencies = [("statements", "0013_verified_ebl_mask_mapping")]
    operations = [migrations.RunPython(retire_own_card_clues, migrations.RunPython.noop)]
