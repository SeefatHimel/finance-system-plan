from django.contrib import admin

from .models import Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "user", "is_active", "display_order")
    list_filter = ("kind", "is_active")
    search_fields = ("name", "user__email", "user__username")

