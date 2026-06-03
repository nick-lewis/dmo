from django.db.models import Max
from django.utils import timezone

from .checkpoints import (
    checkpoint_recording_mode,
    restore_checkpoint_messages,
    save_event_entry_checkpoint,
)
from .models import (
    EventActionStep,
    ExperienceEventCheckpoint,
    SessionMessage,
    TutoringSession,
)
from .notebook import (
    NOTEBOOK_CONTEXT_KEY,
    notebook_context_snapshot,
    normalize_notebook,
)
from .runtime import (
    apply_runtime_context_action,
    condition_matches,
    normalize_choice_icon_background,
    normalize_runtime_value,
    render_context_template,
    set_runtime_current_event,
)
from .script_audio_services import cached_script_audio_payload
from .script_markers import (
    build_interactive_action,
    parse_script_markers,
    resolve_script_marker_action,
)
from .serializers import event_choice_icon_background, serialize_message
MAX_EVENT_CHAIN_DEPTH = 12


def parse_client_ui_state(value):
    if isinstance(value, dict):
        return value
    return {}


def step_condition_matches(step, runtime_context):
    return condition_matches(step.condition, runtime_context)


def action_step_from_model(step):
    return {
        "actionType": step.action_type,
        "condition": step.condition or {},
        "config": step.config or {},
        "enabled": step.enabled,
        "id": str(step.id),
        "label": step.label,
        "sortOrder": step.sort_order,
    }


def create_message_for_runtime(session, role, content, metadata=None):
    next_sequence = (
        SessionMessage.objects.filter(session=session).aggregate(Max("sequence"))[
            "sequence__max"
        ]
        or 0
    ) + 1
    return SessionMessage.objects.create(
        session=session,
        role=role,
        content=content,
        sequence=next_sequence,
        metadata=metadata or {},
    )


def create_runtime_session_for_experience(user, experience, data):
    recording_mode = checkpoint_recording_mode(data.get("recordingMode"))
    event_id = str(data.get("eventId", "") or "").strip()
    checkpoint_id = str(data.get("checkpointId", "") or "").strip()
    launch_event = None
    checkpoint = None
    runtime_context = {}
    runtime_state = {
        "checkpointRecordingMode": recording_mode,
    }
    messages_to_restore = []

    if checkpoint_id:
        checkpoint = (
            ExperienceEventCheckpoint.objects.select_related("event", "experience")
            .filter(
                id=checkpoint_id,
                experience=experience,
            )
            .first()
        )
        if not checkpoint:
            return None, "Saved state not found.", 404
        launch_event = checkpoint.event
        payload = checkpoint.payload if isinstance(checkpoint.payload, dict) else {}
        runtime_context = dict(payload.get("runtimeContext") or {})
        runtime_state = dict(payload.get("runtimeState") or {})
        messages_to_restore = payload.get("messages") or []
    elif event_id:
        launch_event = experience.events.filter(id=event_id).first()
        if not launch_event:
            return None, "Event not found.", 404

    if launch_event:
        runtime_state = set_runtime_current_event(runtime_state, launch_event)
        runtime_state["editorLaunch"] = {
            "checkpointId": str(checkpoint.id) if checkpoint else "",
            "eventId": str(launch_event.id),
            "eventSlug": launch_event.slug,
            "recordingMode": recording_mode,
            "startedAt": timezone.now().isoformat(),
        }
    runtime_state["checkpointRecordingMode"] = recording_mode

    session = TutoringSession.objects.create(
        user=user,
        experience=experience,
        runtime_context=runtime_context,
        runtime_state=runtime_state,
    )
    restore_checkpoint_messages(session, messages_to_restore)
    return session, "", 201


