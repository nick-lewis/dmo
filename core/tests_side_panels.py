from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase

from .models import EventActionStep, Experience, ExperienceEvent, TutoringSession
from .runtime import (
    apply_client_side_panel_state,
    apply_runtime_actions_to_state,
)
from .runtime_execution import run_action_sequence
from .script_markers import resolve_script_marker_action
from .serializers import serialize_experience
from .validation import (
    normalize_emitted_runtime_action,
    validate_action_config,
    validate_side_panels,
)


class SidePanelValidationTests(SimpleTestCase):
    def test_side_panel_action_config_validates(self):
        config, error = validate_action_config(
            EventActionStep.ActionType.SIDE_PANEL,
            {"panelId": " roadmap ", "mode": "available", "source": "next-on-entry-dsl"},
        )
        self.assertEqual(error, "")
        self.assertEqual(
            config,
            {
                "mode": "available",
                "panelId": "roadmap",
                "source": "next-on-entry-dsl",
            },
        )

    def test_side_panel_action_config_defaults_to_open(self):
        config, error = validate_action_config(
            EventActionStep.ActionType.SIDE_PANEL,
            {"panelId": "roadmap"},
        )
        self.assertEqual(error, "")
        self.assertEqual(config, {"mode": "open", "panelId": "roadmap"})

    def test_side_panel_action_config_rejects_bad_payloads(self):
        _, missing_error = validate_action_config(
            EventActionStep.ActionType.SIDE_PANEL,
            {"mode": "open"},
        )
        self.assertTrue(missing_error)

        _, mode_error = validate_action_config(
            EventActionStep.ActionType.SIDE_PANEL,
            {"panelId": "roadmap", "mode": "sideways"},
        )
        self.assertTrue(mode_error)

    def test_highlight_configs_preserve_dsl_source_tag(self):
        on_config, on_error = validate_action_config(
            EventActionStep.ActionType.HIGHLIGHT_ON,
            {
                "selector": ".glow-chat-input",
                "color": "rgba(1, 2, 3, 0.4)",
                "source": "next-on-entry-dsl",
            },
        )
        self.assertEqual(on_error, "")
        self.assertEqual(on_config.get("source"), "next-on-entry-dsl")

        off_config, off_error = validate_action_config(
            EventActionStep.ActionType.HIGHLIGHT_OFF,
            {"selector": ".glow-chat-input", "source": "next-conversation-dsl"},
        )
        self.assertEqual(off_error, "")
        self.assertEqual(off_config.get("source"), "next-conversation-dsl")

    def test_highlight_configs_without_source_stay_untagged(self):
        config, error = validate_action_config(
            EventActionStep.ActionType.HIGHLIGHT_ON,
            {"selector": ".legacy"},
        )
        self.assertEqual(error, "")
        self.assertNotIn("source", config)

    def test_validate_side_panels_normalizes_overrides(self):
        overrides, error = validate_side_panels(
            [
                {"panelId": "roadmap", "title": " Lou's Map ", "iconPath": "icons/map.png"},
                {"panelId": "roadmap", "title": "duplicate ignored"},
            ]
        )
        self.assertEqual(error, "")
        self.assertEqual(
            overrides,
            [{"iconPath": "icons/map.png", "panelId": "roadmap", "title": "Lou's Map"}],
        )

    def test_validate_side_panels_rejects_bad_shapes(self):
        _, not_list = validate_side_panels({"panelId": "roadmap"})
        self.assertTrue(not_list)

        _, missing_id = validate_side_panels([{"title": "No id"}])
        self.assertTrue(missing_id)

    def test_emitted_side_panel_actions_normalize(self):
        action, rejection = normalize_emitted_runtime_action(
            {"type": "side_panel", "panelId": "roadmap", "mode": "open"}
        )
        self.assertIsNone(rejection)
        self.assertEqual(action["panelId"], "roadmap")

        bad_action, bad_rejection = normalize_emitted_runtime_action(
            {"type": "side_panel", "panelId": "", "mode": "open"}
        )
        self.assertIsNone(bad_action)
        self.assertEqual(bad_rejection["reason"], "invalid_side_panel")


class SidePanelMarkerTests(SimpleTestCase):
    def test_panel_on_marker_resolves(self):
        action = resolve_script_marker_action(
            {"markerType": "panel_on", "args": ["roadmap"]},
            {},
            {},
        )
        self.assertEqual(
            action,
            {"mode": "open", "panelId": "roadmap", "type": "side_panel"},
        )

    def test_panel_on_marker_supports_available_mode(self):
        action = resolve_script_marker_action(
            {"markerType": "panel_on", "args": ["roadmap", "available"]},
            {},
            {},
        )
        self.assertEqual(action["mode"], "available")

    def test_panel_off_marker_resolves(self):
        action = resolve_script_marker_action(
            {"markerType": "panel_off", "args": ["roadmap"]},
            {},
            {},
        )
        self.assertEqual(
            action,
            {"mode": "off", "panelId": "roadmap", "type": "side_panel"},
        )

    def test_panel_marker_without_id_resolves_to_nothing(self):
        action = resolve_script_marker_action(
            {"markerType": "panel_on", "args": []},
            {},
            {},
        )
        self.assertIsNone(action)


