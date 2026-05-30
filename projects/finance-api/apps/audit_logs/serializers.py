from rest_framework import serializers

from .models import AuditLogEntry


class AuditLogEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLogEntry
        fields = (
            "id",
            "action",
            "entity_type",
            "entity_id",
            "before",
            "after",
            "metadata",
            "created_at",
        )
        read_only_fields = fields
