import json
import re

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.text import slugify

from .models import (
    EventActionStep,
    EventChatTool,
    EventClassifier,
    EventClassifierGroup,
    EventConversationCheck,
    Experience,
    ExperienceEvent,
    ExperienceSnapshot,
    TutoringSession,
    TutorSettings,
)
from .realtime_services import (
    classification_model_choices,
    default_realtime_voice_for_model,
    normalize_realtime_choice,
    normalize_realtime_model_choice,
    normalize_realtime_voice_choice,
)
from .validation import (
    DEFAULT_CHOICE_ICON_BACKGROUND,
    normalize_conversation_choices,
    normalize_choice_icon_background,
    validate_action_sequence,
    validate_conversation_choices,
)


DEFAULT_EXPERIENCE_TITLE = "Untitled experience"
DEFAULT_START_EVENT_TITLE = "Start"
DEFAULT_SCRIPT_STEP_LABEL = "Say"
EXPERIENCE_EXPORT_FORMAT = "dlu.experience"
EXPERIENCE_EXPORT_VERSION = 1


def unique_experience_slug(user, title):
    base_slug = slugify(title or DEFAULT_EXPERIENCE_TITLE) or "experience"
    candidate = base_slug
    suffix = 2

    while Experience.objects.filter(user=user, slug=candidate).exists():
        candidate = f"{base_slug}-{suffix}"
        suffix += 1

    return candidate


def unique_event_slug(experience, title):
    base_slug = slugify(title or DEFAULT_START_EVENT_TITLE) or "event"
    candidate = base_slug
    suffix = 2

    while ExperienceEvent.objects.filter(
        experience=experience,
        slug=candidate,
    ).exists():
        candidate = f"{base_slug}-{suffix}"
        suffix += 1

    return candidate


def create_default_experience(user):
    experience = Experience.objects.create(
        user=user,
        title=DEFAULT_EXPERIENCE_TITLE,
        slug=unique_experience_slug(user, DEFAULT_EXPERIENCE_TITLE),
        description="",
    )
    ensure_tutor_settings(experience)
    ensure_start_event(experience)
    return experience


def ensure_tutor_settings(experience):
    tutor_settings, _ = TutorSettings.objects.get_or_create(
        experience=experience,
        defaults={
            "assistant_name": "dee-lou",
            "avatar_path": "test-images/dLU-right.png",
            "choice_icon_background": DEFAULT_CHOICE_ICON_BACKGROUND,
            "classification_model": settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
            "realtime_model": settings.DLU_REALTIME_DEFAULT_MODEL,
            "voice": settings.DLU_REALTIME_DEFAULT_VOICE,
            "system_prompt": settings.DLU_REALTIME_DEFAULT_INSTRUCTIONS,
            "voice_instructions": "",
        },
    )
    if not tutor_settings.classification_model:
        tutor_settings.classification_model = settings.DLU_CLASSIFICATION_DEFAULT_MODEL
        tutor_settings.save(update_fields=["classification_model", "updated_at"])
    normalized_choice_icon_background = normalize_choice_icon_background(
        tutor_settings.choice_icon_background
    )
    if tutor_settings.choice_icon_background != normalized_choice_icon_background:
        tutor_settings.choice_icon_background = normalized_choice_icon_background
        tutor_settings.save(update_fields=["choice_icon_background", "updated_at"])
    normalized_realtime_model = normalize_realtime_model_choice(
        tutor_settings.realtime_model,
        settings.DLU_REALTIME_DEFAULT_MODEL,
    )
    if normalized_realtime_model is None:
        normalized_realtime_model = settings.DLU_REALTIME_DEFAULT_MODEL
    if tutor_settings.realtime_model != normalized_realtime_model:
        tutor_settings.realtime_model = normalized_realtime_model
        tutor_settings.save(update_fields=["realtime_model", "updated_at"])
    normalized_voice = normalize_realtime_voice_choice(
        None,
        tutor_settings.voice,
        tutor_settings.realtime_model,
    )
    if normalized_voice and tutor_settings.voice != normalized_voice:
        tutor_settings.voice = normalized_voice
        tutor_settings.save(update_fields=["voice", "updated_at"])
    return tutor_settings


