import hashlib
import re

from .main_panel_apps import interactive_id_error, normalized_interactive_config
from .runtime import render_context_template
from .slides import SlideFetchError, SlideResolutionError, resolve_slide_image

SCRIPT_MARKER_PATTERN = re.compile(
    (
        r"\[(show_image|slide|gslide|interactive|interactive_update|"
        r"interactive_clear|highlight|highlight_on|highlight_off|"
        r"overlay|overlay_off|agent_image_off|agent_image_on|"
        r"pause|chat_off|chat_on|add_note|play_sound)"
        r"(?::\s*([^\]]+))?\]"
    ),
    re.IGNORECASE,
)
SCRIPT_WORD_PATTERN = re.compile(r"\S+")
SCRIPT_MARKER_TIMING_ARG_PATTERN = re.compile(
    r"^@\s*(\d+(?:\.\d+)?)\s*(ms|s)?$",
    re.IGNORECASE,
)


def normalize_script_speech(text):
    return " ".join(str(text or "").split())


def script_word_count(text):
    return len(SCRIPT_WORD_PATTERN.findall(normalize_script_speech(text)))


def parse_script_marker_args(args_text):
    if not args_text:
        return []

    args = []
    current = []
    paren_depth = 0
    for char in str(args_text):
        if char == "(":
            paren_depth += 1
        elif char == ")" and paren_depth > 0:
            paren_depth -= 1

        if char == "," and paren_depth == 0:
            arg = "".join(current).strip()
            if arg:
                args.append(arg)
            current = []
        else:
            current.append(char)

    arg = "".join(current).strip()
    if arg:
        args.append(arg)
    return args


def split_script_marker_timing_args(args):
    normalized_args = [str(arg).strip() for arg in args if str(arg).strip()]
    if not normalized_args:
        return [], None

    match = SCRIPT_MARKER_TIMING_ARG_PATTERN.fullmatch(normalized_args[-1])
    if not match:
        return normalized_args, None

    amount = float(match.group(1))
    unit = (match.group(2) or "ms").lower()
    seconds = amount / 1000 if unit == "ms" else amount
    return normalized_args[:-1], round(max(0.0, seconds), 3)


def parse_script_markers(script_text):
    parts = []
    markers = []
    last_end = 0

    for match in SCRIPT_MARKER_PATTERN.finditer(script_text or ""):
        parts.append(script_text[last_end : match.start()])
        spoken_so_far = normalize_script_speech("".join(parts))
        args, explicit_time = split_script_marker_timing_args(
            parse_script_marker_args(match.group(2))
        )
        marker = {
            "args": args,
            "charIndex": len(spoken_so_far),
            "markerType": match.group(1).lower(),
            "wordIndex": script_word_count(spoken_so_far),
        }
        if explicit_time is not None:
            marker["time"] = explicit_time
        markers.append(
            marker
        )
        last_end = match.end()

    parts.append((script_text or "")[last_end:])
    spoken_text = normalize_script_speech("".join(parts))
    total_chars = max(len(spoken_text), 1)
    for marker in markers:
        marker["progress"] = min(1, max(0, marker["charIndex"] / total_chars))
    return spoken_text, markers


def script_cue_time_from_words(cue, words):
    if not words:
        return None

    if "wordIndex" in cue:
        try:
            word_index = int(cue.get("wordIndex", 0) or 0)
        except (TypeError, ValueError):
            word_index = None
    else:
        word_index = None

    if word_index is None:
        try:
            progress = float(cue.get("progress", 0) or 0)
        except (TypeError, ValueError):
            progress = 0
        duration = float(words[-1].get("end", 0) or 0)
        return round(max(0.0, duration * min(1.0, max(0.0, progress))), 3)

    if word_index <= 0:
        return 0.0
    if word_index >= len(words):
        return round(float(words[-1].get("end", 0) or 0), 3)
    return round(float(words[word_index].get("start", 0) or 0), 3)


def script_cues_with_word_times(cues, words):
    if not isinstance(cues, list):
        return []

    timed_cues = []
    for cue in cues:
        if not isinstance(cue, dict):
            continue

        next_cue = dict(cue)
        try:
            explicit_time = float(next_cue["time"])
        except (KeyError, TypeError, ValueError):
            explicit_time = None
        if explicit_time is not None:
            next_cue["time"] = round(max(0.0, explicit_time), 3)
        else:
            cue_time = script_cue_time_from_words(next_cue, words)
            if cue_time is not None:
                next_cue["time"] = cue_time
        timed_cues.append(next_cue)
    return timed_cues


def build_interactive_action(
    *,
    config,
    event_id="",
    metadata=None,
    runtime_context=None,
    step_id="",
    update=False,
):
    runtime_context = runtime_context or {}
    metadata = dict(metadata or {})
    interactive_id = render_context_template(
        config.get("interactiveId") or config.get("name") or "delivery_data",
        runtime_context,
    ).strip()
    id_error = interactive_id_error(interactive_id)
    if id_error:
        return {
            "detail": id_error,
            "eventId": str(event_id),
            "interactiveId": interactive_id,
            "stepId": step_id,
            "type": "interactive_error",
            **metadata,
        }

    action = {
        "config": normalized_interactive_config(config.get("config")),
        "eventId": str(event_id),
        "interactiveId": interactive_id,
        "mode": render_context_template(config.get("mode", ""), runtime_context).strip(),
        "prompt": render_context_template(config.get("prompt", ""), runtime_context).strip(),
        "stepId": step_id,
        "title": render_context_template(config.get("title", ""), runtime_context).strip(),
        "type": "interactive_update" if update else "interactive",
        **metadata,
    }
    triggers_event = render_context_template(
        config.get("triggersEvent", ""),
        runtime_context,
    ).strip()
    if triggers_event:
        action["triggersEvent"] = triggers_event
    return action


