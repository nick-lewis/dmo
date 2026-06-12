from django.db import transaction
from django.http import JsonResponse

from . import realtime_services
from .experience_services import get_session_current_event
from .http_utils import session_payload
from .models import TutoringSession
from .realtime_services import classifier_has_positive_result
from .runtime import apply_client_ui_state, apply_runtime_actions_to_state
from .runtime_execution import run_action_sequence, run_event_chain
from .serializers import (
    conversation_choice_actions_for_ran_events,
    serialize_experience_event,
    serialize_message,
)


def run_conversation_checks_for_session(user, session_id, client_ui_state):
    session = (
        TutoringSession.objects.filter(
            id=session_id,
            user=user,
            status=TutoringSession.Status.ACTIVE,
        )
        .select_related("experience", "user")
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

    classifier_groups = list(
        current_event.classifier_groups.filter(enabled=True).order_by(
            "sort_order", "created_at"
        )
    )
    checks = list(
        current_event.conversation_checks.filter(enabled=True).order_by(
            "sort_order", "created_at"
        )
    )
    if not classifier_groups and not checks:
        return JsonResponse(
            {
                **session_payload(session),
                "actions": [],
                "checks": [],
                "classifierGroups": [],
                "handled": False,
                "ran": False,
                "ranEvents": [],
                "ranMessages": [],
            }
        )

    evaluated_classifier_groups = []
    runtime_context_preview = dict(session.runtime_context or {})
    for group in classifier_groups:
        session.runtime_context = runtime_context_preview
        group_payload, group_error = realtime_services.evaluate_classifier_group(
            session,
            current_event,
            group,
            runtime_context_preview,
            classifier_evaluator=realtime_services.evaluate_event_classifier,
        )
        if group_error:
            return JsonResponse({"detail": group_error}, status=502)

        evaluated_classifier_groups.append(group_payload)
        if group.result_context_key:
            runtime_context_preview[group.result_context_key] = group_payload[
                "results"
            ]
        if group.handler_actions or group.triggers_event:
            break

    actions = []
    messages = []
    ran_events = []
    classifier_results = []
    handled = False

    if evaluated_classifier_groups:
        with transaction.atomic():
            session = (
                TutoringSession.objects.select_for_update()
                .filter(
                    id=session_id,
                    user=user,
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
                return JsonResponse(
                    {"detail": "Current event not found."},
                    status=404,
                )

            state = dict(session.runtime_state or {})
            state = apply_client_ui_state(state, client_ui_state)
            runtime_context = dict(session.runtime_context or {})

            for group_payload in evaluated_classifier_groups:
                group = group_payload["group"]
                results = group_payload["results"]
                group_actions = group_payload["actions"]
                actions.extend(group_actions)
                classifier_results.append(
                    {
                        "classifierGroupId": str(group.id),
                        "classifierGroupTitle": group.title,
                        "resultContextKey": group.result_context_key,
                        "results": results,
                        "skipped": bool(group_payload.get("skipped")),
                    }
                )

                if group.result_context_key:
                    runtime_context[group.result_context_key] = results
                    session.runtime_context = runtime_context

                if group_payload.get("skipped"):
                    continue

                handler_next_event_slug = ""
                handler_messages = []
                if group.handler_actions:
                    (
                        handler_actions,
                        handler_messages,
                        handler_next_event_slug,
                    ) = run_action_sequence(
                        session,
                        current_event,
                        group.handler_actions,
                        client_ui_state=client_ui_state,
                        source="classifier-group-action",
                        metadata={
                            "classifierGroupId": str(group.id),
                            "classifierGroupTitle": group.title,
                        },
                    )
                    actions.extend(handler_actions)
                    messages.extend(handler_messages)
                    runtime_context = dict(session.runtime_context or {})

                next_event_slug = handler_next_event_slug
                if (
                    not next_event_slug
                    and group.triggers_event
                    and any(
                        classifier_has_positive_result(result)
                        for result in results.values()
                    )
                ):
                    next_event_slug = group.triggers_event

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
                        (
                            step_actions,
                            event_messages,
                            ran_events,
                            state,
                        ) = run_event_chain(
                            session,
                            next_event,
                            client_ui_state=client_ui_state,
                            state=state,
                        )
                        actions.extend(step_actions)
                        messages.extend(event_messages)

                handled = bool(next_event_slug or handler_messages)
                if handled:
                    break

            state = apply_runtime_actions_to_state(
                state,
                actions + conversation_choice_actions_for_ran_events(ran_events),
                clear_buttons=handled,
            )
            session.runtime_state = state
            session.save(
                update_fields=["runtime_context", "runtime_state", "updated_at"]
            )

    if handled or not checks:
        return JsonResponse(
            {
                **session_payload(session),
                "actions": actions,
                "checks": [],
                "classifierGroups": classifier_results,
                "handled": handled,
                "ran": bool(ran_events),
                "ranEvents": [
                    serialize_experience_event(ran_event)
                    for ran_event in ran_events
                ],
                "ranMessages": [serialize_message(message) for message in messages],
            }
        )

    session.refresh_from_db()
    current_event = get_session_current_event(session)
    evaluated_checks = []
    runtime_context_preview = dict(session.runtime_context or {})
    for check in checks:
        session.runtime_context = runtime_context_preview
        result_payload, result_error = realtime_services.evaluate_conversation_check(
            session,
            check,
        )
        if result_error:
            return JsonResponse({"detail": result_error}, status=502)

        result = bool(result_payload["result"])
        reason = result_payload.get("reason", "")
        if check.result_context_key:
            runtime_context_preview[check.result_context_key] = (
                "true" if result else "false"
            )

        check_action = {
            "checkId": str(check.id),
            "checkTitle": check.title,
            "eventId": str(current_event.id),
            "handlerActionCount": len(check.handler_actions or []),
            "handlerMessageCount": 0,
            "handled": False,
            "reason": reason,
            "result": result,
            "resultContextKey": check.result_context_key,
            "triggersEvent": check.triggers_event,
            "type": "conversation_check_result",
        }
        evaluated_checks.append((check, check_action, result))
        if result and (check.handler_actions or check.triggers_event):
            break

    with transaction.atomic():
        session = (
            TutoringSession.objects.select_for_update()
            .filter(
                id=session_id,
                user=user,
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

        state = dict(session.runtime_state or {})
        state = apply_client_ui_state(state, client_ui_state)
        runtime_context = dict(session.runtime_context or {})
        check_results = []

        for check, check_action, result in evaluated_checks:
            if check.result_context_key:
                runtime_context[check.result_context_key] = (
                    "true" if result else "false"
                )
                session.runtime_context = runtime_context

            actions.append(check_action)
            check_results.append(check_action)

            if not result:
                continue

            handler_next_event_slug = ""
            handler_messages = []
            if check.handler_actions:
                handler_actions, handler_messages, handler_next_event_slug = (
                    run_action_sequence(
                        session,
                        current_event,
                        check.handler_actions,
                        client_ui_state=client_ui_state,
                        source="conversation-check-action",
                        metadata={
                            "checkId": str(check.id),
                            "checkTitle": check.title,
                        },
                    )
                )
                actions.extend(handler_actions)
                messages.extend(handler_messages)

            next_event_slug = handler_next_event_slug or check.triggers_event
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

            handled = bool(next_event_slug or handler_messages)
            check_action["handled"] = handled
            check_action["handlerMessageCount"] = len(handler_messages)
            check_action["triggersEvent"] = next_event_slug
            if handled:
                break

        state = apply_runtime_actions_to_state(
            state,
            actions + conversation_choice_actions_for_ran_events(ran_events),
            clear_buttons=handled,
        )
        session.runtime_state = state
        session.save(update_fields=["runtime_context", "runtime_state", "updated_at"])

    return JsonResponse(
        {
            **session_payload(session),
            "actions": actions,
            "checks": check_results,
            "classifierGroups": classifier_results,
            "handled": handled,
            "ran": bool(ran_events),
            "ranEvents": [
                serialize_experience_event(ran_event) for ran_event in ran_events
            ],
            "ranMessages": [serialize_message(message) for message in messages],
        }
    )
