import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model, login
from django.contrib.auth import logout
from django.db import transaction
from django.db.models import Max
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST
import requests

from .audio_cache import (
    AudioGenerationError,
    OPENAI_CHAT_COMPLETIONS_URL,
    get_or_create_script_audio,
    get_or_create_voice_sample,
    openai_error_message,
    script_audio_audio_path,
    voice_sample_audio_path,
)
from .models import (
    DEFAULT_CLASSIFICATION_MODEL,
    EventActionStep,
    EventChatTool,
    EventClassifier,
    EventClassifierGroup,
    EventConversationCheck,
    Experience,
    ExperienceEvent,
    SessionMessage,
    TutoringSession,
    TutorSettings,
)
from .slides import (
    SlideFetchError,
    SlideResolutionError,
    get_slide_image_path,
    resolve_slide_image,
)


DEFAULT_APP_PATH = "/surfaces/tutoring/panels"
OPENAI_REALTIME_CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets"
REALTIME_MODELS = {
    "gpt-realtime-mini",
    "gpt-realtime-1.5",
    "gpt-realtime-2",
}
CLASSIFICATION_MODELS = {
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
}
REALTIME_VOICES = {
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "marin",
    "sage",
    "shimmer",
    "verse",
}
REALTIME_CONTEXT_MESSAGE_LIMIT = 24
REALTIME_CONTEXT_CHAR_LIMIT = 8000
DEFAULT_EXPERIENCE_TITLE = "Untitled experience"
DEFAULT_START_EVENT_TITLE = "Start"
DEFAULT_SCRIPT_STEP_LABEL = "Say"
MAX_EVENT_CHAIN_DEPTH = 12
TOOL_CAPTURE_SAVE_MAP_KEY = "x-dluCaptureSaves"
TOOL_DISPLAY_TITLE_KEY = "x-dluDisplayTitle"
SCRIPT_AUDIO_MESSAGE_SOURCES = {
    "event-action",
    "conversation-tool-action",
    "conversation-check-action",
    "classifier-group-action",
}
DEFAULT_CLASSIFIER_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "mentioned": {"type": "boolean"},
        "context": {"type": ["string", "null"]},
    },
    "required": ["mentioned", "context"],
    "additionalProperties": False,
}


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


