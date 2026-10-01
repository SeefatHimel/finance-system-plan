from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .serializers import (
    LogoutSerializer,
    SessionTokenRefreshSerializer,
    UserSerializer,
)
from .throttles import LoginIpRateThrottle, LoginUsernameRateThrottle


class LoginView(TokenObtainPairView):
    throttle_classes = (LoginIpRateThrottle, LoginUsernameRateThrottle)


class SessionTokenRefreshView(TokenRefreshView):
    serializer_class = SessionTokenRefreshSerializer


class CurrentUserView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=UserSerializer)
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(request=LogoutSerializer, responses={204: None})
    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class LogoutAllView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        outstanding_tokens = OutstandingToken.objects.filter(
            user=request.user,
            expires_at__gt=timezone.now(),
        )
        for token in outstanding_tokens:
            BlacklistedToken.objects.get_or_create(token=token)
        return Response(status=status.HTTP_204_NO_CONTENT)
