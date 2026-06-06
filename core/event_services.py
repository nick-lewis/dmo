import re

from django.db import transaction
from django.db.models import Max

from .experience_services import (
    ExperienceImportError,
    create_experience_event_from_payload,
    ensure_default_event_step,
    ensure_start_event,
    unique_event_slug,
)
from .models import (
    EventActionStep,
    EventChatTool,
    EventClassifier,
    EventClassifierGroup,
    EventConversationCheck,
    ExperienceEvent,
)
from .validation import (
    validate_action_config,
    validate_chat_tool_payload,
    validate_classifier_group_payload,
    validate_classifier_payload,
    validate_conversation_choices,
    validate_conversation_check_payload,
    validate_step_condition,
)


class EventServiceError(ValueError):
    pass


DEFAULT_NEW_EVENT_TITLE = "New event"
NEW_EVENT_SLUG_PATTERN = re.compile(r"^new-event(?:-(\d+))?$", re.IGNORECASE)
NEW_EVENT_TITLE_PATTERN = re.compile(r"^new event(?:\s+(\d+))?$", re.IGNORECASE)


def ordered_experience_events(experience):
    return experience.events.order_by("sort_order", "created_at")


def next_sort_order(manager):
    return (manager.aggregate(Max("sort_order"))["sort_order__max"] or 0) + 1


def compact_sort_order(manager):
    for index, item in enumerate(manager.order_by("sort_order", "created_at")):
        if item.sort_order == index:
            continue
        item.sort_order = index
        item.save(update_fields=["sort_order", "updated_at"])


def placeholder_event_number(value, pattern):
    match = pattern.match(str(value or "").strip())
    if not match:
        return None
    suffix = match.group(1)
    return int(suffix) if suffix else 1


def unique_new_event_title(experience):
    used_numbers = set()
    for title, slug in experience.events.values_list("title", "slug"):
        title_number = placeholder_event_number(title, NEW_EVENT_TITLE_PATTERN)
        slug_number = placeholder_event_number(slug, NEW_EVENT_SLUG_PATTERN)
        if title_number:
            used_numbers.add(title_number)
        if slug_number:
            used_numbers.add(slug_number)

    suffix = 1
    while suffix in used_numbers:
        suffix += 1

    if suffix == 1:
        return DEFAULT_NEW_EVENT_TITLE
    return f"{DEFAULT_NEW_EVENT_TITLE} {suffix}"


def create_experience_event(experience, data):
    if isinstance(data.get("event"), dict):
        try:
            with transaction.atomic():
                event = create_experience_event_from_payload(
                    experience,
                    data.get("event"),
                )
                ensure_start_event(experience)
        except ExperienceImportError as error:
            raise EventServiceError(str(error)) from error
        return event

    title = str(data.get("title", "")).strip()
    if not title or title.casefold() == DEFAULT_NEW_EVENT_TITLE.casefold():
        title = unique_new_event_title(experience)
    description = str(data.get("description", "")).strip()
    if len(title) > 160:
        raise EventServiceError("Event title is too long.")
    if len(description) > 4000:
        raise EventServiceError("Event description is too long.")

    sort_order = (
        experience.events.aggregate(Max("sort_order"))["sort_order__max"] or 0
    ) + 1
    event = ExperienceEvent.objects.create(
        experience=experience,
        title=title,
        slug=unique_event_slug(experience, title),
        description=description,
        is_start=bool(data.get("isStart", False)),
        sort_order=sort_order,
    )
    if event.is_start:
        ExperienceEvent.objects.filter(experience=experience).exclude(
            id=event.id,
        ).update(is_start=False)
    ensure_default_event_step(event)
    return event


def reorder_experience_event_ids(experience, event_ids):
    if not isinstance(event_ids, list):
        raise EventServiceError("Event order must be a list.")

    normalized_event_ids = [str(event_id).strip() for event_id in event_ids]
    current_events = list(ordered_experience_events(experience))
    current_event_ids = [str(event.id) for event in current_events]
    if (
        len(normalized_event_ids) != len(current_event_ids)
        or len(set(normalized_event_ids)) != len(normalized_event_ids)
        or set(normalized_event_ids) != set(current_event_ids)
    ):
        raise EventServiceError("Event order must include every event exactly once.")

    event_by_id = {str(event.id): event for event in current_events}
    with transaction.atomic():
        for index, event_id in enumerate(normalized_event_ids):
            event = event_by_id[event_id]
            if event.sort_order == index:
                continue
            event.sort_order = index
            event.save(update_fields=["sort_order", "updated_at"])
        ensure_start_event(experience)

    return ordered_experience_events(experience)


