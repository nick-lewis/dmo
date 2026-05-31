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
    AudioTimingError,
    OPENAI_CHAT_COMPLETIONS_URL,
    audio_duration_seconds,
    compute_script_audio_cache_key,
    get_or_create_script_audio,
    get_or_create_script_audio_words,
    get_or_create_voice_sample,
    normalize_transcription_words,
    openai_error_message,
    script_audio_audio_path,
    script_audio_metadata_path,
    script_audio_words_path,
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
    "gpt-realtime",
    "gpt-realtime-1.5",
    "gpt-realtime-2",
    "gpt-realtime-mini",
}
LEGACY_REALTIME_MODEL_ALIASES = {
    "gpt-4o-mini-realtime-preview": "gpt-realtime-mini",
    "gpt-4o-realtime-preview": "gpt-realtime",
}
CLASSIFICATION_MODELS = {
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
}
REALTIME_VOICE_ORDER = (
    "marin",
    "cedar",
    "verse",
    "ash",
    "ballad",
    "coral",
    "echo",
    "sage",
    "shimmer",
    "alloy",
)
REALTIME_VOICES = set(REALTIME_VOICE_ORDER)
REALTIME_VOICES_BY_MODEL = {
    realtime_model: set(REALTIME_VOICE_ORDER)
    for realtime_model in REALTIME_MODELS
}
REALTIME_CONTEXT_MESSAGE_LIMIT = 24
REALTIME_CONTEXT_CHAR_LIMIT = 8000
DEFAULT_EXPERIENCE_TITLE = "Untitled experience"
DEFAULT_START_EVENT_TITLE = "Start"
DEFAULT_SCRIPT_STEP_LABEL = "Say"
EXPERIENCE_EXPORT_FORMAT = "dlu.experience"
EXPERIENCE_EXPORT_VERSION = 1
MAX_EVENT_CHAIN_DEPTH = 12
RUNTIME_ACTION_TRACE_LIMIT = 80
RUNTIME_TRANSITION_TRACE_LIMIT = 40
RUNTIME_DEBUG_VALUE_LIMIT = 600
INITIAL_SCRIPT_CUE_PROGRESS = 0.001
SCRIPT_ACTION_OFFSET_LIMIT_MS = 3000
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
REGISTERED_MAIN_PANEL_APP_IDS = {
    "delivery_data",
    "timing_challenge",
}
SCRIPT_MARKER_PATTERN = re.compile(
    (
        r"\[(show_image|slide|gslide|interactive|interactive_update|"
        r"interactive_clear|highlight|highlight_on|highlight_off|"
        r"overlay|overlay_off|pause|chat_off|chat_on|add_note|play_sound)"
        r"(?::\s*([^\]]+))?\]"
    ),
    re.IGNORECASE,
)
SCRIPT_WORD_PATTERN = re.compile(r"\S+")


def normalize_script_speech(text):
    return " ".join(str(text or "").split())


def normalized_interactive_config(value):
    return value if isinstance(value, dict) else {}


def normalize_interactive_id(value):
    return str(value or "").strip()


def interactive_id_error(interactive_id):
    if not interactive_id:
        return "Interactive id is required."
    if len(interactive_id) > 80:
        return "Interactive id is too long."
    if not re.fullmatch(r"[A-Za-z0-9_-]+", interactive_id):
        return "Interactive id can only contain letters, numbers, dashes, and underscores."
    if interactive_id not in REGISTERED_MAIN_PANEL_APP_IDS:
        return "Main-panel app is not registered."
    return ""


def script_word_count(text):
    return len(SCRIPT_WORD_PATTERN.findall(normalize_script_speech(text)))


def parse_script_marker_args(args_text):
    if not args_text:
        return []

    args = []
    current = []
    paren_depth = 0
    for char in str(args_text):
        if char == "(":
            paren_depth += 1
        elif char == ")" and paren_depth > 0:
            paren_depth -= 1

        if char == "," and paren_depth == 0:
            arg = "".join(current).strip()
            if arg:
                args.append(arg)
            current = []
        else:
            current.append(char)

    arg = "".join(current).strip()
    if arg:
        args.append(arg)
    return args


def parse_script_markers(script_text):
    parts = []
    markers = []
    last_end = 0

    for match in SCRIPT_MARKER_PATTERN.finditer(script_text or ""):
        parts.append(script_text[last_end : match.start()])
        spoken_so_far = normalize_script_speech("".join(parts))
        markers.append(
            {
                "args": parse_script_marker_args(match.group(2)),
                "charIndex": len(spoken_so_far),
                "markerType": match.group(1).lower(),
                "wordIndex": script_word_count(spoken_so_far),
            }
        )
        last_end = match.end()

    parts.append((script_text or "")[last_end:])
    spoken_text = normalize_script_speech("".join(parts))
    total_chars = max(len(spoken_text), 1)
    for marker in markers:
        marker["progress"] = min(1, max(0, marker["charIndex"] / total_chars))
    return spoken_text, markers


def script_cue_time_from_words(cue, words):
    if not words:
        return None

    if "wordIndex" in cue:
        try:
            word_index = int(cue.get("wordIndex", 0) or 0)
        except (TypeError, ValueError):
            word_index = None
    else:
        word_index = None

    if word_index is None:
        try:
            progress = float(cue.get("progress", 0) or 0)
        except (TypeError, ValueError):
            progress = 0
        duration = float(words[-1].get("end", 0) or 0)
        return round(max(0.0, duration * min(1.0, max(0.0, progress))), 3)

    if word_index <= 0:
        return 0.0
    if word_index >= len(words):
        return round(float(words[-1].get("end", 0) or 0), 3)
    return round(float(words[word_index].get("start", 0) or 0), 3)


def script_cues_with_word_times(cues, words):
    if not isinstance(cues, list):
        return []

    timed_cues = []
    for cue in cues:
        if not isinstance(cue, dict):
            continue

        next_cue = dict(cue)
        cue_time = script_cue_time_from_words(next_cue, words)
        if cue_time is not None:
            next_cue["time"] = cue_time
        timed_cues.append(next_cue)
    return timed_cues


def build_interactive_action(
    *,
    config,
    event_id="",
    metadata=None,
    runtime_context=None,
    step_id="",
    update=False,
):
    runtime_context = runtime_context or {}
    metadata = dict(metadata or {})
    interactive_id = render_context_template(
        config.get("interactiveId") or config.get("name") or "delivery_data",
        runtime_context,
    ).strip()
    id_error = interactive_id_error(interactive_id)
    if id_error:
        return {
            "detail": id_error,
            "eventId": str(event_id),
            "interactiveId": interactive_id,
            "stepId": step_id,
            "type": "interactive_error",
            **metadata,
        }

    action = {
        "config": normalized_interactive_config(config.get("config")),
        "eventId": str(event_id),
        "interactiveId": interactive_id,
        "mode": render_context_template(config.get("mode", ""), runtime_context).strip(),
        "prompt": render_context_template(config.get("prompt", ""), runtime_context).strip(),
        "stepId": step_id,
        "title": render_context_template(config.get("title", ""), runtime_context).strip(),
        "type": "interactive_update" if update else "interactive",
        **metadata,
    }
    triggers_event = render_context_template(
        config.get("triggersEvent", ""),
        runtime_context,
    ).strip()
    if triggers_event:
        action["triggersEvent"] = triggers_event
    return action


