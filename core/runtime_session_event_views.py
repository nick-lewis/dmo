from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .http_utils import auth_required_response, parse_json_body, session_payload
from .models import TutoringSession
from .runtime import (
    apply_client_side_panel_state,
    apply_runtime_actions_to_state,
    set_runtime_current_event,
)
from .runtime_execution import parse_client_ui_state, run_event_chain
from .serializers import (
    conversation_choice_actions_for_ran_events,
    serialize_experience_event,
    serialize_message,
)


@require_POST
def run_session_event(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    event_id = str(data.get("eventId", "")).strip()
    event_slug = str(data.get("eventSlug", "")).strip()
    clear_buttons = bool(data.get("clearButtons", False))
    trigger_selector = str(data.get("triggerSelector", "")).strip()
    client_ui_state = parse_client_ui_state(data.get("uiState"))

    if not event_id and not event_slug:
        return JsonResponse({"detail": "Event is required."}, status=400)

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=request.user,
                status=TutoringSession.Status.ACTIVE,
            )
            .first()
        )
        if not session:
            return JsonResponse({"detail": "Session not found."}, status=404)
        if not session.experience:
            return JsonResponse(
                {"detail": "Session does not have an experience."},
                status=400,
            )

        event_query = session.experience.events.all()
        if event_id:
            event = event_query.filter(id=event_id).first()
        else:
            event = event_query.filter(slug=event_slug).first()
        if not event:
            return JsonResponse({"detail": "Event not found."}, status=404)

        state = dict(session.runtime_state or {})
        state = apply_client_side_panel_state(state, client_ui_state)
        event_runs = dict(state.get("eventRuns") or {})
        run_key = str(event.id)
        if event_runs.get(run_key, {}).get("status") == "complete":
            actions = [
                {
                    "type": "event_skipped",
                    "eventId": str(event.id),
                    "reason": "already_complete",
                }
            ]
            state = set_runtime_current_event(state, event)
            state = apply_runtime_actions_to_state(
                state,
                actions,
                clear_buttons=clear_buttons,
                clear_trigger_selector=trigger_selector,
            )
            session.runtime_state = state
            session.save(update_fields=["runtime_state", "updated_at"])
            return JsonResponse(
                {
                    **session_payload(session),
                    "actions": actions,
                    "event": serialize_experience_event(event),
                    "ran": False,
                }
            )

        actions, messages, ran_events, state = run_event_chain(
            session,
            event,
            client_ui_state=client_ui_state,
            state=state,
        )
        state = apply_runtime_actions_to_state(
            state,
            actions + conversation_choice_actions_for_ran_events(ran_events),
            clear_buttons=clear_buttons,
            clear_trigger_selector=trigger_selector,
        )
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "event": serialize_experience_event(event),
            "ran": True,
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )
