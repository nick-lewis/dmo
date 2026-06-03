import hashlib
import json

from django.utils import timezone

from .models import ExperienceEventCheckpoint, SessionMessage


CHECKPOINT_RECORDING_OFF = "off"
CHECKPOINT_RECORDING_STRUCTURAL = "structural"
CHECKPOINT_RECORDING_FULL = "full"
CHECKPOINT_RECORDING_MODES = {
    CHECKPOINT_RECORDING_OFF,
    CHECKPOINT_RECORDING_STRUCTURAL,
    CHECKPOINT_RECORDING_FULL,
}
RUNTIME_DEBUG_VALUE_LIMIT = 600


def compact_runtime_debug_value(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:RUNTIME_DEBUG_VALUE_LIMIT]

    try:
        compact = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    except (TypeError, ValueError):
        compact = str(value)
    if len(compact) > RUNTIME_DEBUG_VALUE_LIMIT:
        compact = f"{compact[: RUNTIME_DEBUG_VALUE_LIMIT - 3]}..."
    return compact


def checkpoint_recording_mode(value, default=CHECKPOINT_RECORDING_STRUCTURAL):
    mode = str(value or default).strip().lower()
    return mode if mode in CHECKPOINT_RECORDING_MODES else default


def runtime_state_without_checkpoint_noise(state):
    if not isinstance(state, dict):
        return {}

    next_state = {}
    for key, value in state.items():
        if key in {"runtimeDebug", "editorLaunch", "checkpointRecordingMode"}:
            continue
        if key == "eventRuns" and isinstance(value, dict):
            next_state[key] = {
                str(event_id): {
                    inner_key: inner_value
                    for inner_key, inner_value in dict(run_value or {}).items()
                    if inner_key != "completedAt"
                }
                for event_id, run_value in value.items()
                if isinstance(run_value, dict)
            }
            continue
        next_state[key] = value
    return next_state


def checkpoint_fingerprint_payload(payload, mode):
    runtime_state = dict(payload.get("runtimeState") or {})
    base = {
        "clientUiState": payload.get("clientUiState") or {},
        "eventId": payload.get("eventId"),
        "runtimeContext": payload.get("runtimeContext") or {},
        "runtimeState": runtime_state_without_checkpoint_noise(runtime_state),
    }
    if mode == CHECKPOINT_RECORDING_FULL:
        base["messages"] = [
            {
                "content": message.get("content", ""),
                "metadata": message.get("metadata") or {},
                "role": message.get("role", ""),
                "sequence": message.get("sequence", 0),
            }
            for message in payload.get("messages") or []
            if isinstance(message, dict)
        ]
    return base


