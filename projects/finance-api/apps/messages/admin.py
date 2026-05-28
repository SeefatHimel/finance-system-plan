from django.contrib import admin

from .models import SenderRule


@admin.register(SenderRule)
class SenderRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "provider", "sender", "account", "priority", "is_active")
    list_filter = ("provider", "match_type", "is_active")
    search_fields = ("name", "sender", "pattern", "account__name", "user__username")
