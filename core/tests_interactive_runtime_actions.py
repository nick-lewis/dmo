import json
import tempfile
import wave
from io import StringIO
from threading import Event, Lock
from unittest.mock import patch

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
from .main_panel_apps import REGISTERED_MAIN_PANEL_APP_IDS
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

    def test_interactive_can_emit_registered_app_mount_and_update_actions(self):
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
                            "config": {"targetMs": 1500},
                            "interactiveId": "timing_challenge",
                            "mode": "timer",
                            "state": {"markedMs": 0},
                            "title": "Timing challenge",
                            "type": "interactive",
                        },
                        {
                            "config": {"toleranceMs": 100},
                            "interactiveId": "timing_challenge",
                            "mode": "review",
                            "state": {"markedMs": 1490},
                            "title": "Timing review",
                            "triggersEvent": "done",
                            "type": "interactive_update",
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
        ui_runtime = session.runtime_state["uiRuntime"]
        interactive = ui_runtime["interactive"]
        self.assertEqual(interactive["interactiveId"], "timing_challenge")
        self.assertEqual(interactive["mode"], "review")
        self.assertEqual(interactive["title"], "Timing review")
        self.assertEqual(interactive["triggersEvent"], "done")
        self.assertEqual(interactive["config"]["targetMs"], 1500)
        self.assertEqual(interactive["config"]["toleranceMs"], 100)
        self.assertEqual(ui_runtime["interactiveState"], {"markedMs": 1490})

        payload = response.json()
        emitted_app_actions = [
            action
            for action in payload["actions"]
            if action["type"] in {"interactive", "interactive_update"}
        ]
        self.assertEqual(
            [action["type"] for action in emitted_app_actions],
            ["interactive", "interactive_update"],
        )
        self.assertTrue(
            all(action["source"] == "interactive" for action in emitted_app_actions)
        )

    def test_interactive_rejects_emitted_unregistered_app_action(self):
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
                            "interactiveId": "custom_form_that_is_not_registered",
                            "mode": "default",
                            "type": "interactive",
                        }
                    ],
                    "interactiveId": "delivery_data",
                    "state": {},
                },
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        ui_runtime = session.runtime_state["uiRuntime"]
        self.assertEqual(ui_runtime["interactive"]["interactiveId"], "delivery_data")

        rejected_actions = [
            action
            for action in response.json()["actions"]
            if action["type"] == "interactive_action_rejected"
        ]
        self.assertEqual(len(rejected_actions), 1)
        self.assertEqual(rejected_actions[0]["reason"], "invalid_interactive")

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

    def test_python_notebook_run_persists_state_and_runtime_context(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )
        self.client.force_login(self.user)
        notebook = {
            "activeCellId": "code-1",
            "cells": [
                {
                    "id": "md-1",
                    "kind": "markdown",
                    "source": "### Work",
                },
                {
                    "id": "code-1",
                    "kind": "code",
                    "source": "x = 2\nx + 3",
                },
            ],
            "executionCount": 0,
        }

        response = self.client.post(
            f"/api/sessions/{session.id}/notebook/",
            data=json.dumps(
                {
                    "action": "run",
                    "cellId": "code-1",
                    "notebook": notebook,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        code_cell = payload["notebook"]["cells"][1]
        self.assertEqual(code_cell["output"]["result"], "5")
        self.assertEqual(code_cell["output"]["status"], "ok")
        session.refresh_from_db()
        saved_notebook = session.runtime_state["uiRuntime"]["leftPanels"][
            "pythonNotebook"
        ]
        self.assertEqual(saved_notebook["cells"][1]["output"]["result"], "5")
        context_notebook = session.runtime_context["python_notebook"]
        self.assertIn("x = 2", context_notebook["cells"][1]["source"])
        self.assertIn("result: 5", context_notebook["terminal"])
        self.assertEqual(payload["actions"][0]["type"], "python_notebook")

    def test_python_notebook_event_action_loads_panel_and_context(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start notebook",
            slug="start-notebook",
            is_start=True,
        )
        notebook = {
            "activeCellId": "code-task",
            "cells": [
                {
                    "id": "md-task",
                    "kind": "markdown",
                    "source": "### Task",
                },
                {
                    "id": "code-task",
                    "kind": "code",
                    "source": "answer = 42",
                },
            ],
            "executionCount": 0,
        }
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.PYTHON_NOTEBOOK,
            config={"notebook": notebook},
            label="Load starter notebook",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/sessions/{session.id}/start-event/",
            data=json.dumps({"uiState": {}}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["actions"][0]["type"], "python_notebook")
        session.refresh_from_db()
        saved_notebook = session.runtime_state["uiRuntime"]["leftPanels"][
            "pythonNotebook"
        ]
        self.assertEqual(saved_notebook["activeCellId"], "code-task")
        self.assertIn(
            "answer = 42",
            session.runtime_context["python_notebook"]["cells"][1]["source"],
        )

    def test_python_notebook_run_preserves_prior_code_state_for_target_cell(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/sessions/{session.id}/notebook/",
            data=json.dumps(
                {
                    "action": "run",
                    "cellId": "code-2",
                    "notebook": {
                        "cells": [
                            {
                                "id": "code-1",
                                "kind": "code",
                                "source": "base = 10",
                            },
                            {
                                "id": "code-2",
                                "kind": "code",
                                "source": "base * 4",
                            },
                        ],
                    },
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        cells = response.json()["notebook"]["cells"]
        self.assertEqual(cells[1]["output"]["result"], "40")

    def test_python_notebook_format_updates_code_cell(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/sessions/{session.id}/notebook/",
            data=json.dumps(
                {
                    "action": "format",
                    "cellId": "code-1",
                    "notebook": {
                        "cells": [
                            {
                                "id": "code-1",
                                "kind": "code",
                                "source": "x=1+2   ",
                            }
                        ]
                    },
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        source = response.json()["notebook"]["cells"][0]["source"]
        self.assertIn("x", source)
        self.assertTrue(source.endswith("\n"))

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
                            "[agent_image_off] "
                            "there [overlay: guide, test-images/dLU-right.png] "
                            "[side_image: right, show, test-images/dLU-left.png] "
                            "friend [add_note: Remember the mark] "
                            "[play_sound: sounds/chime.mp3, 0.4] "
                            "[pause: 500] "
                            "[chat_off] "
                            "[chat_on] "
                            "[side_image: right, hide] "
                            "[agent_image_on] "
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
                "agent_image_visibility",
                "overlay",
                "side_image",
                "add_note",
                "play_sound",
                "pause",
                "chat_availability",
                "chat_availability",
                "side_image",
                "agent_image_visibility",
                "overlay_off",
            ],
        )
        self.assertEqual(cue_actions[0]["imagePath"], "test-images/dLU-left.png")
        self.assertFalse(cue_actions[1]["visible"])
        self.assertEqual(cue_actions[2]["overlayId"], "guide")
        self.assertEqual(cue_actions[2]["imagePath"], "test-images/dLU-right.png")
        self.assertEqual(cue_actions[3]["slot"], "right")
        self.assertTrue(cue_actions[3]["visible"])
        self.assertEqual(cue_actions[3]["imagePath"], "test-images/dLU-left.png")
        self.assertEqual(cue_actions[4]["text"], "Remember the mark")
        self.assertEqual(cue_actions[5]["soundPath"], "sounds/chime.mp3")
        self.assertEqual(cue_actions[5]["volume"], "0.4")
        self.assertEqual(cue_actions[6]["durationMs"], "500")
        self.assertFalse(cue_actions[7]["enabled"])
        self.assertTrue(cue_actions[8]["enabled"])
        self.assertEqual(cue_actions[9]["slot"], "right")
        self.assertFalse(cue_actions[9]["visible"])
        self.assertTrue(cue_actions[10]["visible"])
        self.assertEqual(cue_actions[11]["overlayId"], "guide")

    def test_script_markers_can_use_explicit_timeline_times(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        _, messages, _ = run_action_sequence(
            session,
            event,
            [
                {
                    "id": "script-with-timeline-markers",
                    "actionType": EventActionStep.ActionType.SCRIPT,
                    "config": {
                        "text": (
                            "Hello [show_image: test-images/dLU-left.png, @1250ms] "
                            "there [play_sound: sounds/chime.mp3, 0.4, @1.75s]."
                        ),
                    },
                    "enabled": True,
                    "sortOrder": 0,
                },
            ],
        )

        cues = messages[0].metadata["scriptCues"]
        self.assertEqual(cues[0]["time"], 1.25)
        self.assertEqual(cues[1]["time"], 1.75)
        self.assertEqual(cues[0]["action"]["imagePath"], "test-images/dLU-left.png")
        self.assertEqual(cues[1]["action"]["soundPath"], "sounds/chime.mp3")
        self.assertEqual(cues[1]["action"]["volume"], "0.4")

        aligned_cues = script_cues_with_word_times(
            cues,
            [
                {"word": "Hello", "start": 0.0, "end": 0.4},
                {"word": "there", "start": 0.4, "end": 0.9},
            ],
        )
        self.assertEqual(aligned_cues[0]["time"], 1.25)
        self.assertEqual(aligned_cues[1]["time"], 1.75)

    def test_script_cue_word_times_align_when_transcript_skips_prefix(self):
        script = "Ah hello there my name is D-Lou and Now the idea is simple"
        words = [
            {"word": "Now", "start": 9.88, "end": 10.32},
            {"word": "the", "start": 10.32, "end": 10.38},
            {"word": "idea", "start": 10.38, "end": 10.7},
            {"word": "is", "start": 10.7, "end": 10.9},
            {"word": "simple", "start": 10.9, "end": 11.2},
        ]

        aligned_cues = script_cues_with_word_times(
            [
                {"progress": 0.02, "wordIndex": 2},
                {"progress": 0.72, "wordIndex": 8},
            ],
            words,
            script,
        )

        self.assertEqual(aligned_cues[0]["time"], 0.224)
        self.assertEqual(aligned_cues[1]["time"], 9.88)

    def test_script_cue_word_times_align_when_timing_splits_script_word(self):
        script = "Ah hello there my name is D-Lou and Now the idea is simple"
        words = [
            {"word": "Ah", "start": 0.0, "end": 0.2},
            {"word": "hello", "start": 0.3, "end": 0.6},
            {"word": "there", "start": 0.7, "end": 1.0},
            {"word": "my", "start": 1.1, "end": 1.3},
            {"word": "name", "start": 1.4, "end": 1.6},
            {"word": "is", "start": 1.7, "end": 1.8},
            {"word": "D", "start": 1.9, "end": 2.0},
            {"word": "Lou", "start": 2.0, "end": 2.2},
            {"word": "and", "start": 2.4, "end": 2.6},
            {"word": "Now", "start": 2.8, "end": 3.0},
            {"word": "the", "start": 3.0, "end": 3.1},
            {"word": "idea", "start": 3.1, "end": 3.4},
            {"word": "is", "start": 3.4, "end": 3.5},
            {"word": "simple", "start": 3.5, "end": 3.9},
        ]

        aligned_cues = script_cues_with_word_times(
            [
                {"progress": 0.1, "wordIndex": 6},
                {"progress": 0.8, "wordIndex": 7},
            ],
            words,
            script,
        )

        self.assertEqual(aligned_cues[0]["time"], 1.9)
        self.assertEqual(aligned_cues[1]["time"], 2.4)

    def test_visual_runtime_actions_update_ui_state(self):
        state = apply_runtime_actions_to_state(
            {},
            [
                {
                    "imagePath": "test-images/dLU-left.png",
                    "type": "show_image",
                },
                {
                    "type": "agent_image_visibility",
                    "visible": False,
                },
                {
                    "imagePath": "test-images/dLU-right.png",
                    "overlayId": "guide",
                    "type": "overlay",
                },
                {
                    "imagePath": "test-images/dLU-right.png",
                    "slot": "right",
                    "type": "side_image",
                    "visible": True,
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
        self.assertFalse(ui_runtime["avatarVisible"])
        self.assertEqual(
            ui_runtime["overlays"]["guide"],
            {"id": "guide", "imagePath": "test-images/dLU-right.png"},
        )
        self.assertEqual(
            ui_runtime["images"]["left"],
            {
                "imagePath": "test-images/dLU-left.png",
                "slot": "left",
                "visible": False,
            },
        )
        self.assertEqual(
            ui_runtime["images"]["right"],
            {
                "imagePath": "test-images/dLU-right.png",
                "slot": "right",
                "visible": True,
            },
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
                    "imagePath": "test-images/dLU-right.png",
                    "type": "show_image",
                },
                {
                    "slot": "right",
                    "type": "side_image",
                    "visible": False,
                },
                {
                    "noteId": "note-1",
                    "text": "Remember the marked time.",
                    "type": "add_note",
                },
            ],
        )
        self.assertEqual(state["uiRuntime"]["overlays"], {})
        self.assertTrue(state["uiRuntime"]["avatarVisible"])
        self.assertFalse(state["uiRuntime"]["images"]["right"]["visible"])
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

    def test_main_panel_apps_endpoint_returns_shared_registry(self):
        self.client.force_login(self.user)

        response = self.client.get("/api/main-panel-apps/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            {app["id"] for app in payload["apps"]},
            REGISTERED_MAIN_PANEL_APP_IDS,
        )
