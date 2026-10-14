from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Account
from apps.categories.models import Category
from apps.transactions.serializers import TransactionActionSerializer

from .models import QuickAddPreset


def compatible(category, transaction_type):
    return category is None or category.kind in (transaction_type, Category.Kind.SYSTEM)


class OwnedChoicesMixin:
    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        user_id = request.user.pk if request and request.user.is_authenticated else None
        fields["account"].queryset = Account.objects.filter(user_id=user_id)
        fields["category"].queryset = Category.objects.filter(user_id=user_id)
        return fields


class QuickAddPresetSerializer(OwnedChoicesMixin, serializers.ModelSerializer):
    note = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")
    available = serializers.SerializerMethodField()

    def get_available(self, obj) -> bool:
        return (obj.account is None or obj.account.is_active) and (obj.category is None or obj.category.is_active) and compatible(obj.category, obj.type)

    def validate(self, attrs):
        for field in ("account", "category"):
            value = attrs.get(field)
            if value is not None and not value.is_active:
                raise serializers.ValidationError({field: "Choose an active option."})
        category = attrs.get("category", getattr(self.instance, "category", None))
        kind = attrs.get("type", getattr(self.instance, "type", "expense"))
        if not compatible(category, kind):
            raise serializers.ValidationError({"category": "Choose a category compatible with the preset type."})
        return attrs

    class Meta:
        model = QuickAddPreset
        fields = ("id", "name", "type", "account", "category", "amount", "counterparty_text", "note", "is_enabled", "is_favorite", "display_order", "available")
        read_only_fields = ("id", "available")


class QuickEntrySerializer(serializers.Serializer):
    client_request_id = serializers.UUIDField()
    # Resolve ownership after checking a receipt so a deleted reference cannot
    # make a previously committed entry appear unsaved.
    account = serializers.UUIDField()
    category = serializers.UUIDField(allow_null=True, required=False, default=None)
    type = serializers.ChoiceField(choices=QuickAddPreset.Type.choices, default="expense")
    source = serializers.ChoiceField(choices=("web", "mobile"))
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    date = serializers.DateField()
    time = serializers.TimeField(allow_null=True, required=False, default=None)
    counterparty_text = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    note = serializers.CharField(max_length=2000, allow_blank=True, required=False, default="")


class QuickEntryResultSerializer(serializers.Serializer):
    undo_action = TransactionActionSerializer(read_only=True, required=False, allow_null=True)
    transaction = serializers.UUIDField()
    replayed = serializers.BooleanField()


class PresetOrderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField())
