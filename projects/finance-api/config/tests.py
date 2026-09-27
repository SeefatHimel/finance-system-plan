from django.contrib.auth import get_user_model
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.urls import reverse


class AdminUserAddViewTests(TestCase):
    def test_user_add_form_renders(self):
        admin_user = get_user_model().objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="test-password",
        )
        self.client.force_login(admin_user)

        response = self.client.get(reverse("admin:auth_user_add"))

        self.assertEqual(response.status_code, 200)


class ProxySecuritySettingsTests(SimpleTestCase):
    def test_forwarded_https_scheme_is_recognized(self):
        request = RequestFactory().get(
            "/admin/login/",
            HTTP_HOST="api.example.com",
            HTTP_X_FORWARDED_PROTO="https",
        )

        self.assertTrue(request.is_secure())
