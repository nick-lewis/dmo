import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="TutoringSession",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("title", models.CharField(blank=True, default="", max_length=160)),
                (
                    "status",
                    models.CharField(
                        choices=[("active", "Active"), ("archived", "Archived")],
                        default="active",
                        max_length=20,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="tutoring_sessions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="SessionMessage",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "role",
                    models.CharField(
                        choices=[
                            ("user", "User"),
                            ("assistant", "Assistant"),
                            ("system", "System"),
                            ("error", "Error"),
                        ],
                        max_length=20,
                    ),
                ),
                ("content", models.TextField()),
                ("sequence", models.PositiveIntegerField()),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="core.tutoringsession",
                    ),
                ),
            ],
            options={
                "ordering": ["sequence", "created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="tutoringsession",
            index=models.Index(
                fields=["user", "-updated_at"],
                name="core_tutori_user_id_516d3e_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="sessionmessage",
            index=models.Index(
                fields=["session", "sequence"],
                name="core_sessio_session_8d78dc_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="sessionmessage",
            constraint=models.UniqueConstraint(
                fields=("session", "sequence"),
                name="unique_session_message_sequence",
            ),
        ),
    ]
