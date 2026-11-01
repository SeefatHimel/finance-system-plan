from django.conf import settings
from django.db import models


class AuthRateWindow(models.Model):
    """Short-lived hashed throttle keys; shared by all API workers."""

    key = models.CharField(max_length=100, primary_key=True)
    hits = models.JSONField(default=list)
    expires_at = models.DateTimeField(db_index=True)


class RefreshReplay(models.Model):
    """Five-second replay for authenticated web proxies after a successful rotation."""

    digest = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    ciphertext = models.BinaryField()
    expires_at = models.DateTimeField(db_index=True)
