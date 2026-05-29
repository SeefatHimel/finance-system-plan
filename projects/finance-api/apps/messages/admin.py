from django.contrib import admin

from .models import RawMessage, SenderRule


@admin.register(SenderRule)
class SenderRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "provider", "sender", "account", "priority", "is_active")
    list_filter = ("provider", "match_type", "is_active")
    search_fields = ("name", "sender", "pattern", "account__name", "user__username")


@admin.register(RawMessage)
class RawMessageAdmin(admin.ModelAdmin):
    list_display = ("sender", "received_at", "user", "status", "device_message_id")
    list_filter = ("status", "sender")
    search_fields = ("sender", "body", "device_message_id", "user__username")
    readonly_fields = ("body_hash", "created_at")
