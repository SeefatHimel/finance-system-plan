"""Enforce new monetary writes without rewriting or scanning historical rows."""

from django.db import migrations, models


class AddStagedCheck(migrations.AddConstraint):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor == "postgresql":
            model = to_state.apps.get_model(app_label, self.model_name)
            schema_editor.execute(
                str(self.constraint.create_sql(model, schema_editor)) + " NOT VALID"
            )
        else:
            super().database_forwards(app_label, schema_editor, from_state, to_state)


class Migration(migrations.Migration):
    dependencies = [("transactions", "0010_timelinebalanceallocation")]
    operations = [
        AddStagedCheck(
            model_name="transaction",
            constraint=models.CheckConstraint(
                condition=models.Q(amount__gt=0), name="ledger_amount_positive"
            ),
        ),
        AddStagedCheck(
            model_name="transaction",
            constraint=models.CheckConstraint(
                condition=models.Q(transfer_account__isnull=True)
                | ~models.Q(account=models.F("transfer_account")),
                name="ledger_distinct_accounts",
            ),
        ),
    ]
