import base64
import io

from django.contrib.auth import get_user_model
from django.urls import reverse
from PIL import Image, PngImagePlugin
from rest_framework.test import APITestCase

from .logos import MAX_LOGO_BYTES
from .models import Account


def image_logo(format="PNG", size=(240, 120), metadata=False):
    output = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    if metadata:
        info.add_text("Comment", "Synthetic private metadata")
    Image.new("RGB", size, "#268c73").save(output, format, **({"pnginfo": info} if format == "PNG" else {}))
    mime = "jpeg" if format == "JPEG" else format.lower()
    return f"data:image/{mime};base64," + base64.b64encode(output.getvalue()).decode("ascii")


class AccountLogoTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="synthetic-logo-owner")
        self.client.force_authenticate(self.user)
        self.account = Account.objects.create(user=self.user, name="Synthetic wallet", type="cash")
        self.url = reverse("account-detail", args=[self.account.pk])

    def test_logo_is_normalized_metadata_free_and_kept_on_unrelated_update(self):
        response = self.client.patch(self.url, {"logo": image_logo(metadata=True)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        logo = response.data["logo"]
        self.assertTrue(logo.startswith("data:image/webp;base64,"))
        raw = base64.b64decode(logo.split(",")[1])
        self.assertLess(len(raw), 32 * 1024)
        self.assertNotIn(b"Synthetic private metadata", raw)
        with Image.open(io.BytesIO(raw)) as saved:
            self.assertEqual(saved.size, (128, 128))
            self.assertEqual(saved.convert("RGBA").getpixel((0, 0))[3], 0)
        for body in ({"name": "Renamed wallet"}, {"logo": logo}):
            changed = self.client.patch(self.url, body, format="json")
            self.assertEqual(changed.status_code, 200, changed.data)
            self.assertEqual(changed.data["logo"], logo)
        listed = self.client.get(reverse("account-list"))
        self.assertEqual(listed.data[0]["logo"], logo)
        self.account.refresh_from_db()
        self.assertEqual(self.account.starting_balance, 0)

    def test_can_create_replace_and_remove_logo(self):
        for format in ("PNG", "JPEG", "WEBP"):
            result = self.client.patch(self.url, {"logo": image_logo(format)}, format="json")
            self.assertEqual(result.status_code, 200, result.data)
        removed = self.client.patch(self.url, {"logo": ""}, format="json")
        self.assertEqual(removed.status_code, 200, removed.data)
        self.assertEqual(removed.data["logo"], "")
        created = self.client.post(reverse("account-list"), {"name": "Another synthetic account", "type": "bank", "logo": image_logo()}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertTrue(created.data["logo"].startswith("data:image/webp;"))

    def test_bad_content_cannot_replace_existing_logo(self):
        good = self.client.patch(self.url, {"logo": image_logo()}, format="json").data["logo"]
        corrupt_png = bytearray(base64.b64decode(image_logo().split(",")[1]))
        corrupt_png[corrupt_png.index(b"IDAT") + 4] ^= 1
        for invalid in (
            "https://example.test/logo.png",
            "data:image/svg+xml;base64," + base64.b64encode(b"<svg/>").decode(),
            "data:image/png;base64,%%%%",
            "data:image/png;base64," + base64.b64encode(b"not an image").decode(),
            "data:image/png;base64," + base64.b64encode(corrupt_png).decode(),
            image_logo()[:-20],
            "data:image/png;base64," + base64.b64encode(b"x" * (MAX_LOGO_BYTES + 1)).decode(),
            image_logo(size=(4001, 4000)),
        ):
            response = self.client.patch(self.url, {"logo": invalid}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn("logo", response.data)
        self.account.refresh_from_db()
        self.assertEqual(self.account.logo, good)

    def test_logos_remain_private_to_account_owner(self):
        self.account.logo = image_logo()
        self.account.save()
        other = get_user_model().objects.create_user(username="synthetic-other-logo-owner")
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.patch(self.url, {"logo": ""}, format="json").status_code, 404)
        self.assertEqual(self.client.get(reverse("account-list")).data, [])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)