def ensure_default_event_step(event):
    if event.steps.exists():
        return event.steps.order_by("sort_order", "created_at").first()

    return EventActionStep.objects.create(
        event=event,
        action_type=EventActionStep.ActionType.SCRIPT,
        label=DEFAULT_SCRIPT_STEP_LABEL,
        config={"text": ""},
        sort_order=0,
    )


def ensure_start_event(experience):
    start_event = (
        experience.events.filter(is_start=True)
        .order_by("sort_order", "created_at")
        .first()
    )
    if not start_event:
        start_event = experience.events.order_by("sort_order", "created_at").first()

    if start_event:
        if not start_event.is_start:
            start_event.is_start = True
            start_event.save(update_fields=["is_start", "updated_at"])
    else:
        start_event = ExperienceEvent.objects.create(
            experience=experience,
            title=DEFAULT_START_EVENT_TITLE,
            slug=unique_event_slug(experience, DEFAULT_START_EVENT_TITLE),
            is_start=True,
            sort_order=0,
        )

    ExperienceEvent.objects.filter(
        experience=experience,
        is_start=True,
    ).exclude(id=start_event.id).update(is_start=False)
    ensure_default_event_step(start_event)
    return start_event


def update_experience_from_data(experience, data):
    if "title" in data:
        title = str(data.get("title", "")).strip()
        if not title:
            return None, "Title is required."
        if len(title) > 160:
            return None, "Title is too long."
        experience.title = title

    if "description" in data:
        description = str(data.get("description", "")).strip()
        if len(description) > 4000:
            return None, "Description is too long."
        experience.description = description

    tutor_data = data.get("tutor")
    tutor_settings = ensure_tutor_settings(experience)
    if tutor_data is not None:
        if not isinstance(tutor_data, dict):
            return None, "Tutor settings must be an object."

        if "assistantName" in tutor_data:
            assistant_name = str(tutor_data.get("assistantName", "")).strip()
            if not assistant_name:
                return None, "Tutor name is required."
            if len(assistant_name) > 100:
                return None, "Tutor name is too long."
            tutor_settings.assistant_name = assistant_name

        if "avatarPath" in tutor_data:
            avatar_path = str(tutor_data.get("avatarPath", "")).strip()
            if not avatar_path:
                return None, "Avatar path is required."
            if ".." in avatar_path or avatar_path.startswith(("/", "\\")):
                return None, "Avatar path is not supported."
            if len(avatar_path) > 220:
                return None, "Avatar path is too long."
            tutor_settings.avatar_path = avatar_path

        if "choiceIconBackground" in tutor_data:
            raw_background = str(tutor_data.get("choiceIconBackground", "") or "").strip()
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", raw_background):
                return None, "Choice icon background must be a hex color."
            tutor_settings.choice_icon_background = raw_background.lower()

        if "realtimeModel" in tutor_data:
            model = normalize_realtime_model_choice(
                tutor_data.get("realtimeModel"),
                settings.DLU_REALTIME_DEFAULT_MODEL,
            )
            if model is None:
                return None, "Realtime model is not supported."
            tutor_settings.realtime_model = model

        if "classificationModel" in tutor_data:
            classification_model = normalize_realtime_choice(
                tutor_data.get("classificationModel"),
                classification_model_choices(),
                settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
            )
            if classification_model is None:
                return None, "Classification model is not supported."
            tutor_settings.classification_model = classification_model

        if "voice" in tutor_data:
            voice = normalize_realtime_voice_choice(
                tutor_data.get("voice"),
                settings.DLU_REALTIME_DEFAULT_VOICE,
                tutor_settings.realtime_model,
            )
            if voice is None:
                return None, "Realtime voice is not supported."
            tutor_settings.voice = voice

        if "systemPrompt" in tutor_data:
            system_prompt = str(tutor_data.get("systemPrompt", "")).strip()
            if len(system_prompt) > 12000:
                return None, "System prompt is too long."
            tutor_settings.system_prompt = system_prompt

        if "voiceInstructions" in tutor_data:
            voice_instructions = str(tutor_data.get("voiceInstructions", "")).strip()
            if len(voice_instructions) > 4000:
                return None, "Voice instructions are too long."
            tutor_settings.voice_instructions = voice_instructions

        tutor_settings.save()

    experience.save()
    return experience, ""


