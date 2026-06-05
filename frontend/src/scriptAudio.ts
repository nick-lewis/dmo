import type {
  RealtimeModelId,
  RealtimeVoiceId,
} from "./realtime";
import type {
  ChatMessage,
  MessageAudioPayload,
  ScriptCue,
  ScriptWord,
} from "./types";

export const scriptAudioPlaybackRateOptions = [0.75, 1, 1.25, 1.5, 2] as const;

export const scriptAudioSources = new Set([
  "event-action",
  "conversation-tool-action",
  "conversation-check-action",
  "classifier-group-action",
]);


function clampCueProgress(value: number) {
  return Math.min(Math.max(value, 0), 1);
}


export function scriptCuesFromValue(value: unknown): ScriptCue[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ScriptCue | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const cue = item as Record<string, unknown>;
      const action = cue.action;
      if (!action || typeof action !== "object" || Array.isArray(action)) return null;

      const rawProgress = Number(cue.progress);
      const rawTime = Number(cue.time);
      const rawWordIndex = Number(cue.wordIndex);
      const parsedCue: ScriptCue = {
        action: action as Record<string, unknown>,
        progress: Number.isFinite(rawProgress) ? clampCueProgress(rawProgress) : 0,
      };
      if (Number.isFinite(rawTime) && rawTime >= 0) {
        parsedCue.time = rawTime;
      }
      if (Number.isFinite(rawWordIndex) && rawWordIndex >= 0) {
        parsedCue.wordIndex = Math.floor(rawWordIndex);
      }
      return parsedCue;
    })
    .filter((cue): cue is ScriptCue => Boolean(cue))
    .sort((left, right) => {
      const leftSort =
        typeof left.time === "number" ? left.time : left.progress * 100000;
      const rightSort =
        typeof right.time === "number" ? right.time : right.progress * 100000;
      return leftSort - rightSort;
    });
}


export function scriptWordsFromValue(value: unknown): ScriptWord[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const word = item as Record<string, unknown>;
      const text = typeof word.word === "string" ? word.word.trim() : "";
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;

      return {
        end: Math.max(start, end),
        start: Math.max(0, start),
        word: text,
      };
    })
    .filter((word): word is ScriptWord => Boolean(word))
    .sort((left, right) => left.start - right.start);
}


export function scriptCuesFromMessage(
  message: ChatMessage,
  fallbackValue?: unknown,
): ScriptCue[] {
  const metadataCues = scriptCuesFromValue(message.metadata?.scriptCues);
  if (metadataCues.length) return metadataCues;
  return scriptCuesFromValue(fallbackValue);
}


export function cachedScriptAudioFromMessage(
  message: ChatMessage,
): MessageAudioPayload | null {
  const rawAudio = message.metadata?.scriptAudio;
  if (!rawAudio || typeof rawAudio !== "object" || Array.isArray(rawAudio)) {
    return null;
  }

  const audio = rawAudio as Record<string, unknown>;
  const audioUrl = typeof audio.audioUrl === "string" ? audio.audioUrl : "";
  const realtimeModel =
    typeof audio.realtimeModel === "string" ? audio.realtimeModel : "";
  const voice = typeof audio.voice === "string" ? audio.voice : "";
  if (!audioUrl || !realtimeModel || !voice) return null;
  const audioScriptCues = scriptCuesFromValue(audio.scriptCues);

  return {
    audioUrl,
    audioEngine:
      typeof audio.audioEngine === "string" ? audio.audioEngine : "",
    audioModel: typeof audio.audioModel === "string" ? audio.audioModel : "",
    cached: Boolean(audio.cached),
    displayText: typeof audio.displayText === "string" ? audio.displayText : "",
    durationSeconds:
      typeof audio.durationSeconds === "number" &&
      Number.isFinite(audio.durationSeconds)
        ? audio.durationSeconds
        : null,
    messageId:
      typeof audio.messageId === "string" ? audio.messageId : message.id,
    realtimeModel: realtimeModel as RealtimeModelId,
    scriptCues: audioScriptCues.length
      ? audioScriptCues
      : scriptCuesFromMessage(message),
    scriptWords: scriptWordsFromValue(audio.scriptWords),
    timingModel: typeof audio.timingModel === "string" ? audio.timingModel : "",
    timingWarning:
      typeof audio.timingWarning === "string" ? audio.timingWarning : "",
    ttsModel: typeof audio.ttsModel === "string" ? audio.ttsModel : "",
    voice: voice as RealtimeVoiceId,
  };
}


export function displayTextFromScriptAudioMessage(message: ChatMessage) {
  const displayText = cachedScriptAudioFromMessage(message)?.displayText?.trim();
  return displayText || message.content;
}
