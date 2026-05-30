from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import (
    EventActionStep,
    EventClassifier,
    EventClassifierGroup,
    Experience,
    ExperienceEvent,
    TutoringSession,
    TutorSettings,
)
from core.views import ensure_tutor_settings


FRUIT_SCHEMA = {
    "type": "object",
    "properties": {
        "mentioned": {
            "type": "boolean",
            "description": "Multi-classifier demo with banana, apple, orange detection",
        },
        "context": {
            "type": ["string", "null"],
            "description": "Multi-classifier demo with banana, apple, orange detection",
        },
    },
    "required": ["mentioned", "context"],
    "additionalProperties": False,
}

FRUIT_CLASSIFIER_PROMPTS = {
    "banana": '''Analyze the conversation. Was "banana" mentioned
in the user's most recent message? Consider both explicit mentions and
variations (bananas, banana's, etc.).''',
    "apple": '''Analyze the conversation. Was "apple" mentioned
in the user's most recent message? Consider both the fruit and variations
(apples, apple's). Do NOT count Apple the company/brand.''',
    "orange": '''Analyze the conversation. Was "orange" mentioned
in the user's most recent message? Consider the fruit (oranges, orange juice, etc.)
Do NOT count orange the color unless clearly referring to the fruit.''',
}

CHAT_SYSTEM_TEMPLATE = '''{{#if fruits_mentioned}}You are a friendly assistant tracking fruit mentions.

Fruits mentioned so far: {{fruits_mentioned}}

When responding:
1. Acknowledge any NEW fruits the classifiers detected (the system will tell you)
2. Naturally continue the conversation about fruits
3. If the user says "summary", list all fruits mentioned so far
4. Keep responses brief and fun!{{else}}You are a friendly assistant tracking fruit mentions.

No fruits have been mentioned yet!

Encourage the user to talk about bananas, apples, or oranges.
Keep responses brief and fun!{{/if}}'''

INTRO_SCRIPT = """
Welcome to the Fruit Demo!

This experience demonstrates multi-classifier parallel classification.
I have THREE classifiers running in parallel before each response:
- One checking if you mentioned a banana
- One checking if you mentioned an apple
- One checking if you mentioned an orange

Try talking about fruits and I'll track which ones you've mentioned!
Say "summary" when you want to see the full list.
"""

CELEBRATION_SCRIPT = """
Congratulations! You've mentioned all three fruits!

Your fruit collection: {{fruits_mentioned}}

This demonstrates how multi-classifier parallel classification works:
- Three classifiers ran independently in parallel
- Each checked for a different fruit
- Results were combined in handle_classifications()
- When all three were detected, we transitioned here!

You can restart to try again, or explore other experiences.
"""


