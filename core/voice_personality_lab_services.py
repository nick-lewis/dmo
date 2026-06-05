import hashlib
import json
import uuid
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .audio_cache import (
    AudioGenerationError,
    SCRIPT_AUDIO_ENGINE,
    audio_duration_seconds,
    compute_script_audio_cache_key,
    get_or_create_script_audio,
    script_audio_audio_path,
    script_audio_metadata_path,
)
from .realtime_services import (
    REALTIME_VOICE_ORDER,
    normalize_realtime_model_choice,
    realtime_voice_choices_for_model,
)


VOICE_PERSONALITY_LAB_SCRIPT = (
    "Hello my name is D-lou and I hear you want to learn about deep learning, "
    "but first I'm going to need your help"
)
VOICE_PERSONALITY_LAB_ASSISTANT_NAME = "D-lou"
VOICE_PERSONALITY_LAB_DEFAULT_REALTIME_MODEL = "gpt-realtime-2"
VOICE_PERSONALITY_LAB_MANIFEST_VERSION = "voice-personality-lab-v1"


def voice_personality_lab_dir():
    cache_dir = Path(settings.MEDIA_ROOT) / "voice_personality_lab"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def voice_personality_lab_manifest_path(user):
    user_key = hashlib.sha256(str(user.pk).encode("utf-8")).hexdigest()[:16]
    return voice_personality_lab_dir() / f"{user_key}.json"


def voice_personality_lab_timestamp():
    return timezone.now().isoformat()


def empty_voice_personality_lab_manifest():
    return {
        "groups": [],
        "version": VOICE_PERSONALITY_LAB_MANIFEST_VERSION,
    }


def load_voice_personality_lab_manifest(user):
    manifest_path = voice_personality_lab_manifest_path(user)
    if not manifest_path.exists():
        return empty_voice_personality_lab_manifest()

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty_voice_personality_lab_manifest()

    if not isinstance(manifest, dict):
        return empty_voice_personality_lab_manifest()
    if not isinstance(manifest.get("groups"), list):
        manifest["groups"] = []
    manifest["version"] = VOICE_PERSONALITY_LAB_MANIFEST_VERSION
    return manifest


def save_voice_personality_lab_manifest(user, manifest):
    manifest_path = voice_personality_lab_manifest_path(user)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest["version"] = VOICE_PERSONALITY_LAB_MANIFEST_VERSION
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def voice_personality_lab_voices_for_model(realtime_model):
    allowed_voices = realtime_voice_choices_for_model(realtime_model)
    return [voice for voice in REALTIME_VOICE_ORDER if voice in allowed_voices]


def voice_personality_lab_sample_cache_key(realtime_model, voice, voice_instructions):
    return compute_script_audio_cache_key(
        assistant_name=VOICE_PERSONALITY_LAB_ASSISTANT_NAME,
        audio_model=realtime_model,
        realtime_model=realtime_model,
        script=VOICE_PERSONALITY_LAB_SCRIPT,
        voice=voice,
        voice_instructions=voice_instructions,
    )


def voice_personality_lab_sample_payload(
    realtime_model,
    voice,
    voice_instructions,
    error="",
):
    cache_key = voice_personality_lab_sample_cache_key(
        realtime_model,
        voice,
        voice_instructions,
    )
    audio_path = script_audio_audio_path(cache_key)
    metadata_path = script_audio_metadata_path(cache_key)
    cached = audio_path.exists() and metadata_path.exists()
    return {
        "audioEngine": SCRIPT_AUDIO_ENGINE,
        "audioModel": realtime_model,
        "audioUrl": f"/api/script-audio/{cache_key}.wav/" if cached else "",
        "cacheKey": cache_key,
        "cached": cached,
        "durationSeconds": audio_duration_seconds(audio_path) if cached else None,
        "error": str(error or ""),
        "realtimeModel": realtime_model,
        "script": VOICE_PERSONALITY_LAB_SCRIPT,
        "voice": voice,
    }


def voice_personality_lab_group_payload(group):
    realtime_model = str(group.get("realtimeModel") or "").strip()
    voice_instructions = str(group.get("voiceInstructions") or "").strip()
    sample_errors = group.get("sampleErrors")
    if not isinstance(sample_errors, dict):
        sample_errors = {}

    samples = [
        voice_personality_lab_sample_payload(
            realtime_model,
            voice,
            voice_instructions,
            sample_errors.get(voice, ""),
        )
        for voice in voice_personality_lab_voices_for_model(realtime_model)
    ]
    cached_count = sum(1 for sample in samples if sample["cached"])
    return {
        "cachedCount": cached_count,
        "createdAt": str(group.get("createdAt") or ""),
        "id": str(group.get("id") or ""),
        "realtimeModel": realtime_model,
        "sampleCount": len(samples),
        "samples": samples,
        "updatedAt": str(group.get("updatedAt") or ""),
        "voiceInstructions": voice_instructions,
    }