def resolve_script_marker_action(marker, config, runtime_context):
    marker_type = marker.get("markerType")
    args = marker.get("args") or []

    if marker_type == "gslide":
        deck_url = render_context_template(
            config.get("deckUrl", ""),
            runtime_context,
        ).strip()
        slide_ref = (
            render_context_template(args[0] if args else "1", runtime_context).strip()
            or "1"
        )
        if not deck_url:
            return {
                "detail": "Script slide marker needs a deck URL.",
                "slideRef": slide_ref,
                "type": "slide_error",
            }

        try:
            resolved = resolve_slide_image(deck_url, slide_ref)
        except (SlideResolutionError, SlideFetchError) as error:
            return {
                "deckUrl": deck_url,
                "detail": str(error),
                "slideRef": slide_ref,
                "type": "slide_error",
            }

        return {
            "cached": resolved.cache_hit,
            "deckUrl": deck_url,
            "imageUrl": f"/api/slides/images/{resolved.filename}/",
            "pageId": resolved.page_id,
            "presentationId": resolved.presentation_id,
            "slideRef": slide_ref,
            "type": "gslide",
        }

    if marker_type in {"interactive", "interactive_update"}:
        interactive_id = (
            render_context_template(args[0] if args else "", runtime_context).strip()
            or render_context_template(config.get("interactiveId", ""), runtime_context).strip()
            or "delivery_data"
        )
        mode = (
            render_context_template(args[1] if len(args) > 1 else "", runtime_context).strip()
            or render_context_template(config.get("mode", ""), runtime_context).strip()
        )
        return build_interactive_action(
            config={
                "config": config.get("interactiveConfig", {}),
                "interactiveId": interactive_id,
                "mode": mode,
                "prompt": config.get("interactivePrompt", ""),
                "title": config.get("interactiveTitle", ""),
                "triggersEvent": (
                    args[2] if len(args) > 2 else config.get("triggersEvent", "")
                ),
            },
            runtime_context=runtime_context,
            update=marker_type == "interactive_update",
        )

    if marker_type == "interactive_clear":
        return {"type": "interactive_clear"}

    if marker_type == "show_image":
        image_path = render_context_template(
            args[0] if args else "",
            runtime_context,
        ).strip()
        if not image_path:
            return None
        return {
            "imagePath": image_path,
            "type": "show_image",
        }

    if marker_type == "overlay":
        if not args:
            return None
        overlay_id = "default"
        image_arg = args[0]
        if len(args) > 1:
            overlay_id = (
                render_context_template(args[0], runtime_context).strip()
                or "default"
            )
            image_arg = args[1]
        image_path = render_context_template(image_arg, runtime_context).strip()
        if not image_path:
            return None
        return {
            "imagePath": image_path,
            "overlayId": overlay_id,
            "type": "overlay",
        }

    if marker_type == "overlay_off":
        overlay_id = render_context_template(
            args[0] if args else "",
            runtime_context,
        ).strip()
        return {
            "overlayId": overlay_id,
            "type": "overlay_off",
        }

    if marker_type == "add_note":
        note_text = render_context_template(", ".join(args), runtime_context).strip()
        if not note_text:
            return None
        note_id = hashlib.sha1(
            f"{marker.get('wordIndex', 0)}:{note_text}".encode("utf-8")
        ).hexdigest()[:16]
        return {
            "noteId": note_id,
            "text": note_text,
            "type": "add_note",
        }

    if marker_type == "play_sound":
        sound_path = render_context_template(
            args[0] if args else "",
            runtime_context,
        ).strip()
        if not sound_path:
            return None
        return {
            "soundPath": sound_path,
            "type": "play_sound",
            "volume": str(args[1] if len(args) > 1 else "").strip(),
        }

    if marker_type == "highlight":
        selector = str(args[0] if args else "").strip()
        if not selector:
            return None
        return {
            "color": str(
                args[1] if len(args) > 1 else "rgba(59, 130, 246, 0.6)"
            ).strip(),
            "duration": str(args[2] if len(args) > 2 else "1200").strip(),
            "selector": selector,
            "type": "highlight_on",
        }

    if marker_type == "highlight_on":
        selector = str(args[0] if args else "").strip()
        if not selector:
            return None
        return {
            "color": str(
                args[1] if len(args) > 1 else "rgba(59, 130, 246, 0.6)"
            ).strip(),
            "selector": selector,
            "type": "highlight_on",
        }

    if marker_type == "highlight_off":
        selector = str(args[0] if args else "").strip()
        if not selector:
            return None
        return {
            "selector": selector,
            "type": "highlight_off",
        }

    if marker_type == "pause":
        return {
            "durationMs": str(args[0] if args else "0"),
            "type": "pause",
        }

    if marker_type == "chat_off":
        return {
            "enabled": False,
            "type": "chat_availability",
        }

    if marker_type == "chat_on":
        return {
            "enabled": True,
            "type": "chat_availability",
        }

    return None


def cached_script_audio_payload(session, script, script_cues=None):
    if not session.experience:
        return {}

    tutor_settings = ensure_tutor_settings(session.experience)
    cache_key = compute_script_audio_cache_key(
        assistant_name=tutor_settings.assistant_name,
        realtime_model=tutor_settings.realtime_model,
        script=script,
        tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        voice=tutor_settings.voice,
        voice_instructions=tutor_settings.voice_instructions,
    )
    audio_path = script_audio_audio_path(cache_key)
    metadata_path = script_audio_metadata_path(cache_key)
    if not audio_path.exists() or not metadata_path.exists():
        return {}

    words_path = script_audio_words_path(
        cache_key,
        settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
    )
    script_words = []
    if words_path.exists():
        try:
            script_words = normalize_transcription_words(
                json.loads(words_path.read_text(encoding="utf-8"))
            )
        except (OSError, ValueError):
            script_words = []

    payload = {
        "audioUrl": f"/api/script-audio/{cache_key}.wav/",
        "cached": True,
        "durationSeconds": audio_duration_seconds(audio_path),
        "messageId": "",
        "realtimeModel": tutor_settings.realtime_model,
        "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        "voice": tutor_settings.voice,
    }
    if script_words:
        payload["scriptWords"] = script_words
        if script_cues is not None:
            payload["scriptCues"] = script_cues_with_word_times(
                script_cues,
                script_words,
            )
    return payload


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
        "scriptActionOffsetMs": tutor_settings.script_action_offset_ms,
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


def validation_template_is_dynamic(value):
    return "{{" in str(value or "")


def validation_config_value(config, key):
    if not isinstance(config, dict):
        return ""
    return str(config.get(key, "") or "").strip()


def validation_route_record(event, kind, target, source, source_item_id="", dynamic=False):
    return {
        "dynamic": bool(dynamic),
        "kind": kind,
        "source": source,
        "sourceEventId": str(event.id),
        "sourceEventSlug": event.slug,
        "sourceEventTitle": event.title,
        "sourceItemId": str(source_item_id or ""),
        "target": str(target or "").strip(),
    }


def validation_app_issue(event, interactive_id, source, source_item_id=""):
    if not interactive_id or validation_template_is_dynamic(interactive_id):
        return None

    detail = interactive_id_error(interactive_id)
    if not detail:
        return None

    return {
        "detail": detail,
        "interactiveId": interactive_id,
        "source": source,
        "sourceEventId": str(event.id),
        "sourceEventSlug": event.slug,
        "sourceEventTitle": event.title,
        "sourceItemId": str(source_item_id or ""),
    }


def validation_routes_from_action_sequence(event, actions, source_prefix):
    routes = []
    app_issues = []
    action_type_labels = dict(EventActionStep.ActionType.choices)
    for action in actions or []:
        if not isinstance(action, dict):
            continue

        action_type = str(action.get("actionType", "") or "").strip()
        config = action.get("config") if isinstance(action.get("config"), dict) else {}
        label = str(action.get("label", "") or "").strip() or action_type or "action"
        source_item_id = str(action.get("id", "") or "")
        source = f"{source_prefix}: {label}"

        if action_type == EventActionStep.ActionType.SCRIPT:
            _, markers = parse_script_markers(config.get("text", ""))
            fallback_target = validation_config_value(config, "triggersEvent")
            fallback_target_is_dynamic = validation_template_is_dynamic(fallback_target)
            fallback_app_id = validation_config_value(config, "interactiveId")

            for marker in markers:
                marker_type = marker.get("markerType")
                if marker_type not in {"interactive", "interactive_update"}:
                    continue

                args = marker.get("args") or []
                marker_text = f"{source} / [{marker_type}]"
                interactive_id = (
                    str(args[0]).strip()
                    if args
                    else fallback_app_id
                ) or "delivery_data"
                issue = validation_app_issue(
                    event,
                    interactive_id,
                    marker_text,
                    source_item_id,
                )
                if issue:
                    app_issues.append(issue)

                target = str(args[2]).strip() if len(args) > 2 else fallback_target
                if not target:
                    continue

                routes.append(
                    validation_route_record(
                        event,
                        "App submit" if marker_type == "interactive" else "App update submit",
                        target,
                        marker_text,
                        source_item_id,
                        validation_template_is_dynamic(target)
                        or (len(args) <= 2 and fallback_target_is_dynamic),
                    )
                )

        if action_type in {
            EventActionStep.ActionType.INTERACTIVE,
            EventActionStep.ActionType.INTERACTIVE_UPDATE,
        }:
            interactive_id = validation_config_value(config, "interactiveId") or "delivery_data"
            issue = validation_app_issue(event, interactive_id, source, source_item_id)
            if issue:
                app_issues.append(issue)

        if action_type not in {
            EventActionStep.ActionType.SET_UI_TRIGGER,
            EventActionStep.ActionType.GOTO_EVENT,
            EventActionStep.ActionType.BUTTON_CHOICE,
            EventActionStep.ActionType.INTERACTIVE,
            EventActionStep.ActionType.INTERACTIVE_UPDATE,
        }:
            continue

        target = validation_config_value(config, "triggersEvent")
        if not target:
            continue

        routes.append(
            validation_route_record(
                event,
                action_type_labels.get(action_type, action_type),
                target,
                source,
                source_item_id,
                validation_template_is_dynamic(target),
            )
        )

    return routes, app_issues


