from django.contrib import admin

from .models import ParsedMessageCandidate, RawMessage, SenderRule, SmsCapturePreference, SmsDeviceStatus


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


@admin.register(SmsCapturePreference)
class SmsCapturePreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "excluded_providers", "excluded_message_kinds", "raw_sms_retention_days", "updated_at")
    search_fields = ("user__username", "user__email")


@admin.register(ParsedMessageCandidate)
class ParsedMessageCandidateAdmin(admin.ModelAdmin):
    list_display = (
        "raw_message",
        "status",
        "provider",
        "message_kind",
        "amount",
        "confidence",
        "account",
        "possible_internal_transfer",
        "transaction",
    )
    list_filter = ("status", "provider", "message_kind", "parser_name")
    search_fields = ("raw_message__sender", "raw_message__body", "parser_notes", "user__username")


@admin.register(SmsDeviceStatus)
class SmsDeviceStatusAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "sms_permission_state",
        "background_state",
        "pending_upload_count",
        "failed_upload_count",
        "last_successful_sync_at",
        "last_seen_at",
    )
    list_filter = ("sms_permission_state", "background_state", "platform")
    search_fields = ("user__username", "user__email", "device_id")
