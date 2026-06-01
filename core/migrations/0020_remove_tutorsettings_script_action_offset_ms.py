from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0019_experienceevent_conversation_choices"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="tutorsettings",
            name="script_action_offset_ms",
        ),
    ]