def experience_validation_summary(experience):
    events = list(experience.events.order_by("sort_order", "created_at"))
    event_lookup = {}
    for event in events:
        event_lookup[event.slug] = event
        event_lookup[str(event.id)] = event

    routes = []
    app_issues = []
    for event in events:
        action_steps = [
            {
                "actionType": step.action_type,
                "config": step.config,
                "id": str(step.id),
                "label": step.label,
            }
            for step in event.steps.order_by("sort_order", "created_at")
        ]
        step_routes, step_app_issues = validation_routes_from_action_sequence(
            event,
            action_steps,
            "On entry",
        )
        routes.extend(step_routes)
        app_issues.extend(step_app_issues)

        for tool in event.chat_tools.order_by("sort_order", "created_at"):
            if tool.triggers_event:
                routes.append(
                    validation_route_record(
                        event,
                        "FC route",
                        tool.triggers_event,
                        tool.description or tool.name,
                        tool.id,
                    )
                )
            handler_routes, handler_app_issues = validation_routes_from_action_sequence(
                event,
                tool.handler_actions,
                f"FC route {tool.name}",
            )
            routes.extend(handler_routes)
            app_issues.extend(handler_app_issues)

        for check in event.conversation_checks.order_by("sort_order", "created_at"):
            if check.triggers_event:
                routes.append(
                    validation_route_record(
                        event,
                        "Check",
                        check.triggers_event,
                        check.title or "Conversation check",
                        check.id,
                    )
                )
            handler_routes, handler_app_issues = validation_routes_from_action_sequence(
                event,
                check.handler_actions,
                f"Check {check.title}",
            )
            routes.extend(handler_routes)
            app_issues.extend(handler_app_issues)

        for group in event.classifier_groups.order_by("sort_order", "created_at"):
            if group.triggers_event:
                routes.append(
                    validation_route_record(
                        event,
                        "Classifiers",
                        group.triggers_event,
                        group.title or "Classifier group",
                        group.id,
                    )
                )
            handler_routes, handler_app_issues = validation_routes_from_action_sequence(
                event,
                group.handler_actions,
                f"Classifiers {group.title}",
            )
            routes.extend(handler_routes)
            app_issues.extend(handler_app_issues)

    unresolved_routes = [
        route
        for route in routes
        if route["target"]
        and not route["dynamic"]
        and route["target"] not in event_lookup
    ]
    incoming_targets = {
        route["target"]
        for route in routes
        if route["target"] and not route["dynamic"] and route["target"] in event_lookup
    }
    orphaned_events = [
        {
            "id": str(event.id),
            "isStart": event.is_start,
            "slug": event.slug,
            "title": event.title,
        }
        for event in events
        if not event.is_start and event.slug not in incoming_targets and str(event.id) not in incoming_targets
    ]

    return {
        "appIssues": app_issues,
        "dynamicRouteCount": len([route for route in routes if route["dynamic"]]),
        "eventCount": len(events),
        "orphanedEvents": orphaned_events,
        "routeCount": len(routes),
        "routes": routes,
        "unresolvedRoutes": unresolved_routes,
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
            "script_action_offset_ms": 0,
            "voice": settings.DLU_REALTIME_DEFAULT_VOICE,
            "system_prompt": settings.DLU_REALTIME_DEFAULT_INSTRUCTIONS,
            "voice_instructions": "",
        },
    )
    if not tutor_settings.classification_model:
        tutor_settings.classification_model = settings.DLU_CLASSIFICATION_DEFAULT_MODEL
        tutor_settings.save(update_fields=["classification_model", "updated_at"])
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
        duplicate_tutor.realtime_model = source_tutor.realtime_model
        duplicate_tutor.classification_model = source_tutor.classification_model
        duplicate_tutor.voice = source_tutor.voice
        duplicate_tutor.system_prompt = source_tutor.system_prompt
        duplicate_tutor.voice_instructions = source_tutor.voice_instructions
        duplicate_tutor.script_action_offset_ms = source_tutor.script_action_offset_ms
        duplicate_tutor.save()

        for source_event in source.events.order_by("sort_order", "created_at"):
            duplicate_event = ExperienceEvent.objects.create(
                experience=duplicate,
                title=source_event.title,
                slug=source_event.slug,
                description=source_event.description,
                chat_instructions=source_event.chat_instructions,
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


def import_signed_int(value, fallback=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


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
            tutor_settings.script_action_offset_ms = int(
                max(
                    -SCRIPT_ACTION_OFFSET_LIMIT_MS,
                    min(
                        SCRIPT_ACTION_OFFSET_LIMIT_MS,
                        import_signed_int(tutor_data.get("scriptActionOffsetMs"), 0),
                    ),
                )
            )
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
                    chat_instructions=import_string(
                        event_data.get("chatInstructions"),
                        "",
                        max_length=12000,
                        strip=False,
                    ),
                    is_start=import_bool(event_data.get("isStart"), index == 0),
                    sort_order=import_int(event_data.get("sortOrder"), index),
                )
                import_event_steps(event, event_data.get("steps"))
                import_chat_tools(event, event_data.get("chatTools"))
                import_conversation_checks(event, event_data.get("conversationChecks"))
                import_classifier_groups(event, event_data.get("classifierGroups"))
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
        chat_instructions=import_string(
            event_data.get("chatInstructions"),
            "",
            max_length=12000,
            strip=False,
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
    return event


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
    hydrate_initial_script_runtime_state(session)
    return {
        "session": serialize_session(session),
        "messages": [serialize_message(message) for message in session.messages.all()],
    }


def script_is_static_for_audio(text):
    return "{{" not in text and "{%" not in text and "{#" not in text


def script_audio_item_from_text(experience, tutor_settings, source, raw_text, index):
    script, markers = parse_script_markers(raw_text)
    script = script.strip()
    if not script:
        return None

    cache_key = compute_script_audio_cache_key(
        assistant_name=tutor_settings.assistant_name,
        realtime_model=tutor_settings.realtime_model,
        script=script,
        tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        voice=tutor_settings.voice,
        voice_instructions=tutor_settings.voice_instructions,
    )
    audio_path = script_audio_audio_path(cache_key)
    words_path = script_audio_words_path(
        cache_key,
        settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
    )
    cached = audio_path.exists()
    words_cached = words_path.exists()
    can_generate = script_is_static_for_audio(raw_text)
    timing_preview = []
    timing_word_count = 0
    timed_marker_count = 0
    if words_cached:
        try:
            words = normalize_transcription_words(
                json.loads(words_path.read_text(encoding="utf-8"))
            )
        except (OSError, ValueError):
            words = []
        timing_word_count = len(words)
        timing_preview = words[:12]
        timed_marker_count = sum(
            1
            for marker in script_cues_with_word_times(markers, words)
            if isinstance(marker.get("time"), (int, float))
        )
    return {
        "audioUrl": f"/api/script-audio/{cache_key}.wav/" if cached else "",
        "cacheKey": cache_key,
        "canGenerate": can_generate,
        "characterCount": len(script),
        "cached": cached,
        "durationSeconds": audio_duration_seconds(audio_path) if cached else None,
        "experienceId": str(experience.id),
        "generationReason": ""
        if can_generate
        else "Dynamic scripts with template variables cannot be pregenerated yet.",
        "id": hashlib.sha1(
            f"{experience.id}:{index}:{source}:{script}".encode("utf-8")
        ).hexdigest()[:16],
        "markerCount": len(markers),
        "preview": script[:240],
        "realtimeModel": tutor_settings.realtime_model,
        "script": script,
        "source": source,
        "timedMarkerCount": timed_marker_count,
        "timingPreview": timing_preview,
        "timingWordCount": timing_word_count,
        "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        "voice": tutor_settings.voice,
        "wordCount": script_word_count(script),
        "wordsCached": words_cached,
    }


def iter_script_audio_texts_from_action_sequence(actions, source_prefix):
    if not isinstance(actions, list):
        return

    for index, action in enumerate(actions, start=1):
        if not isinstance(action, dict):
            continue
        action_type = str(action.get("actionType", "")).strip()
        config = action.get("config") if isinstance(action.get("config"), dict) else {}
        label = str(action.get("label", "")).strip()
        source = f"{source_prefix} / {label or action_type or f'action {index}'}"
        if action_type == EventActionStep.ActionType.SCRIPT:
            yield source, str(config.get("text", ""))


def collect_experience_script_audio_items(experience):
    tutor_settings = ensure_tutor_settings(experience)
    items = []
    seen_scripts = set()

    for event in experience.events.order_by("sort_order", "created_at"):
        event_source = event.title or event.slug or "Event"
        for step in event.steps.order_by("sort_order", "created_at"):
            if step.action_type == EventActionStep.ActionType.SCRIPT:
                source = f"{event_source} / {step.label or DEFAULT_SCRIPT_STEP_LABEL}"
                item = script_audio_item_from_text(
                    experience,
                    tutor_settings,
                    source,
                    str((step.config or {}).get("text", "")),
                    len(items),
                )
                if item and item["script"] not in seen_scripts:
                    seen_scripts.add(item["script"])
                    items.append(item)

        for tool in event.chat_tools.order_by("sort_order", "created_at"):
            for source, raw_text in iter_script_audio_texts_from_action_sequence(
                tool.handler_actions,
                f"{event_source} / FC route {tool.name}",
            ):
                item = script_audio_item_from_text(
                    experience,
                    tutor_settings,
                    source,
                    raw_text,
                    len(items),
                )
                if item and item["script"] not in seen_scripts:
                    seen_scripts.add(item["script"])
                    items.append(item)

        for check in event.conversation_checks.order_by("sort_order", "created_at"):
            for source, raw_text in iter_script_audio_texts_from_action_sequence(
                check.handler_actions,
                f"{event_source} / Check {check.title}",
            ):
                item = script_audio_item_from_text(
                    experience,
                    tutor_settings,
                    source,
                    raw_text,
                    len(items),
                )
                if item and item["script"] not in seen_scripts:
                    seen_scripts.add(item["script"])
                    items.append(item)

        for group in event.classifier_groups.order_by("sort_order", "created_at"):
            for source, raw_text in iter_script_audio_texts_from_action_sequence(
                group.handler_actions,
                f"{event_source} / Classifiers {group.title}",
            ):
                item = script_audio_item_from_text(
                    experience,
                    tutor_settings,
                    source,
                    raw_text,
                    len(items),
                )
                if item and item["script"] not in seen_scripts:
                    seen_scripts.add(item["script"])
                    items.append(item)

    return items


def generate_script_audio_item(request, experience, tutor_settings, item, force=False):
    if not item.get("canGenerate"):
        return False, "Dynamic scripts with template variables cannot be pregenerated yet."
    if item.get("cached") and item.get("wordsCached") and not force:
        return False, ""

    if force:
        audio_path = script_audio_audio_path(item["cacheKey"])
        metadata_path = script_audio_metadata_path(item["cacheKey"])
        words_path = script_audio_words_path(
            item["cacheKey"],
            settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        )
        for path in (audio_path, metadata_path, words_path):
            try:
                if path.exists():
                    path.unlink()
            except OSError:
                pass

    recording = get_or_create_script_audio(
        api_key=settings.OPENAI_API_KEY,
        assistant_name=tutor_settings.assistant_name,
        realtime_model=tutor_settings.realtime_model,
        safety_identifier=hash_safety_identifier(request.user),
        script=item["script"],
        tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        voice=tutor_settings.voice,
        voice_instructions=tutor_settings.voice_instructions,
    )
    get_or_create_script_audio_words(
        api_key=settings.OPENAI_API_KEY,
        alignment_model=settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        audio_path=recording.audio_path,
        cache_key=recording.cache_key,
        safety_identifier=hash_safety_identifier(request.user),
        script=item["script"],
    )
    return True, ""


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
        tool_names = ", ".join(
            str(tool.get("name", "")).strip()
            for tool in current_tools
            if str(tool.get("name", "")).strip()
        )
        instruction_parts.append(
            f"Available function-call routes: {tool_names}. When the "
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


def normalize_realtime_model_choice(value, default_value):
    choice = str(value or default_value).strip()
    choice = LEGACY_REALTIME_MODEL_ALIASES.get(choice, choice)
    if choice not in REALTIME_MODELS:
        return None
    return choice


def realtime_voice_choices_for_model(realtime_model):
    model = normalize_realtime_model_choice(realtime_model, realtime_model)
    if model is None:
        return set(REALTIME_VOICES)
    return set(REALTIME_VOICES_BY_MODEL.get(model, REALTIME_VOICES))


def default_realtime_voice_for_model(realtime_model, preferred_voice=""):
    allowed_voices = realtime_voice_choices_for_model(realtime_model)
    preferred = str(preferred_voice or "").strip()
    if preferred in allowed_voices:
        return preferred
    default_voice = str(settings.DLU_REALTIME_DEFAULT_VOICE or "").strip()
    if default_voice in allowed_voices:
        return default_voice
    for voice in REALTIME_VOICE_ORDER:
        if voice in allowed_voices:
            return voice
    return ""


def normalize_realtime_voice_choice(value, default_value, realtime_model):
    has_explicit_value = value is not None and str(value).strip() != ""
    choice = str(value if has_explicit_value else default_value).strip()
    allowed_voices = realtime_voice_choices_for_model(realtime_model)
    if choice in allowed_voices:
        return choice
    if has_explicit_value:
        return None
    fallback_voice = default_realtime_voice_for_model(realtime_model, default_value)
    return fallback_voice or None


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


def runtime_action_string(value, max_length=500):
    text = str(value or "").strip()
    if len(text) > max_length:
        return ""
    return text


def rejected_emitted_runtime_action(action, reason):
    action_type = ""
    if isinstance(action, dict):
        action_type = str(action.get("type", "") or "").strip()
    return {
        "actionType": action_type or "unknown",
        "reason": reason,
        "source": "interactive",
        "type": "interactive_action_rejected",
    }


def normalize_emitted_runtime_action(action):
    if not isinstance(action, dict):
        return None, rejected_emitted_runtime_action(action, "not_an_object")

    action_type = str(action.get("type", "") or "").strip()
    if not action_type:
        return None, rejected_emitted_runtime_action(action, "missing_type")

    if action_type in {"set_context", "append_context_list"}:
        key = runtime_context_action_key(action)
        if not key:
            return None, rejected_emitted_runtime_action(action, "invalid_context_key")
        return {
            "key": key,
            "source": "interactive",
            "type": action_type,
            "value": action.get("value"),
        }, None

    if action_type == "goto_event":
        triggers_event, error = validate_event_slug(action.get("triggersEvent"))
        if error:
            return None, rejected_emitted_runtime_action(action, "invalid_target_event")
        return {
            "source": "interactive",
            "triggersEvent": triggers_event,
            "type": "goto_event",
        }, None

    if action_type == "button_choice":
        label = runtime_action_string(action.get("label"), max_length=120)
        triggers_event, error = validate_event_slug(action.get("triggersEvent"))
        if not label or error:
            return None, rejected_emitted_runtime_action(action, "invalid_button")
        return {
            "label": label,
            "source": "interactive",
            "triggersEvent": triggers_event,
            "type": "button_choice",
        }, None

    if action_type == "set_ui_trigger":
        selector, selector_error = validate_selector(action.get("selector"))
        triggers_event, event_error = validate_event_slug(action.get("triggersEvent"))
        if selector_error or event_error:
            return None, rejected_emitted_runtime_action(action, "invalid_ui_trigger")
        return {
            "selector": selector,
            "source": "interactive",
            "triggersEvent": triggers_event,
            "type": "set_ui_trigger",
        }, None

    if action_type == "highlight_on":
        selector, selector_error = validate_selector(action.get("selector"))
        if selector_error:
            return None, rejected_emitted_runtime_action(action, "invalid_selector")
        color = runtime_action_string(
            action.get("color") or "rgba(59, 130, 246, 0.6)",
            max_length=120,
        )
        return {
            "color": color or "rgba(59, 130, 246, 0.6)",
            "selector": selector,
            "source": "interactive",
            "type": "highlight_on",
        }, None

    if action_type == "highlight_off":
        selector, selector_error = validate_selector(action.get("selector"))
        if selector_error:
            return None, rejected_emitted_runtime_action(action, "invalid_selector")
        return {
            "selector": selector,
            "source": "interactive",
            "type": "highlight_off",
        }, None

    if action_type == "chat_availability":
        if not isinstance(action.get("enabled"), bool):
            return None, rejected_emitted_runtime_action(action, "invalid_chat_state")
        return {
            "enabled": action.get("enabled"),
            "source": "interactive",
            "type": "chat_availability",
        }, None

    if action_type == "interactive_clear":
        return {"source": "interactive", "type": "interactive_clear"}, None

    if action_type == "show_image":
        image_path = runtime_action_string(action.get("imagePath"))
        if not image_path:
            return None, rejected_emitted_runtime_action(action, "invalid_image")
        return {
            "imagePath": image_path,
            "source": "interactive",
            "type": "show_image",
        }, None

    if action_type == "overlay":
        image_path = runtime_action_string(action.get("imagePath"))
        overlay_id = runtime_action_string(action.get("overlayId"), max_length=80)
        if not image_path:
            return None, rejected_emitted_runtime_action(action, "invalid_overlay")
        return {
            "imagePath": image_path,
            "overlayId": overlay_id or "default",
            "source": "interactive",
            "type": "overlay",
        }, None

    if action_type == "overlay_off":
        overlay_id = runtime_action_string(action.get("overlayId"), max_length=80)
        return {
            "overlayId": overlay_id,
            "source": "interactive",
            "type": "overlay_off",
        }, None

    if action_type == "add_note":
        text = runtime_action_string(action.get("text"), max_length=1200)
        if not text:
            return None, rejected_emitted_runtime_action(action, "invalid_note")
        note_id = runtime_action_string(action.get("noteId"), max_length=120)
        normalized = {
            "source": "interactive",
            "text": text,
            "type": "add_note",
        }
        if note_id:
            normalized["noteId"] = note_id
        return normalized, None

    if action_type == "play_sound":
        sound_path = runtime_action_string(action.get("soundPath"))
        if not sound_path:
            return None, rejected_emitted_runtime_action(action, "invalid_sound")
        return {
            "soundPath": sound_path,
            "source": "interactive",
            "type": "play_sound",
            "volume": runtime_action_string(action.get("volume"), max_length=24),
        }, None

    return None, rejected_emitted_runtime_action(action, "unsupported_type")


def normalize_emitted_runtime_actions(actions):
    accepted_actions = []
    rejected_actions = []
    for action in actions:
        accepted, rejected = normalize_emitted_runtime_action(action)
        if accepted is not None:
            accepted_actions.append(accepted)
        if rejected is not None:
            rejected_actions.append(rejected)
    return accepted_actions, rejected_actions


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
        deck_url = str(value.get("deckUrl", "")).strip()
        if len(deck_url) > 2048:
            return None, "Deck URL is too long."
        return {"deckUrl": deck_url, "text": text}, ""

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

    if action_type in {
        EventActionStep.ActionType.INTERACTIVE,
        EventActionStep.ActionType.INTERACTIVE_UPDATE,
    }:
        interactive_id = normalize_interactive_id(value.get("interactiveId", ""))
        id_error = interactive_id_error(interactive_id)
        if id_error:
            return None, id_error

        title = str(value.get("title", "")).strip()
        mode = str(value.get("mode", "")).strip()
        prompt = str(value.get("prompt", "")).strip()
        if len(title) > 160:
            return None, "Interactive title is too long."
        if len(mode) > 80:
            return None, "Interactive mode is too long."
        if len(prompt) > 1200:
            return None, "Interactive prompt is too long."

        config = normalized_interactive_config(value.get("config"))
        if len(json.dumps(config, ensure_ascii=True)) > 8000:
            return None, "Interactive config is too large."

        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            label="Completion event",
            required=False,
        )
        if event_error:
            return None, event_error

        payload = {
            "config": config,
            "interactiveId": interactive_id,
            "mode": mode,
            "prompt": prompt,
            "title": title,
        }
        if action_type == EventActionStep.ActionType.INTERACTIVE:
            payload["triggersEvent"] = triggers_event
        return payload, ""

    if action_type == EventActionStep.ActionType.INTERACTIVE_CLEAR:
        return {}, ""

    if action_type == EventActionStep.ActionType.CHAT_AVAILABILITY:
        return {"enabled": value.get("enabled") is not False}, ""

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


def compact_runtime_debug_value(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:RUNTIME_DEBUG_VALUE_LIMIT]

    try:
        compact = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    except (TypeError, ValueError):
        compact = str(value)
    if len(compact) > RUNTIME_DEBUG_VALUE_LIMIT:
        compact = f"{compact[: RUNTIME_DEBUG_VALUE_LIMIT - 3]}..."
    return compact


def runtime_action_summary(action):
    action_type = str(action.get("type", "action") or "action")
    if action_type == "chat_message":
        message = action.get("message")
        if isinstance(message, dict):
            return str(message.get("content", "") or "assistant message")[:180]
        return "assistant message"
    if action_type == "set_context":
        return f"{action.get('key', 'context')} = {compact_runtime_debug_value(action.get('value'))}"
    if action_type == "append_context_list":
        return f"{action.get('key', 'context')} += {compact_runtime_debug_value(action.get('value'))}"
    if action_type == "get_ui_state":
        return f"{action.get('stateKey', 'ui')} -> {action.get('contextKey', 'context')}"
    if action_type in {"goto_event", "set_ui_trigger", "transition_missing"}:
        return f"-> {action.get('triggersEvent', 'event')}"
    if action_type == "button_choice":
        return f"{action.get('label', 'button')} -> {action.get('triggersEvent', 'event')}"
    if action_type == "chat_tool_call":
        return str(action.get("toolName", "function call"))
    if action_type == "classifier_result":
        return f"{action.get('classifierName', 'classifier')}: {compact_runtime_debug_value(action.get('result'))}"
    if action_type == "classifier_group_result":
        return f"{action.get('classifierGroupTitle', 'classifiers')}: {compact_runtime_debug_value(action.get('results'))}"
    if action_type == "conversation_check_result":
        result = "matched" if action.get("result") else "missed"
        reason = str(action.get("reason", "") or "")
        return f"{result}: {reason}" if reason else result
    if action_type in {"interactive", "interactive_update"}:
        return f"{action.get('interactiveId', 'app')} {action.get('mode', '')}".strip()
    if action_type == "interactive_state":
        return f"{action.get('interactiveId', 'app')} state saved"
    if action_type == "interactive_error":
        return f"{action.get('interactiveId', 'app')}: {action.get('detail', 'not registered')}"
    if action_type == "interactive_clear":
        return "clear main-panel app"
    if action_type == "interactive_action_rejected":
        return f"{action.get('actionType', 'action')}: {action.get('reason', 'rejected')}"
    if action_type == "chat_availability":
        return "chat on" if action.get("enabled", True) else "chat off"
    if action_type == "gslide":
        return f"slide {action.get('slideRef', '1')}"
    if action_type == "slide_error":
        return str(action.get("detail", "slide unavailable"))
    if action_type in {"highlight_on", "highlight_off"}:
        return str(action.get("selector", "selector"))
    if action_type == "show_image":
        return str(action.get("imagePath", "image") or "image")
    if action_type == "overlay":
        return f"{action.get('overlayId', 'default') or 'default'} -> {action.get('imagePath', 'image') or 'image'}"
    if action_type == "overlay_off":
        return str(action.get("overlayId", "") or "all overlays")
    if action_type == "add_note":
        return str(action.get("text", "note") or "note")[:180]
    if action_type == "play_sound":
        return str(action.get("soundPath", "sound") or "sound")
    if action_type in {"event_skipped", "classifier_skipped", "classifier_group_skipped", "skipped"}:
        return str(action.get("reason", "skipped"))
    return action_type


def runtime_action_debug_details(action):
    detail_keys = (
        "actionType",
        "arguments",
        "appended",
        "classifierGroupTitle",
        "classifierName",
        "contextKey",
        "detail",
        "eventId",
        "imagePath",
        "interactiveId",
        "key",
        "label",
        "enabled",
        "list",
        "mode",
        "noteId",
        "overlayId",
        "reason",
        "result",
        "resultContextKey",
        "savedValues",
        "selector",
        "slideRef",
        "soundPath",
        "source",
        "stateKey",
        "stepId",
        "text",
        "toolName",
        "triggersEvent",
        "value",
    )
    details = {}
    for key in detail_keys:
        if key in action:
            details[key] = compact_runtime_debug_value(action.get(key))
    return details


def runtime_action_trace_entry(action, timestamp):
    action_type = str(action.get("type", "action") or "action")
    return {
        "at": timestamp,
        "details": runtime_action_debug_details(action),
        "summary": runtime_action_summary(action),
        "type": action_type,
    }


def is_transition_trace_action(action):
    action_type = str(action.get("type", "") or "")
    return action_type in {
        "goto_event",
        "transition_missing",
        "transition_depth_exceeded",
        "event_skipped",
    }


def append_runtime_debug_trace(state, actions):
    actions = [action for action in actions if isinstance(action, dict)]
    if not actions:
        return state

    timestamp = timezone.now().isoformat()
    debug = dict(state.get("runtimeDebug") or {})
    existing_actions = list(debug.get("recentActions") or [])
    existing_transitions = list(debug.get("transitions") or [])
    trace_entries = [
        runtime_action_trace_entry(action, timestamp)
        for action in actions
    ]
    transition_entries = [
        runtime_action_trace_entry(action, timestamp)
        for action in actions
        if is_transition_trace_action(action)
    ]

    debug["recentActions"] = (
        trace_entries + existing_actions
    )[:RUNTIME_ACTION_TRACE_LIMIT]
    debug["transitions"] = (
        transition_entries + existing_transitions
    )[:RUNTIME_TRANSITION_TRACE_LIMIT]
    debug["updatedAt"] = timestamp
    state["runtimeDebug"] = debug
    return state


def record_realtime_prompt_debug(session, model, voice, instructions, tools):
    timestamp = timezone.now().isoformat()
    state = dict(session.runtime_state or {})
    debug = dict(state.get("runtimeDebug") or {})
    current_event = get_session_current_event(session)
    tool_names = [
        str(tool.get("name", "") or "").strip()
        for tool in tools
        if str(tool.get("name", "") or "").strip()
    ]

    debug["realtimePrompt"] = {
        "at": timestamp,
        "eventSlug": current_event.slug if current_event else "",
        "instructions": instructions,
        "model": model,
        "toolCount": len(tool_names),
        "tools": tool_names,
        "voice": voice,
    }
    debug["updatedAt"] = timestamp
    state["runtimeDebug"] = debug
    session.runtime_state = state
    session.save(update_fields=["runtime_state", "updated_at"])


def runtime_context_action_key(action):
    raw_key = action.get("key", "")
    if not isinstance(raw_key, str):
        return ""
    key = raw_key.strip()
    if not key or len(key) > 120:
        return ""
    return key


def apply_runtime_context_action(runtime_context, action):
    next_context = dict(runtime_context or {})
    if not isinstance(action, dict):
        return next_context, None

    action_type = str(action.get("type", "") or "")
    key = runtime_context_action_key(action)
    if not key:
        return next_context, None

    applied_action = dict(action)
    applied_action["key"] = key

    if action_type == "set_context":
        next_context[key] = action.get("value")
        applied_action["value"] = next_context[key]
        return next_context, applied_action

    if action_type == "append_context_list":
        current_value = next_context.get(key)
        if isinstance(current_value, list):
            next_values = list(current_value)
        elif current_value in (None, ""):
            next_values = []
        else:
            next_values = [current_value]

        next_value = action.get("value")
        appended = False
        if not any(values_match(item, next_value) for item in next_values):
            next_values.append(next_value)
            appended = True
        next_context[key] = next_values
        applied_action["appended"] = appended
        applied_action["list"] = next_values
        applied_action["value"] = next_value
        return next_context, applied_action

    return next_context, None


def apply_runtime_actions_to_context(runtime_context, actions):
    next_context = dict(runtime_context or {})
    for action in actions:
        next_context, applied_action = apply_runtime_context_action(
            next_context,
            action,
        )
        if applied_action is not None:
            action.update(applied_action)

    return next_context


def emitted_transition_slug(actions):
    for action in actions:
        if not isinstance(action, dict):
            continue
        if action.get("type") != "goto_event":
            continue
        triggers_event = str(action.get("triggersEvent", "") or "").strip()
        if triggers_event:
            return triggers_event
    return ""


def apply_runtime_actions_to_state(
    state,
    actions,
    clear_buttons=False,
    clear_trigger_selector="",
):
    ui_runtime = dict(state.get("uiRuntime") or {})
    buttons = list(ui_runtime.get("buttons") or [])
    highlights = dict(ui_runtime.get("highlights") or {})
    interactive = ui_runtime.get("interactive")
    interactive_state = normalized_interactive_config(
        ui_runtime.get("interactiveState")
    )
    chat_enabled = ui_runtime.get("chatEnabled")
    if not isinstance(chat_enabled, bool):
        chat_enabled = True
    avatar_path = str(ui_runtime.get("avatarPath", "") or "")
    overlays_value = ui_runtime.get("overlays")
    overlays = dict(overlays_value) if isinstance(overlays_value, dict) else {}
    notes_value = ui_runtime.get("notes")
    notes = list(notes_value) if isinstance(notes_value, list) else []
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
            interactive = None
            interactive_state = {}
            continue

        if action_type == "slide_error":
            slide_error = str(action.get("detail", "Could not load that slide."))
            slide = None
            interactive = None
            interactive_state = {}
            continue

        if action_type == "interactive":
            config = normalized_interactive_config(action.get("config"))
            interactive = {
                "config": config,
                "eventId": str(action.get("eventId", "")),
                "interactiveId": str(action.get("interactiveId", "")),
                "mode": str(action.get("mode", "")),
                "prompt": str(action.get("prompt", "")),
                "stepId": str(action.get("stepId", "")),
                "title": str(action.get("title", "")),
                "triggersEvent": str(action.get("triggersEvent", "")),
            }
            interactive_state = normalized_interactive_config(
                action.get("state", config.get("initialState"))
            )
            slide = None
            slide_error = ""
            continue

        if action_type == "interactive_update" and isinstance(interactive, dict):
            action_state = action.get("state")
            interactive = {
                **interactive,
                "config": {
                    **normalized_interactive_config(interactive.get("config")),
                    **normalized_interactive_config(action.get("config")),
                },
            }
            for key in ("interactiveId", "mode", "prompt", "title", "triggersEvent"):
                if action.get(key):
                    interactive[key] = str(action.get(key, ""))
            if isinstance(action_state, dict):
                interactive_state = normalized_interactive_config(action_state)
            continue

        if action_type == "interactive_state":
            interactive_state = normalized_interactive_config(action.get("state"))
            continue

        if action_type == "interactive_clear":
            interactive = None
            interactive_state = {}
            continue

        if action_type == "chat_availability":
            chat_enabled = bool(action.get("enabled", True))
            continue

        if action_type == "show_image":
            image_path = str(action.get("imagePath", "") or "").strip()
            if image_path:
                avatar_path = image_path
            continue

        if action_type == "overlay":
            image_path = str(action.get("imagePath", "") or "").strip()
            overlay_id = str(action.get("overlayId", "") or "").strip() or "default"
            if image_path:
                overlays[overlay_id] = {
                    "id": overlay_id,
                    "imagePath": image_path,
                }
            continue

        if action_type == "overlay_off":
            overlay_id = str(action.get("overlayId", "") or "").strip()
            if overlay_id:
                overlays.pop(overlay_id, None)
            else:
                overlays = {}
            continue

        if action_type == "add_note":
            text = str(action.get("text", "") or "").strip()
            if text:
                note_id = (
                    str(action.get("noteId", "") or "").strip()
                    or hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
                )
                notes = [
                    note
                    for note in notes
                    if not (
                        isinstance(note, dict)
                        and str(note.get("id", "") or "") == note_id
                    )
                ]
                notes.append(
                    {
                        "id": note_id,
                        "source": str(action.get("source", "") or ""),
                        "text": text,
                    }
                )
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
    ui_runtime["chatEnabled"] = chat_enabled
    ui_runtime["avatarPath"] = avatar_path
    ui_runtime["highlights"] = highlights
    ui_runtime["interactive"] = interactive
    ui_runtime["interactiveState"] = interactive_state
    ui_runtime["notes"] = notes[-80:]
    ui_runtime["overlays"] = overlays
    ui_runtime["slide"] = slide
    ui_runtime["slideError"] = slide_error
    ui_runtime["triggers"] = triggers
    state["uiRuntime"] = ui_runtime
    return append_runtime_debug_trace(state, actions)


def initial_script_cue_actions_from_messages(messages):
    actions = []
    for message in messages:
        metadata = message.metadata or {}
        cues = metadata.get("scriptCues", [])
        if not isinstance(cues, list):
            continue

        for cue in cues:
            if not isinstance(cue, dict):
                continue
            action = cue.get("action")
            if not isinstance(action, dict):
                continue

            try:
                progress = float(cue.get("progress", 0) or 0)
            except (TypeError, ValueError):
                progress = 0

            if progress <= INITIAL_SCRIPT_CUE_PROGRESS:
                actions.append(action)
    return actions


def hydrate_initial_script_runtime_state(session):
    state = dict(session.runtime_state or {})
    ui_runtime = dict(state.get("uiRuntime") or {})
    if (
        ui_runtime.get("interactive")
        or ui_runtime.get("slide")
        or ui_runtime.get("slideError")
        or ui_runtime.get("avatarPath")
        or ui_runtime.get("overlays")
        or ui_runtime.get("notes")
    ):
        return

    messages = list(session.messages.order_by("sequence"))
    actions = initial_script_cue_actions_from_messages(messages)
    if not actions:
        return

    next_state = apply_runtime_actions_to_state(state, actions)
    if next_state == session.runtime_state:
        return

    session.runtime_state = next_state
    session.save(update_fields=["runtime_state", "updated_at"])


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
            raw_text = render_context_template(
                config.get("text", ""),
                runtime_context,
            ).strip()
            text, markers = parse_script_markers(raw_text)
            script_cues = []
            for marker in markers:
                action = resolve_script_marker_action(marker, config, runtime_context)
                if not action:
                    continue
                action.update(
                    {
                        "eventId": str(event.id),
                        "source": source,
                        "stepId": step_id,
                        **metadata,
                    }
                )
                script_cues.append(
                    {
                        "action": action,
                        "progress": marker.get("progress", 0),
                        "wordIndex": marker.get("wordIndex", 0),
                    }
                )
            if not text:
                actions.extend(cue["action"] for cue in script_cues)
                continue

            message = create_message_for_runtime(
                session=session,
                role=SessionMessage.Role.ASSISTANT,
                content=text,
                metadata={
                    "actionType": action_type,
                    "eventId": str(event.id),
                    "source": source,
                    "scriptAudio": cached_script_audio_payload(
                        session,
                        text,
                        script_cues,
                    ),
                    "scriptCues": script_cues,
                    "stepId": step_id,
                    **metadata,
                },
            )
            script_audio = dict(message.metadata.get("scriptAudio") or {})
            if script_audio:
                script_audio["messageId"] = str(message.id)
                message.metadata["scriptAudio"] = script_audio
                message.save(update_fields=["metadata"])
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
            action = {
                "type": "set_context",
                "eventId": str(event.id),
                "stepId": step_id,
                "key": key,
                "value": config.get("value"),
                **metadata,
            }
            runtime_context, applied_action = apply_runtime_context_action(
                runtime_context,
                action,
            )
            if applied_action:
                actions.append(applied_action)
            continue

        if action_type == EventActionStep.ActionType.APPEND_CONTEXT_LIST:
            key = str(config.get("key", "")).strip()
            if not key:
                continue
            action = {
                "type": "append_context_list",
                "eventId": str(event.id),
                "key": key,
                "stepId": step_id,
                "value": config.get("value"),
                **metadata,
            }
            runtime_context, applied_action = apply_runtime_context_action(
                runtime_context,
                action,
            )
            if applied_action:
                actions.append(applied_action)
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

        if action_type == EventActionStep.ActionType.INTERACTIVE:
            action = build_interactive_action(
                config=config,
                event_id=str(event.id),
                metadata=metadata,
                runtime_context=runtime_context,
                step_id=step_id,
            )
            if action:
                actions.append(action)
            continue

        if action_type == EventActionStep.ActionType.INTERACTIVE_UPDATE:
            action = build_interactive_action(
                config=config,
                event_id=str(event.id),
                metadata=metadata,
                runtime_context=runtime_context,
                step_id=step_id,
                update=True,
            )
            if action:
                actions.append(action)
            continue

        if action_type == EventActionStep.ActionType.INTERACTIVE_CLEAR:
            actions.append(
                {
                    "type": "interactive_clear",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.CHAT_AVAILABILITY:
            actions.append(
                {
                    "enabled": config.get("enabled") is not False,
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "type": "chat_availability",
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


def event_classifier_model(classifier, default_model):
    return (
        classifier.model.strip()
        or str(default_model or "").strip()
        or settings.DLU_CLASSIFICATION_DEFAULT_MODEL
        or DEFAULT_CLASSIFICATION_MODEL
    )


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
    model = event_classifier_model(classifier, default_model)
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
    classifiers = list(
        group.classifiers.filter(enabled=True).order_by("sort_order", "created_at")
    )
    group_action = {
        "classifierCount": len(classifiers),
        "classifierGroupId": str(group.id),
        "classifierGroupTitle": group.title,
        "eventId": str(current_event.id),
        "resultContextKey": group.result_context_key,
        "runMode": "parallel",
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

    results = {}
    actions = []
    classifiers_to_run = []
    for classifier in classifiers:
        classifier_action = {
            "classifierGroupId": str(group.id),
            "classifierGroupTitle": group.title,
            "classifierId": str(classifier.id),
            "classifierModel": event_classifier_model(classifier, default_model),
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
                "classifierModel": event_classifier_model(classifier, default_model),
                "classifierName": classifier.name,
                "eventId": str(current_event.id),
                "result": result_payload,
                "resultContextKey": group.result_context_key,
                "type": "classifier_result",
            }
        )

    actions.append(
        {
            **group_action,
            "ranClassifierCount": len(classifiers_to_run),
            "results": results,
        }
    )
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
    user = User.objects.filter(email__iexact=email).order_by("id").first()
    if not user:
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
            model = normalize_realtime_model_choice(
                tutor_data.get("realtimeModel"),
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
            voice = normalize_realtime_voice_choice(
                tutor_data.get("voice"),
                settings.DLU_REALTIME_DEFAULT_VOICE,
                tutor_settings.realtime_model,
            )
            if voice is None:
                return JsonResponse({"detail": "Realtime voice is not supported."}, status=400)
            tutor_settings.voice = voice

        if "systemPrompt" in tutor_data:
            system_prompt = str(tutor_data.get("systemPrompt", "")).strip()
            if len(system_prompt) > 12000:
                return JsonResponse({"detail": "System prompt is too long."}, status=400)
            tutor_settings.system_prompt = system_prompt

        if "scriptActionOffsetMs" in tutor_data:
            try:
                script_action_offset_ms = int(tutor_data.get("scriptActionOffsetMs") or 0)
            except (TypeError, ValueError):
                return JsonResponse(
                    {"detail": "Script action offset must be a number."},
                    status=400,
                )
            if abs(script_action_offset_ms) > SCRIPT_ACTION_OFFSET_LIMIT_MS:
                return JsonResponse(
                    {
                        "detail": (
                            "Script action offset must be between "
                            f"-{SCRIPT_ACTION_OFFSET_LIMIT_MS} and "
                            f"{SCRIPT_ACTION_OFFSET_LIMIT_MS} ms."
                        )
                    },
                    status=400,
                )
            tutor_settings.script_action_offset_ms = script_action_offset_ms

        if "voiceInstructions" in tutor_data:
            voice_instructions = str(tutor_data.get("voiceInstructions", "")).strip()
            if len(voice_instructions) > 4000:
                return JsonResponse({"detail": "Voice instructions are too long."}, status=400)
            tutor_settings.voice_instructions = voice_instructions

        tutor_settings.save()

    experience.save()
    return JsonResponse({"experience": serialize_experience(experience)})


@require_GET
def experience_validation(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    ensure_tutor_settings(experience)
    ensure_start_event(experience)
    return JsonResponse({"validation": experience_validation_summary(experience)})


@require_POST
def duplicate_experience(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    source = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not source:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    duplicate = duplicate_experience_for_user(source, request.user)
    return JsonResponse({"experience": serialize_experience(duplicate)}, status=201)


@require_GET
def export_experience(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    payload = {
        "exportedAt": timezone.now().isoformat(),
        "format": EXPERIENCE_EXPORT_FORMAT,
        "version": EXPERIENCE_EXPORT_VERSION,
        "experience": serialize_experience(experience),
    }
    filename = f"{slugify(experience.title) or 'experience'}.dlu-experience.json"
    response = JsonResponse(payload, json_dumps_params={"indent": 2})
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@require_POST
def import_experience(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    experience, error = create_experience_from_export_payload(request.user, data)
    if error:
        return JsonResponse({"detail": error}, status=400)

    return JsonResponse({"experience": serialize_experience(experience)}, status=201)


@require_http_methods(["GET", "POST"])
def experience_script_audio(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    tutor_settings = ensure_tutor_settings(experience)
    if request.method == "GET":
        items = collect_experience_script_audio_items(experience)
        return JsonResponse(
            {
                "generated": 0,
                "scripts": items,
                "totalScripts": len(items),
            }
        )

    if not settings.OPENAI_API_KEY:
        return JsonResponse(
            {"detail": "OPENAI_API_KEY is not configured."},
            status=500,
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    force = bool(data.get("force", False))
    target_id = str(data.get("scriptId", "")).strip()

    generated = 0
    errors = []
    items = collect_experience_script_audio_items(experience)
    for item in items:
        if target_id and item["id"] != target_id:
            continue
        try:
            did_generate, item_error = generate_script_audio_item(
                request,
                experience,
                tutor_settings,
                item,
                force=force,
            )
            if did_generate:
                generated += 1
            if item_error:
                errors.append(f"{item['source']}: {item_error}")
        except (AudioGenerationError, AudioTimingError) as error:
            errors.append(f"{item['source']}: {error.message}")

    refreshed_items = collect_experience_script_audio_items(experience)
    return JsonResponse(
        {
            "errors": errors,
            "generated": generated,
            "scripts": refreshed_items,
            "totalScripts": len(refreshed_items),
        },
        status=207 if errors else 200,
    )


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

    if isinstance(data.get("event"), dict):
        try:
            with transaction.atomic():
                event = create_experience_event_from_payload(
                    experience,
                    data.get("event"),
                )
                ensure_start_event(experience)
        except ExperienceImportError as error:
            return JsonResponse({"detail": str(error)}, status=400)

        return JsonResponse({"event": serialize_experience_event(event)}, status=201)

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


@require_POST
def update_session_interactive(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    interactive_id = str(data.get("interactiveId", "")).strip()
    id_error = interactive_id_error(interactive_id)
    if id_error:
        return JsonResponse({"detail": id_error}, status=400)

    next_state = normalized_interactive_config(data.get("state"))
    if len(json.dumps(next_state, ensure_ascii=True)) > 12000:
        return JsonResponse({"detail": "Main-panel app state is too large."}, status=400)

    context_values = normalized_interactive_config(data.get("context"))
    if len(json.dumps(context_values, ensure_ascii=True)) > 12000:
        return JsonResponse({"detail": "Main-panel app context is too large."}, status=400)
    for key in context_values:
        if not isinstance(key, str) or not key.strip():
            return JsonResponse({"detail": "Context keys must be named."}, status=400)
        if len(key) > 120:
            return JsonResponse({"detail": "Context key is too long."}, status=400)

    emitted_actions = data.get("actions")
    if not isinstance(emitted_actions, list):
        emitted_actions = []
    if len(emitted_actions) > 24:
        return JsonResponse({"detail": "Too many emitted actions."}, status=400)
    if len(json.dumps(emitted_actions, ensure_ascii=True)) > 16000:
        return JsonResponse({"detail": "Emitted actions are too large."}, status=400)
    emitted_actions, rejected_emitted_actions = normalize_emitted_runtime_actions(
        emitted_actions
    )

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

        state = dict(session.runtime_state or {})
        ui_runtime = dict(state.get("uiRuntime") or {})
        active_interactive = ui_runtime.get("interactive")
        if not isinstance(active_interactive, dict):
            return JsonResponse(
                {"detail": "No main-panel app is active."},
                status=400,
            )
        active_id = str(active_interactive.get("interactiveId", "")).strip()
        if active_id != interactive_id:
            return JsonResponse(
                {"detail": "That main-panel app is no longer active."},
                status=409,
            )

        actions = [
            {
                "interactiveId": interactive_id,
                "state": next_state,
                "type": "interactive_state",
            }
        ]

        for key, value in context_values.items():
            context_key = key.strip()
            actions.append(
                {
                    "key": context_key,
                    "type": "set_context",
                    "value": value,
                }
            )

        actions.extend(emitted_actions)
        actions.extend(rejected_emitted_actions)
        runtime_context = apply_runtime_actions_to_context(
            session.runtime_context,
            actions,
        )
        session.runtime_context = runtime_context

        ran_events = []
        ran_messages = []
        transition_slug = emitted_transition_slug(actions)
        if transition_slug and not session.experience:
            actions.append(
                {
                    "type": "transition_missing",
                    "triggersEvent": transition_slug,
                }
            )
        elif transition_slug:
            transition_event = session.experience.events.filter(
                slug=transition_slug,
            ).first()
            if transition_event:
                (
                    transition_actions,
                    ran_messages,
                    ran_events,
                    state,
                ) = run_event_chain(
                    session,
                    transition_event,
                    state=state,
                )
                actions.extend(transition_actions)
            else:
                actions.append(
                    {
                        "type": "transition_missing",
                        "triggersEvent": transition_slug,
                    }
                )

        state = apply_runtime_actions_to_state(state, actions)
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in ran_messages],
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
    realtime_model = normalize_realtime_model_choice(
        default_model,
        tutor_settings.realtime_model,
    )
    if realtime_model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    default_voice = str(data.get("voice") or tutor_settings.voice).strip()
    voice = normalize_realtime_voice_choice(
        default_voice,
        tutor_settings.voice,
        realtime_model,
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

    duration_seconds = audio_duration_seconds(recording.audio_path)
    script_words = []
    script_cues = metadata.get("scriptCues", [])
    timing_warning = ""
    try:
        script_words = get_or_create_script_audio_words(
            api_key=settings.OPENAI_API_KEY,
            alignment_model=settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
            audio_path=recording.audio_path,
            cache_key=recording.cache_key,
            safety_identifier=hash_safety_identifier(request.user),
            script=script,
        )
        script_cues = script_cues_with_word_times(script_cues, script_words)
        next_metadata = dict(metadata)
        next_metadata["scriptCues"] = script_cues
        script_audio = dict(next_metadata.get("scriptAudio") or {})
        script_audio.update(
            {
                "audioUrl": f"/api/script-audio/{recording.cache_key}.wav/",
                "cached": recording.cached,
                "durationSeconds": duration_seconds,
                "messageId": str(message.id),
                "realtimeModel": realtime_model,
                "scriptWords": script_words,
                "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
                "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
                "voice": voice,
            }
        )
        next_metadata["scriptAudio"] = script_audio
        message.metadata = next_metadata
        message.save(update_fields=["metadata"])
    except AudioTimingError as error:
        timing_warning = error.message

    return JsonResponse(
        {
            "audioUrl": f"/api/script-audio/{recording.cache_key}.wav/",
            "cached": recording.cached,
            "durationSeconds": duration_seconds,
            "messageId": str(message.id),
            "realtimeModel": realtime_model,
            "scriptCues": script_cues,
            "scriptWords": script_words,
            "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
            "timingWarning": timing_warning,
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
    realtime_model = normalize_realtime_model_choice(
        data.get("model"),
        default_model,
    )
    if realtime_model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    default_voice = sample_tutor.get("voice") or tutor_settings.voice
    voice = normalize_realtime_voice_choice(
        data.get("voice"),
        default_voice,
        realtime_model,
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

    model = normalize_realtime_model_choice(
        data.get("model"),
        default_model,
    )
    if model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    voice = normalize_realtime_voice_choice(
        data.get("voice"),
        default_voice,
        model,
    )
    if voice is None:
        return JsonResponse({"detail": "Realtime voice is not supported."}, status=400)

    realtime_tools = realtime_tools_for_event(get_session_current_event(session))
    realtime_instructions = build_realtime_instructions(
        session,
        exclude_message_id=data.get("excludeMessageId"),
    )
    record_realtime_prompt_debug(
        session,
        model,
        voice,
        realtime_instructions,
        realtime_tools,
    )
    payload = {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": realtime_instructions,
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
