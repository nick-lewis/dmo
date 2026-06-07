import hashlib
import json
import re

from django.utils import timezone

from .checkpoints import compact_runtime_debug_value
from .main_panel_apps import normalized_interactive_config
from .notebook import normalize_notebook


RUNTIME_ACTION_TRACE_LIMIT = 80
RUNTIME_TRANSITION_TRACE_LIMIT = 40
DEFAULT_CHOICE_ICON_BACKGROUND = "#f8ded8"
INITIAL_SCRIPT_CUE_PROGRESS = 0.001


def normalize_runtime_side_image_slot(value):
    slot = str(value or "").strip().lower()
    if slot in {"agent", "avatar", "left", "main", "tutor"}:
        return "left"
    if slot in {"right", "side"}:
        return "right"
    return ""


def normalize_runtime_side_image_scale(value):
    try:
        scale = float(str(value or "").strip())
    except ValueError:
        return 1.0
    if scale <= 0:
        return 1.0
    return min(max(scale, 0.2), 3.0)


def normalize_runtime_side_images(value):
    images = {}
    if not isinstance(value, dict):
        return images

    for fallback_slot, raw_image in value.items():
        if isinstance(raw_image, dict):
            slot = normalize_runtime_side_image_slot(
                raw_image.get("slot") or fallback_slot
            )
            image_path = str(raw_image.get("imagePath", "") or "").strip()
            visible = raw_image.get("visible", True)
            scale = normalize_runtime_side_image_scale(raw_image.get("scale"))
        else:
            slot = normalize_runtime_side_image_slot(fallback_slot)
            image_path = str(raw_image or "").strip()
            visible = True
            scale = 1.0
        if not slot:
            continue
        if not isinstance(visible, bool):
            visible = True
        images[slot] = {
            "imagePath": image_path,
            "slot": slot,
            "visible": visible,
        }
        if abs(scale - 1.0) > 0.001:
            images[slot]["scale"] = round(scale, 2)
    return images


def normalize_choice_icon_background(value, fallback=DEFAULT_CHOICE_ICON_BACKGROUND):
    text = str(value if value is not None else fallback).strip()[:40]
    if not text:
        text = fallback
    if re.fullmatch(r"#[0-9a-fA-F]{6}", text):
        return text.lower()
    return fallback


def normalize_runtime_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    return str(value)


def runtime_context_lookup(runtime_context, key):
    key = str(key or "").strip()
    if not key:
        return False, None

    current = runtime_context
    for part in key.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
            continue
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (TypeError, ValueError, IndexError):
                return False, None
            continue
        return False, None
    return True, current


def runtime_context_value(runtime_context, key):
    _, value = runtime_context_lookup(runtime_context, key)
    return value


def values_match(actual, expected):
    if actual == expected:
        return True
    return normalize_runtime_value(actual) == normalize_runtime_value(expected)


def value_contains(container, expected):
    if isinstance(container, list):
        return any(values_match(item, expected) for item in container)
    if isinstance(container, dict):
        return str(expected) in container
    if container is None:
        return False
    return str(expected) in normalize_runtime_value(container)


def runtime_value_is_truthy(value):
    if isinstance(value, (list, dict, str)):
        return bool(value)
    return bool(value)


def render_context_template(text, runtime_context):
    text = str(text or "")
    if "{{" not in text:
        return text

    conditional_pattern = re.compile(
        r"\{\{#if\s+([^{}]+?)\s*\}\}(.*?)"
        r"(?:\{\{else\}\}(.*?))?\{\{/if\}\}",
        flags=re.DOTALL,
    )

    def replace_conditional(match):
        key = match.group(1).strip()
        if_content = match.group(2)
        else_content = match.group(3) or ""
        _, value = runtime_context_lookup(runtime_context, key)
        selected = if_content if runtime_value_is_truthy(value) else else_content
        return render_context_template(selected, runtime_context)

    previous_text = None
    while previous_text != text:
        previous_text = text
        text = conditional_pattern.sub(replace_conditional, text)

    def replace_match(match):
        key = match.group(1).strip()
        exists, value = runtime_context_lookup(runtime_context, key)
        if not exists:
            return ""
        if isinstance(value, list):
            return ", ".join(normalize_runtime_value(item) for item in value)
        if isinstance(value, dict):
            return json.dumps(value, ensure_ascii=True, sort_keys=True)
        return normalize_runtime_value(value)

    return re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", replace_match, text)


