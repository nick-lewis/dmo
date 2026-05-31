from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0013_remove_gslide_action_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="tutorsettings",
            name="script_action_offset_ms",
            field=models.IntegerField(default=0),
        ),
    ]
