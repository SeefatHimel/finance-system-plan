from django.contrib import admin

from .models import Account


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "currency", "user", "is_active", "display_order")
    list_filter = ("type", "currency", "is_active")
    search_fields = ("name", "user__email", "user__username")

