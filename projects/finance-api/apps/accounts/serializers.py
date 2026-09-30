from rest_framework import serializers

from apps.transactions.services import calculate_account_balance_summaries

from .models import Account


class AccountSerializer(serializers.ModelSerializer):
    ledger_balance = serializers.SerializerMethodField()
    latest_reported_balance = serializers.SerializerMethodField()
    latest_reported_balance_date = serializers.SerializerMethodField()

    class Meta:
        model = Account
        fields = (
            "id",
            "name",
            "type",
            "currency",
            "starting_balance",
            "ledger_balance",
            "latest_reported_balance",
            "latest_reported_balance_date",
            "is_active",
            "display_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "ledger_balance",
            "latest_reported_balance",
            "latest_reported_balance_date",
            "created_at",
            "updated_at",
        )

    def _balance_summary(self, account):
        summaries = self.context.setdefault("account_balance_summaries", {})
        if account.id not in summaries:
            summaries.update(calculate_account_balance_summaries(accounts=(account,)))
        return summaries[account.id]

    def get_ledger_balance(self, account):
        return f"{self._balance_summary(account).ledger_balance:.2f}"

    def get_latest_reported_balance(self, account):
        balance = self._balance_summary(account).latest_reported_balance
        return f"{balance:.2f}" if balance is not None else None

    def get_latest_reported_balance_date(self, account):
        reported_date = self._balance_summary(account).latest_reported_balance_date
        return reported_date.isoformat() if reported_date is not None else None
