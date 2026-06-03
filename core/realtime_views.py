from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from . import realtime_services
from .experience_services import ensure_tutor_settings, get_session_current_event
from .http_utils import auth_required_response, parse_json_body
from .models import TutoringSession
from .realtime_services import (
    build_realtime_instructions,
    normalize_realtime_model_choice,
    normalize_realtime_voice_choice,
    record_realtime_prompt_debug,
    realtime_tools_for_event,
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

    current_event = get_session_current_event(session)
    realtime_tools = realtime_tools_for_event(current_event)
    realtime_instructions = build_realtime_instructions(
        session,
        current_event=current_event,
        current_tools=realtime_tools,
        exclude_message_id=data.get("excludeMessageId"),
    )
    record_realtime_prompt_debug(
        session,
        current_event,
        model,
        voice,
        realtime_instructions,
        realtime_tools,
        reasoning=realtime_services.realtime_reasoning_for_model(model),
    )
    client_secret, error_detail, status_code = (
        realtime_services.request_realtime_client_secret(
            request.user,
            model,
            voice,
            realtime_instructions,
            realtime_tools,
        )
    )
    if error_detail:
        return JsonResponse({"detail": error_detail}, status=status_code)

    return JsonResponse(
        {
            "clientSecret": client_secret,
            "model": model,
            "voice": voice,
        }
    )
