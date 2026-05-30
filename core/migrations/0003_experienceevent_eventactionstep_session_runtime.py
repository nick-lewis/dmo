import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_tutorsettings_experience_tutoringsession_experience_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExperienceEvent",
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
                ("title", models.CharField(default="Start", max_length=160)),
                ("slug", models.SlugField(max_length=180)),
                ("description", models.TextField(blank=True, default="")),
                ("is_start", models.BooleanField(default=False)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "experience",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="events",
                        to="core.experience",
                    ),
                ),
            ],
            options={
                "ordering": ["sort_order", "created_at"],
            },
        ),
        migrations.CreateModel(
            name="EventActionStep",
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
                    "action_type",
                    models.CharField(
                        choices=[
                            ("script", "Script"),
                            ("set_context", "Set context"),
                        ],
                        default="script",
                        max_length=40,
                    ),
                ),
                ("label", models.CharField(blank=True, default="", max_length=160)),
                ("config", models.JSONField(blank=True, default=dict)),
                ("enabled", models.BooleanField(default=True)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="steps",
                        to="core.experienceevent",
                    ),
                ),
            ],
            options={
                "ordering": ["sort_order", "created_at"],
            },
        ),
        migrations.AddField(
            model_name="tutoringsession",
            name="runtime_context",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="tutoringsession",
            name="runtime_state",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddIndex(
            model_name="experienceevent",
            index=models.Index(
                fields=["experience", "sort_order"],
                name="core_experi_experie_997895_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="eventactionstep",
            index=models.Index(
                fields=["event", "sort_order"],
                name="core_eventa_event_i_f33e77_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="eventactionstep",
            index=models.Index(
                fields=["action_type"],
                name="core_eventa_action__9770a9_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="experienceevent",
            constraint=models.UniqueConstraint(
                fields=("experience", "slug"),
                name="unique_experience_event_slug",
            ),
        ),
    ]
