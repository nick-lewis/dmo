import json
from urllib.parse import urlencode

from django.conf import settings
from django.http import JsonResponse

from .runtime import hydrate_initial_script_runtime_state
from .serializers import serialize_message, serialize_session


DEFAULT_APP_PATH = "/surfaces/tutoring/panels"


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


def session_payload(session):
    hydrate_initial_script_runtime_state(session)
    return {
        "session": serialize_session(session),
        "messages": [serialize_message(message) for message in session.messages.all()],
    }
