import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.conf import settings
from django.utils import timezone
import requests

from .audio_cache import (
    OPENAI_CHAT_COMPLETIONS_URL,
    openai_error_message,
)
from .models import DEFAULT_CLASSIFICATION_MODEL, SessionMessage
from .runtime import condition_matches, render_context_template
from .validation import DEFAULT_CLASSIFIER_RESULT_SCHEMA


OPENAI_REALTIME_CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets"
MODEL_OPTIONS_PATH = settings.BASE_DIR / "frontend" / "src" / "modelOptions.json"
REALTIME_REASONING_EFFORT_BY_MODEL = {
    "gpt-realtime-2": "minimal",
}


def hash_safety_identifier(user):
    source = f"{settings.SECRET_KEY}:{user.pk}:{user.email or user.username}"
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def realtime_tools_for_event(event):
    from .serializers import openai_tool_parameters

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


def build_realtime_instructions(
    session,
    current_event=None,
    current_tools=None,
    exclude_message_id=None,
):
    from .experience_services import ensure_tutor_settings, get_session_current_event

    tutor_settings = ensure_tutor_settings(session.experience) if session.experience else None
    if current_event is None:
        current_event = get_session_current_event(session)
    current_tools = (
        realtime_tools_for_event(current_event)
        if current_tools is None
        else current_tools
    )
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
            "# Personality and Tone\n"
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
            event_context.append(f"Runtime context: {context_json}")
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

    messages = list(messages_query.order_by("sequence", "created_at"))
    if not messages:
        return instructions

    transcript_lines = []
    for message in messages:
        speaker = "User" if message.role == SessionMessage.Role.USER else "dLU"
        content = " ".join(message.content.split())
        if not content:
            continue

        transcript_lines.append(f"{speaker}: {content}")

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


def realtime_reasoning_for_model(model):
    effort = REALTIME_REASONING_EFFORT_BY_MODEL.get(str(model or "").strip())
    if not effort:
        return None
    return {"effort": effort}


def record_realtime_prompt_debug(
    session,
    current_event,
    model,
    voice,
    instructions,
    tools,
    reasoning=None,
):
    timestamp = timezone.now().isoformat()
    state = dict(session.runtime_state or {})
    debug = dict(state.get("runtimeDebug") or {})
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
        "reasoning": reasoning or None,
        "toolCount": len(tool_names),
        "tools": tool_names,
        "voice": voice,
    }
    debug["updatedAt"] = timestamp
    state["runtimeDebug"] = debug
    session.runtime_state = state
    session.save(update_fields=["runtime_state", "updated_at"])


def request_realtime_client_secret(user, model, voice, instructions, tools):
    reasoning = realtime_reasoning_for_model(model)
    payload = {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "output_modalities": ["audio"],
            "audio": {
                "output": {
                    "voice": voice,
                },
            },
        },
    }
    if reasoning:
        payload["session"]["reasoning"] = reasoning
    if tools:
        payload["session"]["tools"] = tools
        payload["session"]["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": hash_safety_identifier(user),
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
        return (
            None,
            "Could not reach OpenAI to start the Realtime session.",
            502,
        )
    except ValueError:
        return None, "OpenAI returned an unreadable Realtime response.", 502

    if not isinstance(response_data, dict):
        return None, "OpenAI returned an unexpected Realtime response.", 502

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
        return (
            None,
            detail or "OpenAI could not start the Realtime session.",
            status_code,
        )

    return response_data, "", 200


def realtime_session_current_event(session):
    from .experience_services import get_session_current_event

    return get_session_current_event(session)


def conversation_check_transcript(session):
    messages = list(
        session.messages.filter(
            role__in=[SessionMessage.Role.USER, SessionMessage.Role.ASSISTANT]
        ).order_by("sequence", "created_at")
    )
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
            f"Runtime context:\n{json.dumps(runtime_context or {}, ensure_ascii=True)}",
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


def evaluate_classifier_group(
    session,
    current_event,
    group,
    runtime_context,
    classifier_evaluator=None,
):
    from .experience_services import ensure_tutor_settings

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

    classifier_evaluator = classifier_evaluator or evaluate_event_classifier
    if classifiers_to_run:
        transcript = conversation_check_transcript(session)
        max_workers = min(6, len(classifiers_to_run))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(
                    classifier_evaluator,
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

    from .experience_services import ensure_tutor_settings

    current_event = realtime_session_current_event(session)
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
            f"Runtime context:\n{json.dumps(session.runtime_context or {}, ensure_ascii=True)}",
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


def load_model_options():
    try:
        options = json.loads(MODEL_OPTIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "classificationModels": [],
            "realtimeModels": [],
            "realtimeVoices": [],
            "realtimeVoicesByModel": {},
        }
    return options if isinstance(options, dict) else {}


MODEL_OPTIONS = load_model_options()
REALTIME_MODEL_OPTIONS = tuple(
    str(option.get("id", "") or "").strip()
    for option in MODEL_OPTIONS.get("realtimeModels", [])
    if isinstance(option, dict) and str(option.get("id", "") or "").strip()
)
REALTIME_MODELS = set(REALTIME_MODEL_OPTIONS)
LEGACY_REALTIME_MODEL_ALIASES = {
    "gpt-4o-mini-realtime-preview": "gpt-realtime-mini",
    "gpt-4o-realtime-preview": "gpt-realtime",
}
CLASSIFICATION_MODELS = {
    str(option.get("id", "") or "").strip()
    for option in MODEL_OPTIONS.get("classificationModels", [])
    if isinstance(option, dict) and str(option.get("id", "") or "").strip()
}
REALTIME_VOICE_ORDER = tuple(
    str(option.get("id", "") or "").strip()
    for option in MODEL_OPTIONS.get("realtimeVoices", [])
    if isinstance(option, dict) and str(option.get("id", "") or "").strip()
)
REALTIME_VOICES = set(REALTIME_VOICE_ORDER)
REALTIME_VOICES_BY_MODEL = {
    str(model or "").strip(): {
        str(voice or "").strip()
        for voice in voices
        if str(voice or "").strip()
    }
    for model, voices in MODEL_OPTIONS.get("realtimeVoicesByModel", {}).items()
    if isinstance(voices, list) and str(model or "").strip()
}


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
