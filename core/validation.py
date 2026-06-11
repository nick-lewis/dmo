import json
import re
import uuid

from .main_panel_apps import (
    interactive_id_error,
    normalize_interactive_id,
    normalized_interactive_config,
)
from .models import EventActionStep
from .notebook import normalize_notebook
from .runtime import (
    DEFAULT_CHOICE_ICON_BACKGROUND,
    normalize_choice_icon_background,
    normalize_runtime_value,
    runtime_context_action_key,
)
from .script_markers import parse_script_markers


TOOL_CAPTURE_SAVE_MAP_KEY = "x-dluCaptureSaves"
TOOL_DISPLAY_TITLE_KEY = "x-dluDisplayTitle"
DEFAULT_CLASSIFIER_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "mentioned": {"type": "boolean"},
        "context": {"type": ["string", "null"]},
    },
    "required": ["mentioned", "context"],
    "additionalProperties": False,
}


def normalize_conversation_choice(choice, index=0):
    if not isinstance(choice, dict):
        return None

    choice_id = str(choice.get("id", "") or "").strip()
    if not choice_id:
        choice_id = uuid.uuid4().hex

    label = str(choice.get("label", "") or "").strip()[:120]
    triggers_event = str(choice.get("triggersEvent", "") or "").strip()[:180]
    icon_path = str(choice.get("iconPath", "") or "").strip()[:220]
    enabled = choice.get("enabled")
    sort_order = choice.get("sortOrder", index)
    try:
        sort_order = int(sort_order)
    except (TypeError, ValueError):
        sort_order = index
    if sort_order < 0:
        sort_order = index

    return {
        "id": choice_id[:80],
        "label": label,
        "triggersEvent": triggers_event,
        "iconPath": icon_path,
        "enabled": enabled is not False,
        "sortOrder": sort_order,
    }


def normalize_conversation_choices(value):
    if not isinstance(value, list):
        return []

    choices = []
    seen_ids = set()
    for index, raw_choice in enumerate(value):
        choice = normalize_conversation_choice(raw_choice, index)
        if not choice:
            continue
        choice_id = choice["id"]
        if choice_id in seen_ids:
            choice["id"] = uuid.uuid4().hex
        seen_ids.add(choice["id"])
        choices.append(choice)

    return sorted(choices, key=lambda choice: choice["sortOrder"])


def validate_event_slug(value, label="Target event", required=True):
    event_slug = str(value or "").strip()
    if not event_slug and required:
        return None, f"{label} is required."
    if not event_slug:
        return "", ""
    if len(event_slug) > 180:
        return None, f"{label} is too long."
    return event_slug, ""


def validate_conversation_choices(value):
    if value is None:
        return [], ""
    if not isinstance(value, list):
        return None, "Conversation choices must be a list."
    if len(value) > 50:
        return None, "Conversation choices are limited to 50 per event."

    normalized = []
    for index, raw_choice in enumerate(value):
        if not isinstance(raw_choice, dict):
            return None, "Each conversation choice must be an object."

        label = str(raw_choice.get("label", "") or "").strip()
        if len(label) > 120:
            return None, "Conversation choice label is too long."
        icon_path = str(raw_choice.get("iconPath", "") or "").strip()
        if len(icon_path) > 220:
            return None, "Conversation choice icon path is too long."

        triggers_event, event_error = validate_event_slug(
            raw_choice.get("triggersEvent"),
            label="Conversation choice destination",
            required=False,
        )
        if event_error:
            return None, event_error

        choice = normalize_conversation_choice(
            {
                **raw_choice,
                "iconPath": icon_path,
                "label": label,
                "triggersEvent": triggers_event,
            },
            index,
        )
        if choice:
            normalized.append(choice)

    return normalize_conversation_choices(normalized), ""


def validate_side_panels(value):
    """Validate per-experience side panel overrides: [{panelId, title, iconPath}]."""
    if value is None:
        return [], ""
    if not isinstance(value, list):
        return None, "Side panels must be a list."
    if len(value) > 20:
        return None, "Side panels are limited to 20 per experience."

    normalized = []
    seen_panel_ids = set()
    for raw_panel in value:
        if not isinstance(raw_panel, dict):
            return None, "Each side panel must be an object."

        panel_id = str(raw_panel.get("panelId", "") or "").strip()
        if not panel_id:
            return None, "Side panel id is required."
        if len(panel_id) > 60:
            return None, "Side panel id is too long."
        if panel_id in seen_panel_ids:
            continue
        seen_panel_ids.add(panel_id)

        title = str(raw_panel.get("title", "") or "").strip()
        if len(title) > 80:
            return None, "Side panel title is too long."
        icon_path = str(raw_panel.get("iconPath", "") or "").strip()
        if len(icon_path) > 220:
            return None, "Side panel icon path is too long."

        normalized.append(
            {"iconPath": icon_path, "panelId": panel_id, "title": title}
        )

    return normalized, ""


def normalize_side_panel_overrides(value):
    if not isinstance(value, list):
        return []
    normalized, error = validate_side_panels(value)
    return normalized if not error and normalized is not None else []


def validation_template_is_dynamic(value):
    return "{{" in str(value or "")


def validation_config_value(config, key):
    if not isinstance(config, dict):
        return ""
    return str(config.get(key, "") or "").strip()


