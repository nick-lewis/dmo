from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .http_utils import auth_required_response, parse_json_body
from .models import SessionMessage, TutoringSession
from .realtime_services import hash_safety_identifier
from .script_audio_services import generate_message_script_audio_payload


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

    payload, error, status_code = generate_message_script_audio_payload(
        session,
        message,
        data,
        hash_safety_identifier(request.user),
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(payload)
