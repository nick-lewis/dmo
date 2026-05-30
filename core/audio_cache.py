import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import requests
from django.conf import settings


OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_AUDIO_SPEECH_URL = "https://api.openai.com/v1/audio/speech"
VOICE_SAMPLE_CACHE_VERSION = "voice-sample-v1"


class AudioGenerationError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class CachedVoiceSample:
    audio_path: Path
    cache_key: str
    cached: bool
    script: str


def voice_sample_cache_dir():
    cache_dir = Path(settings.MEDIA_ROOT) / "voice_sample_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def voice_sample_audio_path(cache_key):
    return voice_sample_cache_dir() / f"{cache_key}.wav"


def voice_sample_metadata_path(cache_key):
    return voice_sample_cache_dir() / f"{cache_key}.json"


def build_intro_script_prompt(assistant_name, voice_personality):
    assistant_name = assistant_name.strip()
    voice_personality = voice_personality.strip()

    if assistant_name and voice_personality:
        return f"""You are {assistant_name}. Your personality: {voice_personality}

Write a brief (1-2 sentences) introduction message where you introduce yourself by name. Just return the script text, nothing else."""
    if assistant_name:
        return f"""You are {assistant_name}.

Write a brief (1-2 sentences) introduction message where you introduce yourself by name. Just return the script text, nothing else."""
    if voice_personality:
        return f"""Your personality: {voice_personality}

Write a brief (1-2 sentences) introduction message as a tutor greeting a student. Just return the script text, nothing else."""

    return "Write a brief (1-2 sentences) friendly introduction message as a tutor greeting a student. Just return the script text, nothing else."


def compute_voice_sample_cache_key(
    *,
    assistant_name,
    realtime_model,
    script_model,
    tts_model,
    voice,
    voice_instructions,
):
    cache_payload = {
        "assistantName": assistant_name.strip(),
        "realtimeModel": realtime_model,
        "scriptModel": script_model,
        "ttsModel": tts_model,
        "version": VOICE_SAMPLE_CACHE_VERSION,
        "voice": voice,
        "voiceInstructions": voice_instructions.strip(),
    }
    cache_source = json.dumps(cache_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(cache_source.encode("utf-8")).hexdigest()[:32]


def openai_error_message(response, fallback):
    try:
        payload = response.json()
    except ValueError:
        return response.text.strip() or fallback

    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if payload.get("detail"):
            return str(payload["detail"])
    return fallback


def openai_headers(api_key, safety_identifier):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if safety_identifier:
        headers["OpenAI-Safety-Identifier"] = safety_identifier
    return headers


def generate_intro_script(
    *,
    api_key,
    assistant_name,
    script_model,
    safety_identifier,
    voice_instructions,
):
    prompt = build_intro_script_prompt(assistant_name, voice_instructions)
    try:
        response = requests.post(
            OPENAI_CHAT_COMPLETIONS_URL,
            headers=openai_headers(api_key, safety_identifier),
            json={
                "model": script_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 150,
            },
            timeout=30,
        )
    except requests.RequestException as error:
        raise AudioGenerationError("Could not reach OpenAI to write the voice sample.") from error

    if response.status_code >= 400:
        raise AudioGenerationError(
            openai_error_message(response, "OpenAI could not write the voice sample."),
            502 if response.status_code in {401, 403} or response.status_code >= 500 else response.status_code,
        )

    try:
        payload = response.json()
        script = payload["choices"][0]["message"]["content"].strip()
    except (KeyError, TypeError, ValueError, IndexError) as error:
        raise AudioGenerationError("OpenAI returned an unreadable voice sample script.") from error

    if not script:
        raise AudioGenerationError("OpenAI returned an empty voice sample script.")
    return script


def generate_speech_audio(
    *,
    api_key,
    safety_identifier,
    script,
    tts_model,
    voice,
    voice_instructions,
):
    payload = {
        "model": tts_model,
        "input": script,
        "voice": voice,
        "response_format": "wav",
    }
    if voice_instructions.strip():
        payload["instructions"] = voice_instructions.strip()

    try:
        response = requests.post(
            OPENAI_AUDIO_SPEECH_URL,
            headers=openai_headers(api_key, safety_identifier),
            json=payload,
            timeout=60,
        )
    except requests.RequestException as error:
        raise AudioGenerationError("Could not reach OpenAI to render the voice sample.") from error

    if response.status_code >= 400:
        raise AudioGenerationError(
            openai_error_message(response, "OpenAI could not render the voice sample."),
            502 if response.status_code in {401, 403} or response.status_code >= 500 else response.status_code,
        )

    if not response.content:
        raise AudioGenerationError("OpenAI returned an empty voice sample audio file.")
    return response.content


def get_or_create_voice_sample(
    *,
    api_key,
    assistant_name,
    realtime_model,
    safety_identifier,
    script_model,
    tts_model,
    voice,
    voice_instructions,
):
    cache_key = compute_voice_sample_cache_key(
        assistant_name=assistant_name,
        realtime_model=realtime_model,
        script_model=script_model,
        tts_model=tts_model,
        voice=voice,
        voice_instructions=voice_instructions,
    )
    audio_path = voice_sample_audio_path(cache_key)
    metadata_path = voice_sample_metadata_path(cache_key)

    if audio_path.exists() and metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            script = str(metadata.get("script", "")).strip()
        except (OSError, ValueError):
            script = ""
        if script:
            return CachedVoiceSample(
                audio_path=audio_path,
                cache_key=cache_key,
                cached=True,
                script=script,
            )

    script = generate_intro_script(
        api_key=api_key,
        assistant_name=assistant_name,
        script_model=script_model,
        safety_identifier=safety_identifier,
        voice_instructions=voice_instructions,
    )
    audio_content = generate_speech_audio(
        api_key=api_key,
        safety_identifier=safety_identifier,
        script=script,
        tts_model=tts_model,
        voice=voice,
        voice_instructions=voice_instructions,
    )
    audio_path.write_bytes(audio_content)
    metadata_path.write_text(
        json.dumps(
            {
                "assistantName": assistant_name,
                "realtimeModel": realtime_model,
                "script": script,
                "scriptModel": script_model,
                "ttsModel": tts_model,
                "version": VOICE_SAMPLE_CACHE_VERSION,
                "voice": voice,
                "voiceInstructions": voice_instructions,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    return CachedVoiceSample(
        audio_path=audio_path,
        cache_key=cache_key,
        cached=False,
        script=script,
    )