def serialize_experience_event(event):
    ensure_default_event_step(event)
    return {
        "id": str(event.id),
        "experienceId": str(event.experience_id),
        "title": event.title,
        "slug": event.slug,
        "description": event.description,
        "chatInstructions": event.chat_instructions,
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


def auth_required_response(request):
    if request.user.is_authenticated:
        return None

    next_path = request.headers.get("X-Current-Path") or DEFAULT_APP_PATH
    login_url = f"{settings.LOGIN_URL}?{urlencode({'next': next_path})}"
    return JsonResponse(
        {
            "detail": "Authentication required.",
            "loginUrl": login_url,
        },
        status=401,
    )


def parse_json_body(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return None


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


def session_payload(session):
    return {
        "session": serialize_session(session),
        "messages": [serialize_message(message) for message in session.messages.all()],
    }


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


def realtime_tools_for_event(event):
    if not event:
        return []

    tools = []
    for tool in event.chat_tools.filter(enabled=True).order_by(
        "sort_order",
        "created_at",
    ):
        tools.append(
            {
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": openai_tool_parameters(tool.parameters),
            }
        )
    return tools


def build_realtime_instructions(session, exclude_message_id=None):
    tutor_settings = ensure_tutor_settings(session.experience) if session.experience else None
    current_event = get_session_current_event(session)
    current_tools = realtime_tools_for_event(current_event)
    system_prompt = (
        tutor_settings.system_prompt.strip()
        if tutor_settings and tutor_settings.system_prompt.strip()
        else settings.DLU_REALTIME_INSTRUCTIONS.strip()
    )
    instruction_parts = []
    if tutor_settings and tutor_settings.assistant_name.strip():
        instruction_parts.append(
            f"Your name is {tutor_settings.assistant_name.strip()}."
        )
    if tutor_settings and tutor_settings.voice_instructions.strip():
        instruction_parts.append(
            "Voice and personality guidance: "
            f"{tutor_settings.voice_instructions.strip()}"
        )
    instruction_parts.append(system_prompt)
    if current_event:
        event_context = [f"Current experience event: {current_event.title.strip()}."]
        if current_event.description.strip():
            event_context.append(
                f"Event notes or goal: {current_event.description.strip()}"
            )
        chat_instructions = render_context_template(
            current_event.chat_instructions,
            session.runtime_context or {},
        ).strip()
        if chat_instructions:
            event_context.append(f"Event chat instructions:\n{chat_instructions}")
        if session.runtime_context:
            context_json = json.dumps(session.runtime_context, ensure_ascii=True)
            event_context.append(f"Runtime context: {context_json[:2000]}")
        instruction_parts.append("\n".join(event_context))
    if current_tools:
        instruction_parts.append(
            "This event has conversation routes available as tools. When the "
            "learner's message satisfies one of those route conditions, call "
            "the matching tool instead of announcing that you are changing events."
        )
    instructions = "\n\n".join(part for part in instruction_parts if part)
    messages_query = session.messages.filter(
        role__in=[SessionMessage.Role.USER, SessionMessage.Role.ASSISTANT]
    )
    if exclude_message_id:
        messages_query = messages_query.exclude(id=exclude_message_id)

    messages = list(messages_query.order_by("-sequence")[:REALTIME_CONTEXT_MESSAGE_LIMIT])
    messages.reverse()
    if not messages:
        return instructions

    transcript_lines = []
    total_chars = 0
    for message in messages:
        speaker = "User" if message.role == SessionMessage.Role.USER else "dLU"
        content = " ".join(message.content.split())
        if not content:
            continue

        line = f"{speaker}: {content}"
        total_chars += len(line)
        if total_chars > REALTIME_CONTEXT_CHAR_LIMIT:
            break
        transcript_lines.append(line)

    if not transcript_lines:
        return instructions

    return "\n\n".join(
        [
            instructions,
            (
                "Current saved-session transcript for context. Use it only to "
                "continue this session naturally; do not recite it unless asked."
            ),
            "\n".join(transcript_lines),
        ]
    )


def hash_safety_identifier(user):
    source = f"{settings.SECRET_KEY}:{user.pk}:{user.email or user.username}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def normalize_realtime_choice(value, allowed_values, default_value):
    choice = str(value or default_value).strip()
    if choice not in allowed_values:
        return None
    return choice


def classification_model_choices():
    return CLASSIFICATION_MODELS | {
        settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
        DEFAULT_CLASSIFICATION_MODEL,
    }


def normalize_runtime_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    return str(value)


def runtime_context_lookup(runtime_context, key):
    key = str(key or "").strip()
    if not key:
        return False, None

    current = runtime_context
    for part in key.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (TypeError, ValueError, IndexError):
                return False, None
            continue
        return False, None
    return True, current


def runtime_context_value(runtime_context, key):
    _, value = runtime_context_lookup(runtime_context, key)
    return value


def values_match(actual, expected):
    if actual == expected:
        return True
    return normalize_runtime_value(actual) == normalize_runtime_value(expected)


def value_contains(container, expected):
    if isinstance(container, list):
        return any(values_match(item, expected) for item in container)
    if isinstance(container, dict):
        return str(expected) in container
    if container is None:
        return False
    return str(expected) in normalize_runtime_value(container)


def runtime_value_is_truthy(value):
    if isinstance(value, (list, dict, str)):
        return bool(value)
    return bool(value)


def render_context_template(text, runtime_context):
    text = str(text or "")
    if "{{" not in text:
        return text

    conditional_pattern = re.compile(
        r"\{\{#if\s+([^{}]+?)\s*\}\}(.*?)"
        r"(?:\{\{else\}\}(.*?))?\{\{/if\}\}",
        flags=re.DOTALL,
    )

    def replace_conditional(match):
        key = match.group(1).strip()
        if_content = match.group(2)
        else_content = match.group(3) or ""
        _, value = runtime_context_lookup(runtime_context, key)
        selected = if_content if runtime_value_is_truthy(value) else else_content
        return render_context_template(selected, runtime_context)

    previous_text = None
    while previous_text != text:
        previous_text = text
        text = conditional_pattern.sub(replace_conditional, text)

    def replace_match(match):
        key = match.group(1).strip()
        exists, value = runtime_context_lookup(runtime_context, key)
        if not exists:
            return ""
        if isinstance(value, list):
            return ", ".join(normalize_runtime_value(item) for item in value)
        if isinstance(value, dict):
            return json.dumps(value, ensure_ascii=True, sort_keys=True)
        return normalize_runtime_value(value)

    return re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", replace_match, text)


def parse_client_ui_state(value):
    if isinstance(value, dict):
        return value
    return {}


def validate_selector(value, label="Selector"):
    selector = str(value or "").strip()
    if not selector:
        return None, f"{label} is required."
    if len(selector) > 500:
        return None, f"{label} is too long."
    return selector, ""


def validate_event_slug(value, label="Target event", required=True):
    event_slug = str(value or "").strip()
    if not event_slug and required:
        return None, f"{label} is required."
    if not event_slug:
        return "", ""
    if len(event_slug) > 180:
        return None, f"{label} is too long."
    return event_slug, ""


def validate_chat_tool_name(value):
    name = str(value or "").strip()
    if not name:
        return None, "Tool name is required."
    if len(name) > 64:
        return None, "Tool name is too long."
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
        return None, "Tool name must use letters, numbers, and underscores."
    return name, ""


def normalize_tool_parameters(value):
    if value in (None, ""):
        value = {}
    if not isinstance(value, dict):
        return None, "Tool parameters must be an object."

    parameters = dict(value)
    if not parameters:
        parameters = {"type": "object", "properties": {}, "required": []}

    if parameters.get("type") != "object":
        return None, "Tool parameters must use an object schema."

    properties = parameters.get("properties", {})
    if not isinstance(properties, dict):
        return None, "Tool parameter properties must be an object."

    required = parameters.get("required", [])
    if not isinstance(required, list):
        return None, "Tool required parameters must be an array."

    for key in properties.keys():
        if not isinstance(key, str) or len(key) > 120:
            return None, "Tool parameter names are invalid."

    capture_save_map = parameters.get(TOOL_CAPTURE_SAVE_MAP_KEY, {})
    if capture_save_map in (None, ""):
        capture_save_map = {}
    if not isinstance(capture_save_map, dict):
        return None, "Tool capture settings must be an object."
    normalized_capture_save_map = {}
    for argument_name, context_key in capture_save_map.items():
        argument_name = str(argument_name).strip()
        context_key = str(context_key).strip()
        if len(argument_name) > 120 or len(context_key) > 120:
            return None, "Tool capture settings are too long."
        if argument_name and context_key:
            normalized_capture_save_map[argument_name] = context_key

    raw_display_title = parameters.get(TOOL_DISPLAY_TITLE_KEY, "")
    display_title = (
        str(raw_display_title).strip() if raw_display_title not in (None, "") else ""
    )
    if len(display_title) > 120:
        return None, "Tool display title is too long."

    parameters["properties"] = properties
    parameters["required"] = [str(item) for item in required]
    parameters.setdefault("additionalProperties", False)
    if normalized_capture_save_map:
        parameters[TOOL_CAPTURE_SAVE_MAP_KEY] = normalized_capture_save_map
    else:
        parameters.pop(TOOL_CAPTURE_SAVE_MAP_KEY, None)
    if display_title:
        parameters[TOOL_DISPLAY_TITLE_KEY] = display_title
    else:
        parameters.pop(TOOL_DISPLAY_TITLE_KEY, None)
    return parameters, ""


def validate_chat_tool_payload(data, existing_tool=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Chat tool must be an object."

    name, name_error = validate_chat_tool_name(
        data.get("name", existing_tool.name if existing_tool else "")
    )
    if name_error:
        return None, name_error

    description = str(
        data.get(
            "description",
            existing_tool.description if existing_tool else "",
        )
    ).strip()
    if len(description) > 4000:
        return None, "Tool description is too long."

    parameters, parameters_error = normalize_tool_parameters(
        data.get("parameters", existing_tool.parameters if existing_tool else {})
    )
    if parameters_error:
        return None, parameters_error

    handler_actions, handler_actions_error = validate_action_sequence(
        data.get(
            "handlerActions",
            existing_tool.handler_actions if existing_tool else [],
        )
    )
    if handler_actions_error:
        return None, handler_actions_error

    triggers_event, event_error = validate_event_slug(
        data.get(
            "triggersEvent",
            existing_tool.triggers_event if existing_tool else "",
        ),
        label="Triggered event",
        required=False,
    )
    if event_error:
        return None, event_error

    save_argument = str(
        data.get(
            "saveArgument",
            existing_tool.save_argument if existing_tool else "",
        )
    ).strip()
    save_context_key = str(
        data.get(
            "saveContextKey",
            existing_tool.save_context_key if existing_tool else "",
        )
    ).strip()
    if len(save_argument) > 120 or len(save_context_key) > 120:
        return None, "Saved argument settings are too long."

    payload = {
        "description": description,
        "enabled": bool(data.get("enabled", existing_tool.enabled if existing_tool else True)),
        "handler_actions": handler_actions,
        "name": name,
        "parameters": parameters,
        "save_argument": save_argument,
        "save_context_key": save_context_key,
        "triggers_event": triggers_event,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_conversation_check_payload(data, existing_check=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Conversation check must be an object."

    title = str(
        data.get("title", existing_check.title if existing_check else "Check")
    ).strip()
    if not title:
        title = "Check"
    if len(title) > 160:
        return None, "Check title is too long."

    instructions = str(
        data.get(
            "instructions",
            existing_check.instructions if existing_check else "",
        )
    ).strip()
    if len(instructions) > 12000:
        return None, "Check instructions are too long."

    result_context_key = str(
        data.get(
            "resultContextKey",
            existing_check.result_context_key if existing_check else "",
        )
    ).strip()
    if len(result_context_key) > 120:
        return None, "Check result key is too long."

    handler_actions, handler_actions_error = validate_action_sequence(
        data.get(
            "handlerActions",
            existing_check.handler_actions if existing_check else [],
        )
    )
    if handler_actions_error:
        return None, handler_actions_error

    triggers_event, event_error = validate_event_slug(
        data.get(
            "triggersEvent",
            existing_check.triggers_event if existing_check else "",
        ),
        required=False,
    )
    if event_error:
        return None, event_error

    payload = {
        "enabled": bool(
            data.get("enabled", existing_check.enabled if existing_check else True)
        ),
        "handler_actions": handler_actions,
        "instructions": instructions,
        "result_context_key": result_context_key,
        "title": title,
        "triggers_event": triggers_event,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_classifier_schema(value):
    if value in (None, ""):
        return {}, ""
    if not isinstance(value, dict):
        return None, "Classifier schema must be an object."
    try:
        encoded = json.dumps(value, ensure_ascii=True)
    except (TypeError, ValueError):
        return None, "Classifier schema must be JSON serializable."
    if len(encoded) > 12000:
        return None, "Classifier schema is too long."
    return value, ""


def validate_classifier_group_payload(data, existing_group=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Classifier group must be an object."

    title = str(
        data.get(
            "title",
            existing_group.title if existing_group else "Classifier group",
        )
    ).strip()
    if not title:
        title = "Classifier group"
    if len(title) > 160:
        return None, "Classifier group title is too long."

    instructions = str(
        data.get(
            "instructions",
            existing_group.instructions if existing_group else "",
        )
    ).strip()
    if len(instructions) > 12000:
        return None, "Classifier group instructions are too long."

    result_context_key = str(
        data.get(
            "resultContextKey",
            existing_group.result_context_key
            if existing_group
            else "_classifier_results",
        )
    ).strip()
    if len(result_context_key) > 120:
        return None, "Classifier result key is too long."

    handler_actions, handler_actions_error = validate_action_sequence(
        data.get(
            "handlerActions",
            existing_group.handler_actions if existing_group else [],
        )
    )
    if handler_actions_error:
        return None, handler_actions_error

    triggers_event, event_error = validate_event_slug(
        data.get(
            "triggersEvent",
            existing_group.triggers_event if existing_group else "",
        ),
        required=False,
    )
    if event_error:
        return None, event_error

    condition, condition_error = validate_step_condition(
        data.get(
            "condition",
            existing_group.condition if existing_group else {},
        )
    )
    if condition_error:
        return None, condition_error

    payload = {
        "condition": condition,
        "enabled": bool(
            data.get("enabled", existing_group.enabled if existing_group else True)
        ),
        "handler_actions": handler_actions,
        "instructions": instructions,
        "result_context_key": result_context_key,
        "title": title,
        "triggers_event": triggers_event,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_classifier_payload(data, existing_classifier=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Classifier must be an object."

    name = str(
        data.get("name", existing_classifier.name if existing_classifier else "")
    ).strip()
    name = re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_").lower()
    if not name:
        return None, "Classifier name is required."
    if len(name) > 64:
        return None, "Classifier name is too long."

    prompt = str(
        data.get(
            "prompt",
            existing_classifier.prompt if existing_classifier else "",
        )
    ).strip()
    if len(prompt) > 12000:
        return None, "Classifier prompt is too long."

    schema, schema_error = validate_classifier_schema(
        data.get(
            "schema",
            existing_classifier.schema if existing_classifier else {},
        )
    )
    if schema_error:
        return None, schema_error

    model = str(
        data.get(
            "model",
            existing_classifier.model if existing_classifier else "",
        )
    ).strip()
    if len(model) > 100:
        return None, "Classifier model is too long."

    condition, condition_error = validate_step_condition(
        data.get(
            "condition",
            existing_classifier.condition if existing_classifier else {},
        )
    )
    if condition_error:
        return None, condition_error

    payload = {
        "condition": condition,
        "enabled": bool(
            data.get(
                "enabled",
                existing_classifier.enabled if existing_classifier else True,
            )
        ),
        "model": model,
        "name": name,
        "prompt": prompt,
        "schema": schema,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_action_config(action_type, value):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        return None, "Action config must be an object."

    if action_type == EventActionStep.ActionType.SCRIPT:
        text = str(value.get("text", ""))
        if len(text) > 12000:
            return None, "Script text is too long."
        return {"text": text}, ""

    if action_type == EventActionStep.ActionType.SET_CONTEXT:
        key = str(value.get("key", "")).strip()
        if not key:
            return None, "Context key is required."
        if len(key) > 120:
            return None, "Context key is too long."
        return {"key": key, "value": value.get("value")}, ""

    if action_type == EventActionStep.ActionType.APPEND_CONTEXT_LIST:
        key = str(value.get("key", "")).strip()
        if not key:
            return None, "Context key is required."
        if len(key) > 120:
            return None, "Context key is too long."
        return {"key": key, "value": value.get("value")}, ""

    if action_type == EventActionStep.ActionType.GET_UI_STATE:
        state_key = str(value.get("stateKey", "")).strip()
        context_key = str(value.get("contextKey", state_key)).strip()
        if not state_key:
            return None, "UI state key is required."
        if not context_key:
            return None, "Context key is required."
        if len(state_key) > 120 or len(context_key) > 120:
            return None, "UI state keys are too long."
        return {"contextKey": context_key, "stateKey": state_key}, ""

    if action_type == EventActionStep.ActionType.HIGHLIGHT_ON:
        selector, selector_error = validate_selector(value.get("selector"))
        if selector_error:
            return None, selector_error
        color = str(value.get("color", "rgba(59, 130, 246, 0.6)")).strip()
        if len(color) > 120:
            return None, "Highlight color is too long."
        return {"color": color, "selector": selector}, ""

    if action_type == EventActionStep.ActionType.HIGHLIGHT_OFF:
        selector, selector_error = validate_selector(value.get("selector"))
        if selector_error:
            return None, selector_error
        return {"selector": selector}, ""

    if action_type == EventActionStep.ActionType.SET_UI_TRIGGER:
        selector, selector_error = validate_selector(value.get("selector"))
        if selector_error:
            return None, selector_error
        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            label="Triggered event",
            required=False,
        )
        if event_error:
            return None, event_error
        return {"selector": selector, "triggersEvent": triggers_event}, ""

    if action_type == EventActionStep.ActionType.GOTO_EVENT:
        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            required=False,
        )
        if event_error:
            return None, event_error
        return {"triggersEvent": triggers_event}, ""

    if action_type == EventActionStep.ActionType.BUTTON_CHOICE:
        label = str(value.get("label", "")).strip()
        if not label:
            return None, "Button label is required."
        if len(label) > 120:
            return None, "Button label is too long."
        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            label="Triggered event",
            required=False,
        )
        if event_error:
            return None, event_error
        return {"label": label, "triggersEvent": triggers_event}, ""

    return None, "Action type is not supported."


def validate_step_condition(value):
    if value is None:
        return {}, ""
    if not isinstance(value, dict):
        return None, "Step condition must be an object."

    condition_type = str(value.get("type", "always")).strip() or "always"
    if condition_type == "always":
        return {}, ""

    if condition_type in {"context_equals", "context_not_equals"}:
        key = str(value.get("key", "")).strip()
        expected_value = value.get("value", "")
        if not key:
            return None, "Condition context key is required."
        if len(key) > 120:
            return None, "Condition context key is too long."
        if len(normalize_runtime_value(expected_value)) > 4000:
            return None, "Condition value is too long."
        return {
            "type": condition_type,
            "key": key,
            "value": expected_value,
        }, ""

    if condition_type in {"context_contains", "context_not_contains"}:
        key = str(value.get("key", "")).strip()
        expected_value = value.get("value", "")
        if not key:
            return None, "Condition context key is required."
        if len(key) > 120:
            return None, "Condition context key is too long."
        if len(normalize_runtime_value(expected_value)) > 4000:
            return None, "Condition value is too long."
        return {
            "type": condition_type,
            "key": key,
            "value": expected_value,
        }, ""

    if condition_type in {"context_exists", "context_missing"}:
        key = str(value.get("key", "")).strip()
        if not key:
            return None, "Condition context key is required."
        if len(key) > 120:
            return None, "Condition context key is too long."
        return {"type": condition_type, "key": key}, ""

    if condition_type in {"all", "any"}:
        raw_conditions = value.get("conditions", value.get("items", []))
        if not isinstance(raw_conditions, list):
            return None, "Nested conditions must be a list."
        if len(raw_conditions) > 40:
            return None, "Nested condition list is too long."
        conditions = []
        for raw_condition in raw_conditions:
            condition, condition_error = validate_step_condition(raw_condition)
            if condition_error:
                return None, condition_error
            conditions.append(condition)
        return {"type": condition_type, "conditions": conditions}, ""

    return None, "Step condition is not supported."


def validate_action_sequence(value):
    if value in (None, ""):
        return [], ""
    if not isinstance(value, list):
        return None, "Action sequence must be a list."
    if len(value) > 80:
        return None, "Action sequence is too long."

    actions = []
    for index, raw_step in enumerate(value):
        if not isinstance(raw_step, dict):
            return None, "Action sequence steps must be objects."

        action_type = str(raw_step.get("actionType", "")).strip()
        if action_type not in EventActionStep.ActionType.values:
            return None, "Action type is not supported."

        config, config_error = validate_action_config(
            action_type,
            raw_step.get("config", {}),
        )
        if config_error:
            return None, config_error

        condition, condition_error = validate_step_condition(
            raw_step.get("condition", {})
        )
        if condition_error:
            return None, condition_error

        label = str(raw_step.get("label", "")).strip()
        if len(label) > 160:
            return None, "Action label is too long."

        try:
            sort_order = int(raw_step.get("sortOrder", index))
        except (TypeError, ValueError):
            return None, "Action sort order must be a number."
        if sort_order < 0:
            return None, "Action sort order must be positive."

        step_id = str(raw_step.get("id", "")).strip() or f"action-{index + 1}"
        if len(step_id) > 120:
            return None, "Action id is too long."

        actions.append(
            {
                "actionType": action_type,
                "condition": condition,
                "config": config,
                "enabled": bool(raw_step.get("enabled", True)),
                "id": step_id,
                "label": label,
                "sortOrder": sort_order,
            }
        )

    return sorted(actions, key=lambda action: action["sortOrder"]), ""


def condition_matches(condition, runtime_context):
    condition = condition or {}
    condition_type = condition.get("type") or "always"
    if condition_type == "always":
        return True

    if condition_type == "context_equals":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return exists and values_match(actual_value, condition.get("value", ""))

    if condition_type == "context_not_equals":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return not exists or not values_match(actual_value, condition.get("value", ""))

    if condition_type == "context_contains":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return exists and value_contains(actual_value, condition.get("value", ""))

    if condition_type == "context_not_contains":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return not exists or not value_contains(actual_value, condition.get("value", ""))

    if condition_type == "context_exists":
        key = str(condition.get("key", "")).strip()
        exists, _ = runtime_context_lookup(runtime_context, key)
        return exists

    if condition_type == "context_missing":
        key = str(condition.get("key", "")).strip()
        exists, _ = runtime_context_lookup(runtime_context, key)
        return not exists

    if condition_type == "all":
        conditions = condition.get("conditions")
        if not isinstance(conditions, list):
            return False
        return all(condition_matches(item, runtime_context) for item in conditions)

    if condition_type == "any":
        conditions = condition.get("conditions")
        if not isinstance(conditions, list):
            return False
        return any(condition_matches(item, runtime_context) for item in conditions)

    return False


def step_condition_matches(step, runtime_context):
    return condition_matches(step.condition, runtime_context)


def action_step_from_model(step):
    return {
        "actionType": step.action_type,
        "condition": step.condition or {},
        "config": step.config or {},
        "enabled": step.enabled,
        "id": str(step.id),
        "label": step.label,
        "sortOrder": step.sort_order,
    }


def create_message_for_runtime(session, role, content, metadata=None):
    next_sequence = (
        SessionMessage.objects.filter(session=session).aggregate(Max("sequence"))[
            "sequence__max"
        ]
        or 0
    ) + 1
    return SessionMessage.objects.create(
        session=session,
        role=role,
        content=content,
        sequence=next_sequence,
        metadata=metadata or {},
    )


def apply_runtime_actions_to_state(
    state,
    actions,
    clear_buttons=False,
    clear_trigger_selector="",
):
    ui_runtime = dict(state.get("uiRuntime") or {})
    buttons = list(ui_runtime.get("buttons") or [])
    highlights = dict(ui_runtime.get("highlights") or {})
    slide = ui_runtime.get("slide")
    slide_error = str(ui_runtime.get("slideError", "") or "")
    triggers = list(ui_runtime.get("triggers") or [])

    if clear_buttons:
        buttons = []

    if clear_trigger_selector:
        triggers = [
            trigger
            for trigger in triggers
            if trigger.get("selector") != clear_trigger_selector
        ]

    for action in actions:
        action_type = action.get("type")
        selector = str(action.get("selector", "")).strip()

        if action_type == "gslide":
            slide = {
                "cached": bool(action.get("cached", False)),
                "deckUrl": str(action.get("deckUrl", "")),
                "imageUrl": str(action.get("imageUrl", "")),
                "pageId": str(action.get("pageId", "")),
                "presentationId": str(action.get("presentationId", "")),
                "slideRef": str(action.get("slideRef", "")),
            }
            slide_error = ""
            continue

        if action_type == "slide_error":
            slide_error = str(action.get("detail", "Could not load that slide."))
            slide = None
            continue

        if action_type == "button_choice":
            step_id = str(action.get("stepId", ""))
            buttons = [button for button in buttons if button.get("stepId") != step_id]
            buttons.append(
                {
                    "eventId": str(action.get("eventId", "")),
                    "label": str(action.get("label", "")),
                    "stepId": step_id,
                    "triggersEvent": str(action.get("triggersEvent", "")),
                }
            )
            continue

        if not selector:
            continue

        if action_type == "highlight_on":
            highlights[selector] = {
                "color": str(action.get("color", "rgba(59, 130, 246, 0.6)")),
                "selector": selector,
            }
        elif action_type == "highlight_off":
            highlights.pop(selector, None)
        elif action_type == "set_ui_trigger":
            triggers = [
                trigger
                for trigger in triggers
                if not (
                    trigger.get("selector") == selector
                    and trigger.get("triggersEvent") == action.get("triggersEvent")
                )
            ]
            triggers.append(
                {
                    "eventId": str(action.get("eventId", "")),
                    "selector": selector,
                    "stepId": str(action.get("stepId", "")),
                    "triggersEvent": str(action.get("triggersEvent", "")),
                }
            )

    ui_runtime["buttons"] = buttons
    ui_runtime["highlights"] = highlights
    ui_runtime["slide"] = slide
    ui_runtime["slideError"] = slide_error
    ui_runtime["triggers"] = triggers
    state["uiRuntime"] = ui_runtime
    return state


def run_action_sequence(
    session,
    event,
    steps,
    client_ui_state=None,
    source="event-action",
    metadata=None,
):
    actions = []
    messages = []
    next_event_slug = ""
    runtime_context = dict(session.runtime_context or {})
    client_ui_state = parse_client_ui_state(client_ui_state)
    metadata = dict(metadata or {})

    sorted_steps = sorted(
        steps,
        key=lambda step: int(step.get("sortOrder", 0) or 0),
    )

    for step in sorted_steps:
        if not step.get("enabled", True):
            continue

        action_type = str(step.get("actionType", "")).strip()
        step_id = str(step.get("id", "")).strip()
        config = step.get("config") if isinstance(step.get("config"), dict) else {}

        if not condition_matches(step.get("condition"), runtime_context):
            actions.append(
                {
                    "type": "skipped",
                    "actionType": action_type,
                    "eventId": str(event.id),
                    "reason": "condition_not_met",
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.SCRIPT:
            text = render_context_template(
                config.get("text", ""),
                runtime_context,
            ).strip()
            if not text:
                continue

            message = create_message_for_runtime(
                session=session,
                role=SessionMessage.Role.ASSISTANT,
                content=text,
                metadata={
                    "actionType": action_type,
                    "eventId": str(event.id),
                    "source": source,
                    "stepId": step_id,
                    **metadata,
                },
            )
            messages.append(message)
            actions.append(
                {
                    "type": "chat_message",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "message": serialize_message(message),
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.SET_CONTEXT:
            key = str(config.get("key", "")).strip()
            if not key:
                continue
            runtime_context[key] = config.get("value")
            actions.append(
                {
                    "type": "set_context",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "key": key,
                    "value": runtime_context[key],
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.APPEND_CONTEXT_LIST:
            key = str(config.get("key", "")).strip()
            if not key:
                continue
            current_value = runtime_context.get(key)
            if isinstance(current_value, list):
                next_values = list(current_value)
            elif current_value in (None, ""):
                next_values = []
            else:
                next_values = [current_value]

            next_value = config.get("value")
            appended = False
            if not any(values_match(item, next_value) for item in next_values):
                next_values.append(next_value)
                appended = True
            runtime_context[key] = next_values
            actions.append(
                {
                    "type": "append_context_list",
                    "appended": appended,
                    "eventId": str(event.id),
                    "key": key,
                    "list": next_values,
                    "stepId": step_id,
                    "value": next_value,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.GET_UI_STATE:
            state_key = str(config.get("stateKey", "")).strip()
            context_key = str(config.get("contextKey", state_key)).strip()
            if not state_key or not context_key:
                continue
            runtime_context[context_key] = normalize_runtime_value(
                client_ui_state.get(state_key)
            )
            actions.append(
                {
                    "type": "get_ui_state",
                    "contextKey": context_key,
                    "eventId": str(event.id),
                    "stateKey": state_key,
                    "stepId": step_id,
                    "value": runtime_context[context_key],
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.HIGHLIGHT_ON:
            selector = str(config.get("selector", "")).strip()
            if not selector:
                continue
            actions.append(
                {
                    "type": "highlight_on",
                    "color": str(
                        config.get("color", "rgba(59, 130, 246, 0.6)")
                    ),
                    "eventId": str(event.id),
                    "selector": selector,
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.HIGHLIGHT_OFF:
            selector = str(config.get("selector", "")).strip()
            if not selector:
                continue
            actions.append(
                {
                    "type": "highlight_off",
                    "eventId": str(event.id),
                    "selector": selector,
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.SET_UI_TRIGGER:
            selector = str(config.get("selector", "")).strip()
            triggers_event = str(config.get("triggersEvent", "")).strip()
            if not selector or not triggers_event:
                continue
            actions.append(
                {
                    "type": "set_ui_trigger",
                    "eventId": str(event.id),
                    "selector": selector,
                    "stepId": step_id,
                    "triggersEvent": triggers_event,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.GOTO_EVENT:
            triggers_event = str(config.get("triggersEvent", "")).strip()
            if not triggers_event:
                continue
            next_event_slug = triggers_event
            actions.append(
                {
                    "type": "goto_event",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "triggersEvent": triggers_event,
                    **metadata,
                }
            )
            break

        if action_type == EventActionStep.ActionType.BUTTON_CHOICE:
            label = str(config.get("label", "")).strip()
            triggers_event = str(config.get("triggersEvent", "")).strip()
            if not label or not triggers_event:
                continue
            actions.append(
                {
                    "type": "button_choice",
                    "eventId": str(event.id),
                    "label": label,
                    "stepId": step_id,
                    "triggersEvent": triggers_event,
                    **metadata,
                }
            )

    session.runtime_context = runtime_context
    return actions, messages, next_event_slug


def run_event_steps(session, event, client_ui_state=None):
    steps = [
        action_step_from_model(step)
        for step in event.steps.filter(enabled=True).order_by("sort_order", "created_at")
    ]
    return run_action_sequence(
        session,
        event,
        steps,
        client_ui_state=client_ui_state,
        source="event-action",
    )


def run_event_chain(session, first_event, client_ui_state=None, state=None):
    actions = []
    messages = []
    ran_events = []
    state = dict(state or {})
    event_runs = dict(state.get("eventRuns") or {})
    event = first_event
    current_event = first_event

    for _ in range(MAX_EVENT_CHAIN_DEPTH):
        current_event = event
        run_key = str(event.id)
        if event_runs.get(run_key, {}).get("status") == "complete":
            actions.append(
                {
                    "type": "event_skipped",
                    "eventId": str(event.id),
                    "reason": "already_complete",
                }
            )
            break

        step_actions, step_messages, next_event_slug = run_event_steps(
            session,
            event,
            client_ui_state=client_ui_state,
        )
        actions.extend(step_actions)
        messages.extend(step_messages)
        ran_events.append(event)
        event_runs[run_key] = {
            "completedAt": timezone.now().isoformat(),
            "status": "complete",
        }

        if not next_event_slug:
            break

        next_event = session.experience.events.filter(slug=next_event_slug).first()
        if not next_event:
            actions.append(
                {
                    "type": "transition_missing",
                    "eventId": str(event.id),
                    "triggersEvent": next_event_slug,
                }
            )
            break

        event = next_event
    else:
        actions.append(
            {
                "type": "transition_depth_exceeded",
                "eventId": str(event.id),
                "limit": MAX_EVENT_CHAIN_DEPTH,
            }
        )

    state["eventRuns"] = event_runs
    if current_event:
        state["currentEventId"] = str(current_event.id)
        state["currentEventSlug"] = current_event.slug
    return actions, messages, ran_events, state


def conversation_check_transcript(session, limit=16):
    messages = list(
        session.messages.filter(
            role__in=[SessionMessage.Role.USER, SessionMessage.Role.ASSISTANT]
        ).order_by("-sequence")[:limit]
    )
    messages.reverse()
    return "\n".join(
        f"{message.role}: {message.content.strip()}" for message in messages
    )


def parse_check_result(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes", "y", "1", "match", "matched"}:
            return True
        if normalized in {"false", "no", "n", "0", "none", "not_matched"}:
            return False
    return False


def classifier_schema(classifier):
    if isinstance(classifier.schema, dict) and classifier.schema.get("type"):
        return classifier.schema
    return DEFAULT_CLASSIFIER_RESULT_SCHEMA


def classifier_schema_name(name):
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(name or "classifier")).strip("_")
    if not normalized:
        normalized = "classifier"
    if normalized[0].isdigit():
        normalized = f"classifier_{normalized}"
    return normalized[:64]


def classifier_has_positive_result(payload):
    if not isinstance(payload, dict):
        return False
    for key in ("mentioned", "result", "matched", "triggered"):
        if parse_check_result(payload.get(key)):
            return True
    return False


def classifier_chat_payload(model, messages, max_completion_tokens, response_format):
    payload = {
        "model": model,
        "messages": messages,
        "max_completion_tokens": max_completion_tokens,
        "response_format": response_format,
    }
    if not str(model).strip().endswith("-pro"):
        payload["reasoning_effort"] = "none"
    return payload


def evaluate_event_classifier(
    user,
    current_event,
    group,
    classifier,
    default_model,
    runtime_context,
    transcript,
):
    if not settings.OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not configured."

    schema = classifier_schema(classifier)
    model = (
        classifier.model.strip()
        or str(default_model or "").strip()
        or settings.DLU_CLASSIFICATION_DEFAULT_MODEL
        or DEFAULT_CLASSIFICATION_MODEL
    )
    prompt = "\n\n".join(
        [
            "Run one independent classifier for the current tutoring chat.",
            f"Current event: {current_event.title if current_event else ''}",
            f"Classifier name: {classifier.name}",
            f"Group instructions:\n{group.instructions.strip()}",
            f"Classifier instructions:\n{classifier.prompt.strip()}",
            (
                "Return JSON only. The JSON must match the provided schema. "
                "Do not infer from older turns unless the classifier explicitly "
                "asks for conversation history."
            ),
            f"Runtime context:\n{json.dumps(runtime_context or {}, ensure_ascii=True)[:3000]}",
            f"Recent conversation:\n{transcript}",
        ]
    )

    try:
        response = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
                "OpenAI-Safety-Identifier": hash_safety_identifier(user),
            },
            json=classifier_chat_payload(
                model,
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a strict JSON classifier. Run only the "
                            "requested classifier and return no prose."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                320,
                {
                    "type": "json_schema",
                    "json_schema": {
                        "name": classifier_schema_name(classifier.name),
                        "schema": schema,
                        "strict": True,
                    },
                },
            ),
            timeout=45,
        )
    except requests.RequestException:
        return None, "Could not reach OpenAI to run a classifier."

    if response.status_code >= 400:
        return None, openai_error_message(
            response,
            "OpenAI could not run a classifier.",
        )

    try:
        response_payload = response.json()
        content = response_payload["choices"][0]["message"]["content"]
        result_payload = json.loads(content)
    except (KeyError, TypeError, ValueError, IndexError):
        return None, "OpenAI returned an unreadable classifier result."

    if not isinstance(result_payload, dict):
        return None, "OpenAI returned a classifier result that was not an object."

    return result_payload, ""


def evaluate_classifier_group(session, current_event, group, runtime_context):
    group_action = {
        "classifierGroupId": str(group.id),
        "classifierGroupTitle": group.title,
        "eventId": str(current_event.id),
        "resultContextKey": group.result_context_key,
        "type": "classifier_group_result",
    }
    if not condition_matches(group.condition, runtime_context):
        return {
            "actions": [
                {
                    **group_action,
                    "reason": "condition_not_met",
                    "type": "classifier_group_skipped",
                }
            ],
            "group": group,
            "results": {},
            "skipped": True,
        }, ""

    classifiers = list(
        group.classifiers.filter(enabled=True).order_by("sort_order", "created_at")
    )
    results = {}
    actions = []
    classifiers_to_run = []
    for classifier in classifiers:
        classifier_action = {
            "classifierGroupId": str(group.id),
            "classifierGroupTitle": group.title,
            "classifierId": str(classifier.id),
            "classifierName": classifier.name,
            "eventId": str(current_event.id),
            "resultContextKey": group.result_context_key,
        }
        if not condition_matches(classifier.condition, runtime_context):
            actions.append(
                {
                    **classifier_action,
                    "reason": "condition_not_met",
                    "type": "classifier_skipped",
                }
            )
            continue
        classifiers_to_run.append(classifier)

    if classifiers_to_run:
        transcript = conversation_check_transcript(session)
        tutor_settings = (
            ensure_tutor_settings(session.experience)
            if session.experience_id
            else None
        )
        default_model = (
            tutor_settings.classification_model
            if tutor_settings
            else settings.DLU_CLASSIFICATION_DEFAULT_MODEL
        )
        max_workers = min(6, len(classifiers_to_run))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(
                    evaluate_event_classifier,
                    session.user,
                    current_event,
                    group,
                    classifier,
                    default_model,
                    runtime_context,
                    transcript,
                ): classifier
                for classifier in classifiers_to_run
            }
            for future in as_completed(futures):
                classifier = futures[future]
                result_payload, result_error = future.result()
                if result_error:
                    return None, result_error
                results[classifier.name] = result_payload

    for classifier in classifiers_to_run:
        result_payload = results.get(classifier.name, {})
        actions.append(
            {
                "classifierGroupId": str(group.id),
                "classifierGroupTitle": group.title,
                "classifierId": str(classifier.id),
                "classifierName": classifier.name,
                "eventId": str(current_event.id),
                "result": result_payload,
                "resultContextKey": group.result_context_key,
                "type": "classifier_result",
            }
        )

    actions.append({**group_action, "results": results})
    return {
        "actions": actions,
        "group": group,
        "results": results,
        "skipped": False,
    }, ""


def evaluate_conversation_check(session, check):
    if not settings.OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not configured."

    current_event = get_session_current_event(session)
    tutor_settings = (
        ensure_tutor_settings(session.experience)
        if session.experience_id
        else None
    )
    model = (
        tutor_settings.classification_model
        if tutor_settings
        else settings.DLU_CLASSIFICATION_DEFAULT_MODEL
    )
    prompt = "\n\n".join(
        [
            "Evaluate this conversation check for the current tutoring session.",
            f"Check title: {check.title.strip() or 'Check'}",
            f"Current event: {current_event.title if current_event else ''}",
            f"Instructions:\n{check.instructions.strip()}",
            "Return JSON only with keys: result (boolean), reason (short string).",
            f"Runtime context:\n{json.dumps(session.runtime_context or {}, ensure_ascii=True)[:2000]}",
            f"Recent conversation:\n{conversation_check_transcript(session)}",
        ]
    )

    try:
        response = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
                "OpenAI-Safety-Identifier": hash_safety_identifier(session.user),
            },
            json=classifier_chat_payload(
                model,
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a strict conversation classifier. "
                            "Only return a compact JSON object."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                180,
                {"type": "json_object"},
            ),
            timeout=45,
        )
    except requests.RequestException:
        return None, "Could not reach OpenAI to run the conversation check."

    if response.status_code >= 400:
        return None, openai_error_message(
            response,
            "OpenAI could not run the conversation check.",
        )

    try:
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        result_payload = json.loads(content)
    except (KeyError, TypeError, ValueError, IndexError):
        return None, "OpenAI returned an unreadable conversation check."

    return {
        "reason": str(result_payload.get("reason", ""))[:1000],
        "result": parse_check_result(result_payload.get("result")),
    }, ""


def health(request):
    return JsonResponse({"status": "ok", "service": "dmo"})


@ensure_csrf_cookie
@require_GET
def current_user(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    return JsonResponse({"user": serialize_user(request.user)})


@require_POST
def logout_user(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    logout(request)
    return JsonResponse({"ok": True})


@require_POST
def dev_login(request):
    if not settings.DEBUG or not settings.DLU_DEV_AUTH_BYPASS:
        raise Http404("Local sign-in is not enabled.")

    email = str(settings.DLU_DEV_LOGIN_EMAIL or "").strip().lower()
    if not email or "@" not in email:
        email = "nicky@deeplearning.ai"

    username = email.split("@", 1)[0] or "dev-user"
    User = get_user_model()
    user, _ = User.objects.get_or_create(
        username=username,
        defaults={
            "email": email,
            "first_name": "Nicky",
            "last_name": "",
        },
    )
    update_fields = []
    if user.email != email:
        user.email = email
        update_fields.append("email")
    if not user.first_name:
        user.first_name = "Nicky"
        update_fields.append("first_name")
    if update_fields:
        user.save(update_fields=update_fields)

    login(request, user, backend="django.contrib.auth.backends.ModelBackend")

    next_path = str(request.POST.get("next") or settings.LOGIN_REDIRECT_URL)
    if not next_path.startswith("/") or next_path.startswith("//"):
        next_path = settings.LOGIN_REDIRECT_URL
    return redirect(next_path)


@require_http_methods(["GET", "POST"])
def experiences(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if request.method == "GET":
        current_experience = get_current_experience(request.user)
        user_experiences = Experience.objects.filter(user=request.user).order_by(
            "-updated_at", "-created_at"
        )
        return JsonResponse(
            {
                "currentExperienceId": str(current_experience.id),
                "experiences": [
                    serialize_experience(experience)
                    for experience in user_experiences
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    title = str(data.get("title", "")).strip() or DEFAULT_EXPERIENCE_TITLE
    description = str(data.get("description", "")).strip()
    if len(title) > 160:
        return JsonResponse({"detail": "Title is too long."}, status=400)
    if len(description) > 4000:
        return JsonResponse({"detail": "Description is too long."}, status=400)

    experience = Experience.objects.create(
        user=request.user,
        title=title,
        slug=unique_experience_slug(request.user, title),
        description=description,
    )
    ensure_tutor_settings(experience)
    ensure_start_event(experience)
    return JsonResponse({"experience": serialize_experience(experience)}, status=201)


@require_http_methods(["DELETE", "PATCH", "POST"])
def update_experience(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    if request.method == "DELETE":
        experience.delete()
        current_experience = get_current_experience(request.user)
        user_experiences = Experience.objects.filter(user=request.user).order_by(
            "-updated_at", "-created_at"
        )
        return JsonResponse(
            {
                "currentExperienceId": str(current_experience.id),
                "experiences": [
                    serialize_experience(experience)
                    for experience in user_experiences
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    if "title" in data:
        title = str(data.get("title", "")).strip()
        if not title:
            return JsonResponse({"detail": "Title is required."}, status=400)
        if len(title) > 160:
            return JsonResponse({"detail": "Title is too long."}, status=400)
        experience.title = title

    if "description" in data:
        description = str(data.get("description", "")).strip()
        if len(description) > 4000:
            return JsonResponse({"detail": "Description is too long."}, status=400)
        experience.description = description

    tutor_data = data.get("tutor")
    tutor_settings = ensure_tutor_settings(experience)
    if tutor_data is not None:
        if not isinstance(tutor_data, dict):
            return JsonResponse({"detail": "Tutor settings must be an object."}, status=400)

        if "assistantName" in tutor_data:
            assistant_name = str(tutor_data.get("assistantName", "")).strip()
            if not assistant_name:
                return JsonResponse({"detail": "Tutor name is required."}, status=400)
            if len(assistant_name) > 100:
                return JsonResponse({"detail": "Tutor name is too long."}, status=400)
            tutor_settings.assistant_name = assistant_name

        if "avatarPath" in tutor_data:
            avatar_path = str(tutor_data.get("avatarPath", "")).strip()
            if not avatar_path:
                return JsonResponse({"detail": "Avatar path is required."}, status=400)
            if ".." in avatar_path or avatar_path.startswith(("/", "\\")):
                return JsonResponse({"detail": "Avatar path is not supported."}, status=400)
            if len(avatar_path) > 220:
                return JsonResponse({"detail": "Avatar path is too long."}, status=400)
            tutor_settings.avatar_path = avatar_path

        if "realtimeModel" in tutor_data:
            model = normalize_realtime_choice(
                tutor_data.get("realtimeModel"),
                REALTIME_MODELS,
                settings.DLU_REALTIME_DEFAULT_MODEL,
            )
            if model is None:
                return JsonResponse({"detail": "Realtime model is not supported."}, status=400)
            tutor_settings.realtime_model = model

        if "classificationModel" in tutor_data:
            classification_model = normalize_realtime_choice(
                tutor_data.get("classificationModel"),
                classification_model_choices(),
                settings.DLU_CLASSIFICATION_DEFAULT_MODEL,
            )
            if classification_model is None:
                return JsonResponse(
                    {"detail": "Classification model is not supported."},
                    status=400,
                )
            tutor_settings.classification_model = classification_model

        if "voice" in tutor_data:
            voice = normalize_realtime_choice(
                tutor_data.get("voice"),
                REALTIME_VOICES,
                settings.DLU_REALTIME_DEFAULT_VOICE,
            )
            if voice is None:
                return JsonResponse({"detail": "Realtime voice is not supported."}, status=400)
            tutor_settings.voice = voice

        if "systemPrompt" in tutor_data:
            system_prompt = str(tutor_data.get("systemPrompt", "")).strip()
            if len(system_prompt) > 12000:
                return JsonResponse({"detail": "System prompt is too long."}, status=400)
            tutor_settings.system_prompt = system_prompt

        if "voiceInstructions" in tutor_data:
            voice_instructions = str(tutor_data.get("voiceInstructions", "")).strip()
            if len(voice_instructions) > 4000:
                return JsonResponse({"detail": "Voice instructions are too long."}, status=400)
            tutor_settings.voice_instructions = voice_instructions

        tutor_settings.save()

    experience.save()
    return JsonResponse({"experience": serialize_experience(experience)})


@require_http_methods(["GET", "POST"])
def experience_events(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    ensure_start_event(experience)

    if request.method == "GET":
        return JsonResponse(
            {
                "events": [
                    serialize_experience_event(event)
                    for event in experience.events.order_by("sort_order", "created_at")
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    title = str(data.get("title", "")).strip() or "New event"
    description = str(data.get("description", "")).strip()
    if len(title) > 160:
        return JsonResponse({"detail": "Event title is too long."}, status=400)
    if len(description) > 4000:
        return JsonResponse({"detail": "Event description is too long."}, status=400)

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

    return JsonResponse({"event": serialize_experience_event(event)}, status=201)


@require_http_methods(["DELETE", "PATCH"])
def update_experience_event(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    if request.method == "DELETE":
        if experience.events.count() <= 1:
            return JsonResponse(
                {"detail": "An experience needs at least one event."},
                status=400,
            )
        was_start = event.is_start
        event.delete()
        if was_start:
            next_event = experience.events.order_by("sort_order", "created_at").first()
            if next_event:
                next_event.is_start = True
                next_event.save(update_fields=["is_start", "updated_at"])
        ensure_start_event(experience)
        return JsonResponse(
            {
                "events": [
                    serialize_experience_event(next_event)
                    for next_event in experience.events.order_by(
                        "sort_order",
                        "created_at",
                    )
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    if "title" in data:
        title = str(data.get("title", "")).strip()
        if not title:
            return JsonResponse({"detail": "Event title is required."}, status=400)
        if len(title) > 160:
            return JsonResponse({"detail": "Event title is too long."}, status=400)
        event.title = title

    if "description" in data:
        description = str(data.get("description", "")).strip()
        if len(description) > 4000:
            return JsonResponse({"detail": "Event description is too long."}, status=400)
        event.description = description

    if "chatInstructions" in data:
        chat_instructions = str(data.get("chatInstructions", "")).strip()
        if len(chat_instructions) > 12000:
            return JsonResponse(
                {"detail": "Event chat instructions are too long."},
                status=400,
            )
        event.chat_instructions = chat_instructions

    if "isStart" in data and bool(data.get("isStart")):
        event.is_start = True
        ExperienceEvent.objects.filter(experience=experience).exclude(
            id=event.id,
        ).update(is_start=False)

    event.save()
    ensure_default_event_step(event)
    return JsonResponse({"event": serialize_experience_event(event)})


@require_POST
def create_event_action_step(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    action_type = str(
        data.get("actionType", EventActionStep.ActionType.SCRIPT)
    ).strip()
    if action_type not in EventActionStep.ActionType.values:
        return JsonResponse({"detail": "Action type is not supported."}, status=400)

    config, config_error = validate_action_config(
        action_type,
        data.get("config", {}),
    )
    if config_error:
        return JsonResponse({"detail": config_error}, status=400)

    condition, condition_error = validate_step_condition(data.get("condition", {}))
    if condition_error:
        return JsonResponse({"detail": condition_error}, status=400)

    label = str(data.get("label", "")).strip()
    if len(label) > 160:
        return JsonResponse({"detail": "Action label is too long."}, status=400)

    sort_order = (event.steps.aggregate(Max("sort_order"))["sort_order__max"] or 0) + 1
    step = EventActionStep.objects.create(
        event=event,
        action_type=action_type,
        label=label,
        config=config,
        condition=condition,
        enabled=bool(data.get("enabled", True)),
        sort_order=sort_order,
    )

    return JsonResponse(
        {
            "event": serialize_experience_event(event),
            "step": serialize_event_action_step(step),
        },
        status=201,
    )


@require_POST
def reorder_event_action_steps(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    step_ids = data.get("stepIds")
    if not isinstance(step_ids, list):
        return JsonResponse({"detail": "Step IDs must be an array."}, status=400)

    existing_steps = {str(step.id): step for step in event.steps.all()}
    if set(step_ids) != set(existing_steps.keys()):
        return JsonResponse(
            {"detail": "Reorder payload must include every event step."},
            status=400,
        )

    with transaction.atomic():
        for index, step_id in enumerate(step_ids):
            step = existing_steps[str(step_id)]
            step.sort_order = index
            step.save(update_fields=["sort_order", "updated_at"])

    return JsonResponse({"event": serialize_experience_event(event)})


@require_http_methods(["DELETE", "PATCH"])
def update_event_action_step(request, experience_id, event_id, step_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    step = event.steps.filter(id=step_id).first()
    if not step:
        return JsonResponse({"detail": "Action step not found."}, status=404)

    if request.method == "DELETE":
        if event.steps.count() <= 1:
            return JsonResponse(
                {"detail": "An event needs at least one action step."},
                status=400,
            )
        step.delete()
        for index, event_step in enumerate(
            event.steps.order_by("sort_order", "created_at")
        ):
            if event_step.sort_order == index:
                continue
            event_step.sort_order = index
            event_step.save(update_fields=["sort_order", "updated_at"])
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    action_type = str(data.get("actionType", step.action_type)).strip()
    if action_type not in EventActionStep.ActionType.values:
        return JsonResponse({"detail": "Action type is not supported."}, status=400)

    if "label" in data:
        label = str(data.get("label", "")).strip()
        if len(label) > 160:
            return JsonResponse({"detail": "Action label is too long."}, status=400)
        step.label = label

    if "enabled" in data:
        step.enabled = bool(data.get("enabled"))

    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return JsonResponse({"detail": "Sort order must be a number."}, status=400)
        if sort_order < 0:
            return JsonResponse({"detail": "Sort order must be positive."}, status=400)
        step.sort_order = sort_order

    if "config" in data or action_type != step.action_type:
        config, config_error = validate_action_config(
            action_type,
            data.get("config", step.config),
        )
        if config_error:
            return JsonResponse({"detail": config_error}, status=400)
        step.config = config

    if "condition" in data:
        condition, condition_error = validate_step_condition(data.get("condition"))
        if condition_error:
            return JsonResponse({"detail": condition_error}, status=400)
        step.condition = condition

    step.action_type = action_type
    step.save()

    return JsonResponse({"step": serialize_event_action_step(step)})


@require_POST
def create_event_chat_tool(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_chat_tool_payload(data)
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    if event.chat_tools.filter(name=payload["name"]).exists():
        return JsonResponse({"detail": "Tool name already exists."}, status=400)

    sort_order = (
        event.chat_tools.aggregate(Max("sort_order"))["sort_order__max"] or 0
    ) + 1
    payload.setdefault("sort_order", sort_order)
    EventChatTool.objects.create(event=event, **payload)

    return JsonResponse({"event": serialize_experience_event(event)}, status=201)


@require_http_methods(["DELETE", "PATCH"])
def update_event_chat_tool(request, experience_id, event_id, tool_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    tool = event.chat_tools.filter(id=tool_id).first()
    if not tool:
        return JsonResponse({"detail": "Chat tool not found."}, status=404)

    if request.method == "DELETE":
        tool.delete()
        for index, event_tool in enumerate(
            event.chat_tools.order_by("sort_order", "created_at")
        ):
            if event_tool.sort_order == index:
                continue
            event_tool.sort_order = index
            event_tool.save(update_fields=["sort_order", "updated_at"])
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_chat_tool_payload(data, existing_tool=tool)
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    duplicate = event.chat_tools.filter(name=payload["name"]).exclude(id=tool.id)
    if duplicate.exists():
        return JsonResponse({"detail": "Tool name already exists."}, status=400)

    for field, value in payload.items():
        setattr(tool, field, value)
    tool.save()

    return JsonResponse({"tool": serialize_event_chat_tool(tool)})


@require_POST
def create_event_conversation_check(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_conversation_check_payload(data)
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    sort_order = (
        event.conversation_checks.aggregate(Max("sort_order"))["sort_order__max"] or 0
    ) + 1
    payload.setdefault("sort_order", sort_order)
    EventConversationCheck.objects.create(event=event, **payload)

    return JsonResponse({"event": serialize_experience_event(event)}, status=201)


@require_http_methods(["DELETE", "PATCH"])
def update_event_conversation_check(request, experience_id, event_id, check_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    check = event.conversation_checks.filter(id=check_id).first()
    if not check:
        return JsonResponse({"detail": "Conversation check not found."}, status=404)

    if request.method == "DELETE":
        check.delete()
        for index, event_check in enumerate(
            event.conversation_checks.order_by("sort_order", "created_at")
        ):
            if event_check.sort_order == index:
                continue
            event_check.sort_order = index
            event_check.save(update_fields=["sort_order", "updated_at"])
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_conversation_check_payload(
        data,
        existing_check=check,
    )
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    for field, value in payload.items():
        setattr(check, field, value)
    check.save()

    return JsonResponse({"check": serialize_event_conversation_check(check)})


@require_POST
def create_event_classifier_group(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_classifier_group_payload(data)
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    sort_order = (
        event.classifier_groups.aggregate(Max("sort_order"))["sort_order__max"] or 0
    ) + 1
    payload.setdefault("sort_order", sort_order)
    group = EventClassifierGroup.objects.create(event=event, **payload)

    return JsonResponse(
        {
            "event": serialize_experience_event(event),
            "group": serialize_event_classifier_group(group),
        },
        status=201,
    )


@require_http_methods(["DELETE", "PATCH"])
def update_event_classifier_group(request, experience_id, event_id, group_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    group = event.classifier_groups.filter(id=group_id).first()
    if not group:
        return JsonResponse({"detail": "Classifier group not found."}, status=404)

    if request.method == "DELETE":
        group.delete()
        for index, event_group in enumerate(
            event.classifier_groups.order_by("sort_order", "created_at")
        ):
            if event_group.sort_order == index:
                continue
            event_group.sort_order = index
            event_group.save(update_fields=["sort_order", "updated_at"])
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_classifier_group_payload(
        data,
        existing_group=group,
    )
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    for field, value in payload.items():
        setattr(group, field, value)
    group.save()

    return JsonResponse({"group": serialize_event_classifier_group(group)})


@require_POST
def create_event_classifier(request, experience_id, event_id, group_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    group = event.classifier_groups.filter(id=group_id).first()
    if not group:
        return JsonResponse({"detail": "Classifier group not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_classifier_payload(data)
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    if group.classifiers.filter(name=payload["name"]).exists():
        return JsonResponse({"detail": "Classifier name already exists."}, status=400)

    sort_order = (
        group.classifiers.aggregate(Max("sort_order"))["sort_order__max"] or 0
    ) + 1
    payload.setdefault("sort_order", sort_order)
    classifier = EventClassifier.objects.create(group=group, **payload)

    return JsonResponse(
        {
            "classifier": serialize_event_classifier(classifier),
            "event": serialize_experience_event(event),
        },
        status=201,
    )


@require_http_methods(["DELETE", "PATCH"])
def update_event_classifier(request, experience_id, event_id, group_id, classifier_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    group = event.classifier_groups.filter(id=group_id).first()
    if not group:
        return JsonResponse({"detail": "Classifier group not found."}, status=404)

    classifier = group.classifiers.filter(id=classifier_id).first()
    if not classifier:
        return JsonResponse({"detail": "Classifier not found."}, status=404)

    if request.method == "DELETE":
        classifier.delete()
        for index, event_classifier in enumerate(
            group.classifiers.order_by("sort_order", "created_at")
        ):
            if event_classifier.sort_order == index:
                continue
            event_classifier.sort_order = index
            event_classifier.save(update_fields=["sort_order", "updated_at"])
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, payload_error = validate_classifier_payload(
        data,
        existing_classifier=classifier,
    )
    if payload_error:
        return JsonResponse({"detail": payload_error}, status=400)

    duplicate = group.classifiers.filter(name=payload["name"]).exclude(
        id=classifier.id,
    )
    if duplicate.exists():
        return JsonResponse({"detail": "Classifier name already exists."}, status=400)

    for field, value in payload.items():
        setattr(classifier, field, value)
    classifier.save()

    return JsonResponse({"classifier": serialize_event_classifier(classifier)})


@require_GET
def current_session(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience_id = request.GET.get("experienceId")
    experience = get_current_experience(request.user, experience_id)
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    session = get_current_session(request.user, experience)
    return JsonResponse(session_payload(session))


@require_POST
def create_session(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    experience_id = data.get("experienceId")
    experience = get_current_experience(request.user, experience_id)
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    session = TutoringSession.objects.create(user=request.user, experience=experience)
    return JsonResponse(session_payload(session), status=201)


@require_POST
def run_start_event(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    client_ui_state = parse_client_ui_state(data.get("uiState"))

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=request.user,
                status=TutoringSession.Status.ACTIVE,
            )
            .first()
        )
        if not session:
            return JsonResponse({"detail": "Session not found."}, status=404)
        if not session.experience:
            return JsonResponse(
                {"detail": "Session does not have an experience."},
                status=400,
            )

        event = ensure_start_event(session.experience)
        state = dict(session.runtime_state or {})
        event_runs = dict(state.get("eventRuns") or {})
        run_key = str(event.id)

        if event_runs.get(run_key, {}).get("status") == "complete":
            return JsonResponse(
                {
                    **session_payload(session),
                    "actions": [],
                    "event": serialize_experience_event(event),
                    "ran": False,
                }
            )

        if not event_runs and session.messages.exists():
            event_runs[run_key] = {
                "completedAt": timezone.now().isoformat(),
                "reason": "Session already had messages.",
                "status": "skipped",
            }
            state["eventRuns"] = event_runs
            state["startEventId"] = str(event.id)
            state["startEventComplete"] = True
            session.runtime_state = state
            session.save(update_fields=["runtime_state", "updated_at"])
            return JsonResponse(
                {
                    **session_payload(session),
                    "actions": [],
                    "event": serialize_experience_event(event),
                    "ran": False,
                }
            )

        actions, messages, ran_events, state = run_event_chain(
            session,
            event,
            client_ui_state=client_ui_state,
            state=state,
        )
        state["startEventId"] = str(event.id)
        state["startEventComplete"] = True
        state = apply_runtime_actions_to_state(state, actions)
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "event": serialize_experience_event(event),
            "ran": True,
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )


@require_POST
def run_session_event(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    event_id = str(data.get("eventId", "")).strip()
    event_slug = str(data.get("eventSlug", "")).strip()
    clear_buttons = bool(data.get("clearButtons", False))
    trigger_selector = str(data.get("triggerSelector", "")).strip()
    client_ui_state = parse_client_ui_state(data.get("uiState"))

    if not event_id and not event_slug:
        return JsonResponse({"detail": "Event is required."}, status=400)

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=request.user,
                status=TutoringSession.Status.ACTIVE,
            )
            .first()
        )
        if not session:
            return JsonResponse({"detail": "Session not found."}, status=404)
        if not session.experience:
            return JsonResponse(
                {"detail": "Session does not have an experience."},
                status=400,
            )

        event_query = session.experience.events.all()
        if event_id:
            event = event_query.filter(id=event_id).first()
        else:
            event = event_query.filter(slug=event_slug).first()
        if not event:
            return JsonResponse({"detail": "Event not found."}, status=404)

        state = dict(session.runtime_state or {})
        event_runs = dict(state.get("eventRuns") or {})
        run_key = str(event.id)
        if event_runs.get(run_key, {}).get("status") == "complete":
            if clear_buttons or trigger_selector:
                state = apply_runtime_actions_to_state(
                    state,
                    [],
                    clear_buttons=clear_buttons,
                    clear_trigger_selector=trigger_selector,
                )
                session.runtime_state = state
                session.save(update_fields=["runtime_state", "updated_at"])
            return JsonResponse(
                {
                    **session_payload(session),
                    "actions": [],
                    "event": serialize_experience_event(event),
                    "ran": False,
                }
            )

        actions, messages, ran_events, state = run_event_chain(
            session,
            event,
            client_ui_state=client_ui_state,
            state=state,
        )
        state = apply_runtime_actions_to_state(
            state,
            actions,
            clear_buttons=clear_buttons,
            clear_trigger_selector=trigger_selector,
        )
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "event": serialize_experience_event(event),
            "ran": True,
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )


def parse_tool_arguments(value):
    if value in (None, ""):
        return {}, ""
    if isinstance(value, dict):
        return value, ""
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return None, "Tool arguments must be valid JSON."
        if isinstance(parsed, dict):
            return parsed, ""
    return None, "Tool arguments must be an object."


@require_POST
def run_session_chat_tool(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    tool_name, name_error = validate_chat_tool_name(data.get("toolName"))
    if name_error:
        return JsonResponse({"detail": name_error}, status=400)

    arguments, arguments_error = parse_tool_arguments(data.get("arguments", {}))
    if arguments_error:
        return JsonResponse({"detail": arguments_error}, status=400)

    client_ui_state = parse_client_ui_state(data.get("uiState"))

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=request.user,
                status=TutoringSession.Status.ACTIVE,
            )
            .first()
        )
        if not session:
            return JsonResponse({"detail": "Session not found."}, status=404)
        if not session.experience:
            return JsonResponse(
                {"detail": "Session does not have an experience."},
                status=400,
            )

        current_event = get_session_current_event(session)
        if not current_event:
            return JsonResponse({"detail": "Current event not found."}, status=404)

        tool = current_event.chat_tools.filter(
            enabled=True,
            name=tool_name,
        ).first()
        if not tool:
            return JsonResponse({"detail": "Chat tool is not available."}, status=400)

        state = dict(session.runtime_state or {})
        runtime_context = dict(session.runtime_context or {})
        saved_value = None
        saved_values = {}
        capture_saves = tool_capture_save_map(tool)
        if capture_saves:
            for argument_name, context_key in capture_saves.items():
                if argument_name:
                    saved_values[context_key] = arguments.get(argument_name, "")
                else:
                    saved_values[context_key] = arguments
            runtime_context.update(saved_values)
            if len(saved_values) == 1:
                saved_value = next(iter(saved_values.values()))
            else:
                saved_value = saved_values
            session.runtime_context = runtime_context

        actions = [
            {
                "arguments": arguments,
                "eventId": str(current_event.id),
                "handlerActionCount": len(tool.handler_actions or []),
                "saveArgument": tool.save_argument,
                "saveContextKey": tool.save_context_key,
                "savedValue": saved_value,
                "savedValues": saved_values,
                "toolName": tool.name,
                "triggersEvent": tool.triggers_event,
                "type": "chat_tool_call",
            }
        ]
        messages = []
        ran_events = []
        handler_next_event_slug = ""

        if tool.handler_actions:
            handler_actions, messages, handler_next_event_slug = run_action_sequence(
                session,
                current_event,
                tool.handler_actions,
                client_ui_state=client_ui_state,
                source="conversation-tool-action",
                metadata={"toolName": tool.name, "toolId": str(tool.id)},
            )
            actions.extend(handler_actions)

        next_event_slug = handler_next_event_slug or tool.triggers_event
        if next_event_slug:
            next_event = session.experience.events.filter(
                slug=next_event_slug
            ).first()
            if not next_event:
                actions.append(
                    {
                        "type": "transition_missing",
                        "eventId": str(current_event.id),
                        "triggersEvent": next_event_slug,
                    }
                )
            else:
                step_actions, event_messages, ran_events, state = run_event_chain(
                    session,
                    next_event,
                    client_ui_state=client_ui_state,
                    state=state,
                )
                actions.extend(step_actions)
                messages.extend(event_messages)

        state = apply_runtime_actions_to_state(state, actions, clear_buttons=True)
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "event": serialize_experience_event(get_session_current_event(session)),
            "ran": bool(ran_events),
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )


@require_POST
def run_session_conversation_checks(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    client_ui_state = parse_client_ui_state(data.get("uiState"))

    session = (
        TutoringSession.objects.filter(
            id=session_id,
            user=request.user,
            status=TutoringSession.Status.ACTIVE,
        )
        .select_related("experience", "user")
        .first()
    )
    if not session:
        return JsonResponse({"detail": "Session not found."}, status=404)
    if not session.experience:
        return JsonResponse(
            {"detail": "Session does not have an experience."},
            status=400,
        )

    current_event = get_session_current_event(session)
    if not current_event:
        return JsonResponse({"detail": "Current event not found."}, status=404)

    classifier_groups = list(
        current_event.classifier_groups.filter(enabled=True).order_by(
            "sort_order", "created_at"
        )
    )
    checks = list(
        current_event.conversation_checks.filter(enabled=True).order_by(
            "sort_order", "created_at"
        )
    )
    if not classifier_groups and not checks:
        return JsonResponse(
            {
                **session_payload(session),
                "actions": [],
                "checks": [],
                "classifierGroups": [],
                "handled": False,
                "ran": False,
                "ranEvents": [],
                "ranMessages": [],
            }
        )

    evaluated_classifier_groups = []
    runtime_context_preview = dict(session.runtime_context or {})
    for group in classifier_groups:
        session.runtime_context = runtime_context_preview
        group_payload, group_error = evaluate_classifier_group(
            session,
            current_event,
            group,
            runtime_context_preview,
        )
        if group_error:
            return JsonResponse({"detail": group_error}, status=502)

        evaluated_classifier_groups.append(group_payload)
        if group.result_context_key:
            runtime_context_preview[group.result_context_key] = group_payload[
                "results"
            ]
        if group.handler_actions or group.triggers_event:
            break

    actions = []
    messages = []
    ran_events = []
    classifier_results = []
    handled = False

    if evaluated_classifier_groups:
        with transaction.atomic():
            session = (
                TutoringSession.objects.select_for_update()
                .filter(
                    id=session_id,
                    user=request.user,
                    status=TutoringSession.Status.ACTIVE,
                )
                .first()
            )
            if not session:
                return JsonResponse({"detail": "Session not found."}, status=404)
            if not session.experience:
                return JsonResponse(
                    {"detail": "Session does not have an experience."},
                    status=400,
                )

            current_event = get_session_current_event(session)
            if not current_event:
                return JsonResponse(
                    {"detail": "Current event not found."},
                    status=404,
                )

            state = dict(session.runtime_state or {})
            runtime_context = dict(session.runtime_context or {})

            for group_payload in evaluated_classifier_groups:
                group = group_payload["group"]
                results = group_payload["results"]
                group_actions = group_payload["actions"]
                actions.extend(group_actions)
                classifier_results.append(
                    {
                        "classifierGroupId": str(group.id),
                        "classifierGroupTitle": group.title,
                        "resultContextKey": group.result_context_key,
                        "results": results,
                        "skipped": bool(group_payload.get("skipped")),
                    }
                )

                if group.result_context_key:
                    runtime_context[group.result_context_key] = results
                    session.runtime_context = runtime_context

                if group_payload.get("skipped"):
                    continue

                handler_next_event_slug = ""
                handler_messages = []
                if group.handler_actions:
                    (
                        handler_actions,
                        handler_messages,
                        handler_next_event_slug,
                    ) = run_action_sequence(
                        session,
                        current_event,
                        group.handler_actions,
                        client_ui_state=client_ui_state,
                        source="classifier-group-action",
                        metadata={
                            "classifierGroupId": str(group.id),
                            "classifierGroupTitle": group.title,
                        },
                    )
                    actions.extend(handler_actions)
                    messages.extend(handler_messages)
                    runtime_context = dict(session.runtime_context or {})

                next_event_slug = handler_next_event_slug
                if (
                    not next_event_slug
                    and group.triggers_event
                    and any(
                        classifier_has_positive_result(result)
                        for result in results.values()
                    )
                ):
                    next_event_slug = group.triggers_event

                if next_event_slug:
                    next_event = session.experience.events.filter(
                        slug=next_event_slug
                    ).first()
                    if not next_event:
                        actions.append(
                            {
                                "type": "transition_missing",
                                "eventId": str(current_event.id),
                                "triggersEvent": next_event_slug,
                            }
                        )
                    else:
                        (
                            step_actions,
                            event_messages,
                            ran_events,
                            state,
                        ) = run_event_chain(
                            session,
                            next_event,
                            client_ui_state=client_ui_state,
                            state=state,
                        )
                        actions.extend(step_actions)
                        messages.extend(event_messages)

                handled = bool(next_event_slug or handler_messages)
                if handled:
                    break

            state = apply_runtime_actions_to_state(
                state,
                actions,
                clear_buttons=handled,
            )
            session.runtime_state = state
            session.save(
                update_fields=["runtime_context", "runtime_state", "updated_at"]
            )

    if handled or not checks:
        return JsonResponse(
            {
                **session_payload(session),
                "actions": actions,
                "checks": [],
                "classifierGroups": classifier_results,
                "handled": handled,
                "ran": bool(ran_events),
                "ranEvents": [
                    serialize_experience_event(ran_event)
                    for ran_event in ran_events
                ],
                "ranMessages": [serialize_message(message) for message in messages],
            }
        )

    session.refresh_from_db()
    current_event = get_session_current_event(session)
    evaluated_checks = []
    runtime_context_preview = dict(session.runtime_context or {})
    for check in checks:
        session.runtime_context = runtime_context_preview
        result_payload, result_error = evaluate_conversation_check(session, check)
        if result_error:
            return JsonResponse({"detail": result_error}, status=502)

        result = bool(result_payload["result"])
        reason = result_payload.get("reason", "")
        if check.result_context_key:
            runtime_context_preview[check.result_context_key] = (
                "true" if result else "false"
            )

        check_action = {
            "checkId": str(check.id),
            "eventId": str(current_event.id),
            "reason": reason,
            "result": result,
            "resultContextKey": check.result_context_key,
            "type": "conversation_check_result",
        }
        evaluated_checks.append((check, check_action, result))
        if result and (check.handler_actions or check.triggers_event):
            break

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=request.user,
                status=TutoringSession.Status.ACTIVE,
            )
            .first()
        )
        if not session:
            return JsonResponse({"detail": "Session not found."}, status=404)
        if not session.experience:
            return JsonResponse(
                {"detail": "Session does not have an experience."},
                status=400,
            )

        current_event = get_session_current_event(session)
        if not current_event:
            return JsonResponse({"detail": "Current event not found."}, status=404)

        state = dict(session.runtime_state or {})
        runtime_context = dict(session.runtime_context or {})
        check_results = []

        for check, check_action, result in evaluated_checks:
            if check.result_context_key:
                runtime_context[check.result_context_key] = (
                    "true" if result else "false"
                )
                session.runtime_context = runtime_context

            actions.append(check_action)
            check_results.append(check_action)

            if not result:
                continue

            handler_next_event_slug = ""
            if check.handler_actions:
                handler_actions, handler_messages, handler_next_event_slug = (
                    run_action_sequence(
                        session,
                        current_event,
                        check.handler_actions,
                        client_ui_state=client_ui_state,
                        source="conversation-check-action",
                        metadata={
                            "checkId": str(check.id),
                            "checkTitle": check.title,
                        },
                    )
                )
                actions.extend(handler_actions)
                messages.extend(handler_messages)

            next_event_slug = handler_next_event_slug or check.triggers_event
            if next_event_slug:
                next_event = session.experience.events.filter(
                    slug=next_event_slug
                ).first()
                if not next_event:
                    actions.append(
                        {
                            "type": "transition_missing",
                            "eventId": str(current_event.id),
                            "triggersEvent": next_event_slug,
                        }
                    )
                else:
                    step_actions, event_messages, ran_events, state = run_event_chain(
                        session,
                        next_event,
                        client_ui_state=client_ui_state,
                        state=state,
                    )
                    actions.extend(step_actions)
                    messages.extend(event_messages)

            handled = bool(check.handler_actions or next_event_slug)
            if handled:
                break

        state = apply_runtime_actions_to_state(state, actions, clear_buttons=handled)
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "checks": check_results,
            "classifierGroups": classifier_results,
            "handled": handled,
            "ran": bool(ran_events),
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )


@require_POST
def create_message(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    session = TutoringSession.objects.filter(
        id=session_id,
        user=request.user,
        status=TutoringSession.Status.ACTIVE,
    ).first()
    if not session:
        return JsonResponse({"detail": "Session not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    content = str(data.get("content", "")).strip()
    if not content:
        return JsonResponse({"detail": "Message content is required."}, status=400)
    if len(content) > 12000:
        return JsonResponse({"detail": "Message content is too long."}, status=400)

    role = str(data.get("role", SessionMessage.Role.USER)).strip()
    if role not in {SessionMessage.Role.USER, SessionMessage.Role.ASSISTANT}:
        return JsonResponse({"detail": "Message role is not supported."}, status=400)

    metadata = data.get("metadata", {})
    if not isinstance(metadata, dict):
        return JsonResponse({"detail": "Message metadata must be an object."}, status=400)

    with transaction.atomic():
        next_sequence = (
            SessionMessage.objects.filter(session=session).aggregate(Max("sequence"))[
                "sequence__max"
            ]
            or 0
        ) + 1
        message = SessionMessage.objects.create(
            session=session,
            role=role,
            content=content,
            sequence=next_sequence,
            metadata=metadata,
        )

        if role == SessionMessage.Role.USER and not session.title:
            session.title = content[:80]
            session.save(update_fields=["title", "updated_at"])
        else:
            session.save(update_fields=["updated_at"])

    return JsonResponse(
        {
            "session": serialize_session(session),
            "message": serialize_message(message),
        },
        status=201,
    )


@require_POST
def create_message_audio(request, session_id, message_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if not settings.OPENAI_API_KEY:
        return JsonResponse(
            {"detail": "OPENAI_API_KEY is not configured."},
            status=500,
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    session = TutoringSession.objects.filter(
        id=session_id,
        user=request.user,
        status=TutoringSession.Status.ACTIVE,
    ).first()
    if not session:
        return JsonResponse({"detail": "Session not found."}, status=404)
    if not session.experience:
        return JsonResponse(
            {"detail": "Session does not have an experience."},
            status=400,
        )

    message = session.messages.filter(
        id=message_id,
        role=SessionMessage.Role.ASSISTANT,
    ).first()
    if not message:
        return JsonResponse({"detail": "Message not found."}, status=404)

    script = message.content.strip()
    if not script:
        return JsonResponse({"detail": "Message has no script text."}, status=400)

    metadata = message.metadata or {}
    if metadata.get("source") not in SCRIPT_AUDIO_MESSAGE_SOURCES:
        return JsonResponse(
            {"detail": "Only scripted action messages can be recorded."},
            status=400,
        )

    tutor_settings = ensure_tutor_settings(session.experience)
    default_model = str(
        data.get("model") or tutor_settings.realtime_model
    ).strip()
    realtime_model = normalize_realtime_choice(
        default_model,
        REALTIME_MODELS,
        tutor_settings.realtime_model,
    )
    if realtime_model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    default_voice = str(data.get("voice") or tutor_settings.voice).strip()
    voice = normalize_realtime_choice(
        default_voice,
        REALTIME_VOICES,
        tutor_settings.voice,
    )
    if voice is None:
        return JsonResponse({"detail": "Realtime voice is not supported."}, status=400)

    try:
        recording = get_or_create_script_audio(
            api_key=settings.OPENAI_API_KEY,
            assistant_name=tutor_settings.assistant_name,
            realtime_model=realtime_model,
            safety_identifier=hash_safety_identifier(request.user),
            script=script,
            tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
            voice=voice,
            voice_instructions=tutor_settings.voice_instructions,
        )
    except AudioGenerationError as error:
        return JsonResponse({"detail": error.message}, status=error.status_code)

    return JsonResponse(
        {
            "audioUrl": f"/api/script-audio/{recording.cache_key}.wav/",
            "cached": recording.cached,
            "messageId": str(message.id),
            "realtimeModel": realtime_model,
            "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
            "voice": voice,
        }
    )


@require_POST
def create_voice_sample(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if not settings.OPENAI_API_KEY:
        return JsonResponse(
            {"detail": "OPENAI_API_KEY is not configured."},
            status=500,
        )

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    tutor_settings = ensure_tutor_settings(experience)
    sample_tutor = data.get("tutor")
    if sample_tutor is None:
        sample_tutor = {}
    if not isinstance(sample_tutor, dict):
        return JsonResponse({"detail": "Tutor settings must be an object."}, status=400)

    assistant_name = str(
        sample_tutor.get("assistantName") or tutor_settings.assistant_name
    ).strip()
    voice_instructions = str(
        sample_tutor.get("voiceInstructions") or tutor_settings.voice_instructions
    ).strip()
    if not assistant_name:
        return JsonResponse({"detail": "Tutor name is required."}, status=400)
    if len(assistant_name) > 100:
        return JsonResponse({"detail": "Tutor name is too long."}, status=400)
    if len(voice_instructions) > 4000:
        return JsonResponse({"detail": "Voice instructions are too long."}, status=400)

    default_model = sample_tutor.get("realtimeModel") or tutor_settings.realtime_model
    realtime_model = normalize_realtime_choice(
        data.get("model"),
        REALTIME_MODELS,
        default_model,
    )
    if realtime_model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    default_voice = sample_tutor.get("voice") or tutor_settings.voice
    voice = normalize_realtime_choice(
        data.get("voice"),
        REALTIME_VOICES,
        default_voice,
    )
    if voice is None:
        return JsonResponse({"detail": "Realtime voice is not supported."}, status=400)

    try:
        sample = get_or_create_voice_sample(
            api_key=settings.OPENAI_API_KEY,
            assistant_name=assistant_name,
            realtime_model=realtime_model,
            safety_identifier=hash_safety_identifier(request.user),
            script_model=settings.DLU_VOICE_SAMPLE_SCRIPT_MODEL,
            tts_model=settings.DLU_VOICE_SAMPLE_TTS_MODEL,
            voice=voice,
            voice_instructions=voice_instructions,
        )
    except AudioGenerationError as error:
        return JsonResponse({"detail": error.message}, status=error.status_code)

    return JsonResponse(
        {
            "audioUrl": f"/api/voice-samples/{sample.cache_key}.wav/",
            "cached": sample.cached,
            "realtimeModel": realtime_model,
            "script": sample.script,
            "scriptModel": settings.DLU_VOICE_SAMPLE_SCRIPT_MODEL,
            "ttsModel": settings.DLU_VOICE_SAMPLE_TTS_MODEL,
            "voice": voice,
        }
    )


@require_GET
def serve_voice_sample_audio(request, filename):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if not re.fullmatch(r"[a-f0-9]{32}\.wav", filename):
        raise Http404("Voice sample not found.")

    cache_key = filename.removesuffix(".wav")
    audio_path = voice_sample_audio_path(cache_key)
    if not audio_path.exists():
        raise Http404("Voice sample not found.")

    return FileResponse(audio_path.open("rb"), content_type="audio/wav")


@require_GET
def serve_script_audio(request, filename):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if not re.fullmatch(r"[a-f0-9]{32}\.wav", filename):
        raise Http404("Script audio not found.")

    cache_key = filename.removesuffix(".wav")
    audio_path = script_audio_audio_path(cache_key)
    if not audio_path.exists():
        raise Http404("Script audio not found.")

    return FileResponse(audio_path.open("rb"), content_type="audio/wav")


@require_POST
def create_realtime_client_secret(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if not settings.OPENAI_API_KEY:
        return JsonResponse(
            {"detail": "OPENAI_API_KEY is not configured."},
            status=500,
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    session_id = data.get("sessionId")
    session = TutoringSession.objects.filter(
        id=session_id,
        user=request.user,
        status=TutoringSession.Status.ACTIVE,
    ).first()
    if not session:
        return JsonResponse({"detail": "Session not found."}, status=404)

    tutor_settings = ensure_tutor_settings(session.experience) if session.experience else None
    default_model = (
        tutor_settings.realtime_model
        if tutor_settings
        else settings.DLU_REALTIME_DEFAULT_MODEL
    )
    default_voice = (
        tutor_settings.voice
        if tutor_settings
        else settings.DLU_REALTIME_DEFAULT_VOICE
    )

    model = normalize_realtime_choice(
        data.get("model"),
        REALTIME_MODELS,
        default_model,
    )
    if model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    voice = normalize_realtime_choice(
        data.get("voice"),
        REALTIME_VOICES,
        default_voice,
    )
    if voice is None:
        return JsonResponse({"detail": "Realtime voice is not supported."}, status=400)

    realtime_tools = realtime_tools_for_event(get_session_current_event(session))
    payload = {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": build_realtime_instructions(
                session,
                exclude_message_id=data.get("excludeMessageId"),
            ),
            "output_modalities": ["audio"],
            "audio": {
                "output": {
                    "voice": voice,
                },
            },
        },
    }
    if realtime_tools:
        payload["session"]["tools"] = realtime_tools
        payload["session"]["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": hash_safety_identifier(request.user),
    }

    try:
        response = requests.post(
            OPENAI_REALTIME_CLIENT_SECRET_URL,
            headers=headers,
            json=payload,
            timeout=20,
        )
        response_data = response.json()
    except requests.RequestException:
        return JsonResponse(
            {"detail": "Could not reach OpenAI to start the Realtime session."},
            status=502,
        )
    except ValueError:
        return JsonResponse(
            {"detail": "OpenAI returned an unreadable Realtime response."},
            status=502,
        )

    if not isinstance(response_data, dict):
        return JsonResponse(
            {"detail": "OpenAI returned an unexpected Realtime response."},
            status=502,
        )

    if response.status_code >= 400:
        error_data = response_data.get("error")
        detail = (
            error_data.get("message")
            if isinstance(error_data, dict)
            else ""
        ) or response_data.get("detail")
        status_code = response.status_code
        if status_code in {401, 403} or status_code >= 500:
            status_code = 502
        return JsonResponse(
            {"detail": detail or "OpenAI could not start the Realtime session."},
            status=status_code,
        )

    return JsonResponse(
        {
            "clientSecret": response_data,
            "model": model,
            "voice": voice,
        }
    )


@require_POST
def resolve_google_slide(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    deck_url = str(data.get("deckUrl", "")).strip()
    slide_ref = str(data.get("slideRef", "1")).strip() or "1"
    force_refresh = bool(data.get("forceRefresh", False))

    if len(deck_url) > 2048:
        return JsonResponse({"detail": "Deck URL is too long."}, status=400)

    try:
        resolved = resolve_slide_image(deck_url, slide_ref, force_refresh)
    except SlideResolutionError as error:
        return JsonResponse({"detail": str(error)}, status=400)
    except SlideFetchError as error:
        return JsonResponse({"detail": str(error)}, status=502)

    return JsonResponse(
        {
            "cached": resolved.cache_hit,
            "imageUrl": f"/api/slides/images/{resolved.filename}/",
            "pageId": resolved.page_id,
            "presentationId": resolved.presentation_id,
            "slideRef": slide_ref,
        }
    )


@require_GET
def serve_google_slide_image(request, filename):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    try:
        path = get_slide_image_path(filename)
    except SlideResolutionError:
        raise Http404("Slide image not found.")

    if not path.exists():
        raise Http404("Slide image not found.")

    return FileResponse(path.open("rb"), content_type="image/png")


def frontend_index(request):
    if request.path == "/":
        return redirect(DEFAULT_APP_PATH)

    if not request.user.is_authenticated:
        return redirect(f"{settings.LOGIN_URL}?{urlencode({'next': request.path})}")

    index_path = Path(settings.BASE_DIR) / "static" / "frontend" / "index.html"
    if not index_path.exists():
        raise Http404(
            "Frontend build not found. Run the Vite dev server or build the frontend."
        )
    return FileResponse(index_path.open("rb"), content_type="text/html")