class SidePanelStateTests(SimpleTestCase):
    def test_open_available_off_semantics(self):
        state = apply_runtime_actions_to_state(
            {},
            [{"type": "side_panel", "panelId": "roadmap", "mode": "open"}],
        )
        self.assertEqual(
            state["uiRuntime"]["sidePanels"],
            {"roadmap": {"available": True, "open": True}},
        )

        # "available" keeps an already-open window open.
        state = apply_runtime_actions_to_state(
            state,
            [{"type": "side_panel", "panelId": "roadmap", "mode": "available"}],
        )
        self.assertEqual(
            state["uiRuntime"]["sidePanels"],
            {"roadmap": {"available": True, "open": True}},
        )

        # State persists across unrelated action applications (events).
        state = apply_runtime_actions_to_state(
            state,
            [{"type": "chat_availability", "enabled": False}],
        )
        self.assertEqual(
            state["uiRuntime"]["sidePanels"],
            {"roadmap": {"available": True, "open": True}},
        )

        state = apply_runtime_actions_to_state(
            state,
            [{"type": "side_panel", "panelId": "roadmap", "mode": "off"}],
        )
        self.assertEqual(state["uiRuntime"]["sidePanels"], {})

    def test_available_mode_does_not_open(self):
        state = apply_runtime_actions_to_state(
            {},
            [{"type": "side_panel", "panelId": "roadmap", "mode": "available"}],
        )
        self.assertEqual(
            state["uiRuntime"]["sidePanels"],
            {"roadmap": {"available": True, "open": False}},
        )

    def test_client_merge_only_flips_open_for_available_panels(self):
        state = apply_runtime_actions_to_state(
            {},
            [{"type": "side_panel", "panelId": "roadmap", "mode": "open"}],
        )

        merged = apply_client_side_panel_state(
            state,
            {
                "sidePanels": {
                    "roadmap": {"available": True, "open": False},
                    "sneaky": {"available": True, "open": True},
                }
            },
        )
        self.assertEqual(
            merged["uiRuntime"]["sidePanels"],
            {"roadmap": {"available": True, "open": False}},
        )

    def test_client_merge_ignores_invalid_payloads(self):
        state = {"uiRuntime": {"sidePanels": {}}}
        merged = apply_client_side_panel_state(state, {"sidePanels": "nope"})
        self.assertEqual(merged["uiRuntime"]["sidePanels"], {})


class SidePanelRuntimeTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(
            username="side-panel-test",
            email="side-panel-test@example.com",
            password="test-password",
        )
        self.experience = Experience.objects.create(
            user=self.user,
            title="Side panel test",
            slug="side-panel-test",
        )
        self.event = ExperienceEvent.objects.create(
            experience=self.experience,
            title="Start",
            slug="start",
        )

    def test_side_panel_step_emits_action(self):
        session = TutoringSession.objects.create(
            user=self.user,
            experience=self.experience,
        )
        actions, _messages, _next_event_slug = run_action_sequence(
            session,
            self.event,
            [
                {
                    "id": "open-roadmap",
                    "actionType": EventActionStep.ActionType.SIDE_PANEL,
                    "config": {"panelId": "roadmap", "mode": "open"},
                    "enabled": True,
                    "sortOrder": 0,
                },
                {
                    "id": "bad-mode",
                    "actionType": EventActionStep.ActionType.SIDE_PANEL,
                    "config": {"panelId": "roadmap", "mode": "sideways"},
                    "enabled": True,
                    "sortOrder": 1,
                },
            ],
        )
        side_panel_actions = [
            action for action in actions if action.get("type") == "side_panel"
        ]
        self.assertEqual(len(side_panel_actions), 1)
        self.assertEqual(side_panel_actions[0]["panelId"], "roadmap")
        self.assertEqual(side_panel_actions[0]["mode"], "open")

    def test_experience_serializes_side_panel_overrides(self):
        self.experience.side_panels = [
            {"iconPath": "", "panelId": "roadmap", "title": "Map"}
        ]
        self.experience.save(update_fields=["side_panels"])
        payload = serialize_experience(self.experience)
        self.assertEqual(
            payload["sidePanels"],
            [{"iconPath": "", "panelId": "roadmap", "title": "Map"}],
        )
