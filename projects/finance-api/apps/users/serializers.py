import hashlib
import json
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.utils import datetime_from_epoch


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ("id", "username", "email", "first_name", "last_name")
        read_only_fields = fields


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(allow_blank=True, required=False)

    class Meta:
        model = get_user_model()
        fields = ("first_name", "last_name", "email")

    def validate(self, attrs):
        for field in ("first_name", "last_name", "email"):
            if field in attrs:
                attrs[field] = attrs[field].strip()
        return attrs


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)

    @transaction.atomic
    def save(self, **kwargs):
        from rest_framework_simplejwt.tokens import UntypedToken
        from config.secure_data import decrypt_bytes
        from .models import RefreshReplay

        try:
            raw = self.validated_data["refresh"]
            verified = UntypedToken(raw)
            if verified.get(api_settings.TOKEN_TYPE_CLAIM) != "refresh":
                raise TokenError("Use a refresh token.")
            get_user_model().objects.select_for_update().get(
                pk=verified[api_settings.USER_ID_CLAIM]
            )
            digest = hashlib.sha256(raw.encode()).hexdigest()
            replay = RefreshReplay.objects.filter(digest=digest).first()
            if replay:
                # A concurrent proxy refresh may have consumed the cookie being
                # logged out. Revoke its successor before dropping the receipt.
                successor = json.loads(decrypt_bytes(replay.ciphertext))["refresh"]
                try:
                    RefreshToken(successor).blacklist()
                except TokenError:
                    pass  # Already revoked is a successful logout.
                replay.delete()
                return
            RefreshToken(raw).blacklist()
        except (TokenError, get_user_model().DoesNotExist) as error:
            raise serializers.ValidationError(
                {"refresh": "Refresh token is invalid or expired."}
            ) from error


class SessionTokenRefreshSerializer(TokenRefreshSerializer):
    @transaction.atomic
    def validate(self, attrs):
        from rest_framework_simplejwt.tokens import UntypedToken
        from rest_framework.exceptions import AuthenticationFailed
        from config.secure_data import encrypt_bytes, decrypt_bytes
        from .models import RefreshReplay
        from .proxy_auth import can_replay_refresh

        raw = attrs["refresh"]
        verified = UntypedToken(raw)
        if verified.get(api_settings.TOKEN_TYPE_CLAIM) != "refresh":
            raise TokenError("Use a refresh token.")
        user = (
            get_user_model()
            .objects.select_for_update()
            .filter(pk=verified.get(api_settings.USER_ID_CLAIM), is_active=True)
            .first()
        )
        if user is None:
            raise AuthenticationFailed("Session is unavailable.")
        digest = hashlib.sha256(raw.encode()).hexdigest()
        replay_allowed = can_replay_refresh(self.context.get("request"), raw)
        now = timezone.now()
        if replay_allowed:
            saved = RefreshReplay.objects.filter(
                digest=digest, user=user, expires_at__gt=now
            ).first()
            if saved:
                data = json.loads(decrypt_bytes(saved.ciphertext))
                # Logout must win over a cached rotation result.
                RefreshToken(data["refresh"])
                return data
        data = super().validate(attrs)
        rotated_refresh = data.get("refresh")
        if rotated_refresh:
            token = RefreshToken(rotated_refresh)
            OutstandingToken.objects.get_or_create(
                jti=token[api_settings.JTI_CLAIM],
                defaults={
                    "created_at": datetime_from_epoch(token["iat"]),
                    "expires_at": datetime_from_epoch(token["exp"]),
                    "token": rotated_refresh,
                    "user_id": user.pk,
                },
            )
            if replay_allowed:
                RefreshReplay.objects.update_or_create(
                    digest=digest,
                    defaults={
                        "user": user,
                        "ciphertext": encrypt_bytes(json.dumps(data).encode()),
                        "expires_at": now + timedelta(seconds=5),
                    },
                )
        expired = list(
            RefreshReplay.objects.filter(expires_at__lte=now).values_list(
                "digest", flat=True
            )[:100]
        )
        if expired:
            RefreshReplay.objects.filter(
                digest__in=expired, expires_at__lte=now
            ).delete()
        return data
