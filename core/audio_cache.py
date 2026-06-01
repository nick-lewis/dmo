import hashlib
import json
import wave
from dataclasses import dataclass
from pathlib import Path

import requests
from django.conf import settings


OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_AUDIO_SPEECH_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_AUDIO_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions"
VOICE_SAMPLE_CACHE_VERSION = "voice-sample-v2"
SCRIPT_AUDIO_CACHE_VERSION = "script-audio-v1"
SCRIPT_AUDIO_DISPLAY_VERSION = "script-audio-display-v1"
SCRIPT_AUDIO_TIMING_VERSION = "script-audio-timing-v1"


class AudioGenerationError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AudioTimingError(Exception):
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


@dataclass
class CachedScriptAudio:
    audio_path: Path
    cache_key: str
    cached: bool


def voice_sample_cache_dir():
    cache_dir = Path(settings.MEDIA_ROOT) / "voice_sample_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def voice_sample_audio_path(cache_key):
    return voice_sample_cache_dir() / f"{cache_key}.wav"


def voice_sample_metadata_path(cache_key):
    return voice_sample_cache_dir() / f"{cache_key}.json"


def script_audio_cache_dir():
    cache_dir = Path(settings.MEDIA_ROOT) / "script_audio_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def script_audio_audio_path(cache_key):
    return script_audio_cache_dir() / f"{cache_key}.wav"


def script_audio_metadata_path(cache_key):
    return script_audio_cache_dir() / f"{cache_key}.json"


def script_audio_display_path(display_key):
    return script_audio_cache_dir() / f"{display_key}.display.json"


def safe_cache_part(value):
    return "".join(
        char if char.isalnum() or char in {"-", "_"} else "_"
        for char in str(value or "")
    ).strip("_") or "default"


def script_audio_words_path(cache_key, alignment_model):
    model_part = safe_cache_part(alignment_model)
    return script_audio_cache_dir() / f"{cache_key}.{model_part}.words.json"


def wav_data_size(audio_path):
    try:
        file_size = audio_path.stat().st_size
        with audio_path.open("rb") as audio_file:
            if audio_file.read(4) != b"RIFF":
                return None
            audio_file.seek(12)
            while audio_file.tell() + 8 <= file_size:
                chunk_id = audio_file.read(4)
                chunk_size = int.from_bytes(audio_file.read(4), "little")
                chunk_start = audio_file.tell()
                if chunk_id == b"data":
                    return max(0, min(chunk_size, file_size - chunk_start))
                audio_file.seek(chunk_size + (chunk_size % 2), 1)
    except OSError:
        return None
    return None


def audio_duration_seconds(audio_path):
    try:
        with wave.open(str(audio_path), "rb") as audio_file:
            frame_rate = audio_file.getframerate()
            frame_bytes = audio_file.getnchannels() * audio_file.getsampwidth()
            if frame_rate <= 0:
                return None
            if frame_bytes <= 0:
                return None

            data_size = wav_data_size(audio_path)
            if data_size is not None:
                return data_size / (frame_rate * frame_bytes)

            return audio_file.getnframes() / frame_rate
    except (OSError, EOFError, wave.Error):
        return None


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


