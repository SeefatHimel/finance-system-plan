from django.contrib import admin

from .models import ParsedMessageCandidate, RawMessage, SenderRule


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
