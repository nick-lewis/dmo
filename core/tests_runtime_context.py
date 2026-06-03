import json
import tempfile
import wave
from io import StringIO
from threading import Event, Lock
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings

from .audio_cache import (
    compute_script_audio_cache_key,
    compute_script_audio_display_key,
    script_audio_audio_path,
    script_audio_display_path,
    script_audio_metadata_path,
    script_audio_words_path,
)
from .slides import (
    DeckReference,
    SlideResolutionError,
    candidate_page_ids,
    discover_page_ids,
    resolve_slide_image,
    slide_cache_dir,
    slide_filename,
)
from .models import (
    EventActionStep,
    EventChatTool,
    EventClassifier,
    EventClassifierGroup,
    EventConversationCheck,
    Experience,
    ExperienceEvent,
    ExperienceEventCheckpoint,
    ExperienceSnapshot,
    SessionMessage,
    TutorSettings,
    TutoringSession,
)
from .experience_services import (
    EXPERIENCE_EXPORT_FORMAT,
    EXPERIENCE_EXPORT_VERSION,
    create_experience_from_export_payload,
    duplicate_experience_for_user,
)
from .main_panel_apps import (
    MAIN_PANEL_APP_REGISTRY,
    REGISTERED_MAIN_PANEL_APP_IDS,
)
from .realtime_services import (
    CLASSIFICATION_MODELS,
    MODEL_OPTIONS,
    REALTIME_MODEL_OPTIONS,
    REALTIME_MODELS,
    REALTIME_VOICE_ORDER,
    REALTIME_VOICES,
    REALTIME_VOICES_BY_MODEL,
    build_realtime_instructions,
    classification_model_choices,
    conversation_check_transcript,
    evaluate_classifier_group,
    normalize_realtime_voice_choice,
    realtime_voice_choices_for_model,
)
from .runtime import apply_runtime_actions_to_state
from .runtime_execution import run_action_sequence
from .script_audio_services import (
    cached_script_audio_payload,
    collect_experience_script_audio_items,
)
from .script_markers import script_cues_with_word_times
from .serializers import (
    experience_export_payload,
    serialize_experience,
)


class RuntimeContextActionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="runtime-context-action-test",
            email="runtime-context-action-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Runtime context action test",
            slug="runtime-context-action-test",
        )
        self.event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )

    def test_action_sequence_uses_shared_context_action_rules(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={
                "fruits": ["apple"],
                "scalar_value": "first",
            },
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            self.event,
            [
                {
                    "id": "set-estimate",
                    "actionType": EventActionStep.ActionType.SET_CONTEXT,
                    "config": {"key": " delivery_estimate ", "value": 22},
                    "enabled": True,
                    "sortOrder": 0,
                },
                {
                    "id": "append-new",
                    "actionType": EventActionStep.ActionType.APPEND_CONTEXT_LIST,
                    "config": {"key": "fruits", "value": "banana"},
                    "enabled": True,
                    "sortOrder": 1,
                },
                {
                    "id": "append-duplicate",
                    "actionType": EventActionStep.ActionType.APPEND_CONTEXT_LIST,
                    "config": {"key": "fruits", "value": "apple"},
                    "enabled": True,
                    "sortOrder": 2,
                },
                {
                    "id": "append-to-scalar",
                    "actionType": EventActionStep.ActionType.APPEND_CONTEXT_LIST,
                    "config": {"key": "scalar_value", "value": "second"},
                    "enabled": True,
                    "sortOrder": 3,
                },
            ],
        )

        self.assertEqual(messages, [])
        self.assertEqual(next_event_slug, "")
        self.assertEqual(session.runtime_context["delivery_estimate"], 22)
        self.assertEqual(session.runtime_context["fruits"], ["apple", "banana"])
        self.assertEqual(session.runtime_context["scalar_value"], ["first", "second"])

        set_action = actions[0]
        append_actions = [
            action
            for action in actions
            if action.get("type") == "append_context_list"
        ]
        self.assertEqual(set_action["key"], "delivery_estimate")
        self.assertEqual(
            [action["appended"] for action in append_actions],
            [True, False, True],
        )
        self.assertEqual(append_actions[-1]["list"], ["first", "second"])

    def test_script_chat_message_debug_exposes_cue_plan(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            self.event,
            [
                {
                    "id": "script-cues",
                    "actionType": EventActionStep.ActionType.SCRIPT,
                    "config": {
                        "text": (
                            "Hello [show_image: test-images/dLU-left.png] "
                            "there [pause: 250]."
                        )
                    },
                    "enabled": True,
                    "sortOrder": 0,
                },
            ],
        )

        self.assertEqual(next_event_slug, "")
        self.assertEqual(len(messages), 1)
        chat_action = actions[0]
        self.assertEqual(chat_action["type"], "chat_message")
        self.assertEqual(chat_action["scriptCueCount"], 2)
        self.assertEqual(chat_action["scriptCueTypes"], ["show_image", "pause"])
        self.assertFalse(chat_action["scriptAudioCached"])
        self.assertFalse(chat_action["scriptWordTiming"])

        state = apply_runtime_actions_to_state({}, actions)
        chat_trace = state["runtimeDebug"]["recentActions"][0]
        self.assertEqual(chat_trace["type"], "chat_message")
        self.assertEqual(chat_trace["details"]["scriptCueCount"], 2)
        self.assertEqual(
            chat_trace["details"]["scriptCueTypes"],
            '["show_image","pause"]',
        )
        self.assertIn("(2 cues)", chat_trace["summary"])
