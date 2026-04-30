from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase


class CategoryApiTests(APITestCase):
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

