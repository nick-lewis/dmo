from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .http_utils import auth_required_response, parse_json_body
from .realtime_services import hash_safety_identifier
from .voice_personality_lab_services import (
    create_voice_personality_lab_group,
    delete_voice_personality_lab_group,
    generate_voice_personality_lab_group,
    voice_personality_lab_payload,
)


@require_http_methods(["GET", "POST"])
def voice_personality_lab(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    if request.method == "GET":
        return JsonResponse(voice_personality_lab_payload(request.user))

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, error, status_code = create_voice_personality_lab_group(
        request.user,
        data,
        hash_safety_identifier(request.user),
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(payload, status=status_code)


@require_http_methods(["DELETE"])
def voice_personality_lab_group(request, group_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    payload, error, status_code = delete_voice_personality_lab_group(
        request.user,
        group_id,
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(payload, status=status_code)


@require_http_methods(["POST"])
def voice_personality_lab_group_generate(request, group_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    payload, error, status_code = generate_voice_personality_lab_group(
        request.user,
        group_id,
        force=bool(data.get("force", False)),
        safety_identifier=hash_safety_identifier(request.user),
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(payload, status=status_code)
