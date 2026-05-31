import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import Experience, TutoringSession


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