def runtime_context_action_key(action):
    raw_key = action.get("key", "")
    if not isinstance(raw_key, str):
        return ""
    key = raw_key.strip()
    if not key or len(key) > 120:
        return ""
    return key


def condition_matches(condition, runtime_context):
    condition = condition or {}
    condition_type = condition.get("type") or "always"
    if condition_type == "always":
        return True

    if condition_type == "context_equals":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return exists and values_match(actual_value, condition.get("value", ""))

    if condition_type == "context_not_equals":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return not exists or not values_match(actual_value, condition.get("value", ""))

    if condition_type == "context_contains":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return exists and value_contains(actual_value, condition.get("value", ""))

    if condition_type == "context_not_contains":
        key = str(condition.get("key", "")).strip()
        exists, actual_value = runtime_context_lookup(runtime_context, key)
        return not exists or not value_contains(actual_value, condition.get("value", ""))

    if condition_type == "context_exists":
        key = str(condition.get("key", "")).strip()
        exists, _ = runtime_context_lookup(runtime_context, key)
        return exists

    if condition_type == "context_missing":
        key = str(condition.get("key", "")).strip()
        exists, _ = runtime_context_lookup(runtime_context, key)
        return not exists

    if condition_type == "all":
        conditions = condition.get("conditions")
        if not isinstance(conditions, list):
            return False
        return all(condition_matches(item, runtime_context) for item in conditions)

    if condition_type == "any":
        conditions = condition.get("conditions")
        if not isinstance(conditions, list):
            return False
        return any(condition_matches(item, runtime_context) for item in conditions)

    return False


def apply_runtime_context_action(runtime_context, action):
    next_context = dict(runtime_context or {})
    if not isinstance(action, dict):
        return next_context, None

    action_type = str(action.get("type", "") or "")
    key = runtime_context_action_key(action)
    if not key:
        return next_context, None

    applied_action = dict(action)
    applied_action["key"] = key

    if action_type == "set_context":
        next_context[key] = action.get("value")
        applied_action["value"] = next_context[key]
        return next_context, applied_action

    if action_type == "append_context_list":
        current_value = next_context.get(key)
        if isinstance(current_value, list):
            next_values = list(current_value)
        elif current_value in (None, ""):
            next_values = []
        else:
            next_values = [current_value]

        next_value = action.get("value")
        appended = False
        if not any(values_match(item, next_value) for item in next_values):
            next_values.append(next_value)
            appended = True
        next_context[key] = next_values
        applied_action["appended"] = appended
        applied_action["list"] = next_values
        applied_action["value"] = next_value
        return next_context, applied_action

    return next_context, None


def apply_runtime_actions_to_context(runtime_context, actions):
    next_context = dict(runtime_context or {})
    for action in actions:
        next_context, applied_action = apply_runtime_context_action(
            next_context,
            action,
        )
        if applied_action is not None:
            action.update(applied_action)

    return next_context


def emitted_transition_slug(actions):
    for action in actions:
        if not isinstance(action, dict):
            continue
        if action.get("type") != "goto_event":
            continue
        triggers_event = str(action.get("triggersEvent", "") or "").strip()
        if triggers_event:
            return triggers_event
    return ""


