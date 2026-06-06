from django.utils import timezone

from .experience_services import (
    EXPERIENCE_EXPORT_FORMAT,
    EXPERIENCE_EXPORT_VERSION,
    ensure_default_event_step,
    ensure_start_event,
    ensure_tutor_settings,
)
from .models import (
    DEFAULT_CLASSIFICATION_MODEL,
    EventClassifier,
    SessionMessage,
)
from .validation import (
    normalize_choice_icon_background,
    normalize_conversation_choices,
    validate_conversation_choices,
    validate_event_slug,
)

TOOL_CAPTURE_SAVE_MAP_KEY = "x-dluCaptureSaves"
TOOL_DISPLAY_TITLE_KEY = "x-dluDisplayTitle"


def serialize_user(user):
    display_name = user.get_full_name() or user.email or user.username
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "displayName": display_name,
    }


def serialize_session(session):
    return {
        "id": str(session.id),
        "experienceId": str(session.experience_id) if session.experience_id else "",
        "title": session.title,
        "runtimeContext": session.runtime_context,
        "runtimeState": session.runtime_state,
        "status": session.status,
        "createdAt": session.created_at.isoformat(),
        "updatedAt": session.updated_at.isoformat(),
    }


def serialize_message(message):
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "sequence": message.sequence,
        "metadata": message.metadata,
        "createdAt": message.created_at.isoformat(),
    }


def serialize_tutor_settings(tutor_settings):
    return {
        "assistantName": tutor_settings.assistant_name,
        "avatarPath": tutor_settings.avatar_path,
        "choiceIconBackground": normalize_choice_icon_background(
            tutor_settings.choice_icon_background
        ),
        "classificationModel": tutor_settings.classification_model,
        "realtimeModel": tutor_settings.realtime_model,
        "systemPrompt": tutor_settings.system_prompt,
        "voice": tutor_settings.voice,
        "voiceInstructions": tutor_settings.voice_instructions,
    }


def serialize_event_action_step(step):
    return {
        "id": str(step.id),
        "eventId": str(step.event_id),
        "actionType": step.action_type,
        "label": step.label,
        "config": step.config,
        "condition": step.condition,
        "enabled": step.enabled,
        "sortOrder": step.sort_order,
        "createdAt": step.created_at.isoformat(),
        "updatedAt": step.updated_at.isoformat(),
    }


def serialize_event_chat_tool(tool):
    return {
        "id": str(tool.id),
        "eventId": str(tool.event_id),
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters,
        "handlerActions": tool.handler_actions,
        "triggersEvent": tool.triggers_event,
        "saveArgument": tool.save_argument,
        "saveContextKey": tool.save_context_key,
        "enabled": tool.enabled,
        "sortOrder": tool.sort_order,
        "createdAt": tool.created_at.isoformat(),
        "updatedAt": tool.updated_at.isoformat(),
    }


def serialize_event_conversation_check(check):
    return {
        "id": str(check.id),
        "eventId": str(check.event_id),
        "title": check.title,
        "instructions": check.instructions,
        "resultContextKey": check.result_context_key,
        "handlerActions": check.handler_actions,
        "triggersEvent": check.triggers_event,
        "enabled": check.enabled,
        "sortOrder": check.sort_order,
        "createdAt": check.created_at.isoformat(),
        "updatedAt": check.updated_at.isoformat(),
    }


def serialize_event_classifier(classifier):
    return {
        "id": str(classifier.id),
        "groupId": str(classifier.group_id),
        "name": classifier.name,
        "prompt": classifier.prompt,
        "schema": classifier.schema,
        "model": classifier.model,
        "condition": classifier.condition,
        "enabled": classifier.enabled,
        "sortOrder": classifier.sort_order,
        "createdAt": classifier.created_at.isoformat(),
        "updatedAt": classifier.updated_at.isoformat(),
    }


def serialize_event_classifier_group(group):
    return {
        "id": str(group.id),
        "eventId": str(group.event_id),
        "title": group.title,
        "instructions": group.instructions,
        "resultContextKey": group.result_context_key,
        "handlerActions": group.handler_actions,
        "triggersEvent": group.triggers_event,
        "condition": group.condition,
        "enabled": group.enabled,
        "sortOrder": group.sort_order,
        "classifiers": [
            serialize_event_classifier(classifier)
            for classifier in group.classifiers.order_by("sort_order", "created_at")
        ],
        "createdAt": group.created_at.isoformat(),
        "updatedAt": group.updated_at.isoformat(),
    }


def openai_tool_parameters(parameters):
    schema = dict(parameters or {"type": "object", "properties": {}, "required": []})
    schema.pop(TOOL_CAPTURE_SAVE_MAP_KEY, None)
    schema.pop(TOOL_DISPLAY_TITLE_KEY, None)
    return schema


