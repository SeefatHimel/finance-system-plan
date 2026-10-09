from rest_framework import serializers

from apps.accounts.models import Account
from apps.messages.identifiers import sanitize_financial_identifier

from .models import PaymentMethod


class AdditionalIdentifierSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=("account", "card"))
    value = serializers.CharField(max_length=120)
    label = serializers.CharField(
        max_length=80, required=False, allow_blank=True, default=""
    )

    def validate_value(self, value):
        safe = sanitize_financial_identifier(value)
        if not safe:
            raise serializers.ValidationError(
                "Enter a masked identifier or at least four digits."
            )
        return safe


class PaymentMethodSerializer(serializers.ModelSerializer):
    additional_identifiers = AdditionalIdentifierSerializer(many=True, required=False)
    aliases = serializers.ListField(
        child=serializers.CharField(max_length=80), max_length=20, required=False
    )

    class Meta:
        model = PaymentMethod
        fields = (
            "id",
            "account",
            "name",
            "provider",
            "identifier",
            "identifier_kind",
            "additional_identifiers",
            "aliases",
            "is_active",
            "display_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_account(self, account):
        if account.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Account does not belong to this user.")
        if self.instance and account.pk != self.instance.account_id:
            if Account.objects.filter(identity_method=self.instance).exists():
                raise serializers.ValidationError(
                    "This is an account's recognition profile. Edit its identifiers in Accounts; it cannot be moved to another account."
                )
        return account

    def validate_identifier(self, identifier):
        return sanitize_financial_identifier(identifier)

    def validate_additional_identifiers(self, values):
        if len(values) > 20:
            raise serializers.ValidationError("Save at most 20 additional identifiers.")
        keys = [(v["kind"], v["value"].casefold()) for v in values]
        if len(keys) != len(set(keys)):
            raise serializers.ValidationError(
                "Remove duplicate identifiers of the same kind."
            )
        # Nested PATCH skips serializer defaults; response labels must still
        # satisfy the same contract as GET/create responses.
        return [{"label": "", **value} for value in values]

    def validate_aliases(self, values):
        if any(len(v.strip()) < 4 or v.strip().isdigit() for v in values):
            raise serializers.ValidationError(
                "Aliases need at least four characters and cannot be only numbers. Save numbers as identifiers."
            )
        return list(dict.fromkeys(v.strip() for v in values))

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            fields["account"].queryset = Account.objects.none()
            return fields
        fields["account"].queryset = Account.objects.filter(
            user=self.context["request"].user,
            is_active=True,
        )
        return fields


class AccountIdentitySerializer(PaymentMethodSerializer):
    """One shared matching registry; the parent account supplies ownership."""

    class Meta(PaymentMethodSerializer.Meta):
        fields = (
            "id",
            "provider",
            "identifier",
            "identifier_kind",
            "additional_identifiers",
            "aliases",
            "is_active",
        )
        read_only_fields = ("id", "is_active")

    def get_fields(self):
        return serializers.ModelSerializer.get_fields(self)

    def validate_identifier(self, value):
        safe = super().validate_identifier(value)
        if value and not safe:
            raise serializers.ValidationError(
                "Enter a masked identifier or at least four digits."
            )
        return safe
