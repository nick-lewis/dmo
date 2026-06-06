from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0023_tutorsettings_choice_icon_background"),
    ]

    operations = [
        migrations.AddField(
            model_name="experienceevent",
            name="on_entry_dsl_source",
            field=models.TextField(blank=True, default=""),
        ),
    ]
