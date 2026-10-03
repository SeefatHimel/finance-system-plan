from django.contrib import admin

from .models import Transaction


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "date",
        "time",
        "type",
        "direction",
        "amount",
        "account",
        "reference",
        "source",
        "user",
    )
    list_filter = ("type", "direction", "source", "date")
    search_fields = (
        "note",
        "reference",
        "counterparty_text",
        "sender_account_identifier",
        "sender_card_identifier",
        "receiver_account_identifier",
        "receiver_card_identifier",
        "account__name",
        "category__name",
        "user__email",
    )
