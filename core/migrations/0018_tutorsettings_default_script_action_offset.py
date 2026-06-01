from django.db import migrations, models


DEFAULT_SCRIPT_ACTION_OFFSET_MS = 800


def move_zero_offsets_to_default(apps, schema_editor):
    TutorSettings = apps.get_model("core", "TutorSettings")
    TutorSettings.objects.filter(script_action_offset_ms=0).update(
        script_action_offset_ms=DEFAULT_SCRIPT_ACTION_OFFSET_MS
    )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0017_experiencesnapshot"),
    ]

    operations = [
        migrations.AlterField(
            model_name="tutorsettings",
            name="script_action_offset_ms",
            field=models.IntegerField(default=DEFAULT_SCRIPT_ACTION_OFFSET_MS),
        ),
        migrations.RunPython(move_zero_offsets_to_default, migrations.RunPython.noop),
    ]
