from django.urls import path

from .views import (
    CurrentUserView,
    LoginView,
    LogoutAllView,
    LogoutView,
    SessionTokenRefreshView,
)


urlpatterns = [
    path("login/", LoginView.as_view(), name="token_obtain_pair"),
    path("refresh/", SessionTokenRefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="token_logout"),
    path("logout-all/", LogoutAllView.as_view(), name="token_logout_all"),
    path("me/", CurrentUserView.as_view(), name="current-user"),
]
