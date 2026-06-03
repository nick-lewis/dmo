from django.http import JsonResponse
from django.views.decorators.http import require_http_methods, require_POST

from .event_services import (
    EventServiceError,
    create_event_classifier_group_from_data,
    delete_event_classifier_group,
    update_event_classifier_group_from_data,
)
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .serializers import serialize_event_classifier_group, serialize_experience_event


@require_POST
def create_event_classifier_group(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    try:
        group = create_event_classifier_group_from_data(event, data)
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse(
        {
            "event": serialize_experience_event(event),
            "group": serialize_event_classifier_group(group),
        },
        status=201,
    )


@require_http_methods(["DELETE", "PATCH"])
def update_event_classifier_group(request, experience_id, event_id, group_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    group = event.classifier_groups.filter(id=group_id).first()
    if not group:
        return JsonResponse({"detail": "Classifier group not found."}, status=404)

    if request.method == "DELETE":
        delete_event_classifier_group(event, group)
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    try:
        group = update_event_classifier_group_from_data(group, data)
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse({"group": serialize_event_classifier_group(group)})
