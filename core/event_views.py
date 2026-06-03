from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .event_services import (
    EventServiceError,
    create_experience_event,
    delete_experience_event,
    ordered_experience_events,
    reorder_experience_event_ids,
    update_experience_event_from_data,
)
from .experience_services import ensure_start_event
from .http_utils import auth_required_response, parse_json_body
from .models import Experience, ExperienceEvent
from .serializers import serialize_event_checkpoint, serialize_experience_event


@require_http_methods(["GET", "POST"])
def experience_events(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    ensure_start_event(experience)

    if request.method == "GET":
        return JsonResponse(
            {
                "events": [
                    serialize_experience_event(event)
                    for event in ordered_experience_events(experience)
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    try:
        event = create_experience_event(experience, data)
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse({"event": serialize_experience_event(event)}, status=201)


@require_GET
def event_checkpoints(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    event = (
        ExperienceEvent.objects.select_related("experience")
        .filter(
            id=event_id,
            experience_id=experience_id,
            experience__user=request.user,
        )
        .first()
    )
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    checkpoints = event.checkpoints.select_related("event").order_by(
        "-last_used_at",
        "-created_at",
    )[:50]
    return JsonResponse(
        {
            "checkpoints": [
                serialize_event_checkpoint(checkpoint)
                for checkpoint in checkpoints
            ],
        }
    )


@require_POST
def reorder_experience_events(request, experience_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    try:
        events = reorder_experience_event_ids(experience, data.get("eventIds"))
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse(
        {
            "events": [
                serialize_experience_event(event)
                for event in events
            ],
        }
    )


@require_http_methods(["DELETE", "PATCH"])
def update_experience_event(request, experience_id, event_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    if request.method == "DELETE":
        try:
            events = delete_experience_event(experience, event)
        except EventServiceError as error:
            return JsonResponse({"detail": str(error)}, status=400)
        return JsonResponse(
            {
                "events": [
                    serialize_experience_event(next_event)
                    for next_event in events
                ],
            }
        )

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    try:
        event = update_experience_event_from_data(experience, event, data)
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)
    return JsonResponse({"event": serialize_experience_event(event)})
