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


class RealtimeModelChoiceTests(TestCase):
    def test_model_choices_load_from_shared_frontend_registry(self):
        registry_path = settings.BASE_DIR / "frontend" / "src" / "modelOptions.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))

        self.assertEqual(
            set(REALTIME_MODEL_OPTIONS),
            {option["id"] for option in registry["realtimeModels"]},
        )
        self.assertEqual(REALTIME_MODELS, set(REALTIME_MODEL_OPTIONS))
        self.assertEqual(
            set(REALTIME_VOICE_ORDER),
            {option["id"] for option in registry["realtimeVoices"]},
        )
        self.assertEqual(REALTIME_VOICES, set(REALTIME_VOICE_ORDER))
        self.assertEqual(
            CLASSIFICATION_MODELS,
            {option["id"] for option in registry["classificationModels"]},
        )
        self.assertEqual(
            {
                model: set(voices)
                for model, voices in registry["realtimeVoicesByModel"].items()
            },
            REALTIME_VOICES_BY_MODEL,
        )
        self.assertEqual(
            {option["id"] for option in MODEL_OPTIONS["realtimeModels"]},
            REALTIME_MODELS,
        )

    def test_current_realtime_model_choices_are_preserved_on_serialize(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="realtime-model-choice-test",
            email="realtime-model-choice-test@example.com",
            password="test-password",
        )
        experience = Experience.objects.create(
            user=user,
            title="Realtime model choice test",
            slug="realtime-model-choice-test",
        )
        tutor = TutorSettings.objects.create(
            experience=experience,
            realtime_model="gpt-realtime-1.5",
        )

        for model in ["gpt-realtime-1.5", "gpt-realtime-2"]:
            tutor.realtime_model = model
            tutor.save(update_fields=["realtime_model"])

            payload = serialize_experience(experience)

            experience.tutor_settings.refresh_from_db()
            self.assertEqual(payload["tutor"]["realtimeModel"], model)
            self.assertEqual(experience.tutor_settings.realtime_model, model)

    def test_legacy_realtime_model_alias_normalizes_on_serialize(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="legacy-realtime-model-choice-test",
            email="legacy-realtime-model-choice-test@example.com",
            password="test-password",
        )
        experience = Experience.objects.create(
            user=user,
            title="Legacy realtime model choice test",
            slug="legacy-realtime-model-choice-test",
        )
        TutorSettings.objects.create(
            experience=experience,
            realtime_model="gpt-4o-realtime-preview",
        )

        payload = serialize_experience(experience)

        experience.tutor_settings.refresh_from_db()
        self.assertEqual(payload["tutor"]["realtimeModel"], "gpt-realtime")
        self.assertEqual(experience.tutor_settings.realtime_model, "gpt-realtime")

    def test_realtime_voice_choices_are_scoped_to_realtime_models(self):
        expected_realtime_voices = {
            "alloy",
            "ash",
            "ballad",
            "cedar",
            "coral",
            "echo",
            "marin",
            "sage",
            "shimmer",
            "verse",
        }
        for model in [
            "gpt-realtime-mini",
            "gpt-realtime",
            "gpt-realtime-1.5",
            "gpt-realtime-2",
        ]:
            voices = realtime_voice_choices_for_model(model)
            self.assertEqual(expected_realtime_voices, voices)
            self.assertNotIn("fable", voices)
            self.assertNotIn("nova", voices)
            self.assertNotIn("onyx", voices)
            self.assertEqual(
                normalize_realtime_voice_choice("marin", "ash", model),
                "marin",
            )
            self.assertIsNone(
                normalize_realtime_voice_choice("fable", "ash", model)
            )

    def test_classification_choices_include_current_pro_variants(self):
        choices = classification_model_choices()

        self.assertIn("gpt-5.5-pro", choices)
        self.assertIn("gpt-5.4-pro", choices)
        self.assertIn("gpt-5.4-mini", choices)
