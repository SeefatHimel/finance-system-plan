from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase


class AuthApiTests(APITestCase):
    def test_user_can_get_jwt_tokens_and_current_profile(self):
        get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )

        token_response = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "himel", "password": "password"},
            format="json",
        )

        self.assertEqual(token_response.status_code, 200)
        self.assertIn("access", token_response.data)
        self.assertIn("refresh", token_response.data)

        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}"
        )
        me_response = self.client.get(reverse("current-user"))

        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.data["username"], "himel")

