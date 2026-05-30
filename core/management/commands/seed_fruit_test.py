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
        "mentioned": {"type": "boolean"},
        "context": {"type": ["string", "null"]},
    },
    "required": ["mentioned", "context"],
    "additionalProperties": False,
}


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
                "description": "Parallel fruit classifiers with context routing.",
                "title": "Fruit test",
            },
        )
        experience.title = "Fruit test"
        experience.description = "Parallel fruit classifiers with context routing."
        experience.save(update_fields=["title", "description", "updated_at"])

        tutor_settings = ensure_tutor_settings(experience)
        TutorSettings.objects.filter(id=tutor_settings.id).update(
            assistant_name="dee-lou",
            avatar_path="test-images/dLU-right.png",
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
            title="Fruit chat",
            slug="fruit-chat",
            description="Stay here while classifiers watch for fruit mentions.",
            chat_instructions=(
                "You are running the Fruit test. Fruits mentioned so far: "
                "{{fruits_mentioned}}. Newly mentioned this turn: "
                "{{newly_mentioned}}. If newly_mentioned is not empty, briefly "
                "acknowledge it. Ask naturally for any of banana, apple, or "
                "orange not yet mentioned. Do not claim a fruit was mentioned "
                "unless it appears in runtime context."
            ),
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
            {
                "text": (
                    "Let's test the conversation classifiers. Mention banana, "
                    "apple, and orange in any order, and I will keep track."
                )
            },
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
            {
                "text": (
                    "Nice. I have now detected all three fruit: "
                    "{{fruits_mentioned}}."
                )
            },
        )

        group = EventClassifierGroup.objects.create(
            event=chat,
            title="Fruit classifiers",
            instructions=(
                "Run each classifier independently against the user's latest "
                "message. Do not use prior classifier results."
            ),
            result_context_key="_classifier_results",
            handler_actions=self.fruit_handler_actions(),
            sort_order=0,
        )
        for index, fruit in enumerate(("banana", "apple", "orange")):
            EventClassifier.objects.create(
                group=group,
                name=fruit,
                prompt=(
                    f"Return mentioned=true if the learner's latest message "
                    f"mentions {fruit} or {fruit}s. Include a short context "
                    "quote when true; otherwise context=null."
                ),
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
