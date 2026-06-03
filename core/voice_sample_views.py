import re

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .audio_cache import voice_sample_audio_path
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .realtime_services import hash_safety_identifier
from .script_audio_services import generate_voice_sample_payload


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

    payload, error, status_code = generate_voice_sample_payload(
        experience,
        data,
        hash_safety_identifier(request.user),
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(payload)

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
