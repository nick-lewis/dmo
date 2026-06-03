from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import (
    EventActionStep,
    EventChatTool,
    Experience,
    ExperienceEvent,
    TutoringSession,
    TutorSettings,
)
from core.experience_services import ensure_tutor_settings


DEFAULT_USERNAMES = [
    "nick",
    "nicklewis",
    "NickLewis",
    "nicky",
]


START_SCRIPT = """
I set up a Python notebook for you on the left.

Your job is to finish one small function, run the check cell, and then ask me for feedback. I can read the code, see the terminal output, and use any traceback to help you debug.
"""


COACH_CHAT_INSTRUCTIONS = """
You are coaching a Python notebook exercise about normalizing numeric feature values.

The learner should implement `normalize_features(values)` in the Python notebook. The intended behavior is:
- input is a list of numbers
- return a new list where every value is divided by the largest absolute value in the list
- preserve signs
- `[]` returns `[]`
- an all-zero list returns a same-length list of zeros

Do not require a literal reference solution. Accept any implementation with the same behavior.

You can inspect `runtime_context.python_notebook`. Use it as the source of truth for:
- the learner's current code
- stdout and result text
- stderr, errors, and tracebacks
- whether the check cell has run

If there is an error, explain the error in plain language and give one focused next step.
If the notebook has not been run yet, ask the learner to run the check cell or Run all.
If the terminal/output contains `ALL TESTS PASSED`, tell the learner the solution works and call the `solution_complete` function route.
If tests fail, compare the observed failure to the intended behavior and give a hint without dumping the full answer unless the learner asks.
Keep responses concise and practical.
"""


DONE_SCRIPT = """
Nice work. Your code passed the behavioral checks, which is what matters here.

You did not need to match one exact answer. You needed a function that behaves correctly on the edge cases and normal cases, and that is the more useful standard for coding.
"""


NOTEBOOK = {
    "activeCellId": "implement-normalize",
    "executionCount": 0,
    "cells": [
        {
            "id": "assignment",
            "kind": "markdown",
            "source": """### Normalize a feature vector

Finish `normalize_features(values)`.

Rules:
- `[]` should return `[]`
- `[0, 0, 0]` should return `[0, 0, 0]`
- otherwise divide every number by the largest absolute value
- preserve signs
- return a new list

Run the check cell when you think it works, then ask dLU for feedback.""",
        },
        {
            "id": "implement-normalize",
            "kind": "code",
            "source": """def normalize_features(values):
    # TODO: replace this with your solution.
    return values
""",
        },
        {
            "id": "check-instructions",
            "kind": "markdown",
            "source": "Run this check cell. The tutor can see these results and help from the error output.",
        },
        {
            "id": "behavior-checks",
            "kind": "code",
            "source": """def assert_close_list(actual, expected):
    assert isinstance(actual, list), f"Expected a list, got {type(actual).__name__}"
    assert len(actual) == len(expected), f"Expected length {len(expected)}, got {len(actual)}"

    for index, (actual_value, expected_value) in enumerate(zip(actual, expected)):
        difference = abs(actual_value - expected_value)
        assert difference < 1e-9, (
            f"At index {index}, expected {expected_value}, got {actual_value}"
        )


cases = [
    ([], []),
    ([0, 0, 0], [0, 0, 0]),
    ([2, 4, 8], [0.25, 0.5, 1.0]),
    ([-2, 0, 4], [-0.5, 0, 1.0]),
    ([-3, -6], [-0.5, -1.0]),
]

for values, expected in cases:
    original = list(values)
    result = normalize_features(values)
    assert_close_list(result, expected)
    assert values == original, "Do not mutate the input list"

print("ALL TESTS PASSED")
""",
        },
    ],
}


class Command(BaseCommand):
    help = "Create or refresh a Python notebook coaching experience for local testing."

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
                    f"Seeded Python notebook coach for {user.username}: {experience.id}"
                )
            )

    def seed_for_user(self, user):
        experience, _ = Experience.objects.get_or_create(
            user=user,
            slug="python-notebook-code-coach",
            defaults={
                "description": "A Python notebook exercise with tutor code review.",
                "title": "Python notebook code coach",
            },
        )
        experience.title = "Python notebook code coach"
        experience.description = "A Python notebook exercise with tutor code review."
        experience.save(update_fields=["title", "description", "updated_at"])

        tutor_settings = ensure_tutor_settings(experience)
        TutorSettings.objects.filter(id=tutor_settings.id).update(
            assistant_name="dee-lou",
            avatar_path="test-images/dLU-right.png",
            classification_model="gpt-5.4-mini",
            realtime_model="gpt-realtime-mini",
            voice="ash",
            voice_instructions=(
                "Calm, practical coding coach. Be concise and specific."
            ),
        )

        experience.events.all().delete()
        start = ExperienceEvent.objects.create(
            experience=experience,
            title="Set up notebook",
            slug="setup",
            description="Load the starter Python notebook.",
            is_start=True,
            sort_order=0,
        )
        coach = ExperienceEvent.objects.create(
            experience=experience,
            title="Notebook coaching",
            slug="coach",
            description="Coach the learner using notebook code and output.",
            chat_instructions=COACH_CHAT_INSTRUCTIONS,
            sort_order=1,
        )
        done = ExperienceEvent.objects.create(
            experience=experience,
            title="Solution passed",
            slug="solution-passed",
            description="The learner's code passed the behavior checks.",
            sort_order=2,
        )

        EventActionStep.objects.create(
            event=start,
            sort_order=0,
            action_type=EventActionStep.ActionType.PYTHON_NOTEBOOK,
            label="Load notebook exercise",
            config={"notebook": NOTEBOOK},
        )
        EventActionStep.objects.create(
            event=start,
            sort_order=1,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Introduce notebook exercise",
            config={"text": START_SCRIPT},
        )
        EventActionStep.objects.create(
            event=start,
            sort_order=2,
            action_type=EventActionStep.ActionType.GOTO_EVENT,
            label="Start coaching",
            config={"triggersEvent": coach.slug},
        )
        EventActionStep.objects.create(
            event=done,
            sort_order=0,
            action_type=EventActionStep.ActionType.SCRIPT,
            label="Celebrate passed solution",
            config={"text": DONE_SCRIPT},
        )

        EventChatTool.objects.create(
            event=coach,
            name="solution_complete",
            description=(
                "Call this only when runtime_context.python_notebook terminal "
                "or output shows ALL TESTS PASSED for the normalize_features "
                "exercise."
            ),
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": False,
            },
            triggers_event=done.slug,
            sort_order=0,
        )

        TutoringSession.objects.filter(
            user=user,
            experience=experience,
            status=TutoringSession.Status.ACTIVE,
        ).update(status=TutoringSession.Status.ARCHIVED)
        return experience
