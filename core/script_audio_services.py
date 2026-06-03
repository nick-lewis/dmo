import hashlib
import json
import re
from collections import Counter

from django.conf import settings

from .audio_cache import (
    AudioGenerationError,
    AudioTimingError,
    audio_duration_seconds,
    compute_script_audio_cache_key,
    compute_script_audio_display_key,
    get_or_create_script_audio,
    get_or_create_script_audio_words,
    get_or_create_voice_sample,
    normalize_transcription_words,
    script_audio_audio_path,
    script_audio_display_path,
    script_audio_metadata_path,
    script_audio_words_path,
)
from .experience_services import (
    DEFAULT_SCRIPT_STEP_LABEL,
    ensure_tutor_settings,
)
from . import slides
from .models import EventActionStep
from .script_markers import (
    parse_script_markers,
    script_cues_with_word_times,
)
from .slides import SlideFetchError, SlideResolutionError
from .validation import validation_template_is_dynamic


SCRIPT_AUDIO_MESSAGE_SOURCES = {
    "event-action",
    "conversation-tool-action",
    "conversation-check-action",
    "classifier-group-action",
}
SCRIPT_WORD_PATTERN = re.compile(r"\S+")


def normalize_script_speech(text):
    return " ".join(str(text or "").split())


def script_word_count(text):
    return len(SCRIPT_WORD_PATTERN.findall(normalize_script_speech(text)))


def script_audio_display_slots_from_text(text):
    return SCRIPT_WORD_PATTERN.findall(normalize_script_speech(text))


def normalize_script_audio_display_slots(value):
    if not isinstance(value, list):
        return []
    return ["" if slot is None else str(slot).strip() for slot in value]


def normalize_script_audio_display_breaks(value, slot_count=0):
    if not isinstance(value, list):
        return []
    breaks = []
    for item in value:
        try:
            index = int(item)
        except (TypeError, ValueError):
            continue
        if index < 0:
            continue
        if slot_count and index >= slot_count - 1:
            continue
        breaks.append(index)
    return sorted(breaks)


def script_audio_display_text_from_slots(slots, breaks=None):
    normalized_breaks = normalize_script_audio_display_breaks(breaks, len(slots))
    break_counts = Counter(normalized_breaks)
    lines = [""]
    for index, slot in enumerate(slots):
        text = str(slot).strip()
        if text:
            lines[-1] = f"{lines[-1]} {text}".strip()
        for _ in range(break_counts.get(index, 0)):
            lines.append("")
    return "\n".join(lines).strip("\n")