def clone_json(value, fallback):
    try:
        return json.loads(json.dumps(value if value is not None else fallback))
    except (TypeError, ValueError):
        return fallback


def duplicate_experience_for_user(source, user):
    source_tutor = ensure_tutor_settings(source)
    copy_title = f"{source.title} copy"[:160]

    with transaction.atomic():
        duplicate = Experience.objects.create(
            user=user,
            title=copy_title,
            slug=unique_experience_slug(user, copy_title),
            description=source.description,
        )
        duplicate_tutor = ensure_tutor_settings(duplicate)
        duplicate_tutor.assistant_name = source_tutor.assistant_name
        duplicate_tutor.avatar_path = source_tutor.avatar_path
        duplicate_tutor.choice_icon_background = source_tutor.choice_icon_background
        duplicate_tutor.realtime_model = source_tutor.realtime_model
        duplicate_tutor.classification_model = source_tutor.classification_model
        duplicate_tutor.voice = source_tutor.voice
        duplicate_tutor.system_prompt = source_tutor.system_prompt
        duplicate_tutor.voice_instructions = source_tutor.voice_instructions
        duplicate_tutor.save()

        for source_event in source.events.order_by("sort_order", "created_at"):
            duplicate_event = ExperienceEvent.objects.create(
                experience=duplicate,
                title=source_event.title,
                slug=source_event.slug,
                description=source_event.description,
                on_entry_dsl_source=source_event.on_entry_dsl_source,
                conversation_dsl_source=source_event.conversation_dsl_source,
                chat_instructions=source_event.chat_instructions,
                conversation_choices=clone_json(
                    normalize_conversation_choices(source_event.conversation_choices),
                    [],
                ),
                is_start=source_event.is_start,
                sort_order=source_event.sort_order,
            )
            for source_step in source_event.steps.order_by("sort_order", "created_at"):
                EventActionStep.objects.create(
                    event=duplicate_event,
                    action_type=source_step.action_type,
                    label=source_step.label,
                    config=clone_json(source_step.config, {}),
                    condition=clone_json(source_step.condition, {}),
                    enabled=source_step.enabled,
                    sort_order=source_step.sort_order,
                )
            for source_tool in source_event.chat_tools.order_by(
                "sort_order",
                "created_at",
            ):
                EventChatTool.objects.create(
                    event=duplicate_event,
                    name=source_tool.name,
                    description=source_tool.description,
                    parameters=clone_json(source_tool.parameters, {}),
                    handler_actions=clone_json(source_tool.handler_actions, []),
                    triggers_event=source_tool.triggers_event,
                    save_argument=source_tool.save_argument,
                    save_context_key=source_tool.save_context_key,
                    enabled=source_tool.enabled,
                    sort_order=source_tool.sort_order,
                )
            for source_check in source_event.conversation_checks.order_by(
                "sort_order",
                "created_at",
            ):
                EventConversationCheck.objects.create(
                    event=duplicate_event,
                    title=source_check.title,
                    instructions=source_check.instructions,
                    result_context_key=source_check.result_context_key,
                    handler_actions=clone_json(source_check.handler_actions, []),
                    triggers_event=source_check.triggers_event,
                    enabled=source_check.enabled,
                    sort_order=source_check.sort_order,
                )
            for source_group in source_event.classifier_groups.order_by(
                "sort_order",
                "created_at",
            ):
                duplicate_group = EventClassifierGroup.objects.create(
                    event=duplicate_event,
                    title=source_group.title,
                    instructions=source_group.instructions,
                    result_context_key=source_group.result_context_key,
                    handler_actions=clone_json(source_group.handler_actions, []),
                    triggers_event=source_group.triggers_event,
                    condition=clone_json(source_group.condition, {}),
                    enabled=source_group.enabled,
                    sort_order=source_group.sort_order,
                )
                for source_classifier in source_group.classifiers.order_by(
                    "sort_order",
                    "created_at",
                ):
                    EventClassifier.objects.create(
                        group=duplicate_group,
                        name=source_classifier.name,
                        prompt=source_classifier.prompt,
                        schema=clone_json(source_classifier.schema, {}),
                        model=source_classifier.model,
                        condition=clone_json(source_classifier.condition, {}),
                        enabled=source_classifier.enabled,
                        sort_order=source_classifier.sort_order,
                    )

    return duplicate


