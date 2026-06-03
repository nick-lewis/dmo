from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .experience_services import get_current_experience, get_current_session
from .http_utils import auth_required_response, parse_json_body, session_payload
from .runtime_execution import create_runtime_session_for_experience


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

    session, error, status_code = create_runtime_session_for_experience(
        request.user,
        experience,
        data,
    )
    if error:
        return JsonResponse({"detail": error}, status=status_code)
    return JsonResponse(session_payload(session), status=status_code)
