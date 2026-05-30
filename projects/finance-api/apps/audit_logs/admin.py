from django.contrib import admin

from .models import AuditLogEntry


@admin.register(AuditLogEntry)
class AuditLogEntryAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "action", "entity_type", "entity_id")
    list_filter = ("action", "entity_type", "created_at")
    search_fields = ("entity_id", "entity_type", "user__username")
    readonly_fields = (
        "id",
        "user",
        "action",
        "entity_type",
        "entity_id",
        "before",
        "after",
        "metadata",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
