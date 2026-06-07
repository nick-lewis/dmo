import base64
import json
import tempfile
import wave
from io import BytesIO, StringIO
from threading import Event, Lock
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings

from .audio_cache import (
    build_intro_script_prompt,
    build_realtime_script_audio_events,
    build_speech_audio_payload,
    compute_script_audio_cache_key,
    compute_script_audio_display_key,
    generate_realtime_script_audio,
    generate_speech_audio,
    get_or_create_voice_sample,
    pcm16_wav_bytes,
    script_audio_audio_path,
    script_audio_display_path,
    script_audio_metadata_path,
    script_audio_words_path,
    voice_sample_metadata_path,
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
    generate_experience_script_audio_payload,
    generate_message_script_audio_payload,
    generate_voice_sample_payload,
)
from .script_markers import script_cues_with_word_times
from .voice_personality_lab_services import (
    VOICE_PERSONALITY_LAB_SCRIPT,
    create_voice_personality_lab_group,
    load_voice_personality_lab_manifest,
    voice_personality_lab_payload,
)
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
        self.assertIn("for a tutoring assistant", payload["instructions"])
        self.assertNotIn("for dLU", payload["instructions"])
        self.assertIn("<script_to_speak>...</script_to_speak>", payload["instructions"])
        self.assertIn("Do not answer, confirm", payload["instructions"])
        self.assertIn("speak that question exactly and then stop", payload["instructions"])
        self.assertIn(
            "Warm and concise.",
            payload["instructions"],
        )

    def test_intro_script_prompt_uses_voice_sample_sections_and_tone(self):
        prompt = build_intro_script_prompt("dLU", "Warm, curious, and concise.")

        self.assertIn("# Role and Objective", prompt)
        self.assertIn("# Script Rules", prompt)
        self.assertIn("# Personality and Tone", prompt)
        self.assertIn("dLU", prompt)
        self.assertIn("a tutoring assistant", prompt)
        self.assertNotIn("dLU tutoring assistant", prompt)
        self.assertIn("Return only the script text", prompt)
        self.assertIn("Warm, curious, and concise.", prompt)

    def test_realtime_script_audio_events_treat_question_as_literal_script(self):
        script = "Does that make sense?"

        events = build_realtime_script_audio_events(
            script=script,
            realtime_model="gpt-realtime-2",
            voice="ash",
            voice_instructions="Warm and concise.",
        )

        session = events[0]["session"]
        response = events[1]["response"]
        instructions = response["instructions"]

        self.assertEqual(session["model"], "gpt-realtime-2")
        self.assertEqual(session["reasoning"], {"effort": "minimal"})
        self.assertEqual(session["audio"]["output"]["format"]["rate"], 24000)
        self.assertEqual(response["conversation"], "none")
        self.assertEqual(response["output_modalities"], ["audio"])
        self.assertEqual(response["audio"]["output"]["voice"], "ash")
        self.assertEqual(response["audio"]["output"]["format"]["rate"], 24000)
        self.assertEqual(
            response["input"][0]["content"][0]["text"],
            "<script_to_speak>\nDoes that make sense?\n</script_to_speak>",
        )
        self.assertIn("# Role and Objective", instructions)
        self.assertIn("# Script Rules", instructions)
        self.assertIn("# Personality and Tone", instructions)
        self.assertIn("for a tutoring assistant", instructions)
        self.assertNotIn("for dLU", instructions)
        self.assertIn("Does that make sense?", response["input"][0]["content"][0]["text"])
        self.assertIn("speak that question exactly and then stop", instructions)
        self.assertIn("Warm and concise.", instructions)

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

    def test_voice_sample_uses_realtime_audio_renderer(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    "core.audio_cache.generate_intro_script",
                    return_value="Hi, I am dLU. Let's make this feel clear.",
                ) as generate_script:
                    with patch(
                        "core.audio_cache.generate_realtime_script_audio",
                        return_value=b"RIFF-test-wav",
                    ) as render_audio:
                        sample = get_or_create_voice_sample(
                            api_key="test-key",
                            assistant_name="dLU",
                            audio_model="gpt-realtime-2",
                            realtime_model="gpt-realtime-2",
                            safety_identifier="safe-user",
                            script_model="gpt-4o-mini",
                            voice="ash",
                            voice_instructions="Warm and concise.",
                        )

                metadata = json.loads(
                    voice_sample_metadata_path(sample.cache_key).read_text(
                        encoding="utf-8",
                    )
                )

        self.assertFalse(sample.cached)
        generate_script.assert_called_once()
        render_audio.assert_called_once()
        self.assertEqual(
            render_audio.call_args.kwargs["script"],
            "Hi, I am dLU. Let's make this feel clear.",
        )
        self.assertEqual(render_audio.call_args.kwargs["realtime_model"], "gpt-realtime-2")
        self.assertEqual(render_audio.call_args.kwargs["voice"], "ash")
        self.assertEqual(render_audio.call_args.kwargs["voice_instructions"], "Warm and concise.")
        self.assertEqual(metadata["audioEngine"], "realtime")
        self.assertEqual(metadata["audioModel"], "gpt-realtime-2")
        self.assertNotIn("ttsModel", metadata)

    @override_settings(OPENAI_API_KEY="test-key")
    def test_voice_sample_payload_exposes_realtime_audio_model(self):
        sample = SimpleNamespace(
            cache_key="a" * 32,
            cached=False,
            script="Hi, I am dLU.",
        )

        with patch(
            "core.script_audio_services.get_or_create_voice_sample",
            return_value=sample,
        ) as get_sample:
            payload, error, status_code = generate_voice_sample_payload(
                self.experience,
                {"tutor": {"assistantName": "dLU"}},
                "safe-user",
            )

        self.assertEqual(error, "")
        self.assertEqual(status_code, 200)
        self.assertEqual(payload["audioEngine"], "realtime")
        self.assertEqual(payload["audioModel"], self.experience.tutor_settings.realtime_model)
        self.assertNotIn("ttsModel", payload)
        self.assertEqual(
            get_sample.call_args.kwargs["audio_model"],
            self.experience.tutor_settings.realtime_model,
        )
        self.assertNotIn("tts_model", get_sample.call_args.kwargs)

    def test_voice_personality_lab_payload_defaults_to_realtime_2(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(
                MEDIA_ROOT=media_root,
                DLU_REALTIME_DEFAULT_MODEL="gpt-realtime-mini",
            ):
                payload = voice_personality_lab_payload(self.user)

        self.assertEqual(payload["defaultRealtimeModel"], "gpt-realtime-2")

    @override_settings(OPENAI_API_KEY="test-key")
    def test_voice_personality_lab_uses_script_audio_cache_for_all_voices(self):
        audio_content = pcm16_wav_bytes(b"\x00\x00" * 240)

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    "core.audio_cache.generate_realtime_script_audio",
                    return_value=audio_content,
                ) as render_audio:
                    with patch("core.audio_cache.generate_speech_audio") as speech_audio:
                        payload, error, status_code = create_voice_personality_lab_group(
                            self.user,
                            {
                                "realtimeModel": "gpt-realtime-mini",
                                "voiceInstructions": "Warm, curious, and precise.",
                            },
                            "safe-user",
                        )

                self.assertEqual(error, "")
                self.assertEqual(status_code, 200)
                self.assertEqual(payload["generated"], len(REALTIME_VOICE_ORDER))
                self.assertEqual(payload["groups"][0]["cachedCount"], len(REALTIME_VOICE_ORDER))
                self.assertEqual(payload["groups"][0]["sampleCount"], len(REALTIME_VOICE_ORDER))
                self.assertTrue(
                    all(
                        sample["audioUrl"].startswith("/api/script-audio/")
                        for sample in payload["groups"][0]["samples"]
                    )
                )
                self.assertEqual(
                    [call.kwargs["voice"] for call in render_audio.call_args_list],
                    list(REALTIME_VOICE_ORDER),
                )
                self.assertTrue(
                    all(
                        call.kwargs["script"] == VOICE_PERSONALITY_LAB_SCRIPT
                        for call in render_audio.call_args_list
                    )
                )
                self.assertTrue(
                    all(
                        call.kwargs["voice_instructions"]
                        == "Warm, curious, and precise."
                        for call in render_audio.call_args_list
                    )
                )
                speech_audio.assert_not_called()

                manifest = load_voice_personality_lab_manifest(self.user)
                self.assertEqual(
                    manifest["groups"][0]["voiceInstructions"],
                    "Warm, curious, and precise.",
                )

                with patch(
                    "core.audio_cache.generate_realtime_script_audio",
                    return_value=audio_content,
                ) as render_audio_again:
                    payload, error, status_code = create_voice_personality_lab_group(
                        self.user,
                        {
                            "realtimeModel": "gpt-realtime-mini",
                            "voiceInstructions": "Warm, curious, and precise.",
                        },
                        "safe-user",
                    )

                self.assertEqual(error, "")
                self.assertEqual(status_code, 200)
                self.assertEqual(payload["generated"], 0)
                render_audio_again.assert_not_called()

    def test_generate_realtime_script_audio_writes_audio_deltas_to_wav(self):
        pcm_bytes = b"\x00\x00" * 240
        audio_delta = base64.b64encode(pcm_bytes).decode("ascii")

        class FakeWebSocket:
            def __init__(self):
                self.sent = []
                self.closed = False
                self.messages = [
                    json.dumps({"type": "session.updated"}),
                    json.dumps(
                        {
                            "type": "response.output_audio.delta",
                            "delta": audio_delta,
                        }
                    ),
                    json.dumps(
                        {
                            "type": "response.done",
                            "response": {"status": "completed"},
                        }
                    ),
                ]

            def send(self, message):
                self.sent.append(json.loads(message))

            def recv(self):
                return self.messages.pop(0)

            def close(self):
                self.closed = True

        fake_ws = FakeWebSocket()

        with patch(
            "core.audio_cache.open_realtime_websocket",
            return_value=fake_ws,
        ) as open_ws:
            audio_content = generate_realtime_script_audio(
                api_key="test-key",
                realtime_model="gpt-realtime-2",
                safety_identifier="safe-user",
                script="Does that make sense?",
                voice="ash",
                voice_instructions="Warm.",
            )

        open_ws.assert_called_once()
        self.assertTrue(fake_ws.closed)
        self.assertEqual(fake_ws.sent[0]["type"], "session.update")
        self.assertEqual(fake_ws.sent[1]["type"], "response.create")
        with wave.open(BytesIO(audio_content), "rb") as audio_file:
            self.assertEqual(audio_file.getframerate(), 24000)
            self.assertEqual(audio_file.getnchannels(), 1)
            self.assertEqual(audio_file.getsampwidth(), 2)
            self.assertEqual(audio_file.getnframes(), 240)

    def test_cached_payload_includes_word_timing_and_timed_cues(self):
        script = "First second."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    audio_model=tutor.realtime_model,
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
                    audio_model=tutor.realtime_model,
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
        self.assertEqual(items[0]["displayBaseText"], "First second.")
        self.assertEqual(items[0]["displayBaseSlots"], ["First", "second."])
        self.assertEqual(items[0]["displayExpectedWordCount"], 2)
        self.assertEqual(items[0]["timedMarkerCount"], 1)
        self.assertEqual(items[0]["timingWordCount"], 2)
        self.assertEqual(items[0]["timingPreview"][1]["word"], "second")

    def test_script_audio_inventory_keeps_display_text_from_script_when_timing_differs(self):
        script = "Actual written script."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    audio_model=tutor.realtime_model,
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
                            {"word": "Unexpected", "start": 0.1, "end": 0.3},
                            {"word": "transcript", "start": 0.3, "end": 0.6},
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

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(items[0]["displayBaseText"], script)
        self.assertEqual(items[0]["displayBaseSlots"], ["Actual", "written", "script."])
        self.assertEqual(items[0]["displayExpectedWordCount"], 3)
        self.assertEqual(items[0]["timingWordCount"], 2)
        self.assertEqual(items[0]["timingPreview"][0]["word"], "Unexpected")

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
                    audio_model=tutor.realtime_model,
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
        self.assertEqual(payload["displayBreaks"], [])
        self.assertEqual(payload["displaySlots"], display_slots)

    @override_settings(OPENAI_API_KEY="test-key")
    def test_message_audio_generation_keeps_display_formatting_when_timing_words_differ(self):
        script = "First line second line."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    audio_model=tutor.realtime_model,
                    voice=tutor.voice,
                    voice_instructions=tutor.voice_instructions,
                )
                audio_path = script_audio_audio_path(cache_key)
                display_path = script_audio_display_path(
                    compute_script_audio_display_key(script)
                )
                audio_path.parent.mkdir(parents=True, exist_ok=True)
                with wave.open(str(audio_path), "wb") as audio_file:
                    audio_file.setnchannels(1)
                    audio_file.setsampwidth(2)
                    audio_file.setframerate(24000)
                    audio_file.writeframes(b"\x00\x00" * 2400)
                display_path.write_text(
                    json.dumps(
                        {
                            "displayBreaks": [1],
                            "displaySlots": ["First", "line", "second", "line."],
                        }
                    ),
                    encoding="utf-8",
                )
                session = TutoringSession.objects.create(
                    user=self.user,
                    experience=self.experience,
                )
                message = SessionMessage.objects.create(
                    session=session,
                    role=SessionMessage.Role.ASSISTANT,
                    content=script,
                    sequence=1,
                    metadata={"source": "event-action"},
                )

                with (
                    patch(
                        "core.script_audio_services.get_or_create_script_audio",
                        return_value=SimpleNamespace(
                            audio_path=audio_path,
                            cache_key=cache_key,
                            cached=True,
                        ),
                    ),
                    patch(
                        "core.script_audio_services.get_or_create_script_audio_words",
                        return_value=[
                            {"word": "First", "start": 0.1, "end": 0.3},
                            {"word": "line-second", "start": 0.3, "end": 0.7},
                        ],
                    ),
                ):
                    payload, error, status_code = generate_message_script_audio_payload(
                        session,
                        message,
                        {},
                        "test-user",
                    )

                message.refresh_from_db()

        self.assertEqual(status_code, 200)
        self.assertEqual(error, "")
        self.assertEqual(payload["displayBreaks"], [1])
        self.assertEqual(payload["displaySlots"], ["First", "line", "second", "line."])
        self.assertEqual(payload["displayText"], "First line\nsecond line.")
        self.assertEqual(
            message.metadata["scriptAudio"]["displayBreaks"],
            [1],
        )
        self.assertEqual(
            message.metadata["scriptAudio"]["displaySlots"],
            ["First", "line", "second", "line."],
        )
        self.assertEqual(
            message.metadata["scriptAudio"]["displayText"],
            "First line\nsecond line.",
        )

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

    def test_display_transcript_uses_script_slots_when_timing_words_split(self):
        script = "My name is D-lou."

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                tutor = self.experience.tutor_settings
                cache_key = compute_script_audio_cache_key(
                    assistant_name=tutor.assistant_name,
                    realtime_model=tutor.realtime_model,
                    script=script,
                    audio_model=tutor.realtime_model,
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
                    data=json.dumps({"displaySlots": ["My", "name", "is", "dLU."]}),
                    content_type="application/json",
                )

                items = collect_experience_script_audio_items(self.experience)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["displayText"], "My name is dLU.")
        self.assertEqual(response.json()["displaySlots"], ["My", "name", "is", "dLU."])
        self.assertEqual(items[0]["displayBaseSlots"], ["My", "name", "is", "D-lou."])
        self.assertEqual(items[0]["displaySlots"], ["My", "name", "is", "dLU."])
        self.assertEqual(items[0]["displayText"], "My name is dLU.")

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

    @override_settings(OPENAI_API_KEY="test-key")
    def test_force_generation_resets_display_cue_offsets_without_losing_breaks(self):
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
                            "displayCueOffsets": [4.25],
                            "displaySlots": display_slots,
                        }
                    ),
                    content_type="application/json",
                )
                updated_item = collect_experience_script_audio_items(self.experience)[0]
                audio_path = script_audio_audio_path(updated_item["cacheKey"])
                audio_path.parent.mkdir(parents=True, exist_ok=True)

                def create_audio(*args, **kwargs):
                    with wave.open(str(audio_path), "wb") as audio_file:
                        audio_file.setnchannels(1)
                        audio_file.setsampwidth(2)
                        audio_file.setframerate(24000)
                        audio_file.writeframes(b"\x00\x00" * 2400)
                    return SimpleNamespace(
                        audio_path=audio_path,
                        cache_key=updated_item["cacheKey"],
                        cache_hit=False,
                    )

                with (
                    patch(
                        "core.script_audio_services.get_or_create_script_audio",
                        side_effect=create_audio,
                    ),
                    patch(
                        "core.script_audio_services.get_or_create_script_audio_words",
                        return_value=[
                            {"word": "First", "start": 0.1, "end": 0.2},
                            {"word": "line", "start": 0.2, "end": 0.3},
                            {"word": "second", "start": 0.8, "end": 0.9},
                            {"word": "line.", "start": 0.9, "end": 1.0},
                        ],
                    ),
                ):
                    payload, error, status_code = generate_experience_script_audio_payload(
                        self.experience,
                        {"force": True, "scriptId": item["id"]},
                        "test-user",
                    )

                refreshed_item = payload["scripts"][0]

        self.assertEqual(response.status_code, 200)
        self.assertEqual(updated_item["displayCueOffsets"], [4.25])
        self.assertEqual(status_code, 200)
        self.assertEqual(error, "")
        self.assertEqual(payload["errors"], [])
        self.assertEqual(refreshed_item["displayBreaks"], [1, 1])
        self.assertEqual(refreshed_item["displayCueOffsets"], [0.0])
        self.assertEqual(refreshed_item["displaySlots"], display_slots)
        self.assertEqual(refreshed_item["displayText"], "First line\n\nsecond line.")

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

    @override_settings(OPENAI_API_KEY="test-key")
    def test_generate_all_script_audio_skips_dynamic_scripts(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            config={"text": "Static line."},
            label="Static",
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            config={"text": "Hello {{ learner.name }}."},
            label="Dynamic",
            sort_order=1,
        )

        with patch(
            "core.script_audio_services.generate_script_audio_item",
            return_value=(False, ""),
        ) as generate_item:
            payload, error, status_code = generate_experience_script_audio_payload(
                self.experience,
                {"force": False, "scriptId": ""},
                "test-user",
            )

        generated_item = generate_item.call_args[0][1]
        self.assertEqual(status_code, 200)
        self.assertEqual(error, "")
        self.assertEqual(payload["errors"], [])
        self.assertEqual(generate_item.call_count, 1)
        self.assertEqual(generated_item["script"], "Static line.")
        self.assertTrue(generated_item["canGenerate"])
