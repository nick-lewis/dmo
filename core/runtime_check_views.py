from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .http_utils import auth_required_response, parse_json_body
from .runtime_check_services import run_conversation_checks_for_session
from .runtime_execution import parse_client_ui_state


@require_POST
def run_session_conversation_checks(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    client_ui_state = parse_client_ui_state(data.get("uiState"))
    return run_conversation_checks_for_session(
        request.user,
        session_id,
        client_ui_state,
    )
