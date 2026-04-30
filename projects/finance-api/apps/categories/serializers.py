from rest_framework import serializers

from .models import Category


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = (
            "id",
            "name",
            "kind",
            "parent",
            "is_active",
            "display_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_parent(self, parent):
        if parent and parent.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Parent category does not belong to this user.")
        return parent

    def get_fields(self):
        fields = super().get_fields()
        fields["parent"].queryset = Category.objects.filter(
            user=self.context["request"].user,
            is_active=True,
        )
        return fields
