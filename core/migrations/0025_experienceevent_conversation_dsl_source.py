from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0024_experienceevent_on_entry_dsl_source"),
    ]

    operations = [
        migrations.AddField(
            model_name="experienceevent",
            name="conversation_dsl_source",
            field=models.TextField(blank=True, default=""),
        ),
    ]
