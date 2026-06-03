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


class SeedLocalDemosCommandTests(TestCase):
    def test_seed_local_demos_targets_requested_username(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="NickLewis",
            email="nicklewis@deeplearning.ai",
            password="test-password",
        )

        call_command(
            "seed_local_demos",
            usernames=["NickLewis"],
            stdout=StringIO(),
        )

        slugs = set(
            Experience.objects.filter(user=user).values_list("slug", flat=True)
        )
        self.assertIn("fruit-test", slugs)
        self.assertIn("interactive-timing-demo", slugs)
        self.assertIn("python-notebook-code-coach", slugs)
