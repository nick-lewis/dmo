from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .http_utils import auth_required_response, parse_json_body
from .models import SessionMessage, TutoringSession
from .runtime_execution import create_message_for_runtime
from .serializers import serialize_message, serialize_session


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
        message = create_message_for_runtime(session, role, content, metadata)

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
