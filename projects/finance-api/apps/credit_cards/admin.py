from django.contrib import admin

from .models import CreditCardBill, CreditCardPayment


@admin.register(CreditCardBill)
class CreditCardBillAdmin(admin.ModelAdmin):
    list_display = ("account", "statement_balance", "remaining_balance", "due_date", "status")
    list_filter = ("status", "due_date")
    search_fields = ("account__name", "reference", "note")


@admin.register(CreditCardPayment)
class CreditCardPaymentAdmin(admin.ModelAdmin):
    list_display = ("bill", "amount", "paid_at")
    list_filter = ("paid_at",)
    search_fields = ("bill__account__name", "note")