def validation_route_record(event, kind, target, source, source_item_id="", dynamic=False):
    return {
        "dynamic": bool(dynamic),
        "kind": kind,
        "source": source,
        "sourceEventId": str(event.id),
        "sourceEventSlug": event.slug,
        "sourceEventTitle": event.title,
        "sourceItemId": str(source_item_id or ""),
        "target": str(target or "").strip(),
    }


def validation_app_issue(event, interactive_id, source, source_item_id=""):
    if not interactive_id or validation_template_is_dynamic(interactive_id):
        return None

    detail = interactive_id_error(interactive_id)
    if not detail:
        return None

    return {
        "detail": detail,
        "interactiveId": interactive_id,
        "source": source,
        "sourceEventId": str(event.id),
        "sourceEventSlug": event.slug,
        "sourceEventTitle": event.title,
        "sourceItemId": str(source_item_id or ""),
    }


def validation_script_issue(
    event,
    detail,
    source,
    source_item_id="",
    issue_type="script",
    marker_type="",
    value="",
):
    return {
        "detail": detail,
        "issueType": issue_type,
        "markerType": str(marker_type or ""),
        "source": source,
        "sourceEventId": str(event.id),
        "sourceEventSlug": event.slug,
        "sourceEventTitle": event.title,
        "sourceItemId": str(source_item_id or ""),
        "value": str(value or ""),
    }


def validation_routes_from_action_sequence(event, actions, source_prefix):
    routes = []
    app_issues = []
    script_issues = []
    action_type_labels = dict(EventActionStep.ActionType.choices)
    for action in actions or []:
        if not isinstance(action, dict):
            continue

        action_type = str(action.get("actionType", "") or "").strip()
        config = action.get("config") if isinstance(action.get("config"), dict) else {}
        label = str(action.get("label", "") or "").strip() or action_type or "action"
        source_item_id = str(action.get("id", "") or "")
        source = f"{source_prefix}: {label}"

        if action_type == EventActionStep.ActionType.SCRIPT:
            _, markers = parse_script_markers(config.get("text", ""))
            deck_url = validation_config_value(config, "deckUrl")
            fallback_target = validation_config_value(config, "triggersEvent")
            fallback_target_is_dynamic = validation_template_is_dynamic(fallback_target)
            fallback_app_id = validation_config_value(config, "interactiveId")

            for marker in markers:
                marker_type = marker.get("markerType")
                marker_text = f"{source} / [{marker_type}]"
                if marker_type in {"gslide", "slide"} and not deck_url:
                    args = marker.get("args") or []
                    slide_ref = str(args[0]).strip() if args else "1"
                    script_issues.append(
                        validation_script_issue(
                            event,
                            "Script slide marker needs a deck URL.",
                            marker_text,
                            source_item_id,
                            issue_type="missing_slide_deck",
                            marker_type=marker_type,
                            value=slide_ref or "1",
                        )
                    )

                if marker_type not in {"interactive", "interactive_update"}:
                    continue

                args = marker.get("args") or []
                interactive_id = (
                    str(args[0]).strip()
                    if args
                    else fallback_app_id
                ) or "delivery_data"
                issue = validation_app_issue(
                    event,
                    interactive_id,
                    marker_text,
                    source_item_id,
                )
                if issue:
                    app_issues.append(issue)

                target = str(args[2]).strip() if len(args) > 2 else fallback_target
                if not target:
                    continue

                routes.append(
                    validation_route_record(
                        event,
                        "App submit" if marker_type == "interactive" else "App update submit",
                        target,
                        marker_text,
                        source_item_id,
                        validation_template_is_dynamic(target)
                        or (len(args) <= 2 and fallback_target_is_dynamic),
                    )
                )

        if action_type in {
            EventActionStep.ActionType.INTERACTIVE,
            EventActionStep.ActionType.INTERACTIVE_UPDATE,
        }:
            interactive_id = validation_config_value(config, "interactiveId") or "delivery_data"
            issue = validation_app_issue(event, interactive_id, source, source_item_id)
            if issue:
                app_issues.append(issue)

        if action_type not in {
            EventActionStep.ActionType.SET_UI_TRIGGER,
            EventActionStep.ActionType.GOTO_EVENT,
            EventActionStep.ActionType.BUTTON_CHOICE,
            EventActionStep.ActionType.INTERACTIVE,
            EventActionStep.ActionType.INTERACTIVE_UPDATE,
        }:
            continue

        target = validation_config_value(config, "triggersEvent")
        if not target:
            continue

        routes.append(
            validation_route_record(
                event,
                action_type_labels.get(action_type, action_type),
                target,
                source,
                source_item_id,
                validation_template_is_dynamic(target),
            )
        )

    return routes, app_issues, script_issues