def import_string(value, fallback="", max_length=4000, strip=True):
    if value is None:
        text = fallback
    else:
        text = str(value)
    if strip:
        text = text.strip()
    if not text:
        text = fallback
    return text[:max_length]


def import_bool(value, fallback=True):
    if isinstance(value, bool):
        return value
    return fallback


def import_int(value, fallback=0):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(0, parsed)


def import_slug(value, fallback, max_length=180):
    raw_slug = import_string(value, "", max_length=max_length)
    if not raw_slug:
        raw_slug = slugify(fallback or "event") or "event"
    return raw_slug[:max_length]


def import_json_object(value):
    return clone_json(value, {}) if isinstance(value, dict) else {}


def import_json_list(value):
    return clone_json(value, []) if isinstance(value, list) else []


class ExperienceImportError(ValueError):
    pass


def import_action_sequence_or_raise(value, label):
    actions, error = validate_action_sequence(value)
    if error:
        raise ExperienceImportError(f"{label}: {error}")
    return actions


def import_event_steps(event, steps):
    for step in import_action_sequence_or_raise(steps, f"{event.title} actions"):
        EventActionStep.objects.create(
            event=event,
            action_type=step["actionType"],
            label=step["label"],
            config=step["config"],
            condition=step["condition"],
            enabled=step["enabled"],
            sort_order=step["sortOrder"],
        )


def import_chat_tools(event, tools):
    if not isinstance(tools, list):
        return
    seen_names = set()
    for index, tool in enumerate(tools):
        if not isinstance(tool, dict):
            continue
        name = import_slug(tool.get("name"), "chat_exit", max_length=64)
        base_name = name
        suffix = 2
        while name in seen_names:
            name = f"{base_name[:58]}_{suffix}"[:64]
            suffix += 1
        seen_names.add(name)
        EventChatTool.objects.create(
            event=event,
            name=name,
            description=import_string(
                tool.get("description"),
                "",
                max_length=4000,
                strip=False,
            ),
            parameters=import_json_object(tool.get("parameters")),
            handler_actions=import_action_sequence_or_raise(
                tool.get("handlerActions"),
                f"{name} handler actions",
            ),
            triggers_event=import_slug(tool.get("triggersEvent"), "", max_length=180)
            if tool.get("triggersEvent")
            else "",
            save_argument=import_string(tool.get("saveArgument"), "", max_length=120),
            save_context_key=import_string(tool.get("saveContextKey"), "", max_length=120),
            enabled=import_bool(tool.get("enabled"), True),
            sort_order=import_int(tool.get("sortOrder"), index),
        )


def import_conversation_checks(event, checks):
    if not isinstance(checks, list):
        return
    for index, check in enumerate(checks):
        if not isinstance(check, dict):
            continue
        EventConversationCheck.objects.create(
            event=event,
            title=import_string(check.get("title"), "Check", max_length=160),
            instructions=import_string(
                check.get("instructions"),
                "",
                max_length=12000,
                strip=False,
            ),
            result_context_key=import_string(
                check.get("resultContextKey"),
                "",
                max_length=120,
            ),
            handler_actions=import_action_sequence_or_raise(
                check.get("handlerActions"),
                f"{check.get('title') or 'Check'} handler actions",
            ),
            triggers_event=import_slug(check.get("triggersEvent"), "", max_length=180)
            if check.get("triggersEvent")
            else "",
            enabled=import_bool(check.get("enabled"), True),
            sort_order=import_int(check.get("sortOrder"), index),
        )


