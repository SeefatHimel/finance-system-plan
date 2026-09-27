from django.test import RequestFactory, SimpleTestCase


class ProxySecuritySettingsTests(SimpleTestCase):
    def test_forwarded_https_scheme_is_recognized(self):
        request = RequestFactory().get(
            "/admin/login/",
            HTTP_HOST="api.example.com",
            HTTP_X_FORWARDED_PROTO="https",
        )

        self.assertTrue(request.is_secure())