def resolve_script_marker_action(marker, config, runtime_context):
    marker_type = marker.get("markerType")
    args = marker.get("args") or []

    if marker_type in {"gslide", "slide"}:
        deck_url = render_context_template(
            config.get("deckUrl", ""),
            runtime_context,
        ).strip()
        slide_ref = (
            render_context_template(args[0] if args else "1", runtime_context).strip()
            or "1"
        )
        if not deck_url:
            return {
                "detail": "Script slide marker needs a deck URL.",
                "slideRef": slide_ref,
                "type": "slide_error",
            }

        try:
            resolved = resolve_slide_image(deck_url, slide_ref)
        except (SlideResolutionError, SlideFetchError) as error:
            return {
                "deckUrl": deck_url,
                "detail": str(error),
                "slideRef": slide_ref,
                "type": "slide_error",
            }

        return {
            "cached": resolved.cache_hit,
            "deckUrl": deck_url,
            "imageUrl": f"/api/slides/images/{resolved.filename}/",
            "pageId": resolved.page_id,
            "presentationId": resolved.presentation_id,
            "slideRef": slide_ref,
            "type": "gslide",
        }

    if marker_type in {"interactive", "interactive_update"}:
        interactive_id = (
            render_context_template(args[0] if args else "", runtime_context).strip()
            or render_context_template(config.get("interactiveId", ""), runtime_context).strip()
            or "delivery_data"
        )
        mode = (
            render_context_template(args[1] if len(args) > 1 else "", runtime_context).strip()
            or render_context_template(config.get("mode", ""), runtime_context).strip()
        )
        return build_interactive_action(
            config={
                "config": config.get("interactiveConfig", {}),
                "interactiveId": interactive_id,
                "mode": mode,
                "prompt": config.get("interactivePrompt", ""),
                "title": config.get("interactiveTitle", ""),
                "triggersEvent": (
                    args[2] if len(args) > 2 else config.get("triggersEvent", "")
                ),
            },
            runtime_context=runtime_context,
            update=marker_type == "interactive_update",
        )

    if marker_type == "interactive_clear":
        return {"type": "interactive_clear"}

    if marker_type == "show_image":
        image_path = render_context_template(
            args[0] if args else "",
            runtime_context,
        ).strip()
        if not image_path:
            return None
        return {
            "imagePath": image_path,
            "type": "show_image",
        }

    if marker_type == "overlay":
        if not args:
            return None
        overlay_id = "default"
        image_arg = args[0]
        if len(args) > 1:
            overlay_id = (
                render_context_template(args[0], runtime_context).strip()
                or "default"
            )
            image_arg = args[1]
        image_path = render_context_template(image_arg, runtime_context).strip()
        if not image_path:
            return None
        return {
            "imagePath": image_path,
            "overlayId": overlay_id,
            "type": "overlay",
        }

    if marker_type == "overlay_off":
        overlay_id = render_context_template(
            args[0] if args else "",
            runtime_context,
        ).strip()
        return {
            "overlayId": overlay_id,
            "type": "overlay_off",
        }

    if marker_type in {"agent_image_off", "agent_image_on"}:
        return {
            "type": "agent_image_visibility",
            "visible": marker_type == "agent_image_on",
        }

    if marker_type == "add_note":
        note_text = render_context_template(", ".join(args), runtime_context).strip()
        if not note_text:
            return None
        note_id = hashlib.sha1(
            f"{marker.get('wordIndex', 0)}:{note_text}".encode("utf-8")
        ).hexdigest()[:16]
        return {
            "noteId": note_id,
            "text": note_text,
            "type": "add_note",
        }

    if marker_type == "play_sound":
        sound_path = render_context_template(
            args[0] if args else "",
            runtime_context,
        ).strip()
        if not sound_path:
            return None
        return {
            "soundPath": sound_path,
            "type": "play_sound",
            "volume": str(args[1] if len(args) > 1 else "").strip(),
        }

    if marker_type == "highlight":
        selector = str(args[0] if args else "").strip()
        if not selector:
            return None
        return {
            "color": str(
                args[1] if len(args) > 1 else "rgba(59, 130, 246, 0.6)"
            ).strip(),
            "duration": str(args[2] if len(args) > 2 else "1200").strip(),
            "selector": selector,
            "type": "highlight_on",
        }

    if marker_type == "highlight_on":
        selector = str(args[0] if args else "").strip()
        if not selector:
            return None
        return {
            "color": str(
                args[1] if len(args) > 1 else "rgba(59, 130, 246, 0.6)"
            ).strip(),
            "selector": selector,
            "type": "highlight_on",
        }

    if marker_type == "highlight_off":
        selector = str(args[0] if args else "").strip()
        if not selector:
            return None
        return {
            "selector": selector,
            "type": "highlight_off",
        }

    if marker_type == "pause":
        return {
            "durationMs": str(args[0] if args else "0"),
            "type": "pause",
        }

    if marker_type == "chat_off":
        return {
            "enabled": False,
            "type": "chat_availability",
        }

    if marker_type == "chat_on":
        return {
            "enabled": True,
            "type": "chat_availability",
        }

    return None
