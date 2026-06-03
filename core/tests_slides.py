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


class GoogleSlidesResolutionTests(TestCase):
    def test_discover_page_ids_parses_modern_embed_docdata(self):
        class Response:
            text = """
                <script>
                var viewerData = {
                  docData: [[365760,274320],[
                    ["g3e5cbb864f5_0_8",0,"",[],[],[],[],[[],false,1000],[],"",[],
                      [],1,{"g3e5cbb864f5_0_14":"nested-object-not-slide"}],
                    ["g3e5cbb864f5_0_22",0,"",[],[],[],[],[[],false,1000],[],"",[]]
                  ]]
                };
                </script>
            """

            def raise_for_status(self):
                return None

        with (
            tempfile.TemporaryDirectory() as media_root,
            override_settings(MEDIA_ROOT=media_root),
            patch("core.slides.requests.get", return_value=Response()),
        ):
            page_ids = discover_page_ids(DeckReference("deck-id", False))

        self.assertEqual(
            page_ids,
            ["g3e5cbb864f5_0_8", "g3e5cbb864f5_0_22"],
        )

    def test_numeric_slide_ref_uses_discovered_page_ids(self):
        deck = DeckReference("deck-id", False)

        with patch(
            "core.slides.read_cached_page_ids",
            return_value=["real-slide-1", "real-slide-2"],
        ):
            self.assertEqual(candidate_page_ids(deck, "2"), ["real-slide-2", "p1"])

    def test_numeric_slide_ref_does_not_guess_past_discovered_slide_count(self):
        deck = DeckReference("deck-id", False)

        with (
            patch(
                "core.slides.read_cached_page_ids",
                return_value=["real-slide-1"],
            ),
            patch("core.slides.discover_page_ids", return_value=["real-slide-1"]),
        ):
            with self.assertRaisesMessage(
                SlideResolutionError,
                "DMO discovered 1 slide",
            ):
                candidate_page_ids(deck, "2")

    def test_resolve_slide_image_refreshes_cached_file_when_revision_changes(self):
        deck_url = "abcdefghijklmnopqrstuvwxyz123456"
        page_id = "g3e5cbb864f5_0_8"

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                path = slide_cache_dir() / slide_filename(deck_url, page_id)
                path.write_bytes(b"old")

                with (
                    patch(
                        "core.slides.read_cached_deck_index",
                        return_value={
                            "fetchedAt": 0,
                            "pageIds": [page_id],
                            "revision": "1",
                        },
                    ),
                    patch("core.slides.cached_deck_index_is_recent", return_value=False),
                    patch(
                        "core.slides.refresh_deck_index",
                        return_value={
                            "fetchedAt": 999,
                            "pageIds": [page_id],
                            "revision": "2",
                        },
                    ),
                    patch("core.slides.fetch_slide_image", return_value=b"new") as fetch,
                ):
                    resolved = resolve_slide_image(deck_url, page_id)

                self.assertFalse(resolved.cache_hit)
                self.assertEqual(path.read_bytes(), b"new")
                fetch.assert_called_once()

    def test_resolve_slide_image_uses_recent_cache_without_revision_check(self):
        deck_url = "abcdefghijklmnopqrstuvwxyz123456"
        page_id = "g3e5cbb864f5_0_8"

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                path = slide_cache_dir() / slide_filename(deck_url, page_id)
                path.write_bytes(b"cached")

                with (
                    patch("core.slides.cached_deck_index_is_recent", return_value=True),
                    patch("core.slides.refresh_deck_index") as refresh,
                    patch("core.slides.fetch_slide_image") as fetch,
                ):
                    resolved = resolve_slide_image(deck_url, page_id)

                self.assertTrue(resolved.cache_hit)
                self.assertEqual(path.read_bytes(), b"cached")
                refresh.assert_not_called()
                fetch.assert_not_called()
