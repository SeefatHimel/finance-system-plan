from django.contrib import admin

from .models import Debt, DebtPayment


@admin.register(Debt)
class DebtAdmin(admin.ModelAdmin):
    list_display = ("counterparty_name", "direction", "principal_amount", "current_balance", "status", "opened_at")
    list_filter = ("direction", "status", "opened_at")
    search_fields = ("counterparty_name", "note", "user__username")


@admin.register(DebtPayment)
class DebtPaymentAdmin(admin.ModelAdmin):
    list_display = ("debt", "amount", "paid_at", "transaction")
    list_filter = ("paid_at",)
    search_fields = ("debt__counterparty_name", "note", "user__username")