def voice_personality_lab_payload(user, active_group_id=""):
    manifest = load_voice_personality_lab_manifest(user)
    groups = [
        voice_personality_lab_group_payload(group)
        for group in manifest.get("groups", [])
        if isinstance(group, dict) and group.get("id")
    ]
    return {
        "activeGroupId": active_group_id,
        "defaultRealtimeModel": VOICE_PERSONALITY_LAB_DEFAULT_REALTIME_MODEL,
        "groups": groups,
        "script": VOICE_PERSONALITY_LAB_SCRIPT,
        "totalGroups": len(groups),
    }


def normalize_voice_personality_lab_request(data):
    if not isinstance(data, dict):
        return None, "", "Request body must be an object.", 400

    realtime_model = normalize_realtime_model_choice(
        data.get("realtimeModel") or data.get("model"),
        VOICE_PERSONALITY_LAB_DEFAULT_REALTIME_MODEL,
    )
    if realtime_model is None:
        return None, "", "Realtime model is not supported.", 400

    voice_instructions = str(data.get("voiceInstructions") or "").strip()
    if len(voice_instructions) > 4000:
        return None, "", "Voice instructions are too long.", 400

    return realtime_model, voice_instructions, "", 200


def find_voice_personality_lab_group(manifest, group_id):
    for group in manifest.get("groups", []):
        if isinstance(group, dict) and str(group.get("id") or "") == str(group_id):
            return group
    return None


def find_matching_voice_personality_lab_group(
    manifest,
    realtime_model,
    voice_instructions,
):
    for group in manifest.get("groups", []):
        if not isinstance(group, dict):
            continue
        if (
            str(group.get("realtimeModel") or "").strip() == realtime_model
            and str(group.get("voiceInstructions") or "").strip() == voice_instructions
        ):
            return group
    return None


def create_voice_personality_lab_group(user, data, safety_identifier=""):
    realtime_model, voice_instructions, error, status_code = (
        normalize_voice_personality_lab_request(data)
    )
    if error:
        return None, error, status_code

    manifest = load_voice_personality_lab_manifest(user)
    group = find_matching_voice_personality_lab_group(
        manifest,
        realtime_model,
        voice_instructions,
    )
    if group is None:
        now = voice_personality_lab_timestamp()
        group = {
            "createdAt": now,
            "id": uuid.uuid4().hex,
            "realtimeModel": realtime_model,
            "sampleErrors": {},
            "updatedAt": now,
            "voiceInstructions": voice_instructions,
        }
        manifest["groups"].insert(0, group)
        save_voice_personality_lab_manifest(user, manifest)

    return generate_voice_personality_lab_group(
        user,
        group["id"],
        force=False,
        safety_identifier=safety_identifier,
    )


def generate_voice_personality_lab_group(
    user,
    group_id,
    force=False,
    safety_identifier="",
):
    if not settings.OPENAI_API_KEY:
        return None, "OPENAI_API_KEY is not configured.", 500

    manifest = load_voice_personality_lab_manifest(user)
    group = find_voice_personality_lab_group(manifest, group_id)
    if group is None:
        return None, "Voice personality group not found.", 404

    realtime_model = normalize_realtime_model_choice(
        group.get("realtimeModel"),
        VOICE_PERSONALITY_LAB_DEFAULT_REALTIME_MODEL,
    )
    if realtime_model is None:
        return None, "Realtime model is not supported.", 400

    voice_instructions = str(group.get("voiceInstructions") or "").strip()
    sample_errors = {}
    generated = 0

    for voice in voice_personality_lab_voices_for_model(realtime_model):
        cache_key = voice_personality_lab_sample_cache_key(
            realtime_model,
            voice,
            voice_instructions,
        )
        if force:
            for path in (
                script_audio_audio_path(cache_key),
                script_audio_metadata_path(cache_key),
            ):
                try:
                    if path.exists():
                        path.unlink()
                except OSError:
                    pass

        try:
            recording = get_or_create_script_audio(
                api_key=settings.OPENAI_API_KEY,
                assistant_name=VOICE_PERSONALITY_LAB_ASSISTANT_NAME,
                audio_model=realtime_model,
                realtime_model=realtime_model,
                safety_identifier=safety_identifier,
                script=VOICE_PERSONALITY_LAB_SCRIPT,
                voice=voice,
                voice_instructions=voice_instructions,
            )
            if not recording.cached:
                generated += 1
        except AudioGenerationError as audio_error:
            sample_errors[voice] = audio_error.message

    group["realtimeModel"] = realtime_model
    group["sampleErrors"] = sample_errors
    group["updatedAt"] = voice_personality_lab_timestamp()
    save_voice_personality_lab_manifest(user, manifest)

    payload = voice_personality_lab_payload(user, active_group_id=group["id"])
    payload["errors"] = [
        f"{voice}: {message}" for voice, message in sample_errors.items()
    ]
    payload["generated"] = generated
    return payload, "", 207 if sample_errors else 200


def delete_voice_personality_lab_group(user, group_id):
    manifest = load_voice_personality_lab_manifest(user)
    before_count = len(manifest.get("groups", []))
    manifest["groups"] = [
        group
        for group in manifest.get("groups", [])
        if not (isinstance(group, dict) and str(group.get("id") or "") == str(group_id))
    ]
    if len(manifest["groups"]) == before_count:
        return None, "Voice personality group not found.", 404
    save_voice_personality_lab_manifest(user, manifest)
    return voice_personality_lab_payload(user), "", 200