def apply_runtime_actions_to_state(
    state,
    actions,
    clear_buttons=False,
    clear_trigger_selector="",
):
    ui_runtime = dict(state.get("uiRuntime") or {})
    buttons = list(ui_runtime.get("buttons") or [])
    highlights = dict(ui_runtime.get("highlights") or {})
    interactive = ui_runtime.get("interactive")
    interactive_state = normalized_interactive_config(
        ui_runtime.get("interactiveState")
    )
    chat_enabled = ui_runtime.get("chatEnabled")
    if not isinstance(chat_enabled, bool):
        chat_enabled = True
    avatar_path = str(ui_runtime.get("avatarPath", "") or "")
    avatar_visible = ui_runtime.get("avatarVisible", True)
    if not isinstance(avatar_visible, bool):
        avatar_visible = True
    images = normalize_runtime_side_images(ui_runtime.get("images"))
    overlays_value = ui_runtime.get("overlays")
    overlays = dict(overlays_value) if isinstance(overlays_value, dict) else {}
    notes_value = ui_runtime.get("notes")
    notes = list(notes_value) if isinstance(notes_value, list) else []
    left_panels_value = ui_runtime.get("leftPanels")
    left_panels = (
        dict(left_panels_value)
        if isinstance(left_panels_value, dict)
        else {}
    )
    slide = ui_runtime.get("slide")
    slide_error = str(ui_runtime.get("slideError", "") or "")
    triggers = list(ui_runtime.get("triggers") or [])

    if clear_buttons:
        buttons = []

    if clear_trigger_selector:
        triggers = [
            trigger
            for trigger in triggers
            if trigger.get("selector") != clear_trigger_selector
        ]

    for action in actions:
        action_type = action.get("type")
        selector = str(action.get("selector", "")).strip()

        if action_type == "gslide":
            slide = {
                "cached": bool(action.get("cached", False)),
                "deckUrl": str(action.get("deckUrl", "")),
                "imageUrl": str(action.get("imageUrl", "")),
                "pageId": str(action.get("pageId", "")),
                "presentationId": str(action.get("presentationId", "")),
                "slideRef": str(action.get("slideRef", "")),
            }
            slide_error = ""
            interactive = None
            interactive_state = {}
            continue

        if action_type == "slide_error":
            slide_error = str(action.get("detail", "Could not load that slide."))
            slide = None
            interactive = None
            interactive_state = {}
            continue

        if action_type == "interactive":
            config = normalized_interactive_config(action.get("config"))
            interactive = {
                "config": config,
                "eventId": str(action.get("eventId", "")),
                "interactiveId": str(action.get("interactiveId", "")),
                "mode": str(action.get("mode", "")),
                "prompt": str(action.get("prompt", "")),
                "stepId": str(action.get("stepId", "")),
                "title": str(action.get("title", "")),
                "triggersEvent": str(action.get("triggersEvent", "")),
            }
            interactive_state = normalized_interactive_config(
                action.get("state", config.get("initialState"))
            )
            slide = None
            slide_error = ""
            continue

        if action_type == "interactive_update" and isinstance(interactive, dict):
            action_state = action.get("state")
            interactive = {
                **interactive,
                "config": {
                    **normalized_interactive_config(interactive.get("config")),
                    **normalized_interactive_config(action.get("config")),
                },
            }
            for key in ("interactiveId", "mode", "prompt", "title", "triggersEvent"):
                if action.get(key):
                    interactive[key] = str(action.get(key, ""))
            if isinstance(action_state, dict):
                interactive_state = normalized_interactive_config(action_state)
            continue

        if action_type == "interactive_state":
            interactive_state = normalized_interactive_config(action.get("state"))
            continue

        if action_type == "interactive_clear":
            interactive = None
            interactive_state = {}
            continue

        if action_type == "python_notebook":
            try:
                left_panels["pythonNotebook"] = normalize_notebook(
                    action.get("notebook")
                )
            except ValueError:
                pass
            continue

        if action_type == "chat_availability":
            chat_enabled = bool(action.get("enabled", True))
            continue

        if action_type == "show_image":
            image_path = str(action.get("imagePath", "") or "").strip()
            if image_path:
                avatar_path = image_path
                avatar_visible = True
                images["left"] = {
                    "imagePath": image_path,
                    "slot": "left",
                    "visible": True,
                }
            continue

        if action_type == "agent_image_visibility":
            avatar_visible = bool(action.get("visible", True))
            left_image = dict(images.get("left") or {})
            images["left"] = {
                "imagePath": str(left_image.get("imagePath") or avatar_path or ""),
                "slot": "left",
                "visible": avatar_visible,
            }
            continue

        if action_type == "side_image":
            slot = normalize_runtime_side_image_slot(
                action.get("slot") or action.get("location")
            )
            if not slot:
                continue
            existing_image = dict(images.get(slot) or {})
            image_path = str(
                action.get("imagePath", existing_image.get("imagePath", "")) or ""
            ).strip()
            visible = action.get("visible", existing_image.get("visible", True))
            if not isinstance(visible, bool):
                visible = True
            if "scale" in action:
                scale = normalize_runtime_side_image_scale(action.get("scale"))
            elif "imagePath" in action:
                scale = 1.0
            else:
                scale = normalize_runtime_side_image_scale(existing_image.get("scale"))
            images[slot] = {
                "imagePath": image_path,
                "slot": slot,
                "visible": visible,
            }
            if abs(scale - 1.0) > 0.001:
                images[slot]["scale"] = round(scale, 2)
            if slot == "left":
                avatar_path = image_path
                avatar_visible = visible
            continue

        if action_type == "overlay":
            image_path = str(action.get("imagePath", "") or "").strip()
            overlay_id = str(action.get("overlayId", "") or "").strip() or "default"
            if image_path:
                overlays[overlay_id] = {
                    "id": overlay_id,
                    "imagePath": image_path,
                }
            continue

        if action_type == "overlay_off":
            overlay_id = str(action.get("overlayId", "") or "").strip()
            if overlay_id:
                overlays.pop(overlay_id, None)
            else:
                overlays = {}
            continue

        if action_type == "add_note":
            text = str(action.get("text", "") or "").strip()
            if text:
                note_id = (
                    str(action.get("noteId", "") or "").strip()
                    or hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
                )
                notes = [
                    note
                    for note in notes
                    if not (
                        isinstance(note, dict)
                        and str(note.get("id", "") or "") == note_id
                    )
                ]
                notes.append(
                    {
                        "id": note_id,
                        "source": str(action.get("source", "") or ""),
                        "text": text,
                    }
                )
            continue

        if action_type == "button_choice":
            step_id = str(action.get("stepId", ""))
            buttons = [button for button in buttons if button.get("stepId") != step_id]
            buttons.append(
                {
                    "eventId": str(action.get("eventId", "")),
                    "iconBackground": normalize_choice_icon_background(
                        action.get("iconBackground")
                    ),
                    "iconPath": str(action.get("iconPath", "")),
                    "label": str(action.get("label", "")),
                    "source": str(action.get("source", "")),
                    "stepId": step_id,
                    "triggersEvent": str(action.get("triggersEvent", "")),
                }
            )
            continue

        if not selector:
            continue

        if action_type == "highlight_on":
            highlights[selector] = {
                "color": str(action.get("color", "rgba(59, 130, 246, 0.6)")),
                "selector": selector,
            }
        elif action_type == "highlight_off":
            highlights.pop(selector, None)
        elif action_type == "set_ui_trigger":
            triggers = [
                trigger
                for trigger in triggers
                if not (
                    trigger.get("selector") == selector
                    and trigger.get("triggersEvent") == action.get("triggersEvent")
                )
            ]
            triggers.append(
                {
                    "eventId": str(action.get("eventId", "")),
                    "selector": selector,
                    "stepId": str(action.get("stepId", "")),
                    "triggersEvent": str(action.get("triggersEvent", "")),
                }
            )

    ui_runtime["buttons"] = buttons
    ui_runtime["chatEnabled"] = chat_enabled
    ui_runtime["avatarPath"] = avatar_path
    ui_runtime["avatarVisible"] = avatar_visible
    ui_runtime["highlights"] = highlights
    ui_runtime["interactive"] = interactive
    ui_runtime["interactiveState"] = interactive_state
    ui_runtime["images"] = images
    ui_runtime["leftPanels"] = left_panels
    ui_runtime["notes"] = notes[-80:]
    ui_runtime["overlays"] = overlays
    ui_runtime["slide"] = slide
    ui_runtime["slideError"] = slide_error
    ui_runtime["triggers"] = triggers
    state["uiRuntime"] = ui_runtime
    return append_runtime_debug_trace(state, actions)