def import_classifier_groups(event, groups):
    if not isinstance(groups, list):
        return
    for index, group in enumerate(groups):
        if not isinstance(group, dict):
            continue
        imported_group = EventClassifierGroup.objects.create(
            event=event,
            title=import_string(
                group.get("title"),
                "Classifier group",
                max_length=160,
            ),
            instructions=import_string(
                group.get("instructions"),
                "",
                max_length=12000,
                strip=False,
            ),
            result_context_key=import_string(
                group.get("resultContextKey"),
                "_classifier_results",
                max_length=120,
            ),
            handler_actions=import_action_sequence_or_raise(
                group.get("handlerActions"),
                f"{group.get('title') or 'Classifier group'} handler actions",
            ),
            triggers_event=import_slug(group.get("triggersEvent"), "", max_length=180)
            if group.get("triggersEvent")
            else "",
            condition=import_json_object(group.get("condition")),
            enabled=import_bool(group.get("enabled"), True),
            sort_order=import_int(group.get("sortOrder"), index),
        )
        seen_names = set()
        classifiers = group.get("classifiers")
        if not isinstance(classifiers, list):
            continue
        for classifier_index, classifier in enumerate(classifiers):
            if not isinstance(classifier, dict):
                continue
            name = import_slug(classifier.get("name"), "classifier", max_length=64)
            base_name = name
            suffix = 2
            while name in seen_names:
                name = f"{base_name[:58]}_{suffix}"[:64]
                suffix += 1
            seen_names.add(name)
            EventClassifier.objects.create(
                group=imported_group,
                name=name,
                prompt=import_string(
                    classifier.get("prompt"),
                    "",
                    max_length=12000,
                    strip=False,
                ),
                schema=import_json_object(classifier.get("schema")),
                model=import_string(classifier.get("model"), "", max_length=100),
                condition=import_json_object(classifier.get("condition")),
                enabled=import_bool(classifier.get("enabled"), True),
                sort_order=import_int(classifier.get("sortOrder"), classifier_index),
            )


def import_conversation_choices(event, choices):
    normalized, error = validate_conversation_choices(import_json_list(choices))
    if error:
        raise ExperienceImportError(error)
    event.conversation_choices = normalized
    event.save(update_fields=["conversation_choices", "updated_at"])