class Command(BaseCommand):
    help = "Create or refresh a Fruit test experience for local testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            action="append",
            dest="usernames",
            help="Username to seed. May be passed more than once.",
        )

    def handle(self, *args, **options):
        usernames = options.get("usernames") or [
            "nick",
            "nicklewis",
            "nicky",
        ]
        User = get_user_model()
        users = list(User.objects.filter(username__in=usernames).order_by("id"))
        if not users:
            self.stdout.write(self.style.WARNING("No matching users found."))
            return

        for user in users:
            experience = self.seed_for_user(user)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Seeded Fruit test for {user.username}: {experience.id}"
                )
            )

    def seed_for_user(self, user):
        experience, _ = Experience.objects.get_or_create(
            user=user,
            slug="fruit-test",
            defaults={
                "description": "Multi-classifier demo with banana, apple, orange detection",
                "title": "Fruit Demo",
            },
        )
        experience.title = "Fruit Demo"
        experience.description = "Multi-classifier demo with banana, apple, orange detection"
        experience.save(update_fields=["title", "description", "updated_at"])

        tutor_settings = ensure_tutor_settings(experience)
        TutorSettings.objects.filter(id=tutor_settings.id).update(
            assistant_name="dee-lou",
            avatar_path="test-images/dLU-right.png",
            classification_model="gpt-5.4-mini",
            voice="ash",
        )

        experience.events.all().delete()
        intro = ExperienceEvent.objects.create(
            experience=experience,
            title="Intro",
            slug="intro",
            description="Initialize the fruit state.",
            is_start=True,
            sort_order=0,
        )
        chat = ExperienceEvent.objects.create(
            experience=experience,
            title="Chat",
            slug="fruit-chat",
            description="Main chat with active multi-classification.",
            chat_instructions=CHAT_SYSTEM_TEMPLATE,
            sort_order=1,
        )
        celebration = ExperienceEvent.objects.create(
            experience=experience,
            title="Celebration",
            slug="celebration",
            description="All target fruit have been found.",
            sort_order=2,
        )

        self.create_step(
            intro,
            0,
            "set_context",
            "Reset fruit",
            {"key": "fruits_mentioned", "value": []},
        )
        self.create_step(
            intro,
            1,
            "set_context",
            "Reset new fruit",
            {"key": "newly_mentioned", "value": []},
        )
        self.create_step(
            intro,
            2,
            "script",
            "Welcome",
            {"text": INTRO_SCRIPT},
        )
        self.create_step(
            intro,
            3,
            "goto_event",
            "Start fruit chat",
            {"triggersEvent": "fruit-chat"},
        )

        self.create_step(
            celebration,
            0,
            "script",
            "Celebrate",
            {"text": CELEBRATION_SCRIPT},
        )

        group = EventClassifierGroup.objects.create(
            event=chat,
            title="Fruit classifiers",
            instructions="Return three parallel classifiers - one per fruit.",
            result_context_key="_classifier_results",
            handler_actions=self.fruit_handler_actions(),
            sort_order=0,
        )
        for index, fruit in enumerate(("banana", "apple", "orange")):
            EventClassifier.objects.create(
                group=group,
                name=fruit,
                prompt=FRUIT_CLASSIFIER_PROMPTS[fruit],
                schema=FRUIT_SCHEMA,
                condition={
                    "type": "context_not_contains",
                    "key": "fruits_mentioned",
                    "value": fruit,
                },
                sort_order=index,
            )

        TutoringSession.objects.filter(
            user=user,
            experience=experience,
            status=TutoringSession.Status.ACTIVE,
        ).update(status=TutoringSession.Status.ARCHIVED)
        return experience

    def create_step(self, event, sort_order, action_type, label, config):
        return EventActionStep.objects.create(
            event=event,
            sort_order=sort_order,
            action_type=action_type,
            label=label,
            config=config,
        )

    def fruit_handler_actions(self):
        actions = [
            {
                "id": "reset-newly-mentioned",
                "actionType": "set_context",
                "label": "Reset newly mentioned",
                "config": {"key": "newly_mentioned", "value": []},
                "condition": {},
                "enabled": True,
                "sortOrder": 0,
            }
        ]
        sort_order = 1
        for fruit in ("banana", "apple", "orange"):
            condition = {
                "type": "context_equals",
                "key": f"_classifier_results.{fruit}.mentioned",
                "value": True,
            }
            actions.append(
                {
                    "id": f"append-{fruit}",
                    "actionType": "append_context_list",
                    "label": f"Append {fruit}",
                    "config": {"key": "fruits_mentioned", "value": fruit},
                    "condition": condition,
                    "enabled": True,
                    "sortOrder": sort_order,
                }
            )
            sort_order += 1
            actions.append(
                {
                    "id": f"append-new-{fruit}",
                    "actionType": "append_context_list",
                    "label": f"Append new {fruit}",
                    "config": {"key": "newly_mentioned", "value": fruit},
                    "condition": condition,
                    "enabled": True,
                    "sortOrder": sort_order,
                }
            )
            sort_order += 1

        actions.append(
            {
                "id": "celebrate-all-fruit",
                "actionType": "goto_event",
                "label": "Celebrate",
                "config": {"triggersEvent": "celebration"},
                "condition": {
                    "type": "all",
                    "conditions": [
                        {
                            "type": "context_contains",
                            "key": "fruits_mentioned",
                            "value": "banana",
                        },
                        {
                            "type": "context_contains",
                            "key": "fruits_mentioned",
                            "value": "apple",
                        },
                        {
                            "type": "context_contains",
                            "key": "fruits_mentioned",
                            "value": "orange",
                        },
                    ],
                },
                "enabled": True,
                "sortOrder": sort_order,
            }
        )
        return actions
