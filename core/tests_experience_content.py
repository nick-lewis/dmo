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
            system_prompt="Guide the learner.",
            voice="marin",
            voice_instructions="Warm and concise.",
        )
        start = ExperienceEvent.objects.create(
            experience=experience,
            title="Start",
            slug="start",
            description="Entry event.",
            conversation_dsl_source=(
                'button(text="Finish", destination="done", icon=True)\n'
                'set_context(key="seen_start", value=True)'
            ),
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
        self.assertEqual(tutor.voice, "marin")

        start = experience.events.get(slug="start")
        self.assertEqual(start.chat_instructions, "Use context {{ learner_goal }}.")
        self.assertIn("seen_start", start.conversation_dsl_source)
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

    def test_snapshot_endpoint_creates_and_lists_versioned_payloads(self):
        source = self.create_rich_experience()
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/experiences/{source.id}/snapshots/",
            data=json.dumps({"title": "Before graph edits", "note": "Stable checkpoint."}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        snapshot_payload = response.json()["snapshot"]
        self.assertEqual(snapshot_payload["title"], "Before graph edits")
        self.assertEqual(snapshot_payload["note"], "Stable checkpoint.")
        self.assertEqual(snapshot_payload["eventCount"], 2)
        self.assertEqual(snapshot_payload["format"], EXPERIENCE_EXPORT_FORMAT)
        self.assertEqual(snapshot_payload["version"], EXPERIENCE_EXPORT_VERSION)

        snapshot = ExperienceSnapshot.objects.get(id=snapshot_payload["id"])
        self.assertEqual(snapshot.experience, source)
        self.assertEqual(snapshot.user, self.user)
        self.assertEqual(snapshot.payload["experience"]["title"], "Rich experience")
        self.assertEqual(snapshot.payload["experience"]["events"][0]["slug"], "start")

        list_response = self.client.get(f"/api/experiences/{source.id}/snapshots/")

        self.assertEqual(list_response.status_code, 200)
        snapshots = list_response.json()["snapshots"]
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]["id"], snapshot_payload["id"])

    def test_snapshot_export_returns_stored_payload(self):
        source = self.create_rich_experience()
        snapshot = ExperienceSnapshot.objects.create(
            experience=source,
            user=self.user,
            title="Export me",
            payload=experience_export_payload(source),
        )
        source.title = "Edited after snapshot"
        source.save(update_fields=["title", "updated_at"])
        self.client.force_login(self.user)

        response = self.client.get(
            f"/api/experiences/{source.id}/snapshots/{snapshot.id}/export/"
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["format"], EXPERIENCE_EXPORT_FORMAT)
        self.assertEqual(payload["experience"]["title"], "Rich experience")

    def test_snapshot_restore_creates_safe_copy_for_same_user(self):
        source = self.create_rich_experience()
        snapshot = ExperienceSnapshot.objects.create(
            experience=source,
            user=self.user,
            title="Restore point",
            payload=experience_export_payload(source),
        )
        source.description = "Changed after snapshot."
        source.save(update_fields=["description", "updated_at"])
        self.client.force_login(self.user)

        response = self.client.post(
            f"/api/experiences/{source.id}/snapshots/{snapshot.id}/restore/",
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        restored = Experience.objects.get(id=response.json()["experience"]["id"])
        self.assertNotEqual(restored.id, source.id)
        self.assertEqual(restored.user, self.user)
        self.assertEqual(restored.title, "Rich experience restored")
        self.assertEqual(restored.description, "A complete authoring shape.")
        self.assert_rich_experience_shape(restored)
        source.refresh_from_db()
        self.assertEqual(source.description, "Changed after snapshot.")

    def test_snapshot_delete_removes_only_requested_snapshot(self):
        source = self.create_rich_experience()
        first_snapshot = ExperienceSnapshot.objects.create(
            experience=source,
            user=self.user,
            title="Delete me",
            payload=experience_export_payload(source),
        )
        keep_snapshot = ExperienceSnapshot.objects.create(
            experience=source,
            user=self.user,
            title="Keep me",
            payload=experience_export_payload(source),
        )
        self.client.force_login(self.user)

        response = self.client.delete(
            f"/api/experiences/{source.id}/snapshots/{first_snapshot.id}/"
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(ExperienceSnapshot.objects.filter(id=first_snapshot.id).exists())
        self.assertTrue(ExperienceSnapshot.objects.filter(id=keep_snapshot.id).exists())
        snapshots = response.json()["snapshots"]
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]["id"], str(keep_snapshot.id))

    def test_other_user_cannot_access_experience_snapshots(self):
        source = self.create_rich_experience()
        snapshot = ExperienceSnapshot.objects.create(
            experience=source,
            user=self.user,
            title="Private snapshot",
            payload=experience_export_payload(source),
        )
        self.client.force_login(self.other_user)

        list_response = self.client.get(f"/api/experiences/{source.id}/snapshots/")
        export_response = self.client.get(
            f"/api/experiences/{source.id}/snapshots/{snapshot.id}/export/"
        )
        delete_response = self.client.delete(
            f"/api/experiences/{source.id}/snapshots/{snapshot.id}/"
        )
        restore_response = self.client.post(
            f"/api/experiences/{source.id}/snapshots/{snapshot.id}/restore/",
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(list_response.status_code, 404)
        self.assertEqual(export_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)
        self.assertEqual(restore_response.status_code, 404)

    def test_experience_detail_get_returns_serialized_experience(self):
        source = self.create_rich_experience()
        self.client.force_login(self.user)

        response = self.client.get(f"/api/experiences/{source.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["experience"], serialize_experience(source))

    def test_other_user_cannot_fetch_experience_detail(self):
        source = self.create_rich_experience()
        self.client.force_login(self.other_user)

        response = self.client.get(f"/api/experiences/{source.id}/")

        self.assertEqual(response.status_code, 404)

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
