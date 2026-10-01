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


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(write_only=True)

    def save(self, **kwargs):
        try:
            RefreshToken(self.validated_data["refresh"]).blacklist()
        except TokenError as error:
            raise serializers.ValidationError(
                {"refresh": "Refresh token is invalid or expired."}
            ) from error


class SessionTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
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
                    "user_id": token[api_settings.USER_ID_CLAIM],
                },
            )
        return data
