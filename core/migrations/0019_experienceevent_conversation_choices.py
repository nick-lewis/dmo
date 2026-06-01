from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0018_tutorsettings_default_script_action_offset"),
    ]

    operations = [
        migrations.AddField(
            model_name="experienceevent",
            name="conversation_choices",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
