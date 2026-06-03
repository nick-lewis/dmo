import json

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .http_utils import auth_required_response, parse_json_body, session_payload
from .main_panel_apps import interactive_id_error, normalized_interactive_config
from .models import TutoringSession
from .runtime import (
    apply_runtime_actions_to_context,
    apply_runtime_actions_to_state,
    emitted_transition_slug,
)
from .runtime_execution import run_event_chain
from .serializers import (
    conversation_choice_actions_for_ran_events,
    serialize_experience_event,
    serialize_message,
)
from .validation import normalize_emitted_runtime_actions


@require_POST
def update_session_interactive(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    interactive_id = str(data.get("interactiveId", "")).strip()
    id_error = interactive_id_error(interactive_id)
    if id_error:
        return JsonResponse({"detail": id_error}, status=400)

    next_state = normalized_interactive_config(data.get("state"))
    if len(json.dumps(next_state, ensure_ascii=True)) > 12000:
        return JsonResponse({"detail": "Main-panel app state is too large."}, status=400)

    context_values = normalized_interactive_config(data.get("context"))
    if len(json.dumps(context_values, ensure_ascii=True)) > 12000:
        return JsonResponse({"detail": "Main-panel app context is too large."}, status=400)
    for key in context_values:
        if not isinstance(key, str) or not key.strip():
            return JsonResponse({"detail": "Context keys must be named."}, status=400)
        if len(key) > 120:
            return JsonResponse({"detail": "Context key is too long."}, status=400)

    emitted_actions = data.get("actions")
    if not isinstance(emitted_actions, list):
        emitted_actions = []
    if len(emitted_actions) > 24:
        return JsonResponse({"detail": "Too many emitted actions."}, status=400)
    if len(json.dumps(emitted_actions, ensure_ascii=True)) > 16000:
        return JsonResponse({"detail": "Emitted actions are too large."}, status=400)
    emitted_actions, rejected_emitted_actions = normalize_emitted_runtime_actions(
        emitted_actions
    )

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

        state = dict(session.runtime_state or {})
        ui_runtime = dict(state.get("uiRuntime") or {})
        active_interactive = ui_runtime.get("interactive")
        if not isinstance(active_interactive, dict):
            return JsonResponse(
                {"detail": "No main-panel app is active."},
                status=400,
            )
        active_id = str(active_interactive.get("interactiveId", "")).strip()
        if active_id != interactive_id:
            return JsonResponse(
                {"detail": "That main-panel app is no longer active."},
                status=409,
            )

        actions = [
            {
                "interactiveId": interactive_id,
                "state": next_state,
                "type": "interactive_state",
            }
        ]

        for key, value in context_values.items():
            context_key = key.strip()
            actions.append(
                {
                    "key": context_key,
                    "type": "set_context",
                    "value": value,
                }
            )

        actions.extend(emitted_actions)
        actions.extend(rejected_emitted_actions)
        runtime_context = apply_runtime_actions_to_context(
            session.runtime_context,
            actions,
        )
        session.runtime_context = runtime_context

        ran_events = []
        ran_messages = []
        transition_slug = emitted_transition_slug(actions)
        if transition_slug and not session.experience:
            actions.append(
                {
                    "type": "transition_missing",
                    "triggersEvent": transition_slug,
                }
            )
        elif transition_slug:
            transition_event = session.experience.events.filter(
                slug=transition_slug,
            ).first()
            if transition_event:
                (
                    transition_actions,
                    ran_messages,
                    ran_events,
                    state,
                ) = run_event_chain(
                    session,
                    transition_event,
                    state=state,
                )
                actions.extend(transition_actions)
            else:
                actions.append(
                    {
                        "type": "transition_missing",
                        "triggersEvent": transition_slug,
                    }
                )

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
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in ran_messages],
        }
    )
