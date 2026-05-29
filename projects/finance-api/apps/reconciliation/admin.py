from django.contrib import admin

from .models import BalanceSnapshot


@admin.register(BalanceSnapshot)
class BalanceSnapshotAdmin(admin.ModelAdmin):
    list_display = ("account", "checked_at", "actual_balance", "expected_balance", "difference", "status")
    list_filter = ("status", "checked_at")
    search_fields = ("account__name", "note", "user__username")
