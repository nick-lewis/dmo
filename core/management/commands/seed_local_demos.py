from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.management.commands.seed_fruit_test import (
    DEFAULT_USERNAMES as FRUIT_DEFAULT_USERNAMES,
)
from core.management.commands.seed_fruit_test import Command as FruitSeedCommand
from core.management.commands.seed_interactive_timing_demo import (
    DEFAULT_USERNAMES as TIMING_DEFAULT_USERNAMES,
)
from core.management.commands.seed_interactive_timing_demo import (
    Command as TimingSeedCommand,
)
from core.management.commands.seed_python_notebook_code_coach import (
    DEFAULT_USERNAMES as NOTEBOOK_DEFAULT_USERNAMES,
)
from core.management.commands.seed_python_notebook_code_coach import (
    Command as NotebookSeedCommand,
)


class Command(BaseCommand):
    help = "Create or refresh all local demo experiences for testing."

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            action="append",
            dest="usernames",
            help="Username to seed. May be passed more than once.",
        )

    def handle(self, *args, **options):
        usernames = options.get("usernames") or sorted(
            set(
                FRUIT_DEFAULT_USERNAMES
                + TIMING_DEFAULT_USERNAMES
                + NOTEBOOK_DEFAULT_USERNAMES
            )
        )
        User = get_user_model()
        users = list(User.objects.filter(username__in=usernames).order_by("id"))
        if not users:
            self.stdout.write(self.style.WARNING("No matching users found."))
            return

        fruit_seed = FruitSeedCommand()
        timing_seed = TimingSeedCommand()
        notebook_seed = NotebookSeedCommand()

        for user in users:
            fruit = fruit_seed.seed_for_user(user)
            timing = timing_seed.seed_for_user(user)
            notebook = notebook_seed.seed_for_user(user)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Seeded local demos for {user.username}: "
                    f"{fruit.id}, {timing.id}, {notebook.id}"
                )
            )