def set_runtime_current_event(state, event):
    state["currentEventId"] = str(event.id)
    state["currentEventSlug"] = event.slug
    return state


def initial_script_cue_actions_from_messages(messages):
    actions = []
    for message in messages:
        metadata = message.metadata or {}
        cues = metadata.get("scriptCues", [])
        if not isinstance(cues, list):
            continue

        for cue in cues:
            if not isinstance(cue, dict):
                continue
            action = cue.get("action")
            if not isinstance(action, dict):
                continue

            try:
                progress = float(cue.get("progress", 0) or 0)
            except (TypeError, ValueError):
                progress = 0

            if progress <= INITIAL_SCRIPT_CUE_PROGRESS:
                actions.append(action)
    return actions


def hydrate_initial_script_runtime_state(session):
    state = dict(session.runtime_state or {})
    ui_runtime = dict(state.get("uiRuntime") or {})
    if (
        ui_runtime.get("interactive")
        or ui_runtime.get("slide")
        or ui_runtime.get("slideError")
        or ui_runtime.get("avatarPath")
        or "avatarVisible" in ui_runtime
        or ui_runtime.get("images")
        or ui_runtime.get("overlays")
        or ui_runtime.get("notes")
    ):
        return

    messages = list(session.messages.order_by("sequence"))
    actions = initial_script_cue_actions_from_messages(messages)
    if not actions:
        return

    next_state = apply_runtime_actions_to_state(state, actions)
    if next_state == session.runtime_state:
        return

    session.runtime_state = next_state
    session.save(update_fields=["runtime_state", "updated_at"])


