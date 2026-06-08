import json
import tempfile
import wave
from io import StringIO
from pathlib import Path
from threading import Event, Lock
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
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

    def test_create_placeholder_events_get_unique_titles(self):
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="New event",
            slug="new-event",
            sort_order=1,
        )
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="New event",
            slug="new-event-2",
            sort_order=2,
        )

        first_response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/",
            data=json.dumps({"description": "", "title": "New event"}),
            content_type="application/json",
        )
        second_response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/",
            data=json.dumps({"description": "", "title": ""}),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(first_response.json()["event"]["title"], "New event 3")
        self.assertEqual(second_response.json()["event"]["title"], "New event 4")
        self.assertEqual(first_response.json()["event"]["slug"], "new-event-3")
        self.assertEqual(second_response.json()["event"]["slug"], "new-event-4")

    def test_event_patch_persists_conversation_choices(self):
        start = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="Primer",
            slug="primer",
            sort_order=1,
        )

        response = self.client.patch(
            f"/api/experiences/{self.experience.id}/events/{start.id}/",
            data=json.dumps(
                {
                    "conversationDslSource": (
                        'button(text="Yes, quick primer", '
                        'destination="primer", icon=True)\n'
                        'set_context(key="route", value="primer")'
                    ),
                    "conversationChoices": [
                        {
                            "enabled": True,
                            "iconPath": "test-images/dLU-right.png",
                            "id": "quick-primer",
                            "label": "Yes, quick primer",
                            "sortOrder": 0,
                            "triggersEvent": "primer",
                        }
                    ]
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        start.refresh_from_db()
        self.assertIn("set_context", start.conversation_dsl_source)
        self.assertEqual(start.conversation_choices[0]["label"], "Yes, quick primer")
        self.assertEqual(
            start.conversation_choices[0]["iconPath"],
            "test-images/dLU-right.png",
        )
        self.assertEqual(
            response.json()["event"]["conversationChoices"][0]["triggersEvent"],
            "primer",
        )

    def test_editor_generated_action_steps_preserve_source_marker(self):
        start = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="Next",
            slug="next",
            sort_order=1,
        )

        context_response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/{start.id}/steps/",
            data=json.dumps(
                {
                    "actionType": "set_context",
                    "condition": {},
                    "config": {
                        "key": "route",
                        "source": "next-on-entry-dsl",
                        "value": "next",
                    },
                    "enabled": True,
                    "label": "Set route",
                }
            ),
            content_type="application/json",
        )
        goto_response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/{start.id}/steps/",
            data=json.dumps(
                {
                    "actionType": "goto_event",
                    "condition": {},
                    "config": {
                        "source": "next-conversation-dsl",
                        "triggersEvent": "next",
                    },
                    "enabled": True,
                    "label": "Go to next",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(context_response.status_code, 201)
        self.assertEqual(goto_response.status_code, 201)
        self.assertEqual(
            context_response.json()["step"]["config"]["source"],
            "next-on-entry-dsl",
        )
        self.assertEqual(
            goto_response.json()["step"]["config"]["source"],
            "next-conversation-dsl",
        )
        context_step_id = context_response.json()["step"]["id"]
        goto_step_id = goto_response.json()["step"]["id"]

        context_patch_response = self.client.patch(
            f"/api/experiences/{self.experience.id}/events/{start.id}/steps/{context_step_id}/",
            data=json.dumps(
                {
                    "actionType": "set_context",
                    "condition": {},
                    "config": {
                        "key": "route",
                        "source": "next-on-entry-dsl",
                        "value": "patched",
                    },
                    "enabled": True,
                    "label": "Set route",
                }
            ),
            content_type="application/json",
        )
        goto_patch_response = self.client.patch(
            f"/api/experiences/{self.experience.id}/events/{start.id}/steps/{goto_step_id}/",
            data=json.dumps(
                {
                    "actionType": "goto_event",
                    "condition": {},
                    "config": {
                        "source": "next-conversation-dsl",
                        "triggersEvent": "start",
                    },
                    "enabled": True,
                    "label": "Go to start",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(context_patch_response.status_code, 200)
        self.assertEqual(goto_patch_response.status_code, 200)
        self.assertEqual(
            context_patch_response.json()["step"]["config"]["source"],
            "next-on-entry-dsl",
        )
        self.assertEqual(
            goto_patch_response.json()["step"]["config"]["source"],
            "next-conversation-dsl",
        )
        context_step = EventActionStep.objects.get(action_type="set_context")
        goto_step = EventActionStep.objects.get(action_type="goto_event")
        self.assertEqual(context_step.config["source"], "next-on-entry-dsl")
        self.assertEqual(goto_step.config["source"], "next-conversation-dsl")

    def test_experience_patch_persists_choice_icon_background(self):
        response = self.client.patch(
            f"/api/experiences/{self.experience.id}/",
            data=json.dumps(
                {
                    "tutor": {
                        "assistantName": "dee-lou",
                        "avatarPath": "test-images/dLU-right.png",
                        "choiceIconBackground": "#fde2dc",
                        "classificationModel": settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
                        "realtimeModel": settings.DLU_REALTIME_DEFAULT_MODEL,
                        "systemPrompt": "",
                        "voice": settings.DLU_REALTIME_DEFAULT_VOICE,
                        "voiceInstructions": "",
                    }
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.experience.tutor_settings.refresh_from_db()
        self.assertEqual(self.experience.tutor_settings.choice_icon_background, "#fde2dc")
        self.assertEqual(
            response.json()["experience"]["tutor"]["choiceIconBackground"],
            "#fde2dc",
        )

    def test_script_images_lists_built_in_images(self):
        response = self.client.get(
            f"/api/experiences/{self.experience.id}/script-images/",
        )

        self.assertEqual(response.status_code, 200)
        image_paths = {image["path"] for image in response.json()["images"]}
        self.assertIn("test-images/dLU-right.png", image_paths)

    def test_script_images_upload_saves_script_image(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, MEDIA_URL="media/"):
                image = SimpleUploadedFile(
                    "demo.png",
                    b"fake-png-bytes",
                    content_type="image/png",
                )
                response = self.client.post(
                    f"/api/experiences/{self.experience.id}/script-images/",
                    data={"image": image},
                )

                self.assertEqual(response.status_code, 201)
                image_path = response.json()["imagePath"]
                self.assertTrue(image_path.startswith("media/script-images/"))
                self.assertTrue(Path(media_root, image_path.removeprefix("media/")).exists())

                list_response = self.client.get(
                    f"/api/experiences/{self.experience.id}/script-images/",
                )
                image_paths = {
                    item["path"] for item in list_response.json()["images"]
                }
                self.assertIn(image_path, image_paths)

    def test_script_images_delete_uploaded_image(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, MEDIA_URL="media/"):
                image = SimpleUploadedFile(
                    "demo.png",
                    b"fake-png-bytes",
                    content_type="image/png",
                )
                upload_response = self.client.post(
                    f"/api/experiences/{self.experience.id}/script-images/",
                    data={"image": image},
                )
                image_path = upload_response.json()["imagePath"]
                image_file = Path(media_root, image_path.removeprefix("media/"))
                self.assertTrue(image_file.exists())

                delete_response = self.client.delete(
                    f"/api/experiences/{self.experience.id}/script-images/",
                    data=json.dumps({"imagePath": image_path}),
                    content_type="application/json",
                )

                self.assertEqual(delete_response.status_code, 200)
                self.assertFalse(image_file.exists())
                image_paths = {
                    item["path"] for item in delete_response.json()["images"]
                }
                self.assertNotIn(image_path, image_paths)

    def test_script_images_delete_rejects_built_in_image(self):
        response = self.client.delete(
            f"/api/experiences/{self.experience.id}/script-images/",
            data=json.dumps({"imagePath": "test-images/dLU-right.png"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)

    def test_start_event_persists_conversation_choices_without_immediate_action(self):
        TutorSettings.objects.create(
            experience=self.experience,
            choice_icon_background="#fde2dc",
        )
        start = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
            conversation_choices=[
                {
                    "enabled": True,
                    "iconPath": "test-images/dLU-right.png",
                    "id": "continue-choice",
                    "label": "Continue",
                    "sortOrder": 0,
                    "triggersEvent": "next",
                }
            ],
        )
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="Next",
            slug="next",
            sort_order=1,
        )
        EventActionStep.objects.create(
            event=start,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Intro",
            config={"text": "Hello."},
            sort_order=0,
        )
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )

        response = self.client.post(
            f"/api/sessions/{session.id}/start-event/",
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(
            any(action["type"] == "button_choice" for action in payload["actions"])
        )
        buttons = payload["session"]["runtimeState"]["uiRuntime"]["buttons"]
        self.assertEqual(buttons[0]["source"], "conversation-choice")
        self.assertEqual(buttons[0]["label"], "Continue")
        self.assertEqual(buttons[0]["iconBackground"], "#fde2dc")
        self.assertEqual(buttons[0]["iconPath"], "test-images/dLU-right.png")

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
            "conversationDslSource": (
                'button(text="Continue", destination="start", icon=True)\n'
                'set_context(key="done", value="yes")'
            ),
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
        self.assertIn("set_context", event.conversation_dsl_source)
        self.assertEqual(event.steps.get().config["text"], "Restored line.")
        tool = event.chat_tools.get(name="student_done")
        self.assertEqual(tool.handler_actions[0]["config"]["key"], "done")

    def test_reorder_events_updates_sort_order(self):
        first = ExperienceEvent.objects.create(
            experience=self.experience,
            title="First",
            slug="first",
            is_start=True,
            sort_order=0,
        )
        second = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Second",
            slug="second",
            sort_order=1,
        )
        third = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Third",
            slug="third",
            sort_order=2,
        )

        response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/reorder/",
            data=json.dumps(
                {
                    "eventIds": [
                        str(third.id),
                        str(first.id),
                        str(second.id),
                    ]
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [event["slug"] for event in response.json()["events"]],
            ["third", "first", "second"],
        )
        self.assertEqual(
            list(
                self.experience.events.order_by("sort_order").values_list(
                    "slug",
                    "sort_order",
                )
            ),
            [("third", 0), ("first", 1), ("second", 2)],
        )

    def test_reorder_events_requires_every_event_once(self):
        first = ExperienceEvent.objects.create(
            experience=self.experience,
            title="First",
            slug="first",
            is_start=True,
            sort_order=0,
        )
        ExperienceEvent.objects.create(
            experience=self.experience,
            title="Second",
            slug="second",
            sort_order=1,
        )

        response = self.client.post(
            f"/api/experiences/{self.experience.id}/events/reorder/",
            data=json.dumps({"eventIds": [str(first.id), str(first.id)]}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["detail"],
            "Event order must include every event exactly once.",
        )

    def test_recache_slides_endpoint_refreshes_static_script_markers_once(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Intro",
            config={
                "deckUrl": "https://docs.google.com/presentation/d/test-deck/",
                "text": "One [gslide: 2] two [gslide: 2] three [slide: 3].",
            },
            sort_order=0,
        )
        EventChatTool.objects.create(
            event=event,
            name="student_done",
            handler_actions=[
                {
                    "actionType": "script",
                    "config": {
                        "deckUrl": "https://docs.google.com/presentation/d/other-deck/",
                        "text": "Done [gslide: 1].",
                    },
                    "label": "Tool script",
                }
            ],
        )

        class ResolvedSlide:
            cache_hit = False
            filename = "slide.png"
            page_id = "p"
            presentation_id = "presentation"

        with patch("core.slides.resolve_slide_image", return_value=ResolvedSlide()) as resolve:
            response = self.client.post(
                f"/api/experiences/{self.experience.id}/slides/recache/",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["recachedCount"], 3)
        self.assertEqual(payload["skippedCount"], 0)
        self.assertEqual(payload["errorCount"], 0)
        self.assertEqual(
            [
                (call.args[0], call.args[1], call.args[2])
                for call in resolve.call_args_list
            ],
            [
                ("https://docs.google.com/presentation/d/test-deck/", "2", True),
                ("https://docs.google.com/presentation/d/test-deck/", "3", True),
                ("https://docs.google.com/presentation/d/other-deck/", "1", True),
            ],
        )

    def test_recache_slides_endpoint_skips_missing_or_dynamic_slide_targets(self):
        event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            is_start=True,
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Dynamic",
            config={
                "deckUrl": "{{ deck_url }}",
                "text": "One [gslide: 2].",
            },
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=event,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Missing deck",
            config={
                "deckUrl": "",
                "text": "Two [gslide: 3].",
            },
            sort_order=1,
        )

        with patch("core.slides.resolve_slide_image") as resolve:
            response = self.client.post(
                f"/api/experiences/{self.experience.id}/slides/recache/",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["recachedCount"], 0)
        self.assertEqual(payload["skippedCount"], 2)
        self.assertEqual(payload["errorCount"], 0)
        resolve.assert_not_called()