def compute_script_audio_cache_key(
    *,
    assistant_name,
    realtime_model,
    script,
    tts_model,
    voice,
    voice_instructions,
):
    cache_payload = {
        "assistantName": assistant_name.strip(),
        "realtimeModel": realtime_model,
        "script": script.strip(),
        "ttsModel": tts_model,
        "version": SCRIPT_AUDIO_CACHE_VERSION,
        "voice": voice,
        "voiceInstructions": voice_instructions.strip(),
    }
    cache_source = json.dumps(cache_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(cache_source.encode("utf-8")).hexdigest()[:32]


def compute_script_audio_display_key(script):
    cache_payload = {
        "script": str(script or "").strip(),
        "version": SCRIPT_AUDIO_DISPLAY_VERSION,
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


def openai_auth_headers(api_key, safety_identifier):
    headers = {
        "Authorization": f"Bearer {api_key}",
    }
    if safety_identifier:
        headers["OpenAI-Safety-Identifier"] = safety_identifier
    return headers


def build_exact_speech_instructions(voice_instructions):
    base = (
        "Read the provided script exactly as written. Do not add greetings, "
        "commentary, labels, or extra words. Treat text in curly braces as "
        "private performance direction, not spoken text."
    )
    voice_instructions = voice_instructions.strip()
    if not voice_instructions:
        return base
    return f"{base}\n\nVoice and performance guidance: {voice_instructions}"


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
    payload["instructions"] = build_exact_speech_instructions(voice_instructions)

    try:
        response = requests.post(
            OPENAI_AUDIO_SPEECH_URL,
            headers=openai_headers(api_key, safety_identifier),
            json=payload,
            timeout=60,
        )
    except requests.RequestException as error:
        raise AudioGenerationError("Could not reach OpenAI to render audio.") from error

    if response.status_code >= 400:
        raise AudioGenerationError(
            openai_error_message(response, "OpenAI could not render audio."),
            502 if response.status_code in {401, 403} or response.status_code >= 500 else response.status_code,
        )

    if not response.content:
        raise AudioGenerationError("OpenAI returned an empty audio file.")
    return response.content


def normalize_transcription_words(value):
    if not isinstance(value, list):
        return []

    words = []
    for item in value:
        if not isinstance(item, dict):
            continue

        word = str(item.get("word", "")).strip()
        if not word:
            continue

        try:
            start = float(item.get("start", 0) or 0)
            end = float(item.get("end", start) or start)
        except (TypeError, ValueError):
            continue

        start = max(0.0, start)
        end = max(start, end)
        words.append(
            {
                "word": word,
                "start": round(start, 3),
                "end": round(end, 3),
            }
        )

    return words


def transcribe_script_audio_words(
    *,
    api_key,
    alignment_model,
    audio_path,
    safety_identifier,
    script,
):
    try:
        with audio_path.open("rb") as audio_file:
            response = requests.post(
                OPENAI_AUDIO_TRANSCRIPTIONS_URL,
                headers=openai_auth_headers(api_key, safety_identifier),
                files={"file": (audio_path.name, audio_file, "audio/wav")},
                data=[
                    ("model", alignment_model),
                    ("response_format", "verbose_json"),
                    ("timestamp_granularities[]", "word"),
                    ("language", "en"),
                    ("prompt", script[:1200]),
                ],
                timeout=120,
            )
    except (OSError, requests.RequestException) as error:
        raise AudioTimingError("Could not reach OpenAI to align script audio.") from error

    if response.status_code >= 400:
        raise AudioTimingError(
            openai_error_message(response, "OpenAI could not align script audio."),
            502 if response.status_code in {401, 403} or response.status_code >= 500 else response.status_code,
        )

    try:
        payload = response.json()
    except ValueError as error:
        raise AudioTimingError("OpenAI returned unreadable script audio timing.") from error

    words = normalize_transcription_words(payload.get("words"))
    if not words:
        raise AudioTimingError("OpenAI returned no word timings for script audio.")
    return words


def get_or_create_script_audio_words(
    *,
    api_key,
    alignment_model,
    audio_path,
    cache_key,
    safety_identifier,
    script,
):
    alignment_model = (alignment_model or "whisper-1").strip() or "whisper-1"
    words_path = script_audio_words_path(cache_key, alignment_model)

    if words_path.exists():
        try:
            words = normalize_transcription_words(
                json.loads(words_path.read_text(encoding="utf-8"))
            )
        except (OSError, ValueError):
            words = []
        if words:
            return words

    words = transcribe_script_audio_words(
        api_key=api_key,
        alignment_model=alignment_model,
        audio_path=audio_path,
        safety_identifier=safety_identifier,
        script=script,
    )
    words_path.write_text(json.dumps(words, indent=2), encoding="utf-8")
    return words


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


def get_or_create_script_audio(
    *,
    api_key,
    assistant_name,
    realtime_model,
    safety_identifier,
    script,
    tts_model,
    voice,
    voice_instructions,
):
    script = script.strip()
    if not script:
        raise AudioGenerationError("Script audio requires text.", status_code=400)

    cache_key = compute_script_audio_cache_key(
        assistant_name=assistant_name,
        realtime_model=realtime_model,
        script=script,
        tts_model=tts_model,
        voice=voice,
        voice_instructions=voice_instructions,
    )
    audio_path = script_audio_audio_path(cache_key)
    metadata_path = script_audio_metadata_path(cache_key)

    if audio_path.exists() and metadata_path.exists():
        return CachedScriptAudio(
            audio_path=audio_path,
            cache_key=cache_key,
            cached=True,
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
                "ttsModel": tts_model,
                "version": SCRIPT_AUDIO_CACHE_VERSION,
                "voice": voice,
                "voiceInstructions": voice_instructions,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    return CachedScriptAudio(
        audio_path=audio_path,
        cache_key=cache_key,
        cached=False,
    )
