from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0022_alter_eventactionstep_action_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="tutorsettings",
            name="choice_icon_background",
            field=models.CharField(default="#f8ded8", max_length=40),
        ),
    ]