def delete_experience_event(experience, event):
    if experience.events.count() <= 1:
        raise EventServiceError("An experience needs at least one event.")

    was_start = event.is_start
    event.delete()
    if was_start:
        next_event = experience.events.order_by("sort_order", "created_at").first()
        if next_event:
            next_event.is_start = True
            next_event.save(update_fields=["is_start", "updated_at"])
    ensure_start_event(experience)
    return ordered_experience_events(experience)


def update_experience_event_from_data(experience, event, data):
    if "title" in data:
        title = str(data.get("title", "")).strip()
        if not title:
            raise EventServiceError("Event title is required.")
        if len(title) > 160:
            raise EventServiceError("Event title is too long.")
        event.title = title

    if "description" in data:
        description = str(data.get("description", "")).strip()
        if len(description) > 4000:
            raise EventServiceError("Event description is too long.")
        event.description = description

    if "onEntryDslSource" in data:
        on_entry_dsl_source = str(data.get("onEntryDslSource", ""))
        if len(on_entry_dsl_source) > 12000:
            raise EventServiceError("On entry script is too long.")
        event.on_entry_dsl_source = on_entry_dsl_source

    if "chatInstructions" in data:
        chat_instructions = str(data.get("chatInstructions", "")).strip()
        if len(chat_instructions) > 12000:
            raise EventServiceError("Event chat instructions are too long.")
        event.chat_instructions = chat_instructions

    if "conversationChoices" in data:
        choices, choices_error = validate_conversation_choices(
            data.get("conversationChoices")
        )
        if choices_error:
            raise EventServiceError(choices_error)
        event.conversation_choices = choices

    if "isStart" in data and bool(data.get("isStart")):
        event.is_start = True
        ExperienceEvent.objects.filter(experience=experience).exclude(
            id=event.id,
        ).update(is_start=False)

    event.save()
    ensure_default_event_step(event)
    return event


def create_event_action_step_from_data(event, data):
    action_type = str(
        data.get("actionType", EventActionStep.ActionType.SCRIPT)
    ).strip()
    if action_type not in EventActionStep.ActionType.values:
        raise EventServiceError("Action type is not supported.")

    config, config_error = validate_action_config(
        action_type,
        data.get("config", {}),
    )
    if config_error:
        raise EventServiceError(config_error)

    condition, condition_error = validate_step_condition(data.get("condition", {}))
    if condition_error:
        raise EventServiceError(condition_error)

    label = str(data.get("label", "")).strip()
    if len(label) > 160:
        raise EventServiceError("Action label is too long.")

    return EventActionStep.objects.create(
        event=event,
        action_type=action_type,
        label=label,
        config=config,
        condition=condition,
        enabled=bool(data.get("enabled", True)),
        sort_order=next_sort_order(event.steps),
    )


def reorder_event_action_step_ids(event, step_ids):
    if not isinstance(step_ids, list):
        raise EventServiceError("Step IDs must be an array.")

    existing_steps = {str(step.id): step for step in event.steps.all()}
    if set(step_ids) != set(existing_steps.keys()):
        raise EventServiceError("Reorder payload must include every event step.")

    with transaction.atomic():
        for index, step_id in enumerate(step_ids):
            step = existing_steps[str(step_id)]
            step.sort_order = index
            step.save(update_fields=["sort_order", "updated_at"])

    return event


def delete_event_action_step(event, step):
    if event.steps.count() <= 1:
        raise EventServiceError("An event needs at least one action step.")

    step.delete()
    compact_sort_order(event.steps)
    return event