def tool_capture_save_map(tool):
    parameters = tool.parameters if isinstance(tool.parameters, dict) else {}
    raw_map = parameters.get(TOOL_CAPTURE_SAVE_MAP_KEY)
    if isinstance(raw_map, dict):
        captures = {
            str(argument_name).strip(): str(context_key).strip()
            for argument_name, context_key in raw_map.items()
            if str(argument_name).strip() and str(context_key).strip()
        }
        if captures:
            return captures

    if tool.save_context_key:
        if tool.save_argument:
            return {tool.save_argument: tool.save_context_key}
        return {"": tool.save_context_key}
    return {}


def event_choice_icon_background(event):
    tutor_settings = ensure_tutor_settings(event.experience)
    return normalize_choice_icon_background(tutor_settings.choice_icon_background)


def conversation_choice_actions(event):
    icon_background = event_choice_icon_background(event)
    actions = []
    for choice in normalize_conversation_choices(event.conversation_choices):
        label = str(choice.get("label", "") or "").strip()
        triggers_event = str(choice.get("triggersEvent", "") or "").strip()
        if choice.get("enabled") is False or not label or not triggers_event:
            continue
        actions.append(
            {
                "type": "button_choice",
                "eventId": str(event.id),
                "iconBackground": icon_background,
                "iconPath": str(choice.get("iconPath", "") or "").strip(),
                "label": label,
                "source": "conversation-choice",
                "stepId": f"conversation-choice:{choice.get('id')}",
                "triggersEvent": triggers_event,
            }
        )
    return actions


def conversation_choice_actions_for_ran_events(ran_events):
    if not ran_events:
        return []
    return conversation_choice_actions(ran_events[-1])


def serialize_experience_event(event):
    ensure_default_event_step(event)
    return {
        "id": str(event.id),
        "experienceId": str(event.experience_id),
        "title": event.title,
        "slug": event.slug,
        "description": event.description,
        "onEntryDslSource": event.on_entry_dsl_source,
        "chatInstructions": event.chat_instructions,
        "conversationChoices": normalize_conversation_choices(
            event.conversation_choices
        ),
        "isStart": event.is_start,
        "sortOrder": event.sort_order,
        "steps": [
            serialize_event_action_step(step)
            for step in event.steps.order_by("sort_order", "created_at")
        ],
        "chatTools": [
            serialize_event_chat_tool(tool)
            for tool in event.chat_tools.order_by("sort_order", "created_at")
        ],
        "conversationChecks": [
            serialize_event_conversation_check(check)
            for check in event.conversation_checks.order_by(
                "sort_order", "created_at"
            )
        ],
        "classifierGroups": [
            serialize_event_classifier_group(group)
            for group in event.classifier_groups.order_by(
                "sort_order", "created_at"
            )
        ],
        "createdAt": event.created_at.isoformat(),
        "updatedAt": event.updated_at.isoformat(),
    }


def serialize_experience(experience):
    tutor_settings = ensure_tutor_settings(experience)
    ensure_start_event(experience)
    return {
        "id": str(experience.id),
        "title": experience.title,
        "slug": experience.slug,
        "description": experience.description,
        "tutor": serialize_tutor_settings(tutor_settings),
        "events": [
            serialize_experience_event(event)
            for event in experience.events.order_by("sort_order", "created_at")
        ],
        "createdAt": experience.created_at.isoformat(),
        "updatedAt": experience.updated_at.isoformat(),
    }


def experience_export_payload(experience):
    return {
        "exportedAt": timezone.now().isoformat(),
        "format": EXPERIENCE_EXPORT_FORMAT,
        "version": EXPERIENCE_EXPORT_VERSION,
        "experience": serialize_experience(experience),
    }


def serialize_event_checkpoint(checkpoint):
    summary = checkpoint.summary if isinstance(checkpoint.summary, dict) else {}
    return {
        "context": summary.get("context", []),
        "createdAt": checkpoint.created_at.isoformat(),
        "eventId": str(checkpoint.event_id),
        "eventTitle": checkpoint.event.title if checkpoint.event_id else "",
        "fingerprintMode": checkpoint.fingerprint_mode,
        "id": str(checkpoint.id),
        "label": summary.get("label", "saved state"),
        "lastUsedAt": checkpoint.last_used_at.isoformat(),
        "messageCount": summary.get("messageCount", 0),
        "runCount": checkpoint.run_count,
        "slideRef": summary.get("slideRef", ""),
    }


def serialize_experience_snapshot(snapshot):
    payload = snapshot.payload if isinstance(snapshot.payload, dict) else {}
    experience_payload = payload.get("experience")
    events = []
    if isinstance(experience_payload, dict) and isinstance(
        experience_payload.get("events"),
        list,
    ):
        events = experience_payload["events"]

    return {
        "id": str(snapshot.id),
        "experienceId": str(snapshot.experience_id),
        "title": snapshot.title,
        "note": snapshot.note,
        "createdAt": snapshot.created_at.isoformat(),
        "eventCount": len(events),
        "format": payload.get("format", ""),
        "version": payload.get("version"),
    }