def checkpoint_fingerprint(payload, mode):
    encoded = json.dumps(
        checkpoint_fingerprint_payload(payload, mode),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def checkpoint_context_summary(runtime_context):
    if not isinstance(runtime_context, dict):
        return []
    entries = []
    for key in sorted(runtime_context.keys()):
        if str(key).startswith("_"):
            continue
        value = runtime_context[key]
        entries.append(
            {
                "key": str(key),
                "value": compact_runtime_debug_value(value),
            }
        )
        if len(entries) >= 5:
            break
    return entries


def checkpoint_summary(payload, mode):
    runtime_context = payload.get("runtimeContext") or {}
    runtime_state = payload.get("runtimeState") or {}
    ui_runtime = (
        runtime_state.get("uiRuntime")
        if isinstance(runtime_state, dict) and isinstance(runtime_state.get("uiRuntime"), dict)
        else {}
    )
    slide = ui_runtime.get("slide") if isinstance(ui_runtime, dict) else None
    slide_ref = ""
    if isinstance(slide, dict):
        slide_ref = str(slide.get("slideRef", "") or "")

    messages = payload.get("messages") or []
    context_entries = checkpoint_context_summary(runtime_context)
    context_label = ", ".join(
        f"{entry['key']}={compact_runtime_debug_value(entry['value'])}"
        for entry in context_entries[:3]
    )
    if slide_ref:
        context_label = (
            f"{context_label}, slide={slide_ref}" if context_label else f"slide={slide_ref}"
        )
    label = context_label or "cold state"
    if messages:
        last_message = next(
            (
                message
                for message in reversed(messages)
                if isinstance(message, dict)
                and message.get("role") in {SessionMessage.Role.USER, SessionMessage.Role.ASSISTANT}
                and str(message.get("content", "") or "").strip()
            ),
            None,
        )
        if last_message:
            content = str(last_message.get("content", "") or "").strip()
            label = f"{label} · chat: {content[:80]}"

    return {
        "context": context_entries,
        "label": label,
        "messageCount": len(messages) if isinstance(messages, list) else 0,
        "mode": mode,
        "slideRef": slide_ref,
    }


def checkpoint_messages_payload(session):
    from .serializers import serialize_message

    return [
        serialize_message(message)
        for message in session.messages.order_by("sequence", "created_at")
    ]


def restore_checkpoint_messages(session, messages):
    if not isinstance(messages, list):
        return

    next_sequence = 1
    used_sequences = set()
    valid_roles = {choice[0] for choice in SessionMessage.Role.choices}
    for item in messages:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "") or "")
        if role not in valid_roles:
            continue
        content = str(item.get("content", "") or "")
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        sequence = item.get("sequence")
        if (
            not isinstance(sequence, int)
            or sequence < 1
            or sequence in used_sequences
        ):
            sequence = next_sequence
        used_sequences.add(sequence)
        next_sequence = max(next_sequence, sequence + 1)
        SessionMessage.objects.create(
            session=session,
            role=role,
            content=content,
            sequence=sequence,
            metadata=metadata,
        )


def checkpoint_runtime_state_for_event(session, event, state=None):
    entry_state = dict(state or session.runtime_state or {})
    entry_state["currentEventId"] = str(event.id)
    entry_state["currentEventSlug"] = event.slug
    return entry_state


def checkpoint_payload(session, event, state=None, client_ui_state=None):
    return {
        "clientUiState": client_ui_state or {},
        "eventId": str(event.id),
        "eventSlug": event.slug,
        "eventTitle": event.title,
        "experienceId": str(event.experience_id),
        "messages": checkpoint_messages_payload(session),
        "recordedAt": timezone.now().isoformat(),
        "runtimeContext": session.runtime_context or {},
        "runtimeState": checkpoint_runtime_state_for_event(session, event, state),
        "sourceSessionId": str(session.id),
        "version": 1,
    }


def save_event_entry_checkpoint(session, event, state=None, client_ui_state=None):
    state = dict(state or session.runtime_state or {})
    mode = checkpoint_recording_mode(
        state.get("checkpointRecordingMode"),
        CHECKPOINT_RECORDING_OFF,
    )
    if mode == CHECKPOINT_RECORDING_OFF:
        return None
    if not session.experience or session.experience_id != event.experience_id:
        return None

    payload = checkpoint_payload(
        session,
        event,
        state=state,
        client_ui_state=client_ui_state,
    )
    fingerprint = checkpoint_fingerprint(payload, mode)
    summary = checkpoint_summary(payload, mode)
    checkpoint, created = ExperienceEventCheckpoint.objects.get_or_create(
        event=event,
        fingerprint=fingerprint,
        fingerprint_mode=mode,
        defaults={
            "experience": event.experience,
            "payload": payload,
            "source_session": session,
            "summary": summary,
        },
    )
    if not created:
        checkpoint.experience = event.experience
        checkpoint.payload = payload
        checkpoint.source_session = session
        checkpoint.summary = summary
        checkpoint.run_count += 1
        checkpoint.save(
            update_fields=[
                "experience",
                "last_used_at",
                "payload",
                "run_count",
                "source_session",
                "summary",
            ]
        )
    return checkpoint
