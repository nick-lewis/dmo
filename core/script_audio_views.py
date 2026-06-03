import re

from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.http import require_GET, require_http_methods

from .audio_cache import script_audio_audio_path
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .realtime_services import hash_safety_identifier
from .script_audio_services import (
    experience_script_audio_inventory_payload,
    generate_experience_script_audio_payload,
    script_audio_display_transcript_payload,
)


@require_http_methods(["GET", "POST"])
def experience_script_audio(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    if request.method == "GET":
        return JsonResponse(experience_script_audio_inventory_payload(experience))

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, error, status_code = generate_experience_script_audio_payload(
        experience,
        data,
        hash_safety_identifier(request.user),
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(payload, status=status_code)


@require_http_methods(["GET", "PUT"])
def script_audio_display_transcript(request, experience_id, script_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    if request.method == "GET":
        payload, error, status_code = script_audio_display_transcript_payload(
            experience,
            script_id,
        )
        if error:
            return JsonResponse({"detail": error}, status=status_code)
        return JsonResponse(payload, status=status_code)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, error, status_code = script_audio_display_transcript_payload(
        experience,
        script_id,
        data,
    )
    if error:
        response_payload = payload if isinstance(payload, dict) else {"detail": error}
        return JsonResponse(response_payload, status=status_code)
    return JsonResponse(payload, status=status_code)

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