def create_experience_from_export_payload(user, payload):
    if not isinstance(payload, dict):
        return None, "Import file must contain a JSON object."
    if payload.get("format") != EXPERIENCE_EXPORT_FORMAT:
        return None, "Import file is not a dLU experience export."
    if payload.get("version") != EXPERIENCE_EXPORT_VERSION:
        return None, "Import file version is not supported."

    data = payload.get("experience")
    if not isinstance(data, dict):
        return None, "Import file does not contain an experience."

    title = import_string(data.get("title"), DEFAULT_EXPERIENCE_TITLE, max_length=160)
    description = import_string(
        data.get("description"),
        "",
        max_length=4000,
        strip=False,
    )
    events = data.get("events")
    if events is not None and not isinstance(events, list):
        return None, "Imported events must be a list."

    try:
        with transaction.atomic():
            experience = Experience.objects.create(
                user=user,
                title=title,
                slug=unique_experience_slug(user, title),
                description=description,
            )
            tutor_data = data.get("tutor") if isinstance(data.get("tutor"), dict) else {}
            tutor_settings = ensure_tutor_settings(experience)
            tutor_settings.assistant_name = import_string(
                tutor_data.get("assistantName"),
                "dee-lou",
                max_length=100,
            )
            tutor_settings.avatar_path = import_string(
                tutor_data.get("avatarPath"),
                "test-images/dLU-right.png",
                max_length=220,
            )
            tutor_settings.choice_icon_background = normalize_choice_icon_background(
                tutor_data.get("choiceIconBackground")
            )
            imported_classification_model = import_string(
                tutor_data.get("classificationModel"),
                settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
                max_length=100,
            )
            tutor_settings.classification_model = normalize_realtime_choice(
                imported_classification_model,
                classification_model_choices(),
                settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
            ) or settings.DLU_CLASSIFICATION_DEFAULT_MODEL
            imported_realtime_model = import_string(
                tutor_data.get("realtimeModel"),
                settings.DLU_REALTIME_DEFAULT_MODEL,
                max_length=100,
            )
            tutor_settings.realtime_model = normalize_realtime_model_choice(
                imported_realtime_model,
                settings.DLU_REALTIME_DEFAULT_MODEL,
            ) or settings.DLU_REALTIME_DEFAULT_MODEL
            tutor_settings.system_prompt = import_string(
                tutor_data.get("systemPrompt"),
                "",
                max_length=12000,
                strip=False,
            )
            imported_voice = import_string(
                tutor_data.get("voice"),
                settings.DLU_REALTIME_DEFAULT_VOICE,
                max_length=40,
            )
            tutor_settings.voice = normalize_realtime_voice_choice(
                imported_voice,
                settings.DLU_REALTIME_DEFAULT_VOICE,
                tutor_settings.realtime_model,
            ) or default_realtime_voice_for_model(tutor_settings.realtime_model)
            tutor_settings.voice_instructions = import_string(
                tutor_data.get("voiceInstructions"),
                "",
                max_length=4000,
                strip=False,
            )
            tutor_settings.save()

            seen_event_slugs = set()
            for index, event_data in enumerate(events or []):
                if not isinstance(event_data, dict):
                    continue
                event_title = import_string(
                    event_data.get("title"),
                    DEFAULT_START_EVENT_TITLE if index == 0 else "Event",
                    max_length=160,
                )
                event_slug = import_slug(event_data.get("slug"), event_title)
                base_slug = event_slug
                suffix = 2
                while event_slug in seen_event_slugs:
                    event_slug = f"{base_slug[:174]}-{suffix}"[:180]
                    suffix += 1
                seen_event_slugs.add(event_slug)
                event = ExperienceEvent.objects.create(
                    experience=experience,
                    title=event_title,
                    slug=event_slug,
                    description=import_string(
                        event_data.get("description"),
                        "",
                        max_length=4000,
                        strip=False,
                    ),
                    on_entry_dsl_source=import_string(
                        event_data.get("onEntryDslSource"),
                        "",
                        max_length=12000,
                        strip=False,
                    ),
                    conversation_dsl_source=import_string(
                        event_data.get("conversationDslSource"),
                        "",
                        max_length=12000,
                        strip=False,
                    ),
                    chat_instructions=import_string(
                        event_data.get("chatInstructions"),
                        "",
                        max_length=12000,
                        strip=False,
                    ),
                    conversation_choices=normalize_conversation_choices(
                        event_data.get("conversationChoices")
                    ),
                    is_start=import_bool(event_data.get("isStart"), index == 0),
                    sort_order=import_int(event_data.get("sortOrder"), index),
                )
                import_event_steps(event, event_data.get("steps"))
                import_chat_tools(event, event_data.get("chatTools"))
                import_conversation_checks(event, event_data.get("conversationChecks"))
                import_classifier_groups(event, event_data.get("classifierGroups"))
                import_conversation_choices(
                    event,
                    event_data.get("conversationChoices"),
                )
            ensure_start_event(experience)
    except ExperienceImportError as error:
        return None, str(error)

    return experience, ""


def create_experience_event_from_payload(experience, event_data):
    if not isinstance(event_data, dict):
        raise ExperienceImportError("Event restore payload must be an object.")

    next_sort_order = (
        experience.events.aggregate(Max("sort_order"))["sort_order__max"] or 0
    ) + 1
    event_title = import_string(
        event_data.get("title"),
        "New event",
        max_length=160,
    )
    event_slug = import_slug(event_data.get("slug"), event_title)
    event = ExperienceEvent.objects.create(
        experience=experience,
        title=event_title,
        slug=unique_event_slug(experience, event_slug),
        description=import_string(
            event_data.get("description"),
            "",
            max_length=4000,
            strip=False,
        ),
        on_entry_dsl_source=import_string(
            event_data.get("onEntryDslSource"),
            "",
            max_length=12000,
            strip=False,
        ),
        conversation_dsl_source=import_string(
            event_data.get("conversationDslSource"),
            "",
            max_length=12000,
            strip=False,
        ),
        chat_instructions=import_string(
            event_data.get("chatInstructions"),
            "",
            max_length=12000,
            strip=False,
        ),
        conversation_choices=normalize_conversation_choices(
            event_data.get("conversationChoices")
        ),
        is_start=import_bool(event_data.get("isStart"), False),
        sort_order=import_int(event_data.get("sortOrder"), next_sort_order),
    )
    if event.is_start:
        ExperienceEvent.objects.filter(experience=experience).exclude(
            id=event.id,
        ).update(is_start=False)

    import_event_steps(event, event_data.get("steps"))
    if not event.steps.exists():
        ensure_default_event_step(event)
    import_chat_tools(event, event_data.get("chatTools"))
    import_conversation_checks(event, event_data.get("conversationChecks"))
    import_classifier_groups(event, event_data.get("classifierGroups"))
    import_conversation_choices(event, event_data.get("conversationChoices"))
    return event


