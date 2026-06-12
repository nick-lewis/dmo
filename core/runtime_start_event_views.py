from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .experience_services import ensure_start_event
from .http_utils import auth_required_response, parse_json_body, session_payload
from .models import TutoringSession
from .runtime import apply_client_ui_state, apply_runtime_actions_to_state
from .runtime_execution import parse_client_ui_state, run_event_chain
from .serializers import (
    conversation_choice_actions_for_ran_events,
    serialize_experience_event,
    serialize_message,
)


@require_POST
def run_start_event(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    client_ui_state = parse_client_ui_state(data.get("uiState"))

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

        event = ensure_start_event(session.experience)
        state = dict(session.runtime_state or {})
        state = apply_client_ui_state(state, client_ui_state)
        event_runs = dict(state.get("eventRuns") or {})
        run_key = str(event.id)

        if event_runs.get(run_key, {}).get("status") == "complete":
            return JsonResponse(
                {
                    **session_payload(session),
                    "actions": [],
                    "event": serialize_experience_event(event),
                    "ran": False,
                }
            )

        if not event_runs and session.messages.exists():
            event_runs[run_key] = {
                "completedAt": timezone.now().isoformat(),
                "reason": "Session already had messages.",
                "status": "skipped",
            }
            state["eventRuns"] = event_runs
            state["startEventId"] = str(event.id)
            state["startEventComplete"] = True
            session.runtime_state = state
            session.save(update_fields=["runtime_state", "updated_at"])
            return JsonResponse(
                {
                    **session_payload(session),
                    "actions": [],
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
        state["startEventId"] = str(event.id)
        state["startEventComplete"] = True
        state = apply_runtime_actions_to_state(
            state,
            actions + conversation_choice_actions_for_ran_events(ran_events),
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