def experience_validation_summary(experience):
    events = list(experience.events.order_by("sort_order", "created_at"))
    event_lookup = {}
    for event in events:
        event_lookup[event.slug] = event
        event_lookup[str(event.id)] = event

    routes = []
    app_issues = []
    script_issues = []
    for event in events:
        action_steps = [
            {
                "actionType": step.action_type,
                "config": step.config,
                "id": str(step.id),
                "label": step.label,
            }
            for step in event.steps.order_by("sort_order", "created_at")
        ]
        (
            step_routes,
            step_app_issues,
            step_script_issues,
        ) = validation_routes_from_action_sequence(event, action_steps, "On entry")
        routes.extend(step_routes)
        app_issues.extend(step_app_issues)
        script_issues.extend(step_script_issues)

        for tool in event.chat_tools.order_by("sort_order", "created_at"):
            if tool.triggers_event:
                routes.append(
                    validation_route_record(
                        event,
                        "FC route",
                        tool.triggers_event,
                        tool.description or tool.name,
                        tool.id,
                    )
                )
            (
                handler_routes,
                handler_app_issues,
                handler_script_issues,
            ) = validation_routes_from_action_sequence(
                event, tool.handler_actions, f"FC route {tool.name}"
            )
            routes.extend(handler_routes)
            app_issues.extend(handler_app_issues)
            script_issues.extend(handler_script_issues)

        for check in event.conversation_checks.order_by("sort_order", "created_at"):
            if check.triggers_event:
                routes.append(
                    validation_route_record(
                        event,
                        "Check",
                        check.triggers_event,
                        check.title or "Conversation check",
                        check.id,
                    )
                )
            (
                handler_routes,
                handler_app_issues,
                handler_script_issues,
            ) = validation_routes_from_action_sequence(
                event, check.handler_actions, f"Check {check.title}"
            )
            routes.extend(handler_routes)
            app_issues.extend(handler_app_issues)
            script_issues.extend(handler_script_issues)

        for group in event.classifier_groups.order_by("sort_order", "created_at"):
            if group.triggers_event:
                routes.append(
                    validation_route_record(
                        event,
                        "Classifiers",
                        group.triggers_event,
                        group.title or "Classifier group",
                        group.id,
                    )
                )
            (
                handler_routes,
                handler_app_issues,
                handler_script_issues,
            ) = validation_routes_from_action_sequence(
                event, group.handler_actions, f"Classifiers {group.title}"
            )
            routes.extend(handler_routes)
            app_issues.extend(handler_app_issues)
            script_issues.extend(handler_script_issues)

        for choice in normalize_conversation_choices(event.conversation_choices):
            triggers_event = str(choice.get("triggersEvent", "") or "").strip()
            if not triggers_event:
                continue
            routes.append(
                validation_route_record(
                    event,
                    "Choice",
                    triggers_event,
                    choice.get("label") or "Conversation choice",
                    choice.get("id", ""),
                )
            )

    unresolved_routes = [
        route
        for route in routes
        if route["target"]
        and not route["dynamic"]
        and route["target"] not in event_lookup
    ]
    incoming_targets = {
        route["target"]
        for route in routes
        if route["target"] and not route["dynamic"] and route["target"] in event_lookup
    }
    orphaned_events = [
        {
            "id": str(event.id),
            "isStart": event.is_start,
            "slug": event.slug,
            "title": event.title,
        }
        for event in events
        if not event.is_start and event.slug not in incoming_targets and str(event.id) not in incoming_targets
    ]

    return {
        "appIssues": app_issues,
        "dynamicRouteCount": len([route for route in routes if route["dynamic"]]),
        "eventCount": len(events),
        "orphanedEvents": orphaned_events,
        "routeCount": len(routes),
        "routes": routes,
        "scriptIssues": script_issues,
        "unresolvedRoutes": unresolved_routes,
    }


def validate_selector(value, label="Selector"):
    selector = str(value or "").strip()
    if not selector:
        return None, f"{label} is required."
    if len(selector) > 500:
        return None, f"{label} is too long."
    return selector, ""


def runtime_action_string(value, max_length=500):
    text = str(value or "").strip()
    if len(text) > max_length:
        return ""
    return text


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
        return None
    if scale <= 0:
        return None
    return min(max(scale, 0.2), 3.0)


def rejected_emitted_runtime_action(action, reason):
    action_type = ""
    if isinstance(action, dict):
        action_type = str(action.get("type", "") or "").strip()
    return {
        "actionType": action_type or "unknown",
        "reason": reason,
        "source": "interactive",
        "type": "interactive_action_rejected",
    }


