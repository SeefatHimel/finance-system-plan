from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .defaults import create_default_categories


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_categories_for_new_user(sender, instance, created, **kwargs):
    if created and not kwargs.get("raw", False):
        create_default_categories(instance)
