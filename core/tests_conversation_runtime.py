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


class ConversationRuntimeTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="conversation-runtime-test",
            email="conversation-runtime-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Conversation runtime test",
            slug="conversation-runtime-test",
        )
        TutorSettings.objects.create(experience=self.experience)
        self.chat_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Fruit chat",
            slug="fruit-chat",
            is_start=True,
            sort_order=0,
        )

    def test_run_completed_event_moves_session_current_event(self):
        target_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Already introduced",
            slug="already-introduced",
            sort_order=1,
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={
                "currentEventSlug": "fruit-chat",
                "eventRuns": {
                    str(target_event.id): {
                        "status": "complete",
                    }
                },
                "uiRuntime": {
                    "triggers": [
                        {
                            "selector": ".continue-button",
                            "triggersEvent": "already-introduced",
                        }
                    ]
                },
            },
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/sessions/{session.id}/events/run/",
            data=json.dumps(
                {
                    "eventSlug": "already-introduced",
                    "triggerSelector": ".continue-button",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["ran"])
        self.assertEqual(payload["event"]["slug"], "already-introduced")
        self.assertEqual(payload["actions"][0]["type"], "event_skipped")

        session.refresh_from_db()
        self.assertEqual(
            session.runtime_state["currentEventSlug"],
            "already-introduced",
        )
        self.assertEqual(
            session.runtime_state["currentEventId"],
            str(target_event.id),
        )
        self.assertEqual(session.runtime_state["uiRuntime"]["triggers"], [])

    def test_event_run_records_deduped_structural_checkpoint(self):
        target_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Primer",
            slug="primer",
            sort_order=1,
        )
        EventActionStep.objects.create(
            event=target_event,
            action_type=EventActionStep.ActionType.SET_CONTEXT,
            config={"key": "primer_started", "value": "yes"},
            label="Mark primer",
        )
        self.client.force_login(self.user)

        for _ in range(2):
            session = TutoringSession.objects.create(
                user=self.user,
                experience=self.experience,
                runtime_context={"notes_visible": True},
                runtime_state={"checkpointRecordingMode": "structural"},
            )
            response = self.client.post(
                f"/api/sessions/{session.id}/events/run/",
                data=json.dumps({"eventSlug": "primer"}),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200)

        checkpoint = ExperienceEventCheckpoint.objects.get(event=target_event)
        self.assertEqual(checkpoint.fingerprint_mode, "structural")
        self.assertEqual(checkpoint.run_count, 2)
        self.assertEqual(
            checkpoint.payload["runtimeContext"],
            {"notes_visible": True},
        )
        self.assertEqual(checkpoint.summary["messageCount"], 0)

    def test_checkpoint_can_restore_session_for_event_launch(self):
        target_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Primer",
            slug="primer",
            sort_order=1,
        )
        checkpoint = ExperienceEventCheckpoint.objects.create(
            experience=self.experience,
            event=target_event,
            fingerprint_mode="full",
            fingerprint="restore-test",
            payload={
                "eventId": str(target_event.id),
                "eventSlug": target_event.slug,
                "messages": [
                    {
                        "content": "I already said yes.",
                        "metadata": {"source": "test"},
                        "role": SessionMessage.Role.USER,
                        "sequence": 1,
                    }
                ],
                "runtimeContext": {"choice": "yes"},
                "runtimeState": {
                    "currentEventId": str(target_event.id),
                    "currentEventSlug": target_event.slug,
                    "eventRuns": {str(self.chat_event.id): {"status": "complete"}},
                },
            },
            summary={"label": "choice=yes", "messageCount": 1},
        )
        self.client.force_login(self.user)

        response = self.client.post(
            "/api/sessions/",
            data=json.dumps(
                {
                    "checkpointId": str(checkpoint.id),
                    "experienceId": str(self.experience.id),
                    "recordingMode": "off",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        session = TutoringSession.objects.get(id=payload["session"]["id"])
        self.assertEqual(session.runtime_context, {"choice": "yes"})
        self.assertEqual(session.messages.count(), 1)
        self.assertEqual(session.messages.first().content, "I already said yes.")
        self.assertEqual(
            session.runtime_state["editorLaunch"]["checkpointId"],
            str(checkpoint.id),
        )
        self.assertEqual(
            session.runtime_state["editorLaunch"]["eventId"],
            str(target_event.id),
        )
        self.assertEqual(session.runtime_state["checkpointRecordingMode"], "off")

    def test_event_checkpoint_list_is_scoped_to_event(self):
        target_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Primer",
            slug="primer",
            sort_order=1,
        )
        other_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Other",
            slug="other",
            sort_order=2,
        )
        checkpoint = ExperienceEventCheckpoint.objects.create(
            experience=self.experience,
            event=target_event,
            fingerprint_mode="structural",
            fingerprint="primer-state",
            payload={},
            summary={"label": "choice=yes", "messageCount": 2},
        )
        ExperienceEventCheckpoint.objects.create(
            experience=self.experience,
            event=other_event,
            fingerprint_mode="structural",
            fingerprint="other-state",
            payload={},
            summary={"label": "other"},
        )
        self.client.force_login(self.user)

        response = self.client.get(
            f"/api/experiences/{self.experience.id}/events/{target_event.id}/checkpoints/"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["checkpoints"]), 1)
        self.assertEqual(response.json()["checkpoints"][0]["id"], str(checkpoint.id))
        self.assertEqual(response.json()["checkpoints"][0]["label"], "choice=yes")

    def test_classifier_handler_updates_context_without_leaving_event(self):
        group = EventClassifierGroup.objects.create(
            event=self.chat_event,
            title="Fruit classifiers",
            result_context_key="_classifier_results",
            handler_actions=[
                {
                    "id": "reset-newly-mentioned",
                    "actionType": "set_context",
                    "label": "Reset newly mentioned",
                    "config": {"key": "newly_mentioned", "value": []},
                    "condition": {},
                    "enabled": True,
                    "sortOrder": 0,
                },
                {
                    "id": "append-banana",
                    "actionType": "append_context_list",
                    "label": "Append banana",
                    "config": {"key": "fruits_mentioned", "value": "banana"},
                    "condition": {
                        "type": "context_equals",
                        "key": "_classifier_results.banana.mentioned",
                        "value": True,
                    },
                    "enabled": True,
                    "sortOrder": 1,
                },
                {
                    "id": "append-new-banana",
                    "actionType": "append_context_list",
                    "label": "Append new banana",
                    "config": {"key": "newly_mentioned", "value": "banana"},
                    "condition": {
                        "type": "context_equals",
                        "key": "_classifier_results.banana.mentioned",
                        "value": True,
                    },
                    "enabled": True,
                    "sortOrder": 2,
                },
            ],
        )
        EventClassifier.objects.create(
            group=group,
            name="banana",
            prompt="Detect banana in the latest message.",
            schema={
                "type": "object",
                "properties": {"mentioned": {"type": "boolean"}},
                "required": ["mentioned"],
                "additionalProperties": False,
            },
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={"fruits_mentioned": []},
            runtime_state={"currentEventSlug": "fruit-chat"},
        )
        SessionMessage.objects.create(
            session=session,
            role=SessionMessage.Role.USER,
            content="I like bananas.",
            sequence=1,
        )
        self.client.force_login(self.user)

        with patch(
            "core.realtime_services.evaluate_event_classifier",
            return_value=({"mentioned": True}, ""),
        ):
            response = self.client.post(
                f"/api/sessions/{session.id}/conversation-checks/run/",
                data=json.dumps({"uiState": {"notesVisible": False}}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["handled"])
        self.assertEqual(payload["ranEvents"], [])

        session.refresh_from_db()
        self.assertEqual(session.runtime_state["currentEventSlug"], "fruit-chat")
        self.assertEqual(session.runtime_context["fruits_mentioned"], ["banana"])
        self.assertEqual(session.runtime_context["newly_mentioned"], ["banana"])
        self.assertEqual(
            session.runtime_context["_classifier_results"],
            {"banana": {"mentioned": True}},
        )
        self.assertTrue(
            any(
                action.get("type") == "append_context_list"
                and action.get("key") == "fruits_mentioned"
                for action in payload["actions"]
            )
        )

    def test_conversation_check_context_only_handler_does_not_block_chat(self):
        EventConversationCheck.objects.create(
            event=self.chat_event,
            title="Track confidence",
            instructions="Detect whether the learner gave a confidence estimate.",
            result_context_key="confidence_detected",
            handler_actions=[
                {
                    "id": "save-confidence-state",
                    "actionType": "set_context",
                    "label": "Save confidence state",
                    "config": {"key": "last_confidence_check", "value": "matched"},
                    "condition": {},
                    "enabled": True,
                    "sortOrder": 0,
                }
            ],
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={"currentEventSlug": "fruit-chat"},
        )
        SessionMessage.objects.create(
            session=session,
            role=SessionMessage.Role.USER,
            content="I am about 80 percent sure.",
            sequence=1,
        )
        self.client.force_login(self.user)

        with patch(
            "core.realtime_services.evaluate_conversation_check",
            return_value=({"result": True, "reason": "confidence supplied"}, ""),
        ):
            response = self.client.post(
                f"/api/sessions/{session.id}/conversation-checks/run/",
                data=json.dumps({"uiState": {}}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["handled"])
        self.assertEqual(payload["ranEvents"], [])
        self.assertEqual(payload["checks"][0]["checkTitle"], "Track confidence")
        self.assertFalse(payload["checks"][0]["handled"])
        self.assertEqual(payload["checks"][0]["handlerActionCount"], 1)
        self.assertEqual(payload["checks"][0]["handlerMessageCount"], 0)

        session.refresh_from_db()
        self.assertEqual(session.runtime_state["currentEventSlug"], "fruit-chat")
        self.assertEqual(session.runtime_context["confidence_detected"], "true")
        self.assertEqual(session.runtime_context["last_confidence_check"], "matched")
        check_trace = next(
            entry
            for entry in session.runtime_state["runtimeDebug"]["recentActions"]
            if entry["type"] == "conversation_check_result"
        )
        self.assertFalse(check_trace["details"]["handled"])
        self.assertEqual(check_trace["details"]["handlerActionCount"], 1)
        self.assertTrue(
            any(
                action.get("type") == "set_context"
                and action.get("key") == "last_confidence_check"
                for action in payload["actions"]
            )
        )

    def test_positive_conversation_check_without_handler_continues_chat(self):
        EventConversationCheck.objects.create(
            event=self.chat_event,
            title="Notice confidence",
            instructions="Detect confidence estimate.",
            result_context_key="confidence_detected",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={"currentEventSlug": "fruit-chat"},
        )
        SessionMessage.objects.create(
            session=session,
            role=SessionMessage.Role.USER,
            content="Maybe 80 percent confident.",
            sequence=1,
        )
        self.client.force_login(self.user)

        with patch(
            "core.realtime_services.evaluate_conversation_check",
            return_value=({"result": True, "reason": "confidence supplied"}, ""),
        ):
            response = self.client.post(
                f"/api/sessions/{session.id}/conversation-checks/run/",
                data=json.dumps({"uiState": {}}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["handled"])
        self.assertEqual(payload["checks"][0]["handlerActionCount"], 0)
        self.assertEqual(payload["checks"][0]["handlerMessageCount"], 0)
        self.assertEqual(payload["checks"][0]["triggersEvent"], "")

        session.refresh_from_db()
        self.assertEqual(session.runtime_context["confidence_detected"], "true")

    def test_classifier_group_runs_classifiers_in_parallel(self):
        group = EventClassifierGroup.objects.create(
            event=self.chat_event,
            title="Fruit classifiers",
            result_context_key="_classifier_results",
        )
        for index, fruit in enumerate(("banana", "apple", "orange")):
            EventClassifier.objects.create(
                group=group,
                name=fruit,
                prompt=f"Detect {fruit} in the latest message.",
                schema={
                    "type": "object",
                    "properties": {"mentioned": {"type": "boolean"}},
                    "required": ["mentioned"],
                    "additionalProperties": False,
                },
                sort_order=index,
            )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={"currentEventSlug": "fruit-chat"},
        )
        SessionMessage.objects.create(
            session=session,
            role=SessionMessage.Role.USER,
            content="Banana, apple, and orange all showed up.",
            sequence=1,
        )
        started = []
        started_lock = Lock()
        all_started = Event()

        def fake_classifier(
            user,
            current_event,
            classifier_group,
            classifier,
            default_model,
            runtime_context,
            transcript,
        ):
            with started_lock:
                started.append(classifier.name)
                if len(started) == 3:
                    all_started.set()
            self.assertTrue(
                all_started.wait(1),
                "Classifier calls did not overlap before returning.",
            )
            return {"mentioned": True, "fruit": classifier.name}, ""

        payload, error = evaluate_classifier_group(
            session,
            self.chat_event,
            group,
            {},
            classifier_evaluator=fake_classifier,
        )

        self.assertEqual(error, "")
        self.assertCountEqual(started, ["banana", "apple", "orange"])
        self.assertEqual(payload["results"]["banana"]["fruit"], "banana")
        classifier_actions = [
            action
            for action in payload["actions"]
            if action["type"] == "classifier_result"
        ]
        self.assertEqual(
            [action["classifierName"] for action in classifier_actions],
            ["banana", "apple", "orange"],
        )
        self.assertTrue(
            all(
                action["classifierModel"] == "gpt-5.4-mini"
                for action in classifier_actions
            )
        )
        group_action = payload["actions"][-1]
        self.assertEqual(group_action["runMode"], "parallel")
        self.assertEqual(group_action["classifierCount"], 3)
        self.assertEqual(group_action["ranClassifierCount"], 3)

    def test_realtime_instructions_include_event_prompt_context_and_tools(self):
        self.chat_event.chat_instructions = (
            "Push toward this goal: {{ learner_goal }}. "
            "Newly mentioned: {{ newly_mentioned }}."
        )
        self.chat_event.description = "Learner is testing fruit routing."
        self.chat_event.save(update_fields=["chat_instructions", "description"])
        EventChatTool.objects.create(
            event=self.chat_event,
            name="student_done",
            description="The learner says they are done with the fruit task.",
            parameters={
                "type": "object",
                "properties": {
                    "fruit": {"type": "string", "description": "Fruit named."}
                },
                "required": ["fruit"],
            },
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={
                "learner_goal": "name fruits",
                "newly_mentioned": ["banana"],
            },
            runtime_state={"currentEventSlug": "fruit-chat"},
        )

        instructions = build_realtime_instructions(session)

        self.assertIn("Event chat instructions:", instructions)
        self.assertIn("Push toward this goal: name fruits.", instructions)
        self.assertIn("Newly mentioned: banana.", instructions)
        self.assertIn("Runtime context:", instructions)
        self.assertIn('"learner_goal": "name fruits"', instructions)
        self.assertIn("Available function-call routes:", instructions)
        self.assertIn("student_done", instructions)

    def test_realtime_instructions_include_full_session_history_and_context(self):
        self.chat_event.chat_instructions = "Use the whole context."
        self.chat_event.save(update_fields=["chat_instructions"])
        long_context_value = "ctx-" + ("x" * 2600) + "-tail"
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={"long_context": long_context_value},
            runtime_state={"currentEventSlug": "fruit-chat"},
        )
        for index in range(30):
            SessionMessage.objects.create(
                session=session,
                role=(
                    SessionMessage.Role.USER
                    if index % 2 == 0
                    else SessionMessage.Role.ASSISTANT
                ),
                content=f"message-{index:02d}",
                sequence=index + 1,
            )

        instructions = build_realtime_instructions(session)

        self.assertIn("ctx-", instructions)
        self.assertIn("-tail", instructions)
        self.assertIn("User: message-00", instructions)
        self.assertIn("dLU: message-29", instructions)

    def test_conversation_check_transcript_uses_full_session_history(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={"currentEventSlug": "fruit-chat"},
        )
        for index in range(22):
            SessionMessage.objects.create(
                session=session,
                role=SessionMessage.Role.USER,
                content=f"check-message-{index:02d}",
                sequence=index + 1,
            )

        transcript = conversation_check_transcript(session)

        self.assertIn("user: check-message-00", transcript)
        self.assertIn("user: check-message-21", transcript)

    @override_settings(OPENAI_API_KEY="test-key")
    def test_realtime_client_secret_records_prompt_debug(self):
        self.chat_event.chat_instructions = "Use {{ learner_goal }}."
        self.chat_event.save(update_fields=["chat_instructions"])
        EventChatTool.objects.create(
            event=self.chat_event,
            name="student_done",
            description="The learner says they are done.",
            parameters={"type": "object", "properties": {}},
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={"learner_goal": "name fruits"},
            runtime_state={"currentEventSlug": "fruit-chat"},
        )

        class FakeRealtimeResponse:
            status_code = 200

            def json(self):
                return {
                    "client_secret": {
                        "value": "secret-test-value",
                    },
                }

        self.client.force_login(self.user)
        with patch("core.realtime_services.requests.post") as post:
            post.return_value = FakeRealtimeResponse()
            response = self.client.post(
                "/api/realtime/client-secret/",
                data=json.dumps(
                    {
                        "model": "gpt-realtime-mini",
                        "sessionId": str(session.id),
                        "voice": "ash",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        prompt_debug = session.runtime_state["runtimeDebug"]["realtimePrompt"]
        posted_payload = post.call_args.kwargs["json"]

        self.assertEqual(prompt_debug["eventSlug"], "fruit-chat")
        self.assertEqual(prompt_debug["model"], "gpt-realtime-mini")
        self.assertEqual(prompt_debug["voice"], "ash")
        self.assertEqual(prompt_debug["tools"], ["student_done"])
        self.assertIn("Use name fruits.", prompt_debug["instructions"])
        self.assertEqual(
            posted_payload["session"]["instructions"],
            prompt_debug["instructions"],
        )
        self.assertIsNone(prompt_debug["reasoning"])
        self.assertNotIn("reasoning", posted_payload["session"])
        self.assertEqual(
            posted_payload["session"]["tools"][0]["name"],
            "student_done",
        )

    @override_settings(OPENAI_API_KEY="test-key")
    def test_realtime_client_secret_sets_minimal_reasoning_for_realtime_2(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={"currentEventSlug": "fruit-chat"},
        )

        class FakeRealtimeResponse:
            status_code = 200

            def json(self):
                return {
                    "client_secret": {
                        "value": "secret-test-value",
                    },
                }

        self.client.force_login(self.user)
        with patch("core.realtime_services.requests.post") as post:
            post.return_value = FakeRealtimeResponse()
            response = self.client.post(
                "/api/realtime/client-secret/",
                data=json.dumps(
                    {
                        "model": "gpt-realtime-2",
                        "sessionId": str(session.id),
                        "voice": "ash",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        prompt_debug = session.runtime_state["runtimeDebug"]["realtimePrompt"]
        posted_payload = post.call_args.kwargs["json"]

        self.assertEqual(
            {"effort": "minimal"},
            posted_payload["session"]["reasoning"],
        )
        self.assertEqual({"effort": "minimal"}, prompt_debug["reasoning"])
