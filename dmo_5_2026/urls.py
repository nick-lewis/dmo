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
    create_voice_sample,
    current_session,
    current_user,
    dev_login,
    experience_events,
    experiences,
    frontend_index,
    health,
    logout_user,
    resolve_google_slide,
    run_start_event,
    serve_google_slide_image,
    serve_voice_sample_audio,
    update_event_action_step,
    update_experience,
    update_experience_event,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/dev-login/", dev_login, name="dev-login"),
    path("accounts/", include("allauth.urls")),
    path("api/health/", health, name="health"),
    path("api/auth/me/", current_user, name="current-user"),
    path("api/auth/logout/", logout_user, name="logout-user"),
    path("api/experiences/", experiences, name="experiences"),
    path(
        "api/experiences/<uuid:experience_id>/",
        update_experience,
        name="update-experience",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/",
        experience_events,
        name="experience-events",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/",
        update_experience_event,
        name="update-experience-event",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/steps/<uuid:step_id>/",
        update_event_action_step,
        name="update-event-action-step",
    ),
    path("api/sessions/current/", current_session, name="current-session"),
    path("api/sessions/", create_session, name="create-session"),
    path(
        "api/realtime/client-secret/",
        create_realtime_client_secret,
        name="realtime-client-secret",
    ),
    path(
        "api/experiences/<uuid:experience_id>/voice-sample/",
        create_voice_sample,
        name="voice-sample",
    ),
    path(
        "api/voice-samples/<str:filename>/",
        serve_voice_sample_audio,
        name="serve-voice-sample-audio",
    ),
    path(
        "api/sessions/<uuid:session_id>/messages/",
        create_message,
        name="create-message",
    ),
    path(
        "api/sessions/<uuid:session_id>/start-event/",
        run_start_event,
        name="run-start-event",
    ),
    path("api/slides/resolve/", resolve_google_slide, name="resolve-google-slide"),
    path(
        "api/slides/images/<str:filename>/",
        serve_google_slide_image,
        name="serve-google-slide-image",
    ),
    path("", frontend_index, name="frontend-index"),
    re_path(r"^(?!api/|admin/|accounts/).*$", frontend_index, name="frontend-fallback"),
]
