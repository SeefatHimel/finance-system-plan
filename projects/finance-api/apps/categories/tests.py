from importlib import import_module

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from .defaults import DEFAULT_CATEGORIES, create_default_categories
from .models import Category


class DefaultCategoryTests(TestCase):
    def test_new_user_receives_common_categories(self):
        user = get_user_model().objects.create_user(
            username="new-user",
            password="password",
        )

        categories = list(
            Category.objects.filter(user=user).values_list("name", "kind")
        )

        self.assertCountEqual(categories, DEFAULT_CATEGORIES)

    def test_default_category_creation_is_idempotent(self):
        user = get_user_model().objects.create_user(
            username="idempotent-user",
            password="password",
        )

        create_default_categories(user)

        self.assertEqual(
            Category.objects.filter(user=user).count(),
            len(DEFAULT_CATEGORIES),
        )

    def test_saving_existing_user_does_not_restore_deleted_default(self):
        user = get_user_model().objects.create_user(
            username="custom-user",
            password="password",
        )
        Category.objects.get(user=user, name="Entertainment").delete()

        user.first_name = "Custom"
        user.save(update_fields=("first_name",))

        self.assertFalse(
            Category.objects.filter(user=user, name="Entertainment").exists()
        )

    def test_data_migration_backfills_only_users_with_no_categories(self):
        empty_user = get_user_model().objects.create_user(
            username="empty-user",
            password="password",
        )
        customized_user = get_user_model().objects.create_user(
            username="configured-user",
            password="password",
        )
        Category.objects.filter(user__in=(empty_user, customized_user)).delete()
        Category.objects.create(
            kind=Category.Kind.EXPENSE,
            name="Custom category",
            user=customized_user,
        )

        migration = import_module(
            "apps.categories.migrations.0002_seed_default_categories"
        )
        migration.seed_users_without_categories(django_apps, None)

        self.assertEqual(
            Category.objects.filter(user=empty_user).count(),
            len(DEFAULT_CATEGORIES),
        )
        self.assertEqual(
            list(Category.objects.filter(user=customized_user).values_list("name", flat=True)),
            ["Custom category"],
        )


class CategoryApiTests(APITestCase):
    def test_authenticated_user_can_list_seeded_categories(self):
        user = get_user_model().objects.create_user(
            username="starter-user",
            password="password",
        )
        self.client.force_authenticate(user)

        response = self.client.get(reverse("category-list"))

        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(
            ((item["name"], item["kind"]) for item in response.data),
            DEFAULT_CATEGORIES,
        )

    def test_authenticated_user_can_create_category(self):
        user = get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        self.client.force_authenticate(user)

        response = self.client.post(
            reverse("category-list"),
            {"name": "Food", "kind": "expense"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Food")
