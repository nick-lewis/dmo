from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .experience_services import get_session_current_event
from .http_utils import auth_required_response, parse_json_body, session_payload
from .models import TutoringSession
from .realtime_services import parse_tool_arguments
from .runtime import apply_client_side_panel_state, apply_runtime_actions_to_state
from .runtime_execution import parse_client_ui_state, run_action_sequence, run_event_chain
from .serializers import (
    conversation_choice_actions_for_ran_events,
    serialize_experience_event,
    serialize_message,
    tool_capture_save_map,
)
from .validation import validate_chat_tool_name


@require_POST
def run_session_chat_tool(request, session_id):
    auth_response = auth_required_response(request)
    if auth_response:
        return auth_response

    data = parse_json_body(request)
    if data is None:
        return JsonResponse({"detail": "Invalid JSON."}, status=400)

    tool_name, name_error = validate_chat_tool_name(data.get("toolName"))
    if name_error:
        return JsonResponse({"detail": name_error}, status=400)

    arguments, arguments_error = parse_tool_arguments(data.get("arguments", {}))
    if arguments_error:
        return JsonResponse({"detail": arguments_error}, status=400)

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

        current_event = get_session_current_event(session)
        if not current_event:
            return JsonResponse({"detail": "Current event not found."}, status=404)

        tool = current_event.chat_tools.filter(
            enabled=True,
            name=tool_name,
        ).first()
        if not tool:
            return JsonResponse({"detail": "Chat tool is not available."}, status=400)

        state = dict(session.runtime_state or {})
        state = apply_client_side_panel_state(state, client_ui_state)
        runtime_context = dict(session.runtime_context or {})
        saved_value = None
        saved_values = {}
        capture_saves = tool_capture_save_map(tool)
        if capture_saves:
            for argument_name, context_key in capture_saves.items():
                if argument_name:
                    saved_values[context_key] = arguments.get(argument_name, "")
                else:
                    saved_values[context_key] = arguments
            runtime_context.update(saved_values)
            if len(saved_values) == 1:
                saved_value = next(iter(saved_values.values()))
            else:
                saved_value = saved_values
            session.runtime_context = runtime_context

        actions = [
            {
                "arguments": arguments,
                "eventId": str(current_event.id),
                "handlerActionCount": len(tool.handler_actions or []),
                "saveArgument": tool.save_argument,
                "saveContextKey": tool.save_context_key,
                "savedValue": saved_value,
                "savedValues": saved_values,
                "toolName": tool.name,
                "triggersEvent": tool.triggers_event,
                "type": "chat_tool_call",
            }
        ]
        messages = []
        ran_events = []
        handler_next_event_slug = ""

        if tool.handler_actions:
            handler_actions, messages, handler_next_event_slug = run_action_sequence(
                session,
                current_event,
                tool.handler_actions,
                client_ui_state=client_ui_state,
                source="conversation-tool-action",
                metadata={"toolName": tool.name, "toolId": str(tool.id)},
            )
            actions.extend(handler_actions)

        next_event_slug = handler_next_event_slug or tool.triggers_event
        if next_event_slug:
            next_event = session.experience.events.filter(
                slug=next_event_slug
            ).first()
            if not next_event:
                actions.append(
                    {
                        "type": "transition_missing",
                        "eventId": str(current_event.id),
                        "triggersEvent": next_event_slug,
                    }
                )
            else:
                step_actions, event_messages, ran_events, state = run_event_chain(
                    session,
                    next_event,
                    client_ui_state=client_ui_state,
                    state=state,
                )
                actions.extend(step_actions)
                messages.extend(event_messages)

        state = apply_runtime_actions_to_state(
            state,
            actions + conversation_choice_actions_for_ran_events(ran_events),
            clear_buttons=True,
        )
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "event": serialize_experience_event(get_session_current_event(session)),
            "ran": bool(ran_events),
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )
