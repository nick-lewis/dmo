import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0020_remove_tutorsettings_script_action_offset_ms"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExperienceEventCheckpoint",
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
                    "fingerprint_mode",
                    models.CharField(
                        choices=[
                            ("structural", "Structural"),
                            ("full", "Full"),
                        ],
                        default="structural",
                        max_length=20,
                    ),
                ),
                ("fingerprint", models.CharField(max_length=64)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("summary", models.JSONField(blank=True, default=dict)),
                ("run_count", models.PositiveIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_used_at", models.DateTimeField(auto_now=True)),
                (
                    "event",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="checkpoints",
                        to="core.experienceevent",
                    ),
                ),
                (
                    "experience",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="event_checkpoints",
                        to="core.experience",
                    ),
                ),
                (
                    "source_session",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="event_checkpoints",
                        to="core.tutoringsession",
                    ),
                ),
            ],
            options={
                "ordering": ["-last_used_at", "-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="experienceeventcheckpoint",
            constraint=models.UniqueConstraint(
                fields=("event", "fingerprint_mode", "fingerprint"),
                name="unique_event_checkpoint_fingerprint",
            ),
        ),
        migrations.AddIndex(
            model_name="experienceeventcheckpoint",
            index=models.Index(
                fields=["experience", "event", "-last_used_at"],
                name="core_eventc_experie_36db_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="experienceeventcheckpoint",
            index=models.Index(
                fields=["event", "fingerprint_mode"],
                name="core_eventc_event_i_2f3d_idx",
            ),
        ),
    ]
