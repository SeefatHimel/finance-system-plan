import uuid

from django.conf import settings
from django.db import models


class AuditLogEntry(models.Model):
    class Action(models.TextChoices):
        CREATED = "created", "Created"
        UPDATED = "updated", "Updated"
        DELETED = "deleted", "Deleted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="audit_log_entries",
    )
    action = models.CharField(max_length=32, choices=Action.choices)
    entity_type = models.CharField(max_length=80)
    entity_id = models.CharField(max_length=80)
    before = models.JSONField(blank=True, null=True)
    after = models.JSONField(blank=True, null=True)
    metadata = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("user", "created_at")),
            models.Index(fields=("user", "entity_type", "entity_id")),
            models.Index(fields=("user", "action")),
        ]

    def __str__(self) -> str:
        return f"{self.created_at} {self.action} {self.entity_type}:{self.entity_id}"
