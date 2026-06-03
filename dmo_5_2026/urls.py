"""
URL configuration for dmo_5_2026 project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
"""
from django.contrib import admin
from django.urls import include, path, re_path

from core.basic_views import (
    current_user,
    dev_login,
    frontend_index,
    health,
    logout_user,
    main_panel_apps,
)
from core.experience_import_views import import_experience
from core.experience_lifecycle_views import (
    duplicate_experience,
    export_experience,
    experience_validation,
    experiences,
    update_experience,
)
from core.experience_snapshot_views import (
    delete_experience_snapshot,
    export_experience_snapshot,
    experience_snapshots,
    restore_experience_snapshot,
)
from core.event_action_step_views import (
    create_event_action_step,
    reorder_event_action_steps,
    update_event_action_step,
)
from core.event_chat_tool_views import (
    create_event_chat_tool,
    update_event_chat_tool,
)
from core.event_classifier_group_views import (
    create_event_classifier_group,
    update_event_classifier_group,
)
from core.event_classifier_item_views import (
    create_event_classifier,
    update_event_classifier,
)
from core.event_conversation_check_views import (
    create_event_conversation_check,
    update_event_conversation_check,
)
from core.event_views import (
    event_checkpoints,
    experience_events,
    reorder_experience_events,
    update_experience_event,
)
from core.message_audio_views import create_message_audio
from core.script_audio_views import (
    experience_script_audio,
    script_audio_display_transcript,
    serve_script_audio,
)
from core.slide_views import (
    recache_experience_slides,
    resolve_google_slide,
    serve_google_slide_image,
)
from core.voice_sample_views import (
    create_voice_sample,
    serve_voice_sample_audio,
)
from core.realtime_views import create_realtime_client_secret
from core.runtime_chat_tool_views import run_session_chat_tool
from core.runtime_check_views import run_session_conversation_checks
from core.runtime_interactive_views import update_session_interactive
from core.runtime_message_views import create_message
from core.runtime_notebook_views import update_session_notebook
from core.runtime_session_event_views import run_session_event
from core.runtime_start_event_views import run_start_event
from core.session_views import create_session, current_session

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/dev-login/", dev_login, name="dev-login"),
    path("accounts/", include("allauth.urls")),
    path("api/health/", health, name="health"),
    path("api/auth/me/", current_user, name="current-user"),
    path("api/auth/logout/", logout_user, name="logout-user"),
    path("api/main-panel-apps/", main_panel_apps, name="main-panel-apps"),
    path("api/experiences/", experiences, name="experiences"),
    path(
        "api/experiences/import/",
        import_experience,
        name="import-experience",
    ),
    path(
        "api/experiences/<uuid:experience_id>/",
        update_experience,
        name="update-experience",
    ),
    path(
        "api/experiences/<uuid:experience_id>/duplicate/",
        duplicate_experience,
        name="duplicate-experience",
    ),
    path(
        "api/experiences/<uuid:experience_id>/export/",
        export_experience,
        name="export-experience",
    ),
    path(
        "api/experiences/<uuid:experience_id>/snapshots/",
        experience_snapshots,
        name="experience-snapshots",
    ),
    path(
        "api/experiences/<uuid:experience_id>/snapshots/<uuid:snapshot_id>/export/",
        export_experience_snapshot,
        name="export-experience-snapshot",
    ),
    path(
        "api/experiences/<uuid:experience_id>/snapshots/<uuid:snapshot_id>/",
        delete_experience_snapshot,
        name="delete-experience-snapshot",
    ),
    path(
        "api/experiences/<uuid:experience_id>/snapshots/<uuid:snapshot_id>/restore/",
        restore_experience_snapshot,
        name="restore-experience-snapshot",
    ),
    path(
        "api/experiences/<uuid:experience_id>/validation/",
        experience_validation,
        name="experience-validation",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/",
        experience_events,
        name="experience-events",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/reorder/",
        reorder_experience_events,
        name="reorder-experience-events",
    ),
    path(
        "api/experiences/<uuid:experience_id>/script-audio/",
        experience_script_audio,
        name="experience-script-audio",
    ),
    path(
        "api/experiences/<uuid:experience_id>/script-audio/<str:script_id>/display/",
        script_audio_display_transcript,
        name="script-audio-display-transcript",
    ),
    path(
        "api/experiences/<uuid:experience_id>/slides/recache/",
        recache_experience_slides,
        name="recache-experience-slides",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/",
        update_experience_event,
        name="update-experience-event",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/checkpoints/",
        event_checkpoints,
        name="event-checkpoints",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/steps/<uuid:step_id>/",
        update_event_action_step,
        name="update-event-action-step",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/steps/",
        create_event_action_step,
        name="create-event-action-step",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/steps/reorder/",
        reorder_event_action_steps,
        name="reorder-event-action-steps",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/chat-tools/",
        create_event_chat_tool,
        name="create-event-chat-tool",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/chat-tools/<uuid:tool_id>/",
        update_event_chat_tool,
        name="update-event-chat-tool",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/conversation-checks/",
        create_event_conversation_check,
        name="create-event-conversation-check",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/conversation-checks/<uuid:check_id>/",
        update_event_conversation_check,
        name="update-event-conversation-check",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/classifier-groups/",
        create_event_classifier_group,
        name="create-event-classifier-group",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/classifier-groups/<uuid:group_id>/",
        update_event_classifier_group,
        name="update-event-classifier-group",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/classifier-groups/<uuid:group_id>/classifiers/",
        create_event_classifier,
        name="create-event-classifier",
    ),
    path(
        "api/experiences/<uuid:experience_id>/events/<uuid:event_id>/classifier-groups/<uuid:group_id>/classifiers/<uuid:classifier_id>/",
        update_event_classifier,
        name="update-event-classifier",
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
        "api/script-audio/<str:filename>/",
        serve_script_audio,
        name="serve-script-audio",
    ),
    path(
        "api/sessions/<uuid:session_id>/messages/",
        create_message,
        name="create-message",
    ),
    path(
        "api/sessions/<uuid:session_id>/messages/<uuid:message_id>/audio/",
        create_message_audio,
        name="create-message-audio",
    ),
    path(
        "api/sessions/<uuid:session_id>/start-event/",
        run_start_event,
        name="run-start-event",
    ),
    path(
        "api/sessions/<uuid:session_id>/events/run/",
        run_session_event,
        name="run-session-event",
    ),
    path(
        "api/sessions/<uuid:session_id>/interactive/",
        update_session_interactive,
        name="update-session-interactive",
    ),
    path(
        "api/sessions/<uuid:session_id>/notebook/",
        update_session_notebook,
        name="update-session-notebook",
    ),
    path(
        "api/sessions/<uuid:session_id>/chat-tool/",
        run_session_chat_tool,
        name="run-session-chat-tool",
    ),
    path(
        "api/sessions/<uuid:session_id>/conversation-checks/run/",
        run_session_conversation_checks,
        name="run-session-conversation-checks",
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