def update_event_action_step_from_data(step, data):
    action_type = str(data.get("actionType", step.action_type)).strip()
    if action_type not in EventActionStep.ActionType.values:
        raise EventServiceError("Action type is not supported.")

    if "label" in data:
        label = str(data.get("label", "")).strip()
        if len(label) > 160:
            raise EventServiceError("Action label is too long.")
        step.label = label

    if "enabled" in data:
        step.enabled = bool(data.get("enabled"))

    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError) as error:
            raise EventServiceError("Sort order must be a number.") from error
        if sort_order < 0:
            raise EventServiceError("Sort order must be positive.")
        step.sort_order = sort_order

    if "config" in data or action_type != step.action_type:
        config, config_error = validate_action_config(
            action_type,
            data.get("config", step.config),
        )
        if config_error:
            raise EventServiceError(config_error)
        step.config = config

    if "condition" in data:
        condition, condition_error = validate_step_condition(data.get("condition"))
        if condition_error:
            raise EventServiceError(condition_error)
        step.condition = condition

    step.action_type = action_type
    step.save()
    return step


def create_event_chat_tool_from_data(event, data):
    payload, payload_error = validate_chat_tool_payload(data)
    if payload_error:
        raise EventServiceError(payload_error)

    if event.chat_tools.filter(name=payload["name"]).exists():
        raise EventServiceError("Tool name already exists.")

    payload.setdefault("sort_order", next_sort_order(event.chat_tools))
    return EventChatTool.objects.create(event=event, **payload)


def delete_event_chat_tool(event, tool):
    tool.delete()
    compact_sort_order(event.chat_tools)
    return event


def update_event_chat_tool_from_data(event, tool, data):
    payload, payload_error = validate_chat_tool_payload(data, existing_tool=tool)
    if payload_error:
        raise EventServiceError(payload_error)

    duplicate = event.chat_tools.filter(name=payload["name"]).exclude(id=tool.id)
    if duplicate.exists():
        raise EventServiceError("Tool name already exists.")

    for field, value in payload.items():
        setattr(tool, field, value)
    tool.save()
    return tool


def create_event_conversation_check_from_data(event, data):
    payload, payload_error = validate_conversation_check_payload(data)
    if payload_error:
        raise EventServiceError(payload_error)

    payload.setdefault("sort_order", next_sort_order(event.conversation_checks))
    return EventConversationCheck.objects.create(event=event, **payload)


def delete_event_conversation_check(event, check):
    check.delete()
    compact_sort_order(event.conversation_checks)
    return event


def update_event_conversation_check_from_data(check, data):
    payload, payload_error = validate_conversation_check_payload(
        data,
        existing_check=check,
    )
    if payload_error:
        raise EventServiceError(payload_error)

    for field, value in payload.items():
        setattr(check, field, value)
    check.save()
    return check


def create_event_classifier_group_from_data(event, data):
    payload, payload_error = validate_classifier_group_payload(data)
    if payload_error:
        raise EventServiceError(payload_error)

    payload.setdefault("sort_order", next_sort_order(event.classifier_groups))
    return EventClassifierGroup.objects.create(event=event, **payload)


def delete_event_classifier_group(event, group):
    group.delete()
    compact_sort_order(event.classifier_groups)
    return event


def update_event_classifier_group_from_data(group, data):
    payload, payload_error = validate_classifier_group_payload(
        data,
        existing_group=group,
    )
    if payload_error:
        raise EventServiceError(payload_error)

    for field, value in payload.items():
        setattr(group, field, value)
    group.save()
    return group


def create_event_classifier_from_data(group, data):
    payload, payload_error = validate_classifier_payload(data)
    if payload_error:
        raise EventServiceError(payload_error)

    if group.classifiers.filter(name=payload["name"]).exists():
        raise EventServiceError("Classifier name already exists.")

    payload.setdefault("sort_order", next_sort_order(group.classifiers))
    return EventClassifier.objects.create(group=group, **payload)


def delete_event_classifier(group, classifier):
    classifier.delete()
    compact_sort_order(group.classifiers)
    return group


def update_event_classifier_from_data(group, classifier, data):
    payload, payload_error = validate_classifier_payload(
        data,
        existing_classifier=classifier,
    )
    if payload_error:
        raise EventServiceError(payload_error)

    duplicate = group.classifiers.filter(name=payload["name"]).exclude(
        id=classifier.id,
    )
    if duplicate.exists():
        raise EventServiceError("Classifier name already exists.")

    for field, value in payload.items():
        setattr(classifier, field, value)
    classifier.save()
    return classifier
