from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase


class AuthApiTests(APITestCase):
    def setUp(self):
        cache.clear()

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

    def test_user_can_update_own_profile_without_changing_username(self):
        user = get_user_model().objects.create_user(username="synthetic-profile", email="old@example.com")
        self.client.force_authenticate(user)

        response = self.client.patch(reverse("current-user"), {
            "first_name": "  Alex  ",
            "last_name": "  Morgan ",
            "email": " alex@example.com ",
            "username": "changed",
        }, format="json")

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertEqual((user.first_name, user.last_name, user.email), ("Alex", "Morgan", "alex@example.com"))
        self.assertEqual(user.username, "synthetic-profile")
        self.assertEqual(response.data["username"], "synthetic-profile")

    def test_profile_update_rejects_invalid_email_and_requires_authentication(self):
        user = get_user_model().objects.create_user(username="synthetic-profile", email="old@example.com")
        self.client.force_authenticate(user)
        response = self.client.patch(reverse("current-user"), {"email": "not-an-email"}, format="json")
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertEqual(user.email, "old@example.com")
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.patch(reverse("current-user"), {"first_name": "Alex"}, format="json").status_code, 401)

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

    def test_logout_revokes_only_the_selected_login_session(self):
        get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        first_login = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "himel", "password": "password"},
            format="json",
        )
        second_login = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "himel", "password": "password"},
            format="json",
        )

        logout_response = self.client.post(
            reverse("token_logout"),
            {"refresh": first_login.data["refresh"]},
            format="json",
        )

        self.assertEqual(logout_response.status_code, 204)
        self.assertEqual(
            self.client.post(
                reverse("token_refresh"),
                {"refresh": first_login.data["refresh"]},
                format="json",
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(
                reverse("token_refresh"),
                {"refresh": second_login.data["refresh"]},
                format="json",
            ).status_code,
            200,
        )

    def test_authenticated_user_can_logout_all_login_sessions(self):
        get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        first_login = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "himel", "password": "password"},
            format="json",
        )
        second_login = self.client.post(
            reverse("token_obtain_pair"),
            {"username": "himel", "password": "password"},
            format="json",
        )
        rotated_second_session = self.client.post(
            reverse("token_refresh"),
            {"refresh": second_login.data["refresh"]},
            format="json",
        )
        self.assertEqual(rotated_second_session.status_code, 200)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {first_login.data['access']}"
        )

        logout_response = self.client.post(reverse("token_logout_all"), format="json")

        self.assertEqual(logout_response.status_code, 204)
        self.client.credentials()
        for refresh_token in (
            first_login.data["refresh"],
            rotated_second_session.data["refresh"],
        ):
            self.assertEqual(
                self.client.post(
                    reverse("token_refresh"),
                    {"refresh": refresh_token},
                    format="json",
                ).status_code,
                401,
            )

    def test_repeated_login_attempts_are_throttled(self):
        get_user_model().objects.create_user(
            username="himel",
            email="himel@example.com",
            password="password",
        )
        credentials = {"username": "himel", "password": "wrong-password"}

        responses = [
            self.client.post(
                reverse("token_obtain_pair"), credentials, format="json"
            )
            for _attempt in range(11)
        ]

        self.assertTrue(all(response.status_code == 401 for response in responses[:10]))
        self.assertEqual(responses[10].status_code, 429)
