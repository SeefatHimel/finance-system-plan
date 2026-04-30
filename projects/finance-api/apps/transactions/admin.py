from django.contrib import admin

from .models import Transaction


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("date", "type", "amount", "account", "category", "user", "source")
    list_filter = ("type", "source", "date")
    search_fields = ("note", "account__name", "category__name", "user__email")