def load_script_audio_display_payload(script):
    display_key = compute_script_audio_display_key(script)
    display_path = script_audio_display_path(display_key)
    if not display_path.exists():
        return {}

    try:
        payload = json.loads(display_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return payload


def load_script_audio_display_slots(script):
    payload = load_script_audio_display_payload(script)
    display_slots = normalize_script_audio_display_slots(payload.get("displaySlots"))
    if display_slots:
        return display_slots

    display_text = payload.get("displayText")
    if not isinstance(display_text, str):
        return []
    return script_audio_display_slots_from_text(display_text)


def load_script_audio_display_breaks(script, slot_count=0):
    payload = load_script_audio_display_payload(script)
    return normalize_script_audio_display_breaks(payload.get("displayBreaks"), slot_count)


def load_script_audio_display_text(script):
    display_slots = load_script_audio_display_slots(script)
    return script_audio_display_text_from_slots(
        display_slots,
        load_script_audio_display_breaks(script, len(display_slots)),
    )


def runtime_script_audio_display_text(script, expected_word_count=0):
    display_slots = load_script_audio_display_slots(script)
    if not display_slots:
        return ""

    expected_count = expected_word_count or script_word_count(script)
    if expected_count and len(display_slots) != expected_count:
        return ""
    return script_audio_display_text_from_slots(
        display_slots,
        load_script_audio_display_breaks(script, len(display_slots)),
    )


def save_script_audio_display_slots(
    script,
    display_slots,
    base_slots=None,
    display_breaks=None,
):
    display_key = compute_script_audio_display_key(script)
    display_path = script_audio_display_path(display_key)
    normalized_slots = normalize_script_audio_display_slots(display_slots)
    normalized_base_slots = normalize_script_audio_display_slots(base_slots)
    if not normalized_base_slots:
        normalized_base_slots = script_audio_display_slots_from_text(script)
    normalized_breaks = normalize_script_audio_display_breaks(
        display_breaks,
        len(normalized_base_slots) or len(normalized_slots),
    )

    if (
        not normalized_slots
        or (normalized_slots == normalized_base_slots and not normalized_breaks)
    ):
        try:
            display_path.unlink()
        except FileNotFoundError:
            pass
        return [], []

    display_path.parent.mkdir(parents=True, exist_ok=True)
    display_path.write_text(
        json.dumps(
            {
                "displayBreaks": normalized_breaks,
                "displaySlots": normalized_slots,
                "displayText": script_audio_display_text_from_slots(
                    normalized_slots,
                    normalized_breaks,
                ),
                "version": "script-audio-display-slots-v1",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return normalized_slots, normalized_breaks


def save_script_audio_display_text(script, display_text):
    display_slots = script_audio_display_slots_from_text(display_text)
    saved_slots, saved_breaks = save_script_audio_display_slots(script, display_slots)
    return script_audio_display_text_from_slots(saved_slots, saved_breaks)


def script_audio_display_payload(item):
    return {
        "displayBaseSlots": item.get("displayBaseSlots", []),
        "displayBaseText": item.get("displayBaseText", ""),
        "displayExpectedWordCount": item.get("displayExpectedWordCount", 0),
        "displayBreaks": item.get("displayBreaks", []),
        "displaySlotCount": item.get("displaySlotCount", 0),
        "displaySlots": item.get("displaySlots", []),
        "displayText": item.get("displayText", ""),
        "displayWordCount": item.get("displayWordCount", 0),
        "hasDisplayTranscript": bool(item.get("hasDisplayTranscript")),
        "id": item.get("id", ""),
        "script": item.get("script", ""),
    }

def script_is_static_for_audio(text):
    return "{{" not in text and "{%" not in text and "{#" not in text


def script_audio_item_from_text(experience, tutor_settings, source, raw_text, index):
    script, markers = parse_script_markers(raw_text)
    script = script.strip()
    if not script:
        return None

    cache_key = compute_script_audio_cache_key(
        assistant_name=tutor_settings.assistant_name,
        realtime_model=tutor_settings.realtime_model,
        script=script,
        tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        voice=tutor_settings.voice,
        voice_instructions=tutor_settings.voice_instructions,
    )
    audio_path = script_audio_audio_path(cache_key)
    words_path = script_audio_words_path(
        cache_key,
        settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
    )
    cached = audio_path.exists()
    words_cached = words_path.exists()
    can_generate = script_is_static_for_audio(raw_text)
    display_key = compute_script_audio_display_key(script)
    display_base_text = script
    display_base_slots = script_audio_display_slots_from_text(script)
    timing_preview = []
    timing_word_count = 0
    timing_words = []
    timed_marker_count = 0
    if words_cached:
        try:
            words = normalize_transcription_words(
                json.loads(words_path.read_text(encoding="utf-8"))
            )
        except (OSError, ValueError):
            words = []
        timing_words = words
        timing_word_count = len(words)
        timing_preview = words[:12]
        if words:
            display_base_slots = [str(word["word"]) for word in words]
            display_base_text = " ".join(display_base_slots)
        timed_marker_count = sum(
            1
            for marker in script_cues_with_word_times(markers, words)
            if isinstance(marker.get("time"), (int, float))
        )
    display_slots = load_script_audio_display_slots(script)
    if display_base_slots and len(display_slots) != len(display_base_slots):
        display_slots = []
    display_breaks = load_script_audio_display_breaks(script, len(display_base_slots))
    if not display_slots:
        display_breaks = []
    display_text = script_audio_display_text_from_slots(display_slots, display_breaks)
    has_display_transcript = bool(
        display_slots and (display_slots != display_base_slots or display_breaks)
    )
    return {
        "audioUrl": f"/api/script-audio/{cache_key}.wav/" if cached else "",
        "cacheKey": cache_key,
        "canGenerate": can_generate,
        "characterCount": len(script),
        "cached": cached,
        "durationSeconds": audio_duration_seconds(audio_path) if cached else None,
        "displayBaseSlots": display_base_slots,
        "displayBaseText": display_base_text,
        "displayBreaks": display_breaks,
        "displayExpectedWordCount": len(timing_words) or script_word_count(script),
        "displayKey": display_key,
        "displaySlotCount": len(display_slots) if display_slots else 0,
        "displaySlots": display_slots,
        "displayText": display_text,
        "displayWordCount": script_word_count(display_text) if display_text else 0,
        "experienceId": str(experience.id),
        "generationReason": ""
        if can_generate
        else "Dynamic scripts with template variables cannot be pregenerated yet.",
        "id": hashlib.sha1(
            f"{experience.id}:{index}:{source}:{script}".encode("utf-8")
        ).hexdigest()[:16],
        "markerCount": len(markers),
        "preview": script[:240],
        "realtimeModel": tutor_settings.realtime_model,
        "script": script,
        "source": source,
        "sourceCount": 1,
        "sources": [source],
        "hasDisplayTranscript": has_display_transcript,
        "timedMarkerCount": timed_marker_count,
        "timingPreview": timing_preview,
        "timingWords": timing_words,
        "timingWordCount": timing_word_count,
        "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        "voice": tutor_settings.voice,
        "wordCount": script_word_count(script),
        "wordsCached": words_cached,
    }


def iter_script_audio_texts_from_action_sequence(actions, source_prefix):
    if not isinstance(actions, list):
        return

    for index, action in enumerate(actions, start=1):
        if not isinstance(action, dict):
            continue
        action_type = str(action.get("actionType", "")).strip()
        config = action.get("config") if isinstance(action.get("config"), dict) else {}
        label = str(action.get("label", "")).strip()
        source = f"{source_prefix} / {label or action_type or f'action {index}'}"
        if action_type == EventActionStep.ActionType.SCRIPT:
            yield source, str(config.get("text", ""))


def collect_experience_script_audio_items(experience):
    tutor_settings = ensure_tutor_settings(experience)
    items = []
    items_by_script = {}

    def append_item(item):
        if not item:
            return
        existing_item = items_by_script.get(item["script"])
        if existing_item:
            if item["source"] not in existing_item["sources"]:
                existing_item["sources"].append(item["source"])
                existing_item["sourceCount"] = len(existing_item["sources"])
            return
        items_by_script[item["script"]] = item
        items.append(item)

    for event in experience.events.order_by("sort_order", "created_at"):
        event_source = event.title or event.slug or "Event"
        for step in event.steps.order_by("sort_order", "created_at"):
            if step.action_type == EventActionStep.ActionType.SCRIPT:
                source = f"{event_source} / {step.label or DEFAULT_SCRIPT_STEP_LABEL}"
                append_item(
                    script_audio_item_from_text(
                        experience,
                        tutor_settings,
                        source,
                        str((step.config or {}).get("text", "")),
                        len(items),
                    )
                )

        for tool in event.chat_tools.order_by("sort_order", "created_at"):
            for source, raw_text in iter_script_audio_texts_from_action_sequence(
                tool.handler_actions,
                f"{event_source} / FC route {tool.name}",
            ):
                append_item(
                    script_audio_item_from_text(
                        experience,
                        tutor_settings,
                        source,
                        raw_text,
                        len(items),
                    )
                )

        for check in event.conversation_checks.order_by("sort_order", "created_at"):
            for source, raw_text in iter_script_audio_texts_from_action_sequence(
                check.handler_actions,
                f"{event_source} / Check {check.title}",
            ):
                append_item(
                    script_audio_item_from_text(
                        experience,
                        tutor_settings,
                        source,
                        raw_text,
                        len(items),
                    )
                )

        for group in event.classifier_groups.order_by("sort_order", "created_at"):
            for source, raw_text in iter_script_audio_texts_from_action_sequence(
                group.handler_actions,
                f"{event_source} / Classifiers {group.title}",
            ):
                append_item(
                    script_audio_item_from_text(
                        experience,
                        tutor_settings,
                        source,
                        raw_text,
                        len(items),
                    )
                )

    return items



def iter_script_slide_recache_targets(experience):
    seen = set()

    def append_targets(source, raw_text, deck_url):
        _, markers = parse_script_markers(raw_text)
        for marker in markers:
            marker_type = marker.get("markerType")
            if marker_type not in {"gslide", "slide"}:
                continue

            args = marker.get("args") or []
            slide_ref = str(args[0]).strip() if args else "1"
            slide_ref = slide_ref or "1"
            target = {
                "deckUrl": deck_url,
                "dynamic": validation_template_is_dynamic(deck_url)
                or validation_template_is_dynamic(slide_ref),
                "slideRef": slide_ref,
                "source": source,
            }
            key = (target["deckUrl"], target["slideRef"])
            if key in seen:
                continue
            seen.add(key)
            yield target

    for event in experience.events.order_by("sort_order", "created_at"):
        event_source = event.title or event.slug or "Event"
        for step in event.steps.order_by("sort_order", "created_at"):
            if step.action_type != EventActionStep.ActionType.SCRIPT:
                continue
            config = step.config or {}
            source = f"{event_source} / {step.label or DEFAULT_SCRIPT_STEP_LABEL}"
            yield from append_targets(
                source,
                str(config.get("text", "")),
                str(config.get("deckUrl", "") or "").strip(),
            )
        for tool in event.chat_tools.order_by("sort_order", "created_at"):
            for source, raw_text, deck_url in iter_script_slide_sources(
                tool.handler_actions,
                f"{event_source} / FC route {tool.name}",
            ):
                yield from append_targets(source, raw_text, deck_url)
        for check in event.conversation_checks.order_by("sort_order", "created_at"):
            for source, raw_text, deck_url in iter_script_slide_sources(
                check.handler_actions,
                f"{event_source} / Check {check.title}",
            ):
                yield from append_targets(source, raw_text, deck_url)
        for group in event.classifier_groups.order_by("sort_order", "created_at"):
            for source, raw_text, deck_url in iter_script_slide_sources(
                group.handler_actions,
                f"{event_source} / Classifiers {group.title}",
            ):
                yield from append_targets(source, raw_text, deck_url)


def iter_script_slide_sources(actions, source_prefix):
    for source, raw_text, config in iter_script_action_configs(actions, source_prefix):
        deck_url = str(config.get("deckUrl", "") or "").strip()
        yield source, raw_text, deck_url


def iter_script_action_configs(actions, source_prefix):
    if not isinstance(actions, list):
        return

    for index, action in enumerate(actions, start=1):
        if not isinstance(action, dict):
            continue
        action_type = str(action.get("actionType", "")).strip()
        config = action.get("config") if isinstance(action.get("config"), dict) else {}
        label = str(action.get("label", "")).strip()
        source = f"{source_prefix} / {label or action_type or f'action {index}'}"
        if action_type == EventActionStep.ActionType.SCRIPT:
            yield source, str(config.get("text", "")), config


def recache_experience_slide_images(experience):
    recached = []
    skipped = []
    errors = []

    for target in iter_script_slide_recache_targets(experience):
        deck_url = target["deckUrl"]
        slide_ref = target["slideRef"]
        if not deck_url:
            skipped.append(
                {
                    **target,
                    "detail": "Script slide marker has no deck URL.",
                }
            )
            continue
        if target["dynamic"]:
            skipped.append(
                {
                    **target,
                    "detail": "Dynamic deck URLs or slide refs need runtime context.",
                }
            )
            continue

        try:
            resolved = slides.resolve_slide_image(deck_url, slide_ref, True)
        except (SlideResolutionError, SlideFetchError) as error:
            errors.append(
                {
                    **target,
                    "detail": str(error),
                }
            )
            continue

        recached.append(
            {
                **target,
                "cached": resolved.cache_hit,
                "imageUrl": f"/api/slides/images/{resolved.filename}/",
                "pageId": resolved.page_id,
                "presentationId": resolved.presentation_id,
            }
        )

    return {
        "errors": errors,
        "recached": recached,
        "skipped": skipped,
        "totalTargets": len(recached) + len(skipped) + len(errors),
    }


def generate_script_audio_item(tutor_settings, item, force=False, safety_identifier=""):
    if not item.get("canGenerate"):
        return False, "Dynamic scripts with template variables cannot be pregenerated yet."
    if item.get("cached") and item.get("wordsCached") and not force:
        return False, ""

    if force:
        audio_path = script_audio_audio_path(item["cacheKey"])
        metadata_path = script_audio_metadata_path(item["cacheKey"])
        words_path = script_audio_words_path(
            item["cacheKey"],
            settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        )
        for path in (audio_path, metadata_path, words_path):
            try:
                if path.exists():
                    path.unlink()
            except OSError:
                pass

    recording = get_or_create_script_audio(
        api_key=settings.OPENAI_API_KEY,
        assistant_name=tutor_settings.assistant_name,
        realtime_model=tutor_settings.realtime_model,
        safety_identifier=safety_identifier,
        script=item["script"],
        tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        voice=tutor_settings.voice,
        voice_instructions=tutor_settings.voice_instructions,
    )
    get_or_create_script_audio_words(
        api_key=settings.OPENAI_API_KEY,
        alignment_model=settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        audio_path=recording.audio_path,
        cache_key=recording.cache_key,
        safety_identifier=safety_identifier,
        script=item["script"],
    )
    return True, ""


def experience_script_audio_inventory_payload(experience):
    items = collect_experience_script_audio_items(experience)
    return {
        "generated": 0,
        "scripts": items,
        "totalScripts": len(items),
    }


def generate_experience_script_audio_payload(experience, data, safety_identifier=""):
    if not settings.OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not configured.", 500

    tutor_settings = ensure_tutor_settings(experience)
    force = bool(data.get("force", False))
    target_id = str(data.get("scriptId", "")).strip()

    generated = 0
    errors = []
    items = collect_experience_script_audio_items(experience)
    for item in items:
        if target_id and item["id"] != target_id:
            continue
        try:
            did_generate, item_error = generate_script_audio_item(
                tutor_settings,
                item,
                force=force,
                safety_identifier=safety_identifier,
            )
            if did_generate:
                generated += 1
            if item_error:
                errors.append(f"{item['source']}: {item_error}")
        except (AudioGenerationError, AudioTimingError) as error:
            errors.append(f"{item['source']}: {error.message}")

    refreshed_items = collect_experience_script_audio_items(experience)
    return (
        {
            "errors": errors,
            "generated": generated,
            "scripts": refreshed_items,
            "totalScripts": len(refreshed_items),
        },
        "",
        207 if errors else 200,
    )


def script_audio_display_transcript_payload(experience, script_id, data=None):
    item = next(
        (
            candidate
            for candidate in collect_experience_script_audio_items(experience)
            if candidate["id"] == str(script_id)
        ),
        None,
    )
    if not item:
        return None, "Script audio item not found.", 404

    if data is None:
        return script_audio_display_payload(item), "", 200

    base_slots = normalize_script_audio_display_slots(item.get("displayBaseSlots"))
    if not base_slots:
        base_slots = script_audio_display_slots_from_text(item.get("displayBaseText", ""))
    if "displaySlots" in data:
        display_slots = normalize_script_audio_display_slots(data.get("displaySlots"))
    else:
        display_slots = script_audio_display_slots_from_text(data.get("displayText", ""))
    display_breaks = normalize_script_audio_display_breaks(
        data.get("displayBreaks"),
        len(base_slots),
    )
    expected_slot_count = len(base_slots)
    display_slot_count = len(display_slots)
    if display_slots and expected_slot_count and display_slot_count != expected_slot_count:
        detail = (
            "Display transcript must keep the same number of timed word slots "
            f"({expected_slot_count}); found {display_slot_count}."
        )
        return (
            {
                "detail": detail,
                "displayExpectedWordCount": expected_slot_count,
                "displaySlotCount": display_slot_count,
            },
            detail,
            400,
        )

    save_script_audio_display_slots(
        item.get("script", ""),
        display_slots,
        base_slots,
        display_breaks,
    )
    refreshed_item = next(
        (
            candidate
            for candidate in collect_experience_script_audio_items(experience)
            if candidate["id"] == str(script_id)
        ),
        item,
    )
    return script_audio_display_payload(refreshed_item), "", 200


def cached_script_audio_payload(session, script, script_cues=None):
    if not session.experience:
        return {}

    tutor_settings = ensure_tutor_settings(session.experience)
    cache_key = compute_script_audio_cache_key(
        assistant_name=tutor_settings.assistant_name,
        realtime_model=tutor_settings.realtime_model,
        script=script,
        tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        voice=tutor_settings.voice,
        voice_instructions=tutor_settings.voice_instructions,
    )
    audio_path = script_audio_audio_path(cache_key)
    metadata_path = script_audio_metadata_path(cache_key)
    if not audio_path.exists() or not metadata_path.exists():
        return {}

    words_path = script_audio_words_path(
        cache_key,
        settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
    )
    script_words = []
    if words_path.exists():
        try:
            script_words = normalize_transcription_words(
                json.loads(words_path.read_text(encoding="utf-8"))
            )
        except (OSError, ValueError):
            script_words = []
    display_text = runtime_script_audio_display_text(script, len(script_words))

    payload = {
        "audioUrl": f"/api/script-audio/{cache_key}.wav/",
        "cached": True,
        "durationSeconds": audio_duration_seconds(audio_path),
        "displayText": display_text,
        "messageId": "",
        "realtimeModel": tutor_settings.realtime_model,
        "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        "voice": tutor_settings.voice,
    }
    if script_words:
        payload["scriptWords"] = script_words
        if script_cues is not None:
            payload["scriptCues"] = script_cues_with_word_times(
                script_cues,
                script_words,
            )
    return payload


def generate_message_script_audio_payload(
    session,
    message,
    data,
    safety_identifier,
):
    if not settings.OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not configured.", 500

    if not session.experience:
        return None, "Session does not have an experience.", 400

    script = message.content.strip()
    if not script:
        return None, "Message has no script text.", 400

    metadata = message.metadata or {}
    if metadata.get("source") not in SCRIPT_AUDIO_MESSAGE_SOURCES:
        return None, "Only scripted action messages can be recorded.", 400

    from .realtime_services import (
        normalize_realtime_model_choice,
        normalize_realtime_voice_choice,
    )

    tutor_settings = ensure_tutor_settings(session.experience)
    default_model = str(
        data.get("model") or tutor_settings.realtime_model
    ).strip()
    realtime_model = normalize_realtime_model_choice(
        default_model,
        tutor_settings.realtime_model,
    )
    if realtime_model is None:
        return None, "Realtime model is not supported.", 400

    default_voice = str(data.get("voice") or tutor_settings.voice).strip()
    voice = normalize_realtime_voice_choice(
        default_voice,
        tutor_settings.voice,
        realtime_model,
    )
    if voice is None:
        return None, "Realtime voice is not supported.", 400

    try:
        recording = get_or_create_script_audio(
            api_key=settings.OPENAI_API_KEY,
            assistant_name=tutor_settings.assistant_name,
            realtime_model=realtime_model,
            safety_identifier=safety_identifier,
            script=script,
            tts_model=settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
            voice=voice,
            voice_instructions=tutor_settings.voice_instructions,
        )
    except AudioGenerationError as error:
        return None, error.message, error.status_code

    duration_seconds = audio_duration_seconds(recording.audio_path)
    display_text = runtime_script_audio_display_text(script)
    script_words = []
    script_cues = metadata.get("scriptCues", [])
    timing_warning = ""
    try:
        script_words = get_or_create_script_audio_words(
            api_key=settings.OPENAI_API_KEY,
            alignment_model=settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
            audio_path=recording.audio_path,
            cache_key=recording.cache_key,
            safety_identifier=safety_identifier,
            script=script,
        )
        display_text = runtime_script_audio_display_text(script, len(script_words))
        script_cues = script_cues_with_word_times(script_cues, script_words)
        next_metadata = dict(metadata)
        next_metadata["scriptCues"] = script_cues
        script_audio = dict(next_metadata.get("scriptAudio") or {})
        script_audio.update(
            {
                "audioUrl": f"/api/script-audio/{recording.cache_key}.wav/",
                "cached": recording.cached,
                "displayText": display_text,
                "durationSeconds": duration_seconds,
                "messageId": str(message.id),
                "realtimeModel": realtime_model,
                "scriptWords": script_words,
                "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
                "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
                "voice": voice,
            }
        )
        next_metadata["scriptAudio"] = script_audio
        message.metadata = next_metadata
        message.save(update_fields=["metadata"])
    except AudioTimingError as error:
        timing_warning = error.message

    return {
        "audioUrl": f"/api/script-audio/{recording.cache_key}.wav/",
        "cached": recording.cached,
        "displayText": display_text,
        "durationSeconds": duration_seconds,
        "messageId": str(message.id),
        "realtimeModel": realtime_model,
        "scriptCues": script_cues,
        "scriptWords": script_words,
        "timingModel": settings.DLU_SCRIPT_AUDIO_ALIGNMENT_MODEL,
        "timingWarning": timing_warning,
        "ttsModel": settings.DLU_SCRIPT_AUDIO_TTS_MODEL,
        "voice": voice,
    }, "", 200


def generate_voice_sample_payload(experience, data, safety_identifier):
    if not settings.OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not configured.", 500

    from .realtime_services import (
        normalize_realtime_model_choice,
        normalize_realtime_voice_choice,
    )

    tutor_settings = ensure_tutor_settings(experience)
    sample_tutor = data.get("tutor")
    if sample_tutor is None:
        sample_tutor = {}
    if not isinstance(sample_tutor, dict):
        return None, "Tutor settings must be an object.", 400

    assistant_name = str(
        sample_tutor.get("assistantName") or tutor_settings.assistant_name
    ).strip()
    voice_instructions = str(
        sample_tutor.get("voiceInstructions") or tutor_settings.voice_instructions
    ).strip()
    if not assistant_name:
        return None, "Tutor name is required.", 400
    if len(assistant_name) > 100:
        return None, "Tutor name is too long.", 400
    if len(voice_instructions) > 4000:
        return None, "Voice instructions are too long.", 400

    default_model = sample_tutor.get("realtimeModel") or tutor_settings.realtime_model
    realtime_model = normalize_realtime_model_choice(
        data.get("model"),
        default_model,
    )
    if realtime_model is None:
        return None, "Realtime model is not supported.", 400

    default_voice = sample_tutor.get("voice") or tutor_settings.voice
    voice = normalize_realtime_voice_choice(
        data.get("voice"),
        default_voice,
        realtime_model,
    )
    if voice is None:
        return None, "Realtime voice is not supported.", 400

    try:
        sample = get_or_create_voice_sample(
            api_key=settings.OPENAI_API_KEY,
            assistant_name=assistant_name,
            realtime_model=realtime_model,
            safety_identifier=safety_identifier,
            script_model=settings.DLU_VOICE_SAMPLE_SCRIPT_MODEL,
            tts_model=settings.DLU_VOICE_SAMPLE_TTS_MODEL,
            voice=voice,
            voice_instructions=voice_instructions,
        )
    except AudioGenerationError as error:
        return None, error.message, error.status_code

    return {
        "audioUrl": f"/api/voice-samples/{sample.cache_key}.wav/",
        "cached": sample.cached,
        "realtimeModel": realtime_model,
        "script": sample.script,
        "scriptModel": settings.DLU_VOICE_SAMPLE_SCRIPT_MODEL,
        "ttsModel": settings.DLU_VOICE_SAMPLE_TTS_MODEL,
        "voice": voice,
    }, "", 200
