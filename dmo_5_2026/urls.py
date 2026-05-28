"""
URL configuration for dmo_5_2026 project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
"""
from django.contrib import admin
from django.urls import include, path, re_path

from core.views import (
    create_message,
    create_realtime_client_secret,
    create_session,
    current_session,
    current_user,
    frontend_index,
    health,
    logout_user,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("allauth.urls")),
    path("api/health/", health, name="health"),
    path("api/auth/me/", current_user, name="current-user"),
    path("api/auth/logout/", logout_user, name="logout-user"),
    path("api/sessions/current/", current_session, name="current-session"),
    path("api/sessions/", create_session, name="create-session"),
    path(
        "api/realtime/client-secret/",
        create_realtime_client_secret,
        name="realtime-client-secret",
    ),
    path(
        "api/sessions/<uuid:session_id>/messages/",
        create_message,
        name="create-message",
    ),
    path("", frontend_index, name="frontend-index"),
    re_path(r"^(?!api/|admin/|accounts/).*$", frontend_index, name="frontend-fallback"),
]