def normalize_emitted_runtime_action(action):
    if not isinstance(action, dict):
        return None, rejected_emitted_runtime_action(action, "not_an_object")

    action_type = str(action.get("type", "") or "").strip()
    if not action_type:
        return None, rejected_emitted_runtime_action(action, "missing_type")

    if action_type in {"set_context", "append_context_list"}:
        key = runtime_context_action_key(action)
        if not key:
            return None, rejected_emitted_runtime_action(action, "invalid_context_key")
        return {
            "key": key,
            "source": "interactive",
            "type": action_type,
            "value": action.get("value"),
        }, None

    if action_type == "goto_event":
        triggers_event, error = validate_event_slug(action.get("triggersEvent"))
        if error:
            return None, rejected_emitted_runtime_action(action, "invalid_target_event")
        return {
            "source": "interactive",
            "triggersEvent": triggers_event,
            "type": "goto_event",
        }, None

    if action_type == "button_choice":
        label = runtime_action_string(action.get("label"), max_length=120)
        triggers_event, error = validate_event_slug(action.get("triggersEvent"))
        icon_path = runtime_action_string(action.get("iconPath"), max_length=220)
        icon_background = normalize_choice_icon_background(
            action.get("iconBackground")
        )
        if not label or error:
            return None, rejected_emitted_runtime_action(action, "invalid_button")
        return {
            "iconBackground": icon_background,
            "iconPath": icon_path,
            "label": label,
            "source": "interactive",
            "triggersEvent": triggers_event,
            "type": "button_choice",
        }, None

    if action_type == "set_ui_trigger":
        selector, selector_error = validate_selector(action.get("selector"))
        triggers_event, event_error = validate_event_slug(action.get("triggersEvent"))
        if selector_error or event_error:
            return None, rejected_emitted_runtime_action(action, "invalid_ui_trigger")
        return {
            "selector": selector,
            "source": "interactive",
            "triggersEvent": triggers_event,
            "type": "set_ui_trigger",
        }, None

    if action_type == "highlight_on":
        selector, selector_error = validate_selector(action.get("selector"))
        if selector_error:
            return None, rejected_emitted_runtime_action(action, "invalid_selector")
        color = runtime_action_string(
            action.get("color") or "rgba(59, 130, 246, 0.6)",
            max_length=120,
        )
        return {
            "color": color or "rgba(59, 130, 246, 0.6)",
            "selector": selector,
            "source": "interactive",
            "type": "highlight_on",
        }, None

    if action_type == "highlight_off":
        selector, selector_error = validate_selector(action.get("selector"))
        if selector_error:
            return None, rejected_emitted_runtime_action(action, "invalid_selector")
        return {
            "selector": selector,
            "source": "interactive",
            "type": "highlight_off",
        }, None

    if action_type == "chat_availability":
        if not isinstance(action.get("enabled"), bool):
            return None, rejected_emitted_runtime_action(action, "invalid_chat_state")
        return {
            "enabled": action.get("enabled"),
            "source": "interactive",
            "type": "chat_availability",
        }, None

    if action_type == "side_panel":
        panel_id = runtime_action_string(action.get("panelId"), max_length=60)
        mode = str(action.get("mode", "open") or "open").strip()
        if not panel_id or mode not in {"open", "available", "off"}:
            return None, rejected_emitted_runtime_action(action, "invalid_side_panel")
        return {
            "mode": mode,
            "panelId": panel_id,
            "source": "interactive",
            "type": "side_panel",
        }, None

    if action_type in {"interactive", "interactive_update"}:
        interactive_id = normalize_interactive_id(
            action.get("interactiveId") or action.get("name")
        )
        id_error = interactive_id_error(interactive_id)
        if id_error:
            return None, rejected_emitted_runtime_action(action, "invalid_interactive")

        raw_config = action.get("config")
        if raw_config in (None, ""):
            config = {}
        elif isinstance(raw_config, dict):
            config = normalized_interactive_config(raw_config)
        else:
            return None, rejected_emitted_runtime_action(
                action,
                "invalid_interactive_config",
            )
        if len(json.dumps(config, ensure_ascii=True)) > 8000:
            return None, rejected_emitted_runtime_action(
                action,
                "invalid_interactive_config",
            )

        triggers_event, event_error = validate_event_slug(
            action.get("triggersEvent"),
            label="Completion event",
            required=False,
        )
        if event_error:
            return None, rejected_emitted_runtime_action(
                action,
                "invalid_target_event",
            )

        normalized = {
            "config": config,
            "interactiveId": interactive_id,
            "mode": runtime_action_string(action.get("mode"), max_length=80),
            "prompt": runtime_action_string(action.get("prompt"), max_length=1200),
            "source": "interactive",
            "title": runtime_action_string(action.get("title"), max_length=160),
            "type": action_type,
        }
        if triggers_event:
            normalized["triggersEvent"] = triggers_event

        if "state" in action:
            raw_state = action.get("state")
            if raw_state in (None, ""):
                state = {}
            elif isinstance(raw_state, dict):
                state = normalized_interactive_config(raw_state)
            else:
                return None, rejected_emitted_runtime_action(
                    action,
                    "invalid_interactive_state",
                )
            if len(json.dumps(state, ensure_ascii=True)) > 12000:
                return None, rejected_emitted_runtime_action(
                    action,
                    "invalid_interactive_state",
                )
            normalized["state"] = state

        return normalized, None

    if action_type == "interactive_clear":
        return {"source": "interactive", "type": "interactive_clear"}, None

    if action_type == "side_image":
        slot = normalize_runtime_side_image_slot(
            action.get("slot") or action.get("location")
        )
        if not slot:
            return None, rejected_emitted_runtime_action(action, "invalid_image_slot")
        visible = action.get("visible")
        if visible is None:
            visible = bool(runtime_action_string(action.get("imagePath")))
        if not isinstance(visible, bool):
            return None, rejected_emitted_runtime_action(action, "invalid_visibility")
        image_path = runtime_action_string(action.get("imagePath"))
        normalized = {
            "slot": slot,
            "source": "interactive",
            "type": "side_image",
            "visible": visible,
        }
        if image_path:
            normalized["imagePath"] = image_path
        if "scale" in action:
            scale = normalize_runtime_side_image_scale(action.get("scale"))
            if scale is None:
                return None, rejected_emitted_runtime_action(
                    action,
                    "invalid_image_scale",
                )
            if abs(scale - 1.0) > 0.001:
                normalized["scale"] = round(scale, 2)
        return normalized, None

    if action_type == "show_image":
        image_path = runtime_action_string(action.get("imagePath"))
        if not image_path:
            return None, rejected_emitted_runtime_action(action, "invalid_image")
        return {
            "imagePath": image_path,
            "source": "interactive",
            "type": "show_image",
        }, None

    if action_type == "overlay":
        image_path = runtime_action_string(action.get("imagePath"))
        overlay_id = runtime_action_string(action.get("overlayId"), max_length=80)
        if not image_path:
            return None, rejected_emitted_runtime_action(action, "invalid_overlay")
        return {
            "imagePath": image_path,
            "overlayId": overlay_id or "default",
            "source": "interactive",
            "type": "overlay",
        }, None

    if action_type == "overlay_off":
        overlay_id = runtime_action_string(action.get("overlayId"), max_length=80)
        return {
            "overlayId": overlay_id,
            "source": "interactive",
            "type": "overlay_off",
        }, None

    if action_type == "agent_image_visibility":
        if not isinstance(action.get("visible"), bool):
            return None, rejected_emitted_runtime_action(action, "invalid_visibility")
        return {
            "source": "interactive",
            "type": "agent_image_visibility",
            "visible": action.get("visible"),
        }, None

    if action_type == "add_note":
        text = runtime_action_string(action.get("text"), max_length=1200)
        if not text:
            return None, rejected_emitted_runtime_action(action, "invalid_note")
        note_id = runtime_action_string(action.get("noteId"), max_length=120)
        normalized = {
            "source": "interactive",
            "text": text,
            "type": "add_note",
        }
        if note_id:
            normalized["noteId"] = note_id
        return normalized, None

    if action_type == "play_sound":
        sound_path = runtime_action_string(action.get("soundPath"))
        if not sound_path:
            return None, rejected_emitted_runtime_action(action, "invalid_sound")
        return {
            "soundPath": sound_path,
            "source": "interactive",
            "type": "play_sound",
            "volume": runtime_action_string(action.get("volume"), max_length=24),
        }, None

    return None, rejected_emitted_runtime_action(action, "unsupported_type")


