import hashlib
import json
import re
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
    get_or_create_voice_sample,
    voice_sample_audio_path,
)
from .models import (
    EventActionStep,
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
        "enabled": step.enabled,
        "sortOrder": step.sort_order,
        "createdAt": step.created_at.isoformat(),
        "updatedAt": step.updated_at.isoformat(),
    }


def serialize_experience_event(event):
    ensure_default_event_step(event)
    return {
        "id": str(event.id),
        "experienceId": str(event.experience_id),
        "title": event.title,
        "slug": event.slug,
        "description": event.description,
        "isStart": event.is_start,
        "sortOrder": event.sort_order,
        "steps": [
            serialize_event_action_step(step)
            for step in event.steps.order_by("sort_order", "created_at")
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
            "realtime_model": settings.DLU_REALTIME_DEFAULT_MODEL,
            "voice": settings.DLU_REALTIME_DEFAULT_VOICE,
            "system_prompt": settings.DLU_REALTIME_DEFAULT_INSTRUCTIONS,
            "voice_instructions": "",
        },
    )
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


def build_realtime_instructions(session, exclude_message_id=None):
    tutor_settings = ensure_tutor_settings(session.experience) if session.experience else None
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

    return None, "Action type is not supported."


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


def run_event_steps(session, event):
    actions = []
    messages = []
    runtime_context = dict(session.runtime_context or {})

    for step in event.steps.filter(enabled=True).order_by("sort_order", "created_at"):
        if step.action_type == EventActionStep.ActionType.SCRIPT:
            text = str(step.config.get("text", "")).strip()
            if not text:
                continue

            message = create_message_for_runtime(
                session=session,
                role=SessionMessage.Role.ASSISTANT,
                content=text,
                metadata={
                    "actionType": step.action_type,
                    "eventId": str(event.id),
                    "source": "event-action",
                    "stepId": str(step.id),
                },
            )
            messages.append(message)
            actions.append(
                {
                    "type": "chat_message",
                    "eventId": str(event.id),
                    "stepId": str(step.id),
                    "message": serialize_message(message),
                }
            )
            continue

        if step.action_type == EventActionStep.ActionType.SET_CONTEXT:
            key = str(step.config.get("key", "")).strip()
            if not key:
                continue
            runtime_context[key] = step.config.get("value")
            actions.append(
                {
                    "type": "set_context",
                    "eventId": str(event.id),
                    "stepId": str(step.id),
                    "key": key,
                    "value": runtime_context[key],
                }
            )

    session.runtime_context = runtime_context
    return actions, messages


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

    if "isStart" in data and bool(data.get("isStart")):
        event.is_start = True
        ExperienceEvent.objects.filter(experience=experience).exclude(
            id=event.id,
        ).update(is_start=False)

    event.save()
    ensure_default_event_step(event)
    return JsonResponse({"event": serialize_experience_event(event)})


@require_http_methods(["PATCH"])
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

    if "config" in data or action_type != step.action_type:
        config, config_error = validate_action_config(
            action_type,
            data.get("config", step.config),
        )
        if config_error:
            return JsonResponse({"detail": config_error}, status=400)
        step.config = config

    step.action_type = action_type
    step.save()

    return JsonResponse({"step": serialize_event_action_step(step)})


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

        actions, messages = run_event_steps(session, event)
        event_runs[run_key] = {
            "completedAt": timezone.now().isoformat(),
            "status": "complete",
        }
        state["eventRuns"] = event_runs
        state["startEventId"] = str(event.id)
        state["startEventComplete"] = True
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "event": serialize_experience_event(event),
            "ran": True,
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

    payload = {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": build_realtime_instructions(
                session,
                exclude_message_id=data.get("excludeMessageId"),
            ),
            "audio": {
                "output": {
                    "voice": voice,
                },
            },
        },
    }
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
