import hashlib
import json
from pathlib import Path
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import logout
from django.db import transaction
from django.db.models import Max
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
import requests

from .models import SessionMessage, TutoringSession


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
        "title": session.title,
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


def get_current_session(user):
    session = (
        TutoringSession.objects.filter(user=user, status=TutoringSession.Status.ACTIVE)
        .order_by("-updated_at", "-created_at")
        .first()
    )
    if session:
        return session

    return TutoringSession.objects.create(user=user)


def session_payload(session):
    return {
        "session": serialize_session(session),
        "messages": [serialize_message(message) for message in session.messages.all()],
    }


def build_realtime_instructions(session, exclude_message_id=None):
    instructions = settings.DLU_REALTIME_INSTRUCTIONS.strip()
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


@require_GET
def current_session(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    session = get_current_session(request.user)
    return JsonResponse(session_payload(session))


@require_POST
def create_session(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    session = TutoringSession.objects.create(user=request.user)
    return JsonResponse(session_payload(session), status=201)


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

    model = normalize_realtime_choice(
        data.get("model"),
        REALTIME_MODELS,
        settings.DLU_REALTIME_DEFAULT_MODEL,
    )
    if model is None:
        return JsonResponse({"detail": "Realtime model is not supported."}, status=400)

    voice = normalize_realtime_choice(
        data.get("voice"),
        REALTIME_VOICES,
        settings.DLU_REALTIME_DEFAULT_VOICE,
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
