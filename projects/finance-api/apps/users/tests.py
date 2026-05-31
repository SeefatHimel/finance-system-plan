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

    def test_refresh_token_rotates_and_old_refresh_token_is_rejected(self):
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
        original_refresh_token = token_response.data["refresh"]

        refresh_response = self.client.post(
            reverse("token_refresh"),
            {"refresh": original_refresh_token},
            format="json",
        )

        self.assertEqual(refresh_response.status_code, 200)
        self.assertIn("access", refresh_response.data)
        self.assertIn("refresh", refresh_response.data)
        self.assertNotEqual(refresh_response.data["refresh"], original_refresh_token)

        reused_response = self.client.post(
            reverse("token_refresh"),
            {"refresh": original_refresh_token},
            format="json",
        )

        self.assertEqual(reused_response.status_code, 401)
