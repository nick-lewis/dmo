from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .experience_services import create_experience_from_export_payload
from .http_utils import auth_required_response, parse_json_body
from .serializers import serialize_experience


@require_POST
def import_experience(request):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    experience, error = create_experience_from_export_payload(request.user, data)
    if error:
        return JsonResponse({"detail": error}, status=400)

    return JsonResponse({"experience": serialize_experience(experience)}, status=201)