def run_action_sequence(
    session,
    event,
    steps,
    client_ui_state=None,
    source="event-action",
    metadata=None,
):
    actions = []
    messages = []
    next_event_slug = ""
    runtime_context = dict(session.runtime_context or {})
    client_ui_state = parse_client_ui_state(client_ui_state)
    metadata = dict(metadata or {})

    sorted_steps = sorted(
        steps,
        key=lambda step: int(step.get("sortOrder", 0) or 0),
    )

    for step in sorted_steps:
        if not step.get("enabled", True):
            continue

        action_type = str(step.get("actionType", "")).strip()
        step_id = str(step.get("id", "")).strip()
        config = step.get("config") if isinstance(step.get("config"), dict) else {}

        if not condition_matches(step.get("condition"), runtime_context):
            actions.append(
                {
                    "type": "skipped",
                    "actionType": action_type,
                    "eventId": str(event.id),
                    "reason": "condition_not_met",
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.SCRIPT:
            raw_text = render_context_template(
                config.get("text", ""),
                runtime_context,
            ).strip()
            text, markers = parse_script_markers(raw_text)
            script_cues = []
            for marker in markers:
                action = resolve_script_marker_action(marker, config, runtime_context)
                if not action:
                    continue
                action.update(
                    {
                        "eventId": str(event.id),
                        "source": source,
                        "stepId": step_id,
                        **metadata,
                    }
                )
                script_cues.append(
                    {
                        "action": action,
                        "progress": marker.get("progress", 0),
                        **({"time": marker["time"]} if "time" in marker else {}),
                        "wordIndex": marker.get("wordIndex", 0),
                    }
                )
            if not text:
                actions.extend(cue["action"] for cue in script_cues)
                continue

            message = create_message_for_runtime(
                session=session,
                role=SessionMessage.Role.ASSISTANT,
                content=text,
                metadata={
                    "actionType": action_type,
                    "eventId": str(event.id),
                    "source": source,
                    "scriptAudio": cached_script_audio_payload(
                        session,
                        text,
                        script_cues,
                    ),
                    "scriptCues": script_cues,
                    "stepId": step_id,
                    **metadata,
                },
            )
            script_audio = dict(message.metadata.get("scriptAudio") or {})
            if script_audio:
                script_audio["messageId"] = str(message.id)
                message.metadata["scriptAudio"] = script_audio
                message.save(update_fields=["metadata"])
            messages.append(message)
            script_audio_metadata = dict(message.metadata.get("scriptAudio") or {})
            actions.append(
                {
                    "type": "chat_message",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "message": serialize_message(message),
                    "scriptAudioCached": bool(script_audio_metadata.get("audioUrl")),
                    "scriptCueCount": len(script_cues),
                    "scriptCueTypes": [
                        str(cue.get("action", {}).get("type", "") or "")
                        for cue in script_cues
                        if isinstance(cue.get("action"), dict)
                    ],
                    "scriptWordTiming": bool(script_audio_metadata.get("scriptWords")),
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.SET_CONTEXT:
            key = str(config.get("key", "")).strip()
            if not key:
                continue
            action = {
                "type": "set_context",
                "eventId": str(event.id),
                "stepId": step_id,
                "key": key,
                "value": config.get("value"),
                **metadata,
            }
            runtime_context, applied_action = apply_runtime_context_action(
                runtime_context,
                action,
            )
            if applied_action:
                actions.append(applied_action)
            continue

        if action_type == EventActionStep.ActionType.APPEND_CONTEXT_LIST:
            key = str(config.get("key", "")).strip()
            if not key:
                continue
            action = {
                "type": "append_context_list",
                "eventId": str(event.id),
                "key": key,
                "stepId": step_id,
                "value": config.get("value"),
                **metadata,
            }
            runtime_context, applied_action = apply_runtime_context_action(
                runtime_context,
                action,
            )
            if applied_action:
                actions.append(applied_action)
            continue

        if action_type == EventActionStep.ActionType.GET_UI_STATE:
            state_key = str(config.get("stateKey", "")).strip()
            context_key = str(config.get("contextKey", state_key)).strip()
            if not state_key or not context_key:
                continue
            runtime_context[context_key] = normalize_runtime_value(
                client_ui_state.get(state_key)
            )
            actions.append(
                {
                    "type": "get_ui_state",
                    "contextKey": context_key,
                    "eventId": str(event.id),
                    "stateKey": state_key,
                    "stepId": step_id,
                    "value": runtime_context[context_key],
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.HIGHLIGHT_ON:
            selector = str(config.get("selector", "")).strip()
            if not selector:
                continue
            actions.append(
                {
                    "type": "highlight_on",
                    "color": str(
                        config.get("color", "rgba(59, 130, 246, 0.6)")
                    ),
                    "eventId": str(event.id),
                    "selector": selector,
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.HIGHLIGHT_OFF:
            selector = str(config.get("selector", "")).strip()
            if not selector:
                continue
            actions.append(
                {
                    "type": "highlight_off",
                    "eventId": str(event.id),
                    "selector": selector,
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.INTERACTIVE:
            action = build_interactive_action(
                config=config,
                event_id=str(event.id),
                metadata=metadata,
                runtime_context=runtime_context,
                step_id=step_id,
            )
            if action:
                actions.append(action)
            continue

        if action_type == EventActionStep.ActionType.INTERACTIVE_UPDATE:
            action = build_interactive_action(
                config=config,
                event_id=str(event.id),
                metadata=metadata,
                runtime_context=runtime_context,
                step_id=step_id,
                update=True,
            )
            if action:
                actions.append(action)
            continue

        if action_type == EventActionStep.ActionType.INTERACTIVE_CLEAR:
            actions.append(
                {
                    "type": "interactive_clear",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.PYTHON_NOTEBOOK:
            try:
                notebook = normalize_notebook(config.get("notebook"))
            except ValueError as error:
                actions.append(
                    {
                        "detail": str(error),
                        "eventId": str(event.id),
                        "source": source,
                        "stepId": step_id,
                        "type": "python_notebook_error",
                        **metadata,
                    }
                )
                continue

            runtime_context[NOTEBOOK_CONTEXT_KEY] = notebook_context_snapshot(
                notebook
            )
            actions.append(
                {
                    "eventId": str(event.id),
                    "notebook": notebook,
                    "source": source,
                    "status": "loaded",
                    "stepId": step_id,
                    "type": "python_notebook",
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.CHAT_AVAILABILITY:
            actions.append(
                {
                    "enabled": config.get("enabled") is not False,
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "type": "chat_availability",
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.SET_UI_TRIGGER:
            selector = str(config.get("selector", "")).strip()
            triggers_event = str(config.get("triggersEvent", "")).strip()
            if not selector or not triggers_event:
                continue
            actions.append(
                {
                    "type": "set_ui_trigger",
                    "eventId": str(event.id),
                    "selector": selector,
                    "stepId": step_id,
                    "triggersEvent": triggers_event,
                    **metadata,
                }
            )
            continue

        if action_type == EventActionStep.ActionType.GOTO_EVENT:
            triggers_event = str(config.get("triggersEvent", "")).strip()
            if not triggers_event:
                continue
            next_event_slug = triggers_event
            actions.append(
                {
                    "type": "goto_event",
                    "eventId": str(event.id),
                    "stepId": step_id,
                    "triggersEvent": triggers_event,
                    **metadata,
                }
            )
            break

        if action_type == EventActionStep.ActionType.BUTTON_CHOICE:
            label = str(config.get("label", "")).strip()
            triggers_event = str(config.get("triggersEvent", "")).strip()
            if not label or not triggers_event:
                continue
            actions.append(
                {
                    "type": "button_choice",
                    "eventId": str(event.id),
                    "iconBackground": normalize_choice_icon_background(
                        config.get("iconBackground"),
                        event_choice_icon_background(event),
                    ),
                    "iconPath": str(config.get("iconPath", "")).strip(),
                    "label": label,
                    "stepId": step_id,
                    "triggersEvent": triggers_event,
                    **metadata,
                }
            )

    session.runtime_context = runtime_context
    return actions, messages, next_event_slug


def run_event_steps(session, event, client_ui_state=None):
    steps = [
        action_step_from_model(step)
        for step in event.steps.filter(enabled=True).order_by("sort_order", "created_at")
    ]
    return run_action_sequence(
        session,
        event,
        steps,
        client_ui_state=client_ui_state,
        source="event-action",
    )


def run_event_chain(session, first_event, client_ui_state=None, state=None):
    actions = []
    messages = []
    ran_events = []
    state = dict(state or {})
    event_runs = dict(state.get("eventRuns") or {})
    event = first_event
    current_event = first_event

    for _ in range(MAX_EVENT_CHAIN_DEPTH):
        current_event = event
        run_key = str(event.id)
        if event_runs.get(run_key, {}).get("status") == "complete":
            actions.append(
                {
                    "type": "event_skipped",
                    "eventId": str(event.id),
                    "reason": "already_complete",
                }
            )
            break

        save_event_entry_checkpoint(
            session,
            event,
            state=state,
            client_ui_state=client_ui_state,
        )

        step_actions, step_messages, next_event_slug = run_event_steps(
            session,
            event,
            client_ui_state=client_ui_state,
        )
        actions.extend(step_actions)
        messages.extend(step_messages)
        ran_events.append(event)
        event_runs[run_key] = {
            "completedAt": timezone.now().isoformat(),
            "status": "complete",
        }

        if not next_event_slug:
            break

        next_event = session.experience.events.filter(slug=next_event_slug).first()
        if not next_event:
            actions.append(
                {
                    "type": "transition_missing",
                    "eventId": str(event.id),
                    "triggersEvent": next_event_slug,
                }
            )
            break

        event = next_event
    else:
        actions.append(
            {
                "type": "transition_depth_exceeded",
                "eventId": str(event.id),
                "limit": MAX_EVENT_CHAIN_DEPTH,
            }
        )

    state["eventRuns"] = event_runs
    if current_event:
        state = set_runtime_current_event(state, current_event)
    return actions, messages, ran_events, state
