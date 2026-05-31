from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0015_interactive_action_types"),
    ]

    operations = [
        migrations.AlterField(
            model_name="eventactionstep",
            name="action_type",
            field=models.CharField(
                choices=[
                    ("script", "Script"),
                    ("set_context", "Set context"),
                    ("append_context_list", "Append context list"),
                    ("get_ui_state", "Get UI state"),
                    ("highlight_on", "Highlight on"),
                    ("highlight_off", "Highlight off"),
                    ("interactive", "Interactive"),
                    ("interactive_update", "Update interactive"),
                    ("interactive_clear", "Clear interactive"),
                    ("chat_availability", "Chat availability"),
                    ("set_ui_trigger", "Set UI trigger"),
                    ("goto_event", "Go to event"),
                    ("button_choice", "Button choice"),
                ],
                default="script",
                max_length=40,
            ),
        ),
    ]
