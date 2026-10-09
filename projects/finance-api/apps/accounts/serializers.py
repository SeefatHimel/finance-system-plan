from django.db import transaction
from rest_framework import serializers

from apps.payment_methods.models import PaymentMethod
from apps.payment_methods.serializers import AccountIdentitySerializer
from apps.transactions.services import calculate_account_balance_summaries

from .models import Account


class AccountSerializer(serializers.ModelSerializer):
    identity = AccountIdentitySerializer(
        source="identity_method", required=False, allow_null=True
    )
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
            "identity",
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

    def validate(self, attrs):
        identity = attrs.get("identity_method", serializers.empty)
        if identity is not serializers.empty and identity is not None:
            method = self.instance.identity_method if self.instance else None
            if method is None:
                account_type = attrs.get(
                    "type", self.instance.type if self.instance else None
                )
                identity.setdefault(
                    "identifier_kind",
                    "card" if account_type == Account.Type.CREDIT_CARD else "account",
                )
            if method is None and not identity.get("provider"):
                raise serializers.ValidationError(
                    {"identity": {"provider": "Choose the bank or wallet provider."}}
                )
            if not any(
                identity.get(key, getattr(method, key, None))
                for key in ("identifier", "additional_identifiers", "aliases")
            ):
                raise serializers.ValidationError(
                    {
                        "identity": "Add an account/card identifier or a text alias, or disable recognition."
                    }
                )
        return attrs

    def _save_identity(self, account, values):
        if values is serializers.empty:
            return
        method = account.identity_method
        if values is None:
            if method:
                method.is_active = False
                method.save(update_fields=("is_active", "updated_at"))
            return
        if method is None:
            method = PaymentMethod.objects.create(
                user=account.user,
                account=account,
                name=f"{account.name[:68]} identifiers ({account.pk})",
                is_active=True,
                **values,
            )
            account.identity_method = method
            account.save(update_fields=("identity_method", "updated_at"))
        else:
            for field, value in values.items():
                setattr(method, field, value)
            method.is_active = True
            method.save()

    @transaction.atomic
    def create(self, validated_data):
        identity = validated_data.pop("identity_method", serializers.empty)
        account = super().create(validated_data)
        self._save_identity(account, identity)
        return account

    @transaction.atomic
    def update(self, instance, validated_data):
        # Serialize concurrent profile creation/update for this account.
        instance = Account.objects.select_for_update().get(pk=instance.pk)
        identity = validated_data.pop("identity_method", serializers.empty)
        account = super().update(instance, validated_data)
        self._save_identity(account, identity)
        return account

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
