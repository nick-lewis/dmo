from django.http import JsonResponse
from django.views.decorators.http import require_http_methods, require_POST

from .event_services import (
    EventServiceError,
    create_event_action_step_from_data,
    delete_event_action_step,
    reorder_event_action_step_ids,
    update_event_action_step_from_data,
)
from .http_utils import auth_required_response, parse_json_body
from .models import Experience
from .serializers import serialize_event_action_step, serialize_experience_event


@require_POST
def create_event_action_step(request, experience_id, event_id):
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
        step = create_event_action_step_from_data(event, data)
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse(
        {
            "event": serialize_experience_event(event),
            "step": serialize_event_action_step(step),
        },
        status=201,
    )


@require_POST
def reorder_event_action_steps(request, experience_id, event_id):
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
        reorder_event_action_step_ids(event, data.get("stepIds"))
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse({"event": serialize_experience_event(event)})


@require_http_methods(["DELETE", "PATCH"])
def update_event_action_step(request, experience_id, event_id, step_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    experience = Experience.objects.filter(id=experience_id, user=request.user).first()
    if not experience:
        return JsonResponse({"detail": "Experience not found."}, status=404)

    event = experience.events.filter(id=event_id).first()
    if not event:
        return JsonResponse({"detail": "Event not found."}, status=404)

    step = event.steps.filter(id=step_id).first()
    if not step:
        return JsonResponse({"detail": "Action step not found."}, status=404)

    if request.method == "DELETE":
        try:
            delete_event_action_step(event, step)
        except EventServiceError as error:
            return JsonResponse({"detail": str(error)}, status=400)
        return JsonResponse({"event": serialize_experience_event(event)})

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    try:
        step = update_event_action_step_from_data(step, data)
    except EventServiceError as error:
        return JsonResponse({"detail": str(error)}, status=400)

    return JsonResponse({"step": serialize_event_action_step(step)})
