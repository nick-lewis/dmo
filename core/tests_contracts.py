import json
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase

from .main_panel_apps import MAIN_PANEL_APP_REGISTRY, REGISTERED_MAIN_PANEL_APP_IDS
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
from .serializers import (
    serialize_experience,
    serialize_message,
    serialize_session,
)


class ActionRegistryContractTests(SimpleTestCase):
    def frontend_action_registry_source(self):
        return (
            settings.BASE_DIR / "frontend" / "src" / "actionRegistry.ts"
        ).read_text(encoding="utf-8")

    def test_frontend_action_registry_matches_backend_action_types(self):
        source = self.frontend_action_registry_source()
        options_match = re.search(
            r"eventActionOptions\s*=\s*\[(.*?)\]\s+as const",
            source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(options_match)

        frontend_action_ids = set(
            re.findall(r"\{\s*id:\s*\"([^\"]+)\"", options_match.group(1))
        )
        backend_action_ids = set(EventActionStep.ActionType.values)
        self.assertEqual(frontend_action_ids, backend_action_ids)

        union_match = re.search(
            r"actionType:\s*(.*?);\n\s*label:",
            (settings.BASE_DIR / "frontend" / "src" / "types.ts").read_text(
                encoding="utf-8"
            ),
            flags=re.DOTALL,
        )
        self.assertIsNotNone(union_match)
        frontend_union_ids = set(
            re.findall(r"\|\s*\"([^\"]+)\"", union_match.group(1))
        )
        self.assertEqual(frontend_union_ids, backend_action_ids)

    def test_frontend_action_registry_has_metadata_for_each_backend_action(self):
        source = self.frontend_action_registry_source()
        backend_action_ids = set(EventActionStep.ActionType.values)

        option_ids = set(
            re.findall(
                r"\{\s*id:\s*\"([^\"]+)\",\s*label:\s*\"[^\"]+\"\s*\}",
                source,
            )
        )
        default_config_ids = set(
            re.findall(r"actionType === \"([^\"]+)\"", source)
        )

        description_match = re.search(
            r"function eventActionDescription\(.*?return \"Script spoken text",
            source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(description_match)
        description_ids = set(
            re.findall(r"actionType === \"([^\"]+)\"", description_match.group(0))
        ) | {EventActionStep.ActionType.SCRIPT}

        tone_match = re.search(
            r"function eventActionToneClass\(.*?return \"speech\";",
            source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(tone_match)
        tone_ids = set(
            re.findall(r"actionType === \"([^\"]+)\"", tone_match.group(0))
        ) | {EventActionStep.ActionType.SCRIPT}

        self.assertEqual(option_ids, backend_action_ids)
        self.assertTrue(backend_action_ids.issubset(default_config_ids))
        self.assertEqual(description_ids, backend_action_ids)
        self.assertEqual(tone_ids, backend_action_ids)


class MainPanelRegistryContractTests(SimpleTestCase):
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


class SerializerShapeContractTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="serializer-contract-test",
            email="serializer-contract-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Contract experience",
            slug="contract-experience",
            description="Payload contract fixture.",
        )
        TutorSettings.objects.create(
            experience=self.experience,
            assistant_name="dee-lou",
            avatar_path="test-images/dLU-right.png",
            classification_model="gpt-5.4-mini",
            realtime_model="gpt-realtime-mini",
            system_prompt="Help briefly.",
            voice="ash",
            voice_instructions="Warm.",
        )
        self.event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
            description="Start here.",
            chat_instructions="Use context.",
            is_start=True,
            sort_order=0,
        )
        EventActionStep.objects.create(
            event=self.event,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Intro",
            config={"text": "Hello."},
            condition={"type": "always"},
            enabled=True,
            sort_order=0,
        )
        EventChatTool.objects.create(
            event=self.event,
            name="student_done",
            description="Learner is done.",
            parameters={"type": "object", "properties": {}, "required": []},
            handler_actions=[],
            triggers_event="done",
            save_argument="answer",
            save_context_key="saved_answer",
            enabled=True,
            sort_order=0,
        )
        EventConversationCheck.objects.create(
            event=self.event,
            title="Confusion",
            instructions="Detect confusion.",
            result_context_key="confused",
            handler_actions=[],
            triggers_event="help",
            enabled=True,
            sort_order=0,
        )
        group = EventClassifierGroup.objects.create(
            event=self.event,
            title="Fruit classifiers",
            instructions="Classify fruit.",
            result_context_key="fruit_results",
            handler_actions=[],
            triggers_event="fruit",
            condition={"type": "always"},
            enabled=True,
            sort_order=0,
        )
        EventClassifier.objects.create(
            group=group,
            name="banana",
            prompt="Detect banana.",
            schema={"type": "object", "properties": {}},
            model="gpt-5.4-mini",
            condition={"type": "always"},
            enabled=True,
            sort_order=0,
        )
        self.session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
            runtime_context={"goal": "test"},
            runtime_state={"currentEventSlug": "start"},
        )
        self.message = SessionMessage.objects.create(
            session=self.session,
            role=SessionMessage.Role.USER,
            content="Hello",
            sequence=1,
            metadata={"source": "test"},
        )

    def test_experience_payload_shape_is_stable(self):
        payload = serialize_experience(self.experience)

        self.assertEqual(
            set(payload),
            {
                "createdAt",
                "description",
                "events",
                "id",
                "slug",
                "title",
                "tutor",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(payload["tutor"]),
            {
                "assistantName",
                "avatarPath",
                "choiceIconBackground",
                "classificationModel",
                "realtimeModel",
                "systemPrompt",
                "voice",
                "voiceInstructions",
            },
        )

        event = payload["events"][0]
        self.assertEqual(
            set(event),
            {
                "chatInstructions",
                "chatTools",
                "classifierGroups",
                "conversationChecks",
                "conversationChoices",
                "createdAt",
                "description",
                "id",
                "experienceId",
                "isStart",
                "onEntryDslSource",
                "slug",
                "sortOrder",
                "steps",
                "title",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(event["steps"][0]),
            {
                "actionType",
                "condition",
                "config",
                "createdAt",
                "enabled",
                "eventId",
                "id",
                "label",
                "sortOrder",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(event["chatTools"][0]),
            {
                "createdAt",
                "description",
                "enabled",
                "eventId",
                "handlerActions",
                "id",
                "name",
                "parameters",
                "saveArgument",
                "saveContextKey",
                "sortOrder",
                "triggersEvent",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(event["conversationChecks"][0]),
            {
                "createdAt",
                "enabled",
                "eventId",
                "handlerActions",
                "id",
                "instructions",
                "resultContextKey",
                "sortOrder",
                "title",
                "triggersEvent",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(event["classifierGroups"][0]),
            {
                "classifiers",
                "condition",
                "createdAt",
                "enabled",
                "eventId",
                "handlerActions",
                "id",
                "instructions",
                "resultContextKey",
                "sortOrder",
                "title",
                "triggersEvent",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(event["classifierGroups"][0]["classifiers"][0]),
            {
                "condition",
                "createdAt",
                "enabled",
                "groupId",
                "id",
                "model",
                "name",
                "prompt",
                "schema",
                "sortOrder",
                "updatedAt",
            },
        )

    def test_session_and_message_payload_shapes_are_stable(self):
        self.assertEqual(
            set(serialize_session(self.session)),
            {
                "createdAt",
                "experienceId",
                "id",
                "runtimeContext",
                "runtimeState",
                "status",
                "title",
                "updatedAt",
            },
        )
        self.assertEqual(
            set(serialize_message(self.message)),
            {
                "content",
                "createdAt",
                "id",
                "metadata",
                "role",
                "sequence",
            },
        )