def runtime_action_summary(action):
    action_type = str(action.get("type", "action") or "action")
    if action_type == "chat_message":
        message = action.get("message")
        cue_count = action.get("scriptCueCount")
        cue_suffix = ""
        if isinstance(cue_count, int) and cue_count > 0:
            cue_suffix = f" ({cue_count} cues)"
        if isinstance(message, dict):
            content = str(message.get("content", "") or "assistant message")[:180]
            return f"{content}{cue_suffix}"
        return f"assistant message{cue_suffix}"
    if action_type == "set_context":
        return f"{action.get('key', 'context')} = {compact_runtime_debug_value(action.get('value'))}"
    if action_type == "append_context_list":
        return f"{action.get('key', 'context')} += {compact_runtime_debug_value(action.get('value'))}"
    if action_type == "get_ui_state":
        return f"{action.get('stateKey', 'ui')} -> {action.get('contextKey', 'context')}"
    if action_type in {"goto_event", "set_ui_trigger", "transition_missing"}:
        return f"-> {action.get('triggersEvent', 'event')}"
    if action_type == "button_choice":
        return f"{action.get('label', 'button')} -> {action.get('triggersEvent', 'event')}"
    if action_type == "chat_tool_call":
        return str(action.get("toolName", "function call"))
    if action_type == "classifier_result":
        return f"{action.get('classifierName', 'classifier')}: {compact_runtime_debug_value(action.get('result'))}"
    if action_type == "classifier_group_result":
        return f"{action.get('classifierGroupTitle', 'classifiers')}: {compact_runtime_debug_value(action.get('results'))}"
    if action_type == "conversation_check_result":
        result = "matched" if action.get("result") else "missed"
        reason = str(action.get("reason", "") or "")
        return f"{result}: {reason}" if reason else result
    if action_type in {"interactive", "interactive_update"}:
        return f"{action.get('interactiveId', 'app')} {action.get('mode', '')}".strip()
    if action_type == "interactive_state":
        return f"{action.get('interactiveId', 'app')} state saved"
    if action_type == "interactive_error":
        return f"{action.get('interactiveId', 'app')}: {action.get('detail', 'not registered')}"
    if action_type == "interactive_clear":
        return "clear main-panel app"
    if action_type == "python_notebook":
        notebook = action.get("notebook")
        if isinstance(notebook, dict):
            cells = notebook.get("cells")
            if isinstance(cells, list):
                return f"load Python notebook ({len(cells)} cells)"
        if action.get("runAll"):
            return "Python notebook run all"
        return "Python notebook"
    if action_type == "interactive_action_rejected":
        return f"{action.get('actionType', 'action')}: {action.get('reason', 'rejected')}"
    if action_type == "chat_availability":
        return "chat on" if action.get("enabled", True) else "chat off"
    if action_type == "gslide":
        return f"slide {action.get('slideRef', '1')}"
    if action_type == "slide_error":
        return str(action.get("detail", "slide unavailable"))
    if action_type in {"highlight_on", "highlight_off"}:
        return str(action.get("selector", "selector"))
    if action_type == "side_image":
        slot = action.get("slot", "left") or "left"
        if action.get("visible") is False:
            return f"{slot} interface image off"
        image_path = action.get("imagePath")
        if image_path:
            return f"{slot} interface image -> {image_path}"
        return f"{slot} interface image on"
    if action_type == "show_image":
        return str(action.get("imagePath", "image") or "image")
    if action_type == "overlay":
        return f"{action.get('overlayId', 'default') or 'default'} -> {action.get('imagePath', 'image') or 'image'}"
    if action_type == "overlay_off":
        return str(action.get("overlayId", "") or "all overlays")
    if action_type == "agent_image_visibility":
        return "agent image on" if action.get("visible", True) else "agent image off"
    if action_type == "add_note":
        return str(action.get("text", "note") or "note")[:180]
    if action_type == "play_sound":
        return str(action.get("soundPath", "sound") or "sound")
    if action_type == "pause":
        return f"{action.get('durationMs', '0')}ms"
    if action_type in {"event_skipped", "classifier_skipped", "classifier_group_skipped", "skipped"}:
        return str(action.get("reason", "skipped"))
    return action_type


