import json
import tempfile
import wave

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .audio_cache import (
    compute_script_audio_cache_key,
    script_audio_audio_path,
    script_audio_metadata_path,
    script_audio_words_path,
)
from .models import (
    EventActionStep,
    Experience,
    ExperienceEvent,
    TutorSettings,
    TutoringSession,
)
from .views import cached_script_audio_payload


class InteractiveRuntimeActionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="interactive-action-test",
            email="interactive-action-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Interactive action test",
            slug="interactive-action-test",
        )

    def test_emitted_context_actions_update_runtime_context(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={"fruits": ["apple"]},
            runtime_state={
                "uiRuntime": {
                    "interactive": {
                        "config": {},
                        "interactiveId": "delivery_data",
                        "mode": "table",
                        "title": "Delivery data",
                    },
                    "interactiveState": {},
                },
            },
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/sessions/{session.id}/interactive/",
            data=json.dumps(
                {
                    "actions": [
                        {
                            "key": "delivery_estimate",
                            "type": "set_context",
                            "value": "22",
                        },
                        {
                            "key": "fruits",
                            "type": "append_context_list",
                            "value": "banana",
                        },
                        {
                            "key": "fruits",
                            "type": "append_context_list",
                            "value": "apple",
                        },
                    ],
                    "interactiveId": "delivery_data",
                    "state": {"estimate": "22"},
                },
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.runtime_context["delivery_estimate"], "22")
        self.assertEqual(session.runtime_context["fruits"], ["apple", "banana"])

        payload = response.json()
        append_actions = [
            action
            for action in payload["actions"]
            if action.get("type") == "append_context_list"
        ]
        self.assertEqual([action["appended"] for action in append_actions], [True, False])
        self.assertEqual(append_actions[-1]["list"], ["apple", "banana"])

    def test_emitted_goto_event_runs_target_event_after_context_actions(self):
        target_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Done",
            slug="done",
            sort_order=1,
        )
        EventActionStep.objects.create(
            event=target_event,
            action_type=EventActionStep.ActionType.SCRIPT,
            config={"text": "Submitted estimate: {{ delivery_estimate }} minutes."},
            label="Confirm estimate",
            sort_order=0,
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={
                "uiRuntime": {
                    "interactive": {
                        "config": {},
                        "interactiveId": "delivery_data",
                        "mode": "table",
                        "title": "Delivery data",
                    },
                    "interactiveState": {},
                },
            },
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/sessions/{session.id}/interactive/",
            data=json.dumps(
                {
                    "actions": [
                        {
                            "key": "delivery_estimate",
                            "type": "set_context",
                            "value": "22",
                        },
                        {
                            "triggersEvent": "done",
                            "type": "goto_event",
                        },
                    ],
                    "interactiveId": "delivery_data",
                    "state": {"estimate": "22"},
                },
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.runtime_context["delivery_estimate"], "22")
        self.assertEqual(session.runtime_state["currentEventSlug"], "done")
        self.assertEqual(
            list(session.messages.values_list("content", flat=True)),
            ["Submitted estimate: 22 minutes."],
        )

        payload = response.json()
        self.assertEqual(payload["ranEvents"][0]["slug"], "done")
        self.assertTrue(
            any(action.get("type") == "chat_message" for action in payload["actions"])
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
