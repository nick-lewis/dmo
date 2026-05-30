from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_classifier_groups_event_chat_instructions"),
    ]

    operations = [
        migrations.AddField(
            model_name="tutorsettings",
            name="classification_model",
            field=models.CharField(default="gpt-5.4-mini", max_length=100),
        ),
    ]
