from rest_framework import serializers

from .models import Account


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = (
            "id",
            "name",
            "type",
            "currency",
            "starting_balance",
            "is_active",
            "display_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

