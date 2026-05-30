from django.contrib import admin

from .models import RecurringBill, RecurringBillPayment


@admin.register(RecurringBill)
class RecurringBillAdmin(admin.ModelAdmin):
    list_display = ("name", "amount", "frequency", "next_due_date", "status")
    list_filter = ("frequency", "status", "next_due_date")
    search_fields = ("name", "note")


@admin.register(RecurringBillPayment)
class RecurringBillPaymentAdmin(admin.ModelAdmin):
    list_display = ("bill", "amount", "due_date", "paid_at")
    list_filter = ("paid_at", "due_date")
    search_fields = ("bill__name", "note")
