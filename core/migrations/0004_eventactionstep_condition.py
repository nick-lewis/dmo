from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_experienceevent_eventactionstep_session_runtime"),
    ]

    operations = [
        migrations.AddField(
            model_name="eventactionstep",
            name="condition",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