def normalize_emitted_runtime_actions(actions):
    accepted_actions = []
    rejected_actions = []
    for action in actions:
        accepted, rejected = normalize_emitted_runtime_action(action)
        if accepted is not None:
            accepted_actions.append(accepted)
        if rejected is not None:
            rejected_actions.append(rejected)
    return accepted_actions, rejected_actions


def validate_chat_tool_name(value):
    name = str(value or "").strip()
    if not name:
        return None, "Tool name is required."
    if len(name) > 64:
        return None, "Tool name is too long."
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
        return None, "Tool name must use letters, numbers, and underscores."
    return name, ""


def normalize_tool_parameters(value):
    if value in (None, ""):
        value = {}
    if not isinstance(value, dict):
        return None, "Tool parameters must be an object."

    parameters = dict(value)
    if not parameters:
        parameters = {"type": "object", "properties": {}, "required": []}

    if parameters.get("type") != "object":
        return None, "Tool parameters must use an object schema."

    properties = parameters.get("properties", {})
    if not isinstance(properties, dict):
        return None, "Tool parameter properties must be an object."

    required = parameters.get("required", [])
    if not isinstance(required, list):
        return None, "Tool required parameters must be an array."

    for key in properties.keys():
        if not isinstance(key, str) or len(key) > 120:
            return None, "Tool parameter names are invalid."

    capture_save_map = parameters.get(TOOL_CAPTURE_SAVE_MAP_KEY, {})
    if capture_save_map in (None, ""):
        capture_save_map = {}
    if not isinstance(capture_save_map, dict):
        return None, "Tool capture settings must be an object."
    normalized_capture_save_map = {}
    for argument_name, context_key in capture_save_map.items():
        argument_name = str(argument_name).strip()
        context_key = str(context_key).strip()
        if len(argument_name) > 120 or len(context_key) > 120:
            return None, "Tool capture settings are too long."
        if argument_name and context_key:
            normalized_capture_save_map[argument_name] = context_key

    raw_display_title = parameters.get(TOOL_DISPLAY_TITLE_KEY, "")
    display_title = (
        str(raw_display_title).strip() if raw_display_title not in (None, "") else ""
    )
    if len(display_title) > 120:
        return None, "Tool display title is too long."

    parameters["properties"] = properties
    parameters["required"] = [str(item) for item in required]
    parameters.setdefault("additionalProperties", False)
    if normalized_capture_save_map:
        parameters[TOOL_CAPTURE_SAVE_MAP_KEY] = normalized_capture_save_map
    else:
        parameters.pop(TOOL_CAPTURE_SAVE_MAP_KEY, None)
    if display_title:
        parameters[TOOL_DISPLAY_TITLE_KEY] = display_title
    else:
        parameters.pop(TOOL_DISPLAY_TITLE_KEY, None)
    return parameters, ""