def runtime_action_debug_details(action):
    detail_keys = (
        "actionType",
        "arguments",
        "appended",
        "checkTitle",
        "classifierGroupTitle",
        "classifierName",
        "contextKey",
        "detail",
        "durationMs",
        "eventId",
        "handled",
        "handlerActionCount",
        "handlerMessageCount",
        "imagePath",
        "interactiveId",
        "key",
        "label",
        "enabled",
        "list",
        "mode",
        "noteId",
        "overlayId",
        "reason",
        "result",
        "resultContextKey",
        "savedValues",
        "selector",
        "scriptAudioCached",
        "scriptCueCount",
        "scriptCueTypes",
        "scriptWordTiming",
        "slot",
        "visible",
        "slideRef",
        "soundPath",
        "source",
        "stateKey",
        "stepId",
        "text",
        "toolName",
        "triggersEvent",
        "value",
    )
    details = {}
    for key in detail_keys:
        if key in action:
            details[key] = compact_runtime_debug_value(action.get(key))
    return details


def runtime_action_trace_entry(action, timestamp):
    action_type = str(action.get("type", "action") or "action")
    return {
        "at": timestamp,
        "details": runtime_action_debug_details(action),
        "summary": runtime_action_summary(action),
        "type": action_type,
    }


def is_transition_trace_action(action):
    action_type = str(action.get("type", "") or "")
    return action_type in {
        "goto_event",
        "transition_missing",
        "transition_depth_exceeded",
        "event_skipped",
    }


def append_runtime_debug_trace(state, actions):
    actions = [action for action in actions if isinstance(action, dict)]
    if not actions:
        return state

    timestamp = timezone.now().isoformat()
    debug = dict(state.get("runtimeDebug") or {})
    existing_actions = list(debug.get("recentActions") or [])
    existing_transitions = list(debug.get("transitions") or [])
    trace_entries = [
        runtime_action_trace_entry(action, timestamp)
        for action in actions
    ]
    transition_entries = [
        runtime_action_trace_entry(action, timestamp)
        for action in actions
        if is_transition_trace_action(action)
    ]

    debug["recentActions"] = (
        trace_entries + existing_actions
    )[:RUNTIME_ACTION_TRACE_LIMIT]
    debug["transitions"] = (
        transition_entries + existing_transitions
    )[:RUNTIME_TRANSITION_TRACE_LIMIT]
    debug["updatedAt"] = timestamp
    state["runtimeDebug"] = debug
    return state