def get_current_experience(user, experience_id=None):
    if experience_id:
        experience = Experience.objects.filter(id=experience_id, user=user).first()
        if experience:
            ensure_tutor_settings(experience)
            ensure_start_event(experience)
        return experience

    experience = Experience.objects.filter(user=user).order_by("-updated_at").first()
    if experience:
        ensure_tutor_settings(experience)
        ensure_start_event(experience)
        return experience

    return create_default_experience(user)


def ordered_user_experiences(user):
    return Experience.objects.filter(user=user).order_by("-updated_at", "-created_at")


def create_experience_for_user(user, data):
    title = str(data.get("title", "")).strip() or DEFAULT_EXPERIENCE_TITLE
    description = str(data.get("description", "")).strip()
    if len(title) > 160:
        return None, "Title is too long."
    if len(description) > 4000:
        return None, "Description is too long."

    experience = Experience.objects.create(
        user=user,
        title=title,
        slug=unique_experience_slug(user, title),
        description=description,
    )
    ensure_tutor_settings(experience)
    ensure_start_event(experience)
    return experience, ""


def delete_experience_for_user(experience, user):
    experience.delete()
    return get_current_experience(user), ordered_user_experiences(user)


def get_current_session(user, experience=None):
    filters = {
        "user": user,
        "status": TutoringSession.Status.ACTIVE,
    }
    if experience:
        filters["experience"] = experience

    session = (
        TutoringSession.objects.filter(**filters)
        .order_by("-updated_at", "-created_at")
        .first()
    )
    if session:
        return session

    return TutoringSession.objects.create(user=user, experience=experience)


def get_session_current_event(session):
    if not session.experience:
        return None

    state = dict(session.runtime_state or {})
    event_id = str(state.get("currentEventId", "")).strip()
    event_slug = str(state.get("currentEventSlug", "")).strip()
    event_query = session.experience.events.all()
    if event_id:
        event = event_query.filter(id=event_id).first()
        if event:
            return event
    if event_slug:
        event = event_query.filter(slug=event_slug).first()
        if event:
            return event
    return ensure_start_event(session.experience)


def default_snapshot_title(experience):
    timestamp = timezone.localtime().strftime("%b %d, %Y %I:%M %p")
    return f"{experience.title} snapshot {timestamp}"[:160]


def get_experience_snapshot_for_user(experience_id, snapshot_id, user):
    return ExperienceSnapshot.objects.filter(
        id=snapshot_id,
        experience_id=experience_id,
        user=user,
    ).first()


def list_experience_snapshots_for_user(experience, user):
    return experience.snapshots.filter(user=user)


def create_experience_snapshot_for_user(experience, user, data, payload):
    title = import_string(data.get("title"), "", max_length=160)
    if not title:
        title = default_snapshot_title(experience)
    note = import_string(
        data.get("note"),
        "",
        max_length=4000,
        strip=False,
    )
    return ExperienceSnapshot.objects.create(
        experience=experience,
        user=user,
        title=title,
        note=note,
        payload=payload,
    )


def snapshot_export_payload(snapshot):
    return snapshot.payload if isinstance(snapshot.payload, dict) else {}


def snapshot_export_filename(snapshot):
    return f"{slugify(snapshot.title) or 'experience-snapshot'}.dlu-experience.json"


def delete_experience_snapshot_for_user(snapshot):
    experience_id = snapshot.experience_id
    user = snapshot.user
    snapshot.delete()
    return ExperienceSnapshot.objects.filter(
        experience_id=experience_id,
        user=user,
    )


def restore_experience_snapshot_for_user(snapshot, user):
    restored, error = create_experience_from_export_payload(
        user,
        snapshot.payload,
    )
    if error:
        return None, error

    restored.title = f"{restored.title} restored"[:160]
    restored.slug = unique_experience_slug(user, restored.title)
    restored.save(update_fields=["title", "slug", "updated_at"])
    return restored, ""
