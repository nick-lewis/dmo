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
    build_speech_audio_payload,
    compute_script_audio_cache_key,
    compute_script_audio_display_key,
    generate_speech_audio,
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


class ScriptAudioCachePayloadTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="script-audio-cache-test",
            email="script-audio-cache-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Script audio cache test",
            slug="script-audio-cache-test",
        )
        TutorSettings.objects.create(experience=self.experience)

    def test_speech_audio_payload_treats_question_ending_as_literal_script(self):
        script = "Try that in your notebook. Sound good?"

        payload = build_speech_audio_payload(
            script=script,
            tts_model="gpt-4o-mini-tts",
            voice="ash",
            voice_instructions="Warm and concise.",
        )

        self.assertEqual(payload["input"], script)
        self.assertIn("# Role and Objective", payload["instructions"])
        self.assertIn("# Script Rules", payload["instructions"])
        self.assertIn("# Personality and Tone", payload["instructions"])
        self.assertIn("<script_to_speak>...</script_to_speak>", payload["instructions"])
        self.assertIn("Do not answer, confirm", payload["instructions"])
        self.assertIn("speak that question exactly and then stop", payload["instructions"])
        self.assertIn(
            "Warm and concise.",
            payload["instructions"],
        )

    def test_generate_speech_audio_sends_question_ending_script_as_input(self):
        script = "Does that make sense?"

        class Response:
            status_code = 200
            content = b"RIFF-test-wav"

        with patch("core.audio_cache.requests.post", return_value=Response()) as post:
            content = generate_speech_audio(
                api_key="test-key",
                safety_identifier="safe-user",
                script=script,
                tts_model="gpt-4o-mini-tts",
                voice="ash",
                voice_instructions="",
            )

        self.assertEqual(content, b"RIFF-test-wav")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["input"], script)
        self.assertIn("does that make sense?", payload["instructions"])

    def test_cached_payload_includes_word_timing_and_timed_cues(self):
        script = "First second."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
                    voice=tutor.voice,
                    voice_instructions=tutor.voice_instructions,
                )
                audio_path = script_audio_audio_path(cache_key)
                metadata_path = script_audio_metadata_path(cache_key)
                words_path = script_audio_words_path(
                    cache_key,
                    settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
                )
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                with wave.open(str(audio_path), "wb") as audio_file:
                    audio_file.setnchannels(1)
                    audio_file.setsampwidth(2)
                    audio_file.setframerate(24000)
                    audio_file.writeframes(b"\x00\x00" * 2400)
                metadata_path.write_text("{}", encoding="utf-8")
                words_path.write_text(
                    json.dumps(
                        [
                            {"word": "First", "start": 0.1, "end": 0.4},
                            {"word": "second", "start": 0.5, "end": 0.8},
                        ]
                    ),
                    encoding="utf-8",
                )

                session = TutoringSession.objects.create(
                    user=self.user,
                    experience=self.experience,
                )
                payload = cached_script_audio_payload(
                    session,
                    script,
                    [
                        {
                            "action": {"type": "gslide", "slideRef": "2"},
                            "progress": 0.5,
                            "wordIndex": 1,
                        }
                    ],
                )

        self.assertEqual(payload["scriptWords"][1]["word"], "second")
        self.assertEqual(payload["scriptCues"][0]["time"], 0.5)

    def test_script_audio_inventory_exposes_marker_and_timing_preview(self):
        raw_script = "First [gslide: 2] second."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                spoken_script = "First second."
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=spoken_script,
                    tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
                    voice=tutor.voice,
                    voice_instructions=tutor.voice_instructions,
                )
                audio_path = script_audio_audio_path(cache_key)
                words_path = script_audio_words_path(
                    cache_key,
                    settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
                )
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                with wave.open(str(audio_path), "wb") as audio_file:
                    audio_file.setnchannels(1)
                    audio_file.setsampwidth(2)
                    audio_file.setframerate(24000)
                    audio_file.writeframes(b"\x00\x00" * 2400)
                words_path.write_text(
                    json.dumps(
                        [
                            {"word": "First", "start": 0.1, "end": 0.4},
                            {"word": "second", "start": 0.5, "end": 0.8},
                        ]
                    ),
                    encoding="utf-8",
                )
                event = ExperienceEvent.objects.create(
                    experience=self.experience,
                    title="Start",
                    slug="start",
                    is_start=True,
                )
                EventActionStep.objects.create(
                    event=event,
                    action_type=EventActionStep.ActionType.SCRIPT,
                    config={"text": raw_script},
                    label="Timed script",
                )

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["markerCount"], 1)
        self.assertEqual(items[0]["displayBaseText"], "First second")
        self.assertEqual(items[0]["displayExpectedWordCount"], 2)
        self.assertEqual(items[0]["timedMarkerCount"], 1)
        self.assertEqual(items[0]["timingWordCount"], 2)
        self.assertEqual(items[0]["timingPreview"][1]["word"], "second")

    def test_script_audio_inventory_exposes_display_transcript_override(self):
        raw_script = "My name is D-lou."
        display_text = "My name is dLU."
        display_slots = ["My", "name", "is", "dLU."]

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                display_key = compute_script_audio_display_key(raw_script)
                display_path = script_audio_display_path(display_key)
                display_path.parent.mkdir(parents=True, exist_ok=True)
                display_path.write_text(
                    json.dumps({"displaySlots": display_slots}),
                    encoding="utf-8",
                )
                event = ExperienceEvent.objects.create(
                    experience=self.experience,
                    title="Start",
                    slug="start",
                    is_start=True,
                )
                EventActionStep.objects.create(
                    event=event,
                    action_type=EventActionStep.ActionType.SCRIPT,
                    config={"text": raw_script},
                    label="Intro",
                )

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(items[0]["displayText"], display_text)
        self.assertEqual(items[0]["displaySlots"], display_slots)
        self.assertEqual(items[0]["displayBaseText"], raw_script)
        self.assertTrue(items[0]["hasDisplayTranscript"])
        self.assertEqual(items[0]["displayExpectedWordCount"], 4)
        self.assertEqual(items[0]["displaySlotCount"], 4)
        self.assertEqual(items[0]["displayWordCount"], 4)

    def test_cached_payload_includes_display_transcript_override(self):
        script = "My name is D-lou."
        display_text = "My name is dLU."
        display_slots = ["My", "name", "is", "dLU."]

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
                    voice=tutor.voice,
                    voice_instructions=tutor.voice_instructions,
                )
                audio_path = script_audio_audio_path(cache_key)
                metadata_path = script_audio_metadata_path(cache_key)
                display_path = script_audio_display_path(
                    compute_script_audio_display_key(script)
                )
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                with wave.open(str(audio_path), "wb") as audio_file:
                    audio_file.setnchannels(1)
                    audio_file.setsampwidth(2)
                    audio_file.setframerate(24000)
                    audio_file.writeframes(b"\x00\x00" * 2400)
                metadata_path.write_text("{}", encoding="utf-8")
                display_path.write_text(
                    json.dumps({"displaySlots": display_slots}),
                    encoding="utf-8",
                )
                session = TutoringSession.objects.create(
                    user=self.user,
                    experience=self.experience,
                )

                payload = cached_script_audio_payload(session, script)

        self.assertEqual(payload["displayText"], display_text)

    def test_display_transcript_endpoint_requires_same_word_count(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            config={"text": "My name is D-lou."},
            label="Intro",
        )
        self.client.force_login(self.user)

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                item = collect_experience_script_audio_items(self.experience)[0]

                good_response = self.client.put(
                    f"/api/experiences/{self.experience.id}/script-audio/{item['id']}/display/",
                    data=json.dumps({"displaySlots": ["My", "name", "is", "dLU."]}),
                    content_type="application/json",
                )
                bad_response = self.client.put(
                    f"/api/experiences/{self.experience.id}/script-audio/{item['id']}/display/",
                    data=json.dumps({"displaySlots": ["My", "name", "definitely", "is", "dLU."]}),
                    content_type="application/json",
                )

        self.assertEqual(good_response.status_code, 200)
        self.assertTrue(good_response.json()["hasDisplayTranscript"])
        self.assertEqual(good_response.json()["displayText"], "My name is dLU.")
        self.assertEqual(good_response.json()["displaySlots"], ["My", "name", "is", "dLU."])
        self.assertEqual(bad_response.status_code, 400)

    def test_display_transcript_slots_can_keep_blank_timed_words(self):
        script = "My name is D-lou."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
                    voice=tutor.voice,
                    voice_instructions=tutor.voice_instructions,
                )
                words_path = script_audio_words_path(
                    cache_key,
                    settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
                )
                words_path.parent.mkdir(parents=True, exist_ok=True)
                words_path.write_text(
                    json.dumps(
                        [
                            {"word": "My", "start": 0, "end": 0.1},
                            {"word": "name", "start": 0.1, "end": 0.2},
                            {"word": "is", "start": 0.2, "end": 0.3},
                            {"word": "D", "start": 0.3, "end": 0.4},
                            {"word": "lou.", "start": 0.4, "end": 0.5},
                        ]
                    ),
                    encoding="utf-8",
                )
                event = ExperienceEvent.objects.create(
                    experience=self.experience,
                    title="Start",
                    slug="start",
                    is_start=True,
                )
                EventActionStep.objects.create(
                    event=event,
                    action_type=EventActionStep.ActionType.SCRIPT,
                    config={"text": script},
                    label="Intro",
                )
                self.client.force_login(self.user)
                item = collect_experience_script_audio_items(self.experience)[0]

                response = self.client.put(
                    f"/api/experiences/{self.experience.id}/script-audio/{item['id']}/display/",
                    data=json.dumps({"displaySlots": ["My", "name", "is", "dLU", ""]}),
                    content_type="application/json",
                )

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["displayText"], "My name is dLU")
        self.assertEqual(response.json()["displaySlots"], ["My", "name", "is", "dLU", ""])
        self.assertEqual(items[0]["displayBaseSlots"], ["My", "name", "is", "D", "lou."])
        self.assertEqual(items[0]["displaySlots"], ["My", "name", "is", "dLU", ""])
        self.assertEqual(items[0]["displayText"], "My name is dLU")

    def test_display_transcript_can_store_visual_line_breaks(self):
        script = "First line second line."
        display_slots = ["First", "line", "second", "line."]

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                event = ExperienceEvent.objects.create(
                    experience=self.experience,
                    title="Start",
                    slug="start",
                    is_start=True,
                )
                EventActionStep.objects.create(
                    event=event,
                    action_type=EventActionStep.ActionType.SCRIPT,
                    config={"text": script},
                    label="Intro",
                )
                self.client.force_login(self.user)
                item = collect_experience_script_audio_items(self.experience)[0]

                response = self.client.put(
                    f"/api/experiences/{self.experience.id}/script-audio/{item['id']}/display/",
                    data=json.dumps(
                        {
                            "displayBreaks": [1],
                            "displaySlots": display_slots,
                        }
                    ),
                    content_type="application/json",
                )

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["displayBreaks"], [1])
        self.assertEqual(response.json()["displayText"], "First line\nsecond line.")
        self.assertEqual(response.json()["displaySlots"], display_slots)
        self.assertTrue(response.json()["hasDisplayTranscript"])
        self.assertEqual(items[0]["displayBreaks"], [1])
        self.assertEqual(items[0]["displayText"], "First line\nsecond line.")
        self.assertTrue(items[0]["hasDisplayTranscript"])

    def test_display_transcript_can_store_repeated_visual_line_breaks(self):
        script = "First line second line."
        display_slots = ["First", "line", "second", "line."]

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                event = ExperienceEvent.objects.create(
                    experience=self.experience,
                    title="Start",
                    slug="start",
                    is_start=True,
                )
                EventActionStep.objects.create(
                    event=event,
                    action_type=EventActionStep.ActionType.SCRIPT,
                    config={"text": script},
                    label="Intro",
                )
                self.client.force_login(self.user)
                item = collect_experience_script_audio_items(self.experience)[0]

                response = self.client.put(
                    f"/api/experiences/{self.experience.id}/script-audio/{item['id']}/display/",
                    data=json.dumps(
                        {
                            "displayBreaks": [1, 1],
                            "displaySlots": display_slots,
                        }
                    ),
                    content_type="application/json",
                )

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["displayBreaks"], [1, 1])
        self.assertEqual(response.json()["displayText"], "First line\n\nsecond line.")
        self.assertEqual(items[0]["displayBreaks"], [1, 1])
        self.assertEqual(items[0]["displayText"], "First line\n\nsecond line.")

    def test_script_audio_inventory_groups_duplicate_sources(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            config={"text": "The same reusable line."},
            label="First use",
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            config={"text": "The same reusable line."},
            label="Second use",
            sort_order=1,
        )

        items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["sourceCount"], 2)
        self.assertEqual(
            items[0]["sources"],
            ["Start / First use", "Start / Second use"],
        )
