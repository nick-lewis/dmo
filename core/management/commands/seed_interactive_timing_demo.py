from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import (
    EventActionStep,
    Experience,
    ExperienceEvent,
    TutoringSession,
    TutorSettings,
)
from core.views import ensure_tutor_settings


INTRO_SCRIPT = """
This demo uses a registered main-panel app, not a form-built widget.
[interactive: timing_challenge, timer] The app is hard-coded in TypeScript, but the event can mount it from a script.
[interactive_update: timing_challenge, review] The same script can also update the mounted app while the tutor is speaking.
"""

RESULT_SCRIPT = """
Nice, the timing app saved your marked time.

Marked time: {{ marked_ms }} ms
Accuracy: {{ marked_accuracy_ms }} ms
Within tolerance: {{ timing_within_tolerance }}
"""

DEFAULT_USERNAMES = [
    "nick",
    "nicklewis",
    "NickLewis",
    "nicky",
]


class Command(BaseCommand):
    help = "Create or refresh the interactive timing demo for local testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            action="append",
            dest="usernames",
            help="Username to seed. May be passed more than once.",
        )

    def handle(self, *args, **options):
        usernames = options.get("usernames") or DEFAULT_USERNAMES
        User = get_user_model()
        users = list(User.objects.filter(username__in=usernames).order_by("id"))
        if not users:
            self.stdout.write(self.style.WARNING("No matching users found."))
            return

        for user in users:
            experience = self.seed_for_user(user)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Seeded Interactive timing demo for {user.username}: {experience.id}"
                )
            )

    def seed_for_user(self, user):
        experience, _ = Experience.objects.get_or_create(
            user=user,
            slug="interactive-timing-demo",
            defaults={
                "description": (
                    "Scripted speech with timed main-panel app changes and a "
                    "custom timing app."
                ),
                "title": "Interactive timing demo",
            },
        )
        experience.title = "Interactive timing demo"
        experience.description = (
            "Scripted speech with timed main-panel app changes and a custom timing app."
        )
        experience.save(update_fields=["title", "description", "updated_at"])

        tutor_settings = ensure_tutor_settings(experience)
        TutorSettings.objects.filter(id=tutor_settings.id).update(
            assistant_name="dee-lou",
            avatar_path="test-images/dLU-right.png",
            classification_model="gpt-5.4-mini",
            realtime_model="gpt-realtime-mini",
            voice="ash",
        )

        experience.events.all().delete()
        start = ExperienceEvent.objects.create(
            experience=experience,
            title="Start",
            slug="start",
            description="Introduce and mount the timing app.",
            is_start=True,
            sort_order=0,
        )
        submitted = ExperienceEvent.objects.create(
            experience=experience,
            title="Timing submitted",
            slug="timing-submitted",
            description="Confirm the app-emitted context values.",
            sort_order=1,
        )

        EventActionStep.objects.create(
            event=start,
            sort_order=0,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Introduce timing app",
            config={"text": INTRO_SCRIPT},
        )
        EventActionStep.objects.create(
            event=start,
            sort_order=1,
            action_type=EventActionStep.ActionType.INTERACTIVE,
            label="Collect timing mark",
            config={
                "config": {
                    "accuracyContextKey": "marked_accuracy_ms",
                    "markedContextKey": "marked_ms",
                    "targetMs": 3200,
                    "toleranceMs": 450,
                },
                "interactiveId": "timing_challenge",
                "mode": "timer",
                "prompt": "Start the timer, mark a moment, and submit the result.",
                "title": "Timing challenge",
                "triggersEvent": "timing-submitted",
            },
        )
        EventActionStep.objects.create(
            event=submitted,
            sort_order=0,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Report timing result",
            config={"text": RESULT_SCRIPT},
        )

        TutoringSession.objects.filter(
            user=user,
            experience=experience,
            status=TutoringSession.Status.ACTIVE,
        ).update(status=TutoringSession.Status.ARCHIVED)
        return experience
