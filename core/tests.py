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
    script_audio_audio_path,
    script_audio_metadata_path,
    script_audio_words_path,
)
from .models import (
    EventActionStep,
    EventChatTool,
    EventClassifier,
    EventClassifierGroup,
    EventConversationCheck,
    Experience,
    ExperienceEvent,
    SessionMessage,
    TutorSettings,
    TutoringSession,
)
from .views import (
    apply_runtime_actions_to_state,
    build_realtime_instructions,
    cached_script_audio_payload,
    classification_model_choices,
    collect_experience_script_audio_items,
    create_experience_from_export_payload,
    duplicate_experience_for_user,
    evaluate_classifier_group,
    EXPERIENCE_EXPORT_FORMAT,
    EXPERIENCE_EXPORT_VERSION,
    MAIN_PANEL_APP_REGISTRY,
    CLASSIFICATION_MODELS,
    MODEL_OPTIONS,
    REALTIME_MODEL_OPTIONS,
    REALTIME_MODELS,
    REALTIME_VOICE_ORDER,
    REALTIME_VOICES,
    REALTIME_VOICES_BY_MODEL,
    normalize_realtime_voice_choice,
    REGISTERED_MAIN_PANEL_APP_IDS,
    realtime_voice_choices_for_model,
    run_action_sequence,
    serialize_experience,
)


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

    def test_interactive_emitted_actions_are_normalized_before_runtime_apply(self):
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
                            "key": " learner_score ",
                            "type": "set_context",
                            "value": 3,
                        },
                        {
                            "color": "rgba(10, 20, 30, 0.4)",
                            "selector": ".workspace-shell",
                            "type": "highlight_on",
                        },
                        {
                            "noteId": "note-1",
                            "text": "Remember this result.",
                            "type": "add_note",
                        },
                        {
                            "soundPath": "sounds/chime.mp3",
                            "type": "play_sound",
                            "volume": "0.5",
                        },
                        {
                            "message": {"content": "fake assistant message"},
                            "type": "chat_message",
                        },
                        {"key": "", "type": "set_context", "value": "bad"},
                        5,
                    ],
                    "interactiveId": "delivery_data",
                    "state": {"estimate": "22"},
                },
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.runtime_context["learner_score"], 3)
        ui_runtime = session.runtime_state["uiRuntime"]
        self.assertEqual(
            ui_runtime["highlights"][".workspace-shell"]["color"],
            "rgba(10, 20, 30, 0.4)",
        )
        self.assertEqual(
            ui_runtime["notes"],
            [
                {
                    "id": "note-1",
                    "source": "interactive",
                    "text": "Remember this result.",
                }
            ],
        )

        payload = response.json()
        action_types = [action["type"] for action in payload["actions"]]
        self.assertNotIn("chat_message", action_types)
        self.assertIn("play_sound", action_types)
        rejected_reasons = [
            action["reason"]
            for action in payload["actions"]
            if action["type"] == "interactive_action_rejected"
        ]
        self.assertCountEqual(
            rejected_reasons,
            ["unsupported_type", "invalid_context_key", "not_an_object"],
        )
        normalized_context_action = next(
            action
            for action in payload["actions"]
            if action["type"] == "set_context"
            and action.get("key") == "learner_score"
        )
        self.assertEqual(normalized_context_action["source"], "interactive")

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

    def test_interactive_endpoint_rejects_unregistered_app_id(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_state={
                "uiRuntime": {
                    "interactive": {
                        "config": {},
                        "interactiveId": "delivery_data",
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
                    "interactiveId": "custom_form_that_is_not_registered",
                    "state": {},
                },
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Main-panel app is not registered.")

    def test_interactive_update_can_change_submit_destination(self):
        state = apply_runtime_actions_to_state(
            {},
            [
                {
                    "config": {},
                    "interactiveId": "delivery_data",
                    "mode": "table",
                    "title": "Delivery data",
                    "triggersEvent": "first-destination",
                    "type": "interactive",
                },
                {
                    "config": {},
                    "interactiveId": "delivery_data",
                    "mode": "graph",
                    "triggersEvent": "second-destination",
                    "type": "interactive_update",
                },
            ],
        )

        interactive = state["uiRuntime"]["interactive"]
        self.assertEqual(interactive["mode"], "graph")
        self.assertEqual(interactive["triggersEvent"], "second-destination")

    def test_interactive_clear_action_can_run_in_action_sequence(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            event,
            [
                {
                    "actionType": EventActionStep.ActionType.INTERACTIVE,
                    "config": {
                        "config": {},
                        "interactiveId": "delivery_data",
                        "mode": "table",
                        "title": "Delivery data",
                    },
                    "enabled": True,
                    "id": "mount",
                    "sortOrder": 0,
                },
                {
                    "actionType": EventActionStep.ActionType.INTERACTIVE_CLEAR,
                    "config": {},
                    "enabled": True,
                    "id": "clear",
                    "sortOrder": 1,
                },
            ],
        )

        self.assertEqual(messages, [])
        self.assertEqual(next_event_slug, "")
        self.assertEqual(
            [action["type"] for action in actions],
            ["interactive", "interactive_clear"],
        )
        state = apply_runtime_actions_to_state({}, actions)
        self.assertIsNone(state["uiRuntime"]["interactive"])
        self.assertEqual(state["uiRuntime"]["interactiveState"], {})

    def test_chat_availability_action_can_run_in_action_sequence(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            event,
            [
                {
                    "actionType": EventActionStep.ActionType.CHAT_AVAILABILITY,
                    "config": {"enabled": False},
                    "enabled": True,
                    "id": "chat-off",
                    "sortOrder": 0,
                },
            ],
        )

        self.assertEqual(messages, [])
        self.assertEqual(next_event_slug, "")
        self.assertEqual([action["type"] for action in actions], ["chat_availability"])
        self.assertFalse(actions[0]["enabled"])
        state = apply_runtime_actions_to_state({}, actions)
        self.assertFalse(state["uiRuntime"]["chatEnabled"])

    def test_script_image_and_overlay_markers_emit_runtime_cues(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            event,
            [
                {
                    "id": "script-with-visual-markers",
                    "actionType": EventActionStep.ActionType.SCRIPT,
                    "config": {
                        "text": (
                            "Hello [show_image: test-images/dLU-left.png] "
                            "there [overlay: guide, test-images/dLU-right.png] "
                            "friend [add_note: Remember the mark] "
                            "[play_sound: sounds/chime.mp3, 0.4] "
                            "[pause: 500] "
                            "[chat_off] "
                            "[chat_on] "
                            "[overlay_off: guide]."
                        ),
                    },
                    "enabled": True,
                    "sortOrder": 0,
                },
            ],
        )

        self.assertEqual(next_event_slug, "")
        self.assertEqual(actions[0]["type"], "chat_message")
        self.assertEqual(messages[0].content, "Hello there friend .")
        cue_actions = [
            cue["action"] for cue in messages[0].metadata["scriptCues"]
        ]
        self.assertEqual(
            [action["type"] for action in cue_actions],
            [
                "show_image",
                "overlay",
                "add_note",
                "play_sound",
                "pause",
                "chat_availability",
                "chat_availability",
                "overlay_off",
            ],
        )
        self.assertEqual(cue_actions[0]["imagePath"], "test-images/dLU-left.png")
        self.assertEqual(cue_actions[1]["overlayId"], "guide")
        self.assertEqual(cue_actions[1]["imagePath"], "test-images/dLU-right.png")
        self.assertEqual(cue_actions[2]["text"], "Remember the mark")
        self.assertEqual(cue_actions[3]["soundPath"], "sounds/chime.mp3")
        self.assertEqual(cue_actions[3]["volume"], "0.4")
        self.assertEqual(cue_actions[4]["durationMs"], "500")
        self.assertFalse(cue_actions[5]["enabled"])
        self.assertTrue(cue_actions[6]["enabled"])
        self.assertEqual(cue_actions[7]["overlayId"], "guide")

    def test_visual_runtime_actions_update_ui_state(self):
        state = apply_runtime_actions_to_state(
            {},
            [
                {
                    "imagePath": "test-images/dLU-left.png",
                    "type": "show_image",
                },
                {
                    "imagePath": "test-images/dLU-right.png",
                    "overlayId": "guide",
                    "type": "overlay",
                },
                {
                    "noteId": "note-1",
                    "text": "Remember the marked time.",
                    "type": "add_note",
                },
            ],
        )

        ui_runtime = state["uiRuntime"]
        self.assertEqual(ui_runtime["avatarPath"], "test-images/dLU-left.png")
        self.assertEqual(
            ui_runtime["overlays"]["guide"],
            {"id": "guide", "imagePath": "test-images/dLU-right.png"},
        )
        self.assertEqual(
            ui_runtime["notes"],
            [
                {
                    "id": "note-1",
                    "source": "",
                    "text": "Remember the marked time.",
                }
            ],
        )

        state = apply_runtime_actions_to_state(
            state,
            [
                {"overlayId": "guide", "type": "overlay_off"},
                {
                    "noteId": "note-1",
                    "text": "Remember the marked time.",
                    "type": "add_note",
                },
            ],
        )
        self.assertEqual(state["uiRuntime"]["overlays"], {})
        self.assertEqual(len(state["uiRuntime"]["notes"]), 1)

    def test_editor_rejects_unregistered_main_panel_app_action(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/{event.id}/steps/",
            data=json.dumps(
                {
                    "actionType": EventActionStep.ActionType.INTERACTIVE,
                    "config": {
                        "interactiveId": "custom_form_that_is_not_registered",
                        "mode": "default",
                    },
                },
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Main-panel app is not registered.")

    def test_unregistered_script_marker_records_runtime_error_action(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            event,
            [
                {
                    "id": "script-with-missing-app",
                    "actionType": EventActionStep.ActionType.SCRIPT,
                    "config": {
                        "text": "Now try this. [interactive: missing_app, default]"
                    },
                    "enabled": True,
                    "sortOrder": 0,
                },
            ],
        )

        self.assertEqual(next_event_slug, "")
        self.assertEqual(len(messages), 1)
        self.assertEqual(actions[0]["type"], "chat_message")
        cue_action = messages[0].metadata["scriptCues"][0]["action"]
        self.assertEqual(cue_action["type"], "interactive_error")
        self.assertEqual(cue_action["interactiveId"], "missing_app")
        self.assertEqual(cue_action["detail"], "Main-panel app is not registered.")

    def test_legacy_slide_marker_alias_records_slide_error_without_deck(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        actions, messages, next_event_slug = run_action_sequence(
            session,
            event,
            [
                {
                    "id": "script-with-slide-alias",
                    "actionType": EventActionStep.ActionType.SCRIPT,
                    "config": {"text": "Look [slide: 2] here."},
                    "enabled": True,
                    "sortOrder": 0,
                },
            ],
        )

        self.assertEqual(next_event_slug, "")
        self.assertEqual(actions[0]["type"], "chat_message")
        cue_action = messages[0].metadata["scriptCues"][0]["action"]
        self.assertEqual(cue_action["type"], "slide_error")
        self.assertEqual(cue_action["slideRef"], "2")

    def test_backend_registered_apps_match_frontend_registry(self):
        registry_path = (
            settings.BASE_DIR / "frontend" / "src" / "mainPanelAppRegistry.json"
        )
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        frontend_ids = {app["id"] for app in registry}

        self.assertEqual(REGISTERED_MAIN_PANEL_APP_IDS, frontend_ids)
        self.assertEqual(
            {app["id"] for app in MAIN_PANEL_APP_REGISTRY},
            frontend_ids,
        )

    def test_main_panel_apps_endpoint_returns_shared_registry(self):
        self.client.force_login(self.user)

        response = self.client.get("/api/main-panel-apps/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            {app["id"] for app in payload["apps"]},
            REGISTERED_MAIN_PANEL_APP_IDS,
        )


class EventEditorApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="event-editor-api-test",
            email="event-editor-api-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Event editor test",
            slug="event-editor-test",
        )
        self.client.force_login(self.user)

    def test_delete_event_reassigns_start_event(self):
        start = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        next_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Next",
            slug="next",
            sort_order=1,
        )

        response = self.client.delete(
            f"/api/experiences/{self.experience.id}/events/{start.id}/",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(ExperienceEvent.objects.filter(id=start.id).exists())
        next_event.refresh_from_db()
        self.assertTrue(next_event.is_start)
        self.assertEqual(response.json()["events"][0]["slug"], "next")

    def test_delete_last_event_is_rejected(self):
        only_event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Only",
            slug="only",
            is_start=True,
            sort_order=0,
        )

        response = self.client.delete(
            f"/api/experiences/{self.experience.id}/events/{only_event.id}/",
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue(ExperienceEvent.objects.filter(id=only_event.id).exists())
        self.assertEqual(
            response.json()["detail"],
            "An experience needs at least one event.",
        )

    def test_restore_event_from_serialized_payload_preserves_nested_shape(self):
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        event_payload = {
            "chatInstructions": "Stay focused on the restored event.",
            "chatTools": [
                {
                    "description": "Learner is done.",
                    "enabled": True,
                    "handlerActions": [
                        {
                            "actionType": "set_context",
                            "condition": {},
                            "config": {"key": "done", "value": "yes"},
                            "enabled": True,
                            "id": "save-done",
                            "label": "Save done",
                            "sortOrder": 0,
                        }
                    ],
                    "name": "student_done",
                    "parameters": {"type": "object", "properties": {}},
                    "saveArgument": "",
                    "saveContextKey": "",
                    "sortOrder": 0,
                    "triggersEvent": "start",
                }
            ],
            "classifierGroups": [],
            "conversationChecks": [],
            "description": "Restored from undo.",
            "isStart": False,
            "slug": "restored-event",
            "sortOrder": 3,
            "steps": [
                {
                    "actionType": "script",
                    "condition": {},
                    "config": {"text": "Restored line."},
                    "enabled": True,
                    "id": "script-step",
                    "label": "Restored script",
                    "sortOrder": 0,
                }
            ],
            "title": "Restored event",
        }

        response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/",
            data=json.dumps({"event": event_payload}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        event = self.experience.events.get(slug="restored-event")
        self.assertEqual(event.title, "Restored event")
        self.assertEqual(event.chat_instructions, "Stay focused on the restored event.")
        self.assertEqual(event.steps.get().config["text"], "Restored line.")
        tool = event.chat_tools.get(name="student_done")
        self.assertEqual(tool.handler_actions[0]["config"]["key"], "done")


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
        self.assertEqual(items[0]["timedMarkerCount"], 1)
        self.assertEqual(items[0]["timingWordCount"], 2)
        self.assertEqual(items[0]["timingPreview"][1]["word"], "second")

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
            "core.views.evaluate_event_classifier",
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
            "core.views.evaluate_conversation_check",
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
            "core.views.evaluate_conversation_check",
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

        with patch("core.views.evaluate_event_classifier", side_effect=fake_classifier):
            payload, error = evaluate_classifier_group(
                session,
                self.chat_event,
                group,
                {},
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
        with patch("core.views.requests.post") as post:
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
        self.assertEqual(
            posted_payload["session"]["tools"][0]["name"],
            "student_done",
        )


class ExperienceContentMaturityTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="content-maturity-test",
            email="content-maturity-test@example.com",
            password="test-password",
        )
        self.other_user = User.objects.create_user(
            username="content-maturity-import-test",
            email="content-maturity-import-test@example.com",
            password="test-password",
        )

    def create_rich_experience(self):
        experience = Experience.objects.create(
            user=self.user,
            title="Rich experience",
            slug="rich-experience",
            description="A complete authoring shape.",
        )
        TutorSettings.objects.create(
            experience=experience,
            assistant_name="dee-lou",
            avatar_path="test-images/dLU-right.png",
            classification_model="gpt-5.5-pro",
            realtime_model="gpt-realtime",
            script_action_offset_ms=-125,
            system_prompt="Guide the learner.",
            voice="marin",
            voice_instructions="Warm and concise.",
        )
        start = ExperienceEvent.objects.create(
            experience=experience,
            title="Start",
            slug="start",
            description="Entry event.",
            chat_instructions="Use context {{ learner_goal }}.",
            is_start=True,
            sort_order=0,
        )
        done = ExperienceEvent.objects.create(
            experience=experience,
            title="Done",
            slug="done",
            description="Completion event.",
            sort_order=1,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Intro script",
            config={
                "text": (
                    "Look here. [interactive: timing_challenge, timer, done] "
                    "Then submit your mark."
                )
            },
            condition={"type": "context_missing", "key": "intro_seen"},
            enabled=True,
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.INTERACTIVE,
            label="Timing app",
            config={
                "config": {"markedContextKey": "marked_ms", "targetMs": 3200},
                "interactiveId": "timing_challenge",
                "mode": "timer",
                "triggersEvent": "done",
            },
            enabled=True,
            sort_order=1,
        )
        EventActionStep.objects.create(
            event=done,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Done script",
            config={"text": "Marked: {{ marked_ms }}."},
            enabled=True,
            sort_order=0,
        )
        EventChatTool.objects.create(
            event=start,
            name="student_done",
            description="Learner says they are done.",
            parameters={
                "type": "object",
                "properties": {
                    "estimate": {"type": "number", "description": "Their estimate."}
                },
                "required": ["estimate"],
            },
            handler_actions=[
                {
                    "id": "save-estimate",
                    "actionType": "set_context",
                    "config": {"key": "estimate", "value": "{{ estimate }}"},
                    "condition": {},
                    "enabled": True,
                    "label": "Save estimate",
                    "sortOrder": 0,
                }
            ],
            triggers_event="done",
            save_argument="estimate",
            save_context_key="estimate",
            enabled=True,
            sort_order=0,
        )
        EventConversationCheck.objects.create(
            event=start,
            title="Needs help",
            instructions="Detect whether the learner asks for help.",
            result_context_key="needs_help",
            handler_actions=[
                {
                    "id": "note-help",
                    "actionType": "append_context_list",
                    "config": {"key": "flags", "value": "needs_help"},
                    "condition": {},
                    "enabled": True,
                    "label": "Flag help",
                    "sortOrder": 0,
                }
            ],
            triggers_event="done",
            enabled=True,
            sort_order=0,
        )
        group = EventClassifierGroup.objects.create(
            event=start,
            title="Fruit classifiers",
            instructions="Run fruit classifiers.",
            result_context_key="_classifier_results",
            handler_actions=[
                {
                    "id": "append-banana",
                    "actionType": "append_context_list",
                    "config": {"key": "fruits", "value": "banana"},
                    "condition": {
                        "type": "context_equals",
                        "key": "_classifier_results.banana.mentioned",
                        "value": True,
                    },
                    "enabled": True,
                    "label": "Append banana",
                    "sortOrder": 0,
                }
            ],
            triggers_event="done",
            condition={"type": "context_missing", "key": "fruit_done"},
            enabled=True,
            sort_order=0,
        )
        EventClassifier.objects.create(
            group=group,
            name="banana",
            prompt="Detect banana.",
            schema={
                "type": "object",
                "properties": {"mentioned": {"type": "boolean"}},
                "required": ["mentioned"],
                "additionalProperties": False,
            },
            model="gpt-5.4-mini",
            condition={"type": "context_not_contains", "key": "fruits", "value": "banana"},
            enabled=True,
            sort_order=0,
        )
        return experience

    def assert_rich_experience_shape(self, experience):
        tutor = experience.tutor_settings
        self.assertEqual(tutor.realtime_model, "gpt-realtime")
        self.assertEqual(tutor.classification_model, "gpt-5.5-pro")
        self.assertEqual(tutor.script_action_offset_ms, -125)
        self.assertEqual(tutor.voice, "marin")

        start = experience.events.get(slug="start")
        self.assertEqual(start.chat_instructions, "Use context {{ learner_goal }}.")
        steps = list(start.steps.order_by("sort_order"))
        self.assertEqual(steps[0].config["text"].count("[interactive:"), 1)
        self.assertEqual(steps[0].condition["type"], "context_missing")
        self.assertEqual(steps[1].config["interactiveId"], "timing_challenge")
        self.assertEqual(steps[1].config["config"]["targetMs"], 3200)

        tool = start.chat_tools.get(name="student_done")
        self.assertEqual(tool.triggers_event, "done")
        self.assertEqual(tool.save_argument, "estimate")
        self.assertEqual(tool.handler_actions[0]["actionType"], "set_context")

        check = start.conversation_checks.get(title="Needs help")
        self.assertEqual(check.result_context_key, "needs_help")
        self.assertEqual(check.handler_actions[0]["actionType"], "append_context_list")

        group = start.classifier_groups.get(title="Fruit classifiers")
        self.assertEqual(group.condition["type"], "context_missing")
        self.assertEqual(group.handler_actions[0]["config"]["key"], "fruits")
        classifier = group.classifiers.get(name="banana")
        self.assertEqual(classifier.model, "gpt-5.4-mini")
        self.assertEqual(classifier.condition["type"], "context_not_contains")

    def test_duplicate_preserves_rich_experience_shape(self):
        source = self.create_rich_experience()

        duplicate = duplicate_experience_for_user(source, self.user)

        self.assertNotEqual(duplicate.id, source.id)
        self.assertEqual(duplicate.title, "Rich experience copy")
        self.assert_rich_experience_shape(duplicate)

    def test_export_import_preserves_rich_experience_shape(self):
        source = self.create_rich_experience()
        payload = {
            "format": EXPERIENCE_EXPORT_FORMAT,
            "version": EXPERIENCE_EXPORT_VERSION,
            "experience": serialize_experience(source),
        }

        imported, error = create_experience_from_export_payload(self.other_user, payload)

        self.assertEqual(error, "")
        self.assertIsNotNone(imported)
        self.assertEqual(imported.title, "Rich experience")
        self.assert_rich_experience_shape(imported)

    def test_export_endpoint_returns_versioned_dlu_payload(self):
        source = self.create_rich_experience()
        self.client.force_login(self.user)

        response = self.client.get(f"/api/experiences/{source.id}/export/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["format"], EXPERIENCE_EXPORT_FORMAT)
        self.assertEqual(payload["version"], EXPERIENCE_EXPORT_VERSION)
        self.assertEqual(payload["experience"]["title"], "Rich experience")
        self.assertIn(
            ".dlu-experience.json",
            response.headers["Content-Disposition"],
        )

    def test_import_normalizes_legacy_realtime_model_alias(self):
        source = self.create_rich_experience()
        payload = {
            "format": EXPERIENCE_EXPORT_FORMAT,
            "version": EXPERIENCE_EXPORT_VERSION,
            "experience": serialize_experience(source),
        }
        payload["experience"]["tutor"]["realtimeModel"] = "gpt-4o-realtime-preview"

        imported, error = create_experience_from_export_payload(self.other_user, payload)

        self.assertEqual(error, "")
        self.assertIsNotNone(imported)
        self.assertEqual(imported.tutor_settings.realtime_model, "gpt-realtime")

    def test_import_rejects_unregistered_interactive_app_and_rolls_back(self):
        source = self.create_rich_experience()
        payload = {
            "format": EXPERIENCE_EXPORT_FORMAT,
            "version": EXPERIENCE_EXPORT_VERSION,
            "experience": serialize_experience(source),
        }
        payload["experience"]["events"][0]["steps"][1]["config"][
            "interactiveId"
        ] = "missing_app"
        initial_count = Experience.objects.filter(user=self.other_user).count()

        imported, error = create_experience_from_export_payload(self.other_user, payload)

        self.assertIsNone(imported)
        self.assertIn("Main-panel app is not registered.", error)
        self.assertEqual(
            Experience.objects.filter(user=self.other_user).count(),
            initial_count,
        )

    def test_validation_endpoint_reports_routes_orphans_and_app_issues(self):
        source = self.create_rich_experience()
        start = source.events.get(slug="start")
        ExperienceEvent.objects.create(
            experience=source,
            title="Orphan",
            slug="orphan",
            description="No routes point here.",
            sort_order=2,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.GOTO_EVENT,
            label="Missing route",
            config={"triggersEvent": "missing-target"},
            sort_order=2,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.SET_UI_TRIGGER,
            label="Dynamic route",
            config={"triggersEvent": "{{ next_event }}"},
            sort_order=3,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Missing app script",
            config={"text": "Try this. [interactive: missing_app, table, done]"},
            sort_order=4,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Missing slide deck script",
            config={"text": "Look here. [gslide: 2]"},
            sort_order=5,
        )
        self.client.force_login(self.user)

        response = self.client.get(f"/api/experiences/{source.id}/validation/")

        self.assertEqual(response.status_code, 200)
        validation = response.json()["validation"]
        self.assertEqual(validation["eventCount"], 3)
        self.assertGreaterEqual(validation["routeCount"], 8)
        self.assertEqual(validation["dynamicRouteCount"], 1)
        self.assertIn(
            "missing-target",
            [route["target"] for route in validation["unresolvedRoutes"]],
        )
        self.assertNotIn(
            "{{ next_event }}",
            [route["target"] for route in validation["unresolvedRoutes"]],
        )
        self.assertIn(
            "orphan",
            [event["slug"] for event in validation["orphanedEvents"]],
        )
        self.assertIn(
            "missing_app",
            [issue["interactiveId"] for issue in validation["appIssues"]],
        )
        self.assertIn(
            "missing_slide_deck",
            [issue["issueType"] for issue in validation["scriptIssues"]],
        )
        self.assertIn(
            "2",
            [issue["value"] for issue in validation["scriptIssues"]],
        )
        self.assertIn(
            "done",
            [
                route["target"]
                for route in validation["routes"]
                if route["kind"] == "App submit"
            ],
        )

    def test_validation_endpoint_is_scoped_to_owner(self):
        source = self.create_rich_experience()
        self.client.force_login(self.other_user)

        response = self.client.get(f"/api/experiences/{source.id}/validation/")

        self.assertEqual(response.status_code, 404)