def validate_chat_tool_payload(data, existing_tool=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Chat tool must be an object."

    name, name_error = validate_chat_tool_name(
        data.get("name", existing_tool.name if existing_tool else "")
    )
    if name_error:
        return None, name_error

    description = str(
        data.get(
            "description",
            existing_tool.description if existing_tool else "",
        )
    ).strip()
    if len(description) > 4000:
        return None, "Tool description is too long."

    parameters, parameters_error = normalize_tool_parameters(
        data.get("parameters", existing_tool.parameters if existing_tool else {})
    )
    if parameters_error:
        return None, parameters_error

    handler_actions, handler_actions_error = validate_action_sequence(
        data.get(
            "handlerActions",
            existing_tool.handler_actions if existing_tool else [],
        )
    )
    if handler_actions_error:
        return None, handler_actions_error

    triggers_event, event_error = validate_event_slug(
        data.get(
            "triggersEvent",
            existing_tool.triggers_event if existing_tool else "",
        ),
        label="Triggered event",
        required=False,
    )
    if event_error:
        return None, event_error

    save_argument = str(
        data.get(
            "saveArgument",
            existing_tool.save_argument if existing_tool else "",
        )
    ).strip()
    save_context_key = str(
        data.get(
            "saveContextKey",
            existing_tool.save_context_key if existing_tool else "",
        )
    ).strip()
    if len(save_argument) > 120 or len(save_context_key) > 120:
        return None, "Saved argument settings are too long."

    payload = {
        "description": description,
        "enabled": bool(data.get("enabled", existing_tool.enabled if existing_tool else True)),
        "handler_actions": handler_actions,
        "name": name,
        "parameters": parameters,
        "save_argument": save_argument,
        "save_context_key": save_context_key,
        "triggers_event": triggers_event,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_conversation_check_payload(data, existing_check=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Conversation check must be an object."

    title = str(
        data.get("title", existing_check.title if existing_check else "Check")
    ).strip()
    if not title:
        title = "Check"
    if len(title) > 160:
        return None, "Check title is too long."

    instructions = str(
        data.get(
            "instructions",
            existing_check.instructions if existing_check else "",
        )
    ).strip()
    if len(instructions) > 12000:
        return None, "Check instructions are too long."

    result_context_key = str(
        data.get(
            "resultContextKey",
            existing_check.result_context_key if existing_check else "",
        )
    ).strip()
    if len(result_context_key) > 120:
        return None, "Check result key is too long."

    handler_actions, handler_actions_error = validate_action_sequence(
        data.get(
            "handlerActions",
            existing_check.handler_actions if existing_check else [],
        )
    )
    if handler_actions_error:
        return None, handler_actions_error

    triggers_event, event_error = validate_event_slug(
        data.get(
            "triggersEvent",
            existing_check.triggers_event if existing_check else "",
        ),
        required=False,
    )
    if event_error:
        return None, event_error

    payload = {
        "enabled": bool(
            data.get("enabled", existing_check.enabled if existing_check else True)
        ),
        "handler_actions": handler_actions,
        "instructions": instructions,
        "result_context_key": result_context_key,
        "title": title,
        "triggers_event": triggers_event,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_classifier_schema(value):
    if value in (None, ""):
        return {}, ""
    if not isinstance(value, dict):
        return None, "Classifier schema must be an object."
    try:
        encoded = json.dumps(value, ensure_ascii=True)
    except (TypeError, ValueError):
        return None, "Classifier schema must be JSON serializable."
    if len(encoded) > 12000:
        return None, "Classifier schema is too long."
    return value, ""


def validate_classifier_group_payload(data, existing_group=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Classifier group must be an object."

    title = str(
        data.get(
            "title",
            existing_group.title if existing_group else "Classifier group",
        )
    ).strip()
    if not title:
        title = "Classifier group"
    if len(title) > 160:
        return None, "Classifier group title is too long."

    instructions = str(
        data.get(
            "instructions",
            existing_group.instructions if existing_group else "",
        )
    ).strip()
    if len(instructions) > 12000:
        return None, "Classifier group instructions are too long."

    result_context_key = str(
        data.get(
            "resultContextKey",
            existing_group.result_context_key
            if existing_group
            else "_classifier_results",
        )
    ).strip()
    if len(result_context_key) > 120:
        return None, "Classifier result key is too long."

    handler_actions, handler_actions_error = validate_action_sequence(
        data.get(
            "handlerActions",
            existing_group.handler_actions if existing_group else [],
        )
    )
    if handler_actions_error:
        return None, handler_actions_error

    triggers_event, event_error = validate_event_slug(
        data.get(
            "triggersEvent",
            existing_group.triggers_event if existing_group else "",
        ),
        required=False,
    )
    if event_error:
        return None, event_error

    condition, condition_error = validate_step_condition(
        data.get(
            "condition",
            existing_group.condition if existing_group else {},
        )
    )
    if condition_error:
        return None, condition_error

    payload = {
        "condition": condition,
        "enabled": bool(
            data.get("enabled", existing_group.enabled if existing_group else True)
        ),
        "handler_actions": handler_actions,
        "instructions": instructions,
        "result_context_key": result_context_key,
        "title": title,
        "triggers_event": triggers_event,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_classifier_payload(data, existing_classifier=None):
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, "Classifier must be an object."

    name = str(
        data.get("name", existing_classifier.name if existing_classifier else "")
    ).strip()
    name = re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_").lower()
    if not name:
        return None, "Classifier name is required."
    if len(name) > 64:
        return None, "Classifier name is too long."

    prompt = str(
        data.get(
            "prompt",
            existing_classifier.prompt if existing_classifier else "",
        )
    ).strip()
    if len(prompt) > 12000:
        return None, "Classifier prompt is too long."

    schema, schema_error = validate_classifier_schema(
        data.get(
            "schema",
            existing_classifier.schema if existing_classifier else {},
        )
    )
    if schema_error:
        return None, schema_error

    model = str(
        data.get(
            "model",
            existing_classifier.model if existing_classifier else "",
        )
    ).strip()
    if len(model) > 100:
        return None, "Classifier model is too long."

    condition, condition_error = validate_step_condition(
        data.get(
            "condition",
            existing_classifier.condition if existing_classifier else {},
        )
    )
    if condition_error:
        return None, condition_error

    payload = {
        "condition": condition,
        "enabled": bool(
            data.get(
                "enabled",
                existing_classifier.enabled if existing_classifier else True,
            )
        ),
        "model": model,
        "name": name,
        "prompt": prompt,
        "schema": schema,
    }
    if "sortOrder" in data:
        try:
            sort_order = int(data.get("sortOrder"))
        except (TypeError, ValueError):
            return None, "Sort order must be a number."
        if sort_order < 0:
            return None, "Sort order must be positive."
        payload["sort_order"] = sort_order

    return payload, ""


def validate_action_config(action_type, value):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        return None, "Action config must be an object."

    if action_type == EventActionStep.ActionType.SCRIPT:
        text = str(value.get("text", ""))
        if len(text) > 12000:
            return None, "Script text is too long."
        deck_url = str(value.get("deckUrl", "")).strip()
        if len(deck_url) > 2048:
            return None, "Deck URL is too long."
        return {"deckUrl": deck_url, "text": text}, ""

    if action_type == EventActionStep.ActionType.SET_CONTEXT:
        key = str(value.get("key", "")).strip()
        if not key:
            return None, "Context key is required."
        if len(key) > 120:
            return None, "Context key is too long."
        config = {"key": key, "value": value.get("value")}
        source = str(value.get("source", "")).strip()
        if source:
            config["source"] = source[:80]
        return config, ""

    if action_type == EventActionStep.ActionType.APPEND_CONTEXT_LIST:
        key = str(value.get("key", "")).strip()
        if not key:
            return None, "Context key is required."
        if len(key) > 120:
            return None, "Context key is too long."
        return {"key": key, "value": value.get("value")}, ""

    if action_type == EventActionStep.ActionType.GET_UI_STATE:
        state_key = str(value.get("stateKey", "")).strip()
        context_key = str(value.get("contextKey", state_key)).strip()
        if not state_key:
            return None, "UI state key is required."
        if not context_key:
            return None, "Context key is required."
        if len(state_key) > 120 or len(context_key) > 120:
            return None, "UI state keys are too long."
        return {"contextKey": context_key, "stateKey": state_key}, ""

    if action_type == EventActionStep.ActionType.HIGHLIGHT_ON:
        selector, selector_error = validate_selector(value.get("selector"))
        if selector_error:
            return None, selector_error
        color = str(value.get("color", "rgba(59, 130, 246, 0.6)")).strip()
        if len(color) > 120:
            return None, "Highlight color is too long."
        config = {"color": color, "selector": selector}
        source = str(value.get("source", "")).strip()
        if source:
            config["source"] = source[:80]
        return config, ""

    if action_type == EventActionStep.ActionType.HIGHLIGHT_OFF:
        selector, selector_error = validate_selector(value.get("selector"))
        if selector_error:
            return None, selector_error
        config = {"selector": selector}
        source = str(value.get("source", "")).strip()
        if source:
            config["source"] = source[:80]
        return config, ""

    if action_type == EventActionStep.ActionType.SIDE_PANEL:
        panel_id = str(value.get("panelId", "")).strip()
        if not panel_id:
            return None, "Panel id is required."
        if len(panel_id) > 60:
            return None, "Panel id is too long."
        mode = str(value.get("mode", "open")).strip() or "open"
        if mode not in {"open", "available", "off"}:
            return None, "Panel mode must be open, available, or off."
        config = {"mode": mode, "panelId": panel_id}
        source = str(value.get("source", "")).strip()
        if source:
            config["source"] = source[:80]
        return config, ""

    if action_type in {
        EventActionStep.ActionType.INTERACTIVE,
        EventActionStep.ActionType.INTERACTIVE_UPDATE,
    }:
        interactive_id = normalize_interactive_id(value.get("interactiveId", ""))
        id_error = interactive_id_error(interactive_id)
        if id_error:
            return None, id_error

        title = str(value.get("title", "")).strip()
        mode = str(value.get("mode", "")).strip()
        prompt = str(value.get("prompt", "")).strip()
        if len(title) > 160:
            return None, "Interactive title is too long."
        if len(mode) > 80:
            return None, "Interactive mode is too long."
        if len(prompt) > 1200:
            return None, "Interactive prompt is too long."

        config = normalized_interactive_config(value.get("config"))
        if len(json.dumps(config, ensure_ascii=True)) > 8000:
            return None, "Interactive config is too large."

        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            label="Completion event",
            required=False,
        )
        if event_error:
            return None, event_error

        payload = {
            "config": config,
            "interactiveId": interactive_id,
            "mode": mode,
            "prompt": prompt,
            "title": title,
        }
        if action_type == EventActionStep.ActionType.INTERACTIVE:
            payload["triggersEvent"] = triggers_event
        return payload, ""

    if action_type == EventActionStep.ActionType.INTERACTIVE_CLEAR:
        return {}, ""

    if action_type == EventActionStep.ActionType.PYTHON_NOTEBOOK:
        try:
            notebook = normalize_notebook(value.get("notebook"))
        except ValueError as error:
            return None, str(error)
        return {"notebook": notebook}, ""

    if action_type == EventActionStep.ActionType.CHAT_AVAILABILITY:
        return {"enabled": value.get("enabled") is not False}, ""

    if action_type == EventActionStep.ActionType.SET_UI_TRIGGER:
        selector, selector_error = validate_selector(value.get("selector"))
        if selector_error:
            return None, selector_error
        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            label="Triggered event",
            required=False,
        )
        if event_error:
            return None, event_error
        return {"selector": selector, "triggersEvent": triggers_event}, ""

    if action_type == EventActionStep.ActionType.GOTO_EVENT:
        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            required=False,
        )
        if event_error:
            return None, event_error
        config = {"triggersEvent": triggers_event}
        source = str(value.get("source", "")).strip()
        if source:
            config["source"] = source[:80]
        return config, ""

    if action_type == EventActionStep.ActionType.BUTTON_CHOICE:
        label = str(value.get("label", "")).strip()
        if not label:
            return None, "Button label is required."
        if len(label) > 120:
            return None, "Button label is too long."
        triggers_event, event_error = validate_event_slug(
            value.get("triggersEvent"),
            label="Triggered event",
            required=False,
        )
        if event_error:
            return None, event_error
        config = {"label": label, "triggersEvent": triggers_event}
        raw_icon_background = value.get("iconBackground")
        if raw_icon_background:
            config["iconBackground"] = normalize_choice_icon_background(
                raw_icon_background
            )
        return config, ""

    return None, "Action type is not supported."


def validate_step_condition(value):
    if value is None:
        return {}, ""
    if not isinstance(value, dict):
        return None, "Step condition must be an object."

    condition_type = str(value.get("type", "always")).strip() or "always"
    if condition_type == "always":
        return {}, ""

    if condition_type in {"context_equals", "context_not_equals"}:
        key = str(value.get("key", "")).strip()
        expected_value = value.get("value", "")
        if not key:
            return None, "Condition context key is required."
        if len(key) > 120:
            return None, "Condition context key is too long."
        if len(normalize_runtime_value(expected_value)) > 4000:
            return None, "Condition value is too long."
        return {
            "type": condition_type,
            "key": key,
            "value": expected_value,
        }, ""

    if condition_type in {"context_contains", "context_not_contains"}:
        key = str(value.get("key", "")).strip()
        expected_value = value.get("value", "")
        if not key:
            return None, "Condition context key is required."
        if len(key) > 120:
            return None, "Condition context key is too long."
        if len(normalize_runtime_value(expected_value)) > 4000:
            return None, "Condition value is too long."
        return {
            "type": condition_type,
            "key": key,
            "value": expected_value,
        }, ""

    if condition_type in {"context_exists", "context_missing"}:
        key = str(value.get("key", "")).strip()
        if not key:
            return None, "Condition context key is required."
        if len(key) > 120:
            return None, "Condition context key is too long."
        return {"type": condition_type, "key": key}, ""

    if condition_type in {"all", "any"}:
        raw_conditions = value.get("conditions", value.get("items", []))
        if not isinstance(raw_conditions, list):
            return None, "Nested conditions must be a list."
        if len(raw_conditions) > 40:
            return None, "Nested condition list is too long."
        conditions = []
        for raw_condition in raw_conditions:
            condition, condition_error = validate_step_condition(raw_condition)
            if condition_error:
                return None, condition_error
            conditions.append(condition)
        return {"type": condition_type, "conditions": conditions}, ""

    return None, "Step condition is not supported."


def validate_action_sequence(value):
    if value in (None, ""):
        return [], ""
    if not isinstance(value, list):
        return None, "Action sequence must be a list."
    if len(value) > 80:
        return None, "Action sequence is too long."

    actions = []
    for index, raw_step in enumerate(value):
        if not isinstance(raw_step, dict):
            return None, "Action sequence steps must be objects."

        action_type = str(raw_step.get("actionType", "")).strip()
        if action_type not in EventActionStep.ActionType.values:
            return None, "Action type is not supported."

        config, config_error = validate_action_config(
            action_type,
            raw_step.get("config", {}),
        )
        if config_error:
            return None, config_error

        condition, condition_error = validate_step_condition(
            raw_step.get("condition", {})
        )
        if condition_error:
            return None, condition_error

        label = str(raw_step.get("label", "")).strip()
        if len(label) > 160:
            return None, "Action label is too long."

        try:
            sort_order = int(raw_step.get("sortOrder", index))
        except (TypeError, ValueError):
            return None, "Action sort order must be a number."
        if sort_order < 0:
            return None, "Action sort order must be positive."

        step_id = str(raw_step.get("id", "")).strip() or f"action-{index + 1}"
        if len(step_id) > 120:
            return None, "Action id is too long."

        actions.append(
            {
                "actionType": action_type,
                "condition": condition,
                "config": config,
                "enabled": bool(raw_step.get("enabled", True)),
                "id": step_id,
                "label": label,
                "sortOrder": sort_order,
            }
        )

    return sorted(actions, key=lambda action: action["sortOrder"]), ""
