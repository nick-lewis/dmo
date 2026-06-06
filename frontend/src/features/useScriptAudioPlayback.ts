import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  RealtimeModelId,
  RealtimeStatus,
  RealtimeVoiceId,
} from "../realtime";
import { apiFetch } from "../api";
import { publicAsset } from "../assets";
import {
  cachedScriptAudioFromMessage,
  displayTextFromScriptAudioMessage,
  scriptAudioSources,
  scriptCuesFromMessage,
} from "../scriptAudio";
import { choiceIconBackgroundValue } from "../uiHelpers";
import type {
  ChatMessage,
  ExperienceEvent,
  EventConversationChoice,
  MessageAudioPayload,
  ScriptCue,
  ScriptWord,
  TutoringSession,
} from "../types";

const scriptTextStreamFallbackMs = 8000;
const scriptTextStreamMinMs = 1600;
const scriptImmediateCueProgress = 0.001;
export const scriptTextAudioRevealSpeedStorageKey =
  "dlu.script-text-audio-reveal-speed.v3";
export const defaultScriptTextAudioRevealSpeed = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function scriptStreamDurationMs(text: string) {
  return clamp(text.length * 46, scriptTextStreamMinMs, scriptTextStreamFallbackMs);
}

export function clampScriptTextAudioRevealSpeed(value: number) {
  if (!Number.isFinite(value)) return defaultScriptTextAudioRevealSpeed;
  return clamp(value, 0.7, 4);
}

export function readScriptTextAudioRevealSpeed() {
  if (typeof window === "undefined") return defaultScriptTextAudioRevealSpeed;

  try {
    return clampScriptTextAudioRevealSpeed(
      Number.parseFloat(
        window.localStorage.getItem(scriptTextAudioRevealSpeedStorageKey) ?? "",
      ),
    );
  } catch {
    return defaultScriptTextAudioRevealSpeed;
  }
}

export function writeScriptTextAudioRevealSpeed(value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      scriptTextAudioRevealSpeedStorageKey,
      clampScriptTextAudioRevealSpeed(value).toFixed(2),
    );
  } catch {
    // Ignore storage failures; the lab still previews the current value.
  }
}

function scriptStreamIndexAt(text: string, progress: number) {
  if (progress >= 1) return text.length;

  const rawIndex = Math.max(1, Math.floor(text.length * progress));
  const nextWhitespace = text.slice(rawIndex).search(/\s/);
  if (nextWhitespace >= 0 && nextWhitespace <= 14) {
    return Math.min(text.length, rawIndex + nextWhitespace + 1);
  }

  return rawIndex;
}

type ScriptTextStreamSync = {
  audio: HTMLAudioElement;
  durationSeconds: number;
  scriptWords?: ScriptWord[];
};

export type ScriptTextBoundary = {
  index: number;
  timeSeconds: number;
};

function textWordCountBefore(text: string, index: number) {
  return text.slice(0, index).match(/\S+/g)?.length ?? 0;
}

function scriptTextBoundaryTime(
  text: string,
  index: number,
  durationSeconds: number,
  scriptWords: ScriptWord[] = [],
) {
  if (!durationSeconds) return 0;

  const wordCount = textWordCountBefore(text, index);
  if (scriptWords.length && wordCount > 0) {
    const word = scriptWords[Math.min(wordCount - 1, scriptWords.length - 1)];
    if (word && Number.isFinite(word.end)) {
      return clamp(word.end, 0, durationSeconds);
    }
  }

  return durationSeconds * clamp(index / Math.max(1, text.length), 0, 1);
}

export function scriptTextPauseBoundaries(
  text: string,
  durationSeconds: number,
  scriptWords: ScriptWord[] = [],
) {
  if (!durationSeconds) return [];

  const boundaries: ScriptTextBoundary[] = [];
  const boundaryPattern = /\n[ \t]*\n+/g;
  let match: RegExpExecArray | null;
  let minimumTimeSeconds = 0;

  while ((match = boundaryPattern.exec(text))) {
    const index = match.index + match[0].length;
    if (index <= 0 || index >= text.length) continue;

    const timeSeconds = clamp(
      scriptTextBoundaryTime(text, index, durationSeconds, scriptWords),
      minimumTimeSeconds + 0.05,
      Math.max(minimumTimeSeconds + 0.05, durationSeconds - 0.05),
    );
    minimumTimeSeconds = timeSeconds;
    boundaries.push({ index, timeSeconds });
  }

  return boundaries;
}

export function scriptStreamIndexAtAudioTime(
  text: string,
  audioTimeSeconds: number,
  durationSeconds: number,
  boundaries: ScriptTextBoundary[],
  revealSpeed = defaultScriptTextAudioRevealSpeed,
) {
  if (!durationSeconds) return text.length;
  const currentTime = clamp(audioTimeSeconds, 0, durationSeconds);
  const stops = [...boundaries, { index: text.length, timeSeconds: durationSeconds }];
  let previousIndex = 0;
  let previousTimeSeconds = 0;

  for (const stop of stops) {
    if (currentTime + 0.015 >= stop.timeSeconds) {
      previousIndex = stop.index;
      previousTimeSeconds = stop.timeSeconds;
      continue;
    }

    const sectionText = text.slice(previousIndex, stop.index);
    const sectionDuration = Math.max(0.05, stop.timeSeconds - previousTimeSeconds);
    const sectionProgress = clamp(
      ((currentTime - previousTimeSeconds) / sectionDuration) *
        clampScriptTextAudioRevealSpeed(revealSpeed),
      0,
      1,
    );

    return previousIndex + scriptStreamIndexAt(sectionText, sectionProgress);
  }

  return text.length;
}

export function scriptTextPreviewIndexAtAudioTime({
  audioTimeSeconds,
  durationSeconds,
  revealSpeed,
  scriptWords = [],
  text,
}: {
  audioTimeSeconds: number;
  durationSeconds: number;
  revealSpeed: number;
  scriptWords?: ScriptWord[];
  text: string;
}) {
  return scriptStreamIndexAtAudioTime(
    text,
    audioTimeSeconds,
    durationSeconds,
    scriptTextPauseBoundaries(text, durationSeconds, scriptWords),
    revealSpeed,
  );
}

function sortedEventConversationChoices(choices: EventConversationChoice[] = []) {
  return [...choices].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

function scriptCueTime(cue: ScriptCue, fallbackDurationSeconds: number) {
  if (typeof cue.time === "number" && Number.isFinite(cue.time)) {
    return cue.time;
  }
  return fallbackDurationSeconds * cue.progress;
}

function scriptCueEffectiveTime(
  cue: ScriptCue,
  fallbackDurationSeconds: number,
) {
  return Math.max(0, scriptCueTime(cue, fallbackDurationSeconds));
}

function scriptCueNeedsTiming(cue: ScriptCue) {
  return cue.progress > scriptImmediateCueProgress && typeof cue.time !== "number";
}

function scriptCuePauseDurationMs(action: Record<string, unknown>) {
  if (action.type !== "pause") return 0;

  const rawDuration = action.durationMs;
  const durationMs =
    typeof rawDuration === "number" || typeof rawDuration === "string"
      ? Number(rawDuration)
      : 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.round(clamp(durationMs, 0, 30000));
}

function scriptCueImageUrls(cues: ScriptCue[]) {
  const urls = new Set<string>();
  cues.forEach((cue) => {
    const action = cue.action;
    if (action.type === "gslide") {
      const imageUrl = typeof action.imageUrl === "string" ? action.imageUrl : "";
      if (imageUrl) urls.add(imageUrl);
    }
    if (
      action.type === "show_image" ||
      action.type === "overlay" ||
      action.type === "side_image"
    ) {
      const imagePath =
        typeof action.imagePath === "string" ? action.imagePath : "";
      if (imagePath) urls.add(publicAsset(imagePath));
    }
  });
  return [...urls];
}

type ScriptAudioPlaybackOptions = {
  activeSessionId: string;
  applyRuntimeActions: (actions: Array<Record<string, unknown>>) => void;
  choiceIconBackground: string;
  selectedModel: RealtimeModelId;
  selectedVoice: RealtimeVoiceId;
  setChatError: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setRealtimeStatus: Dispatch<SetStateAction<RealtimeStatus>>;
  setTurnAnchorMessageId: Dispatch<SetStateAction<string | null>>;
  stopRuntimeSoundEffects: () => void;
};

export function useScriptAudioPlayback({
  activeSessionId,
  applyRuntimeActions,
  choiceIconBackground,
  selectedModel,
  selectedVoice,
  setChatError,
  setMessages,
  setRealtimeStatus,
  setTurnAnchorMessageId,
  stopRuntimeSoundEffects,
}: ScriptAudioPlaybackOptions) {
  const activeSessionIdRef = useRef("");
  const playedScriptMessageIdsRef = useRef(new Set<string>());
  const deferredConversationChoiceStepIdsRef = useRef(new Set<string>());
  const scriptAudioRef = useRef<HTMLAudioElement | null>(null);
  const scriptAudioQueueRef = useRef(Promise.resolve());
  const scriptAudioSkipRef = useRef<(() => void) | null>(null);
  const scriptTextSkipRef = useRef<(() => void) | null>(null);
  const [isScriptAudioPlaying, setIsScriptAudioPlaying] = useState(false);

  function isConversationChoiceDeferred(stepId: string) {
    return deferredConversationChoiceStepIdsRef.current.has(stepId);
  }

  function isScriptAudioMessage(message: ChatMessage) {
    const source =
      typeof message.metadata?.source === "string"
        ? message.metadata.source
        : "";
    return (
      message.role === "assistant" &&
      message.content.trim().length > 0 &&
      scriptAudioSources.has(source)
    );
  }

  function waitForAudioMetadata(audio: HTMLAudioElement) {
    if (audio.readyState >= 1) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        audio.removeEventListener("loadedmetadata", handleReady);
        audio.removeEventListener("canplay", handleReady);
      };
      const handleReady = () => {
        cleanup();
        resolve();
      };
      const timeoutId = window.setTimeout(handleReady, 700);

      audio.addEventListener("loadedmetadata", handleReady, { once: true });
      audio.addEventListener("canplay", handleReady, { once: true });
      audio.load();
    });
  }

  function preloadScriptCueAssets(cues: ScriptCue[]) {
    const urls = scriptCueImageUrls(cues);
    if (!urls.length) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let remaining = urls.length;
      let isDone = false;
      let timeoutId = 0;

      const finishOne = () => {
        remaining -= 1;
        if (remaining <= 0 && !isDone) {
          isDone = true;
          window.clearTimeout(timeoutId);
          resolve();
        }
      };
      timeoutId = window.setTimeout(() => {
        if (isDone) return;
        isDone = true;
        resolve();
      }, 1800);

      urls.forEach((url) => {
        const image = new Image();
        image.onload = finishOne;
        image.onerror = finishOne;
        image.src = url;
      });
    });
  }

  function streamScriptMessageText(
    message: ChatMessage,
    durationMs: number,
    displayText = "",
    sync?: ScriptTextStreamSync,
  ) {
    const fullText = displayText.trim() || message.content;
    if (!fullText.trim()) return Promise.resolve();

    setMessages((current) =>
      current.map((currentMessage) =>
        currentMessage.id === message.id
          ? {
              ...currentMessage,
              content: "",
              metadata: {
                ...currentMessage.metadata,
                scriptHidden: false,
                streaming: true,
              },
            }
          : currentMessage,
      ),
    );

    return new Promise<void>((resolve) => {
      let timeoutId = 0;
      let animationFrame = 0;
      let isDone = false;
      const startedAt = performance.now();
      const audioDurationSeconds =
        sync && sync.durationSeconds > 0
          ? sync.durationSeconds
          : sync
            ? durationMs / 1000
            : 0;
      const audioBoundaries =
        sync && audioDurationSeconds
          ? scriptTextPauseBoundaries(
              fullText,
              audioDurationSeconds,
              sync.scriptWords,
            )
          : [];
      const revealSpeed = readScriptTextAudioRevealSpeed();

      const scheduleTick = () => {
        if (sync) {
          animationFrame = window.requestAnimationFrame(tick);
          return;
        }
        timeoutId = window.setTimeout(tick, 50);
      };

      const finish = () => {
        if (isDone) return;
        isDone = true;
        window.clearTimeout(timeoutId);
        window.cancelAnimationFrame(animationFrame);
        if (scriptTextSkipRef.current === finish) {
          scriptTextSkipRef.current = null;
        }
        setMessages((current) =>
          current.map((currentMessage) =>
            currentMessage.id === message.id
              ? {
                  ...currentMessage,
                  content: fullText,
                  metadata: {
                    ...currentMessage.metadata,
                    scriptHidden: false,
                    streaming: false,
                  },
                }
              : currentMessage,
          ),
        );
        resolve();
      };

      const tick = () => {
        if (isDone) return;

        const nextIndex = sync
          ? scriptStreamIndexAtAudioTime(
              fullText,
              sync.audio.ended ? audioDurationSeconds : sync.audio.currentTime,
              audioDurationSeconds,
              audioBoundaries,
              revealSpeed,
            )
          : scriptStreamIndexAt(
              fullText,
              Math.min(1, (performance.now() - startedAt) / durationMs),
            );

        setMessages((current) =>
          current.map((currentMessage) =>
            currentMessage.id === message.id
              ? {
                  ...currentMessage,
                  content: fullText.slice(0, nextIndex),
                  metadata: {
                    ...currentMessage.metadata,
                    scriptHidden: false,
                    streaming: true,
                  },
                }
              : currentMessage,
          ),
        );

        if (nextIndex >= fullText.length) {
          finish();
          return;
        }

        scheduleTick();
      };

      scriptTextSkipRef.current = finish;
      tick();
    });
  }

  function playPreparedScriptAudio(
    audio: HTMLAudioElement,
    cues: ScriptCue[] = [],
    fallbackDurationSeconds = 0,
  ) {
    return new Promise<void>((resolve, reject) => {
      scriptAudioRef.current = audio;
      let isDone = false;
      let cueIndex = 0;
      let pauseTimeout = 0;
      let timingFrame = 0;

      const currentAudioDuration = () =>
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : fallbackDurationSeconds;
      const cueList = [...cues].sort(
        (left, right) =>
          scriptCueEffectiveTime(left, currentAudioDuration()) -
          scriptCueEffectiveTime(right, currentAudioDuration()),
      );

      const runDueCues = (currentTime: number, runAll = false) => {
        const audioDuration = currentAudioDuration();
        while (cueIndex < cueList.length) {
          const cue = cueList[cueIndex];
          const cueTime = scriptCueEffectiveTime(cue, audioDuration);
          if (!runAll && currentTime + 0.015 < cueTime) break;

          cueIndex += 1;
          const pauseDurationMs = scriptCuePauseDurationMs(cue.action);
          if (pauseDurationMs > 0) {
            if (!runAll) {
              applyRuntimeActions([cue.action]);
              audio.pause();
              window.cancelAnimationFrame(timingFrame);
              window.clearTimeout(pauseTimeout);
              pauseTimeout = window.setTimeout(() => {
                pauseTimeout = 0;
                if (isDone) return;
                void audio.play().catch(() => handleError());
              }, pauseDurationMs);
              break;
            }
            continue;
          }
          applyRuntimeActions([cue.action]);
        }
      };

      const tickCues = () => {
        if (isDone) return;
        runDueCues(audio.currentTime);
        timingFrame = window.requestAnimationFrame(tickCues);
      };

      const cleanup = () => {
        window.clearTimeout(pauseTimeout);
        window.cancelAnimationFrame(timingFrame);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        if (scriptAudioSkipRef.current === handleSkip) {
          scriptAudioSkipRef.current = null;
        }
        if (scriptAudioRef.current === audio) {
          scriptAudioRef.current = null;
        }
      };
      const handleEnded = () => {
        if (isDone) return;
        isDone = true;
        runDueCues(currentAudioDuration(), true);
        cleanup();
        resolve();
      };
      const handleError = () => {
        if (isDone) return;
        isDone = true;
        cleanup();
        reject(new Error("Could not play the scripted audio recording."));
      };
      const handleSkip = () => {
        if (isDone) return;
        isDone = true;
        audio.pause();
        runDueCues(currentAudioDuration(), true);
        cleanup();
        resolve();
      };
      const handlePlay = () => {
        window.cancelAnimationFrame(timingFrame);
        runDueCues(audio.currentTime);
        timingFrame = window.requestAnimationFrame(tickCues);
      };
      const handleTimeUpdate = () => {
        runDueCues(audio.currentTime);
      };

      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("error", handleError);
      audio.addEventListener("play", handlePlay);
      audio.addEventListener("timeupdate", handleTimeUpdate);
      scriptAudioSkipRef.current = handleSkip;
      void audio.play().catch((error: unknown) => {
        isDone = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("Audio playback was blocked."));
      });
    });
  }

  async function playScriptMessage(
    message: ChatMessage,
    audioUrl: string,
    cueValue?: unknown,
    durationSeconds?: number | null,
    displayText = "",
    scriptWords: ScriptWord[] = [],
  ) {
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    const messageDisplayText =
      displayText.trim() || displayTextFromScriptAudioMessage(message);
    const durationMs = scriptStreamDurationMs(messageDisplayText);
    const fallbackDurationSeconds =
      durationSeconds && Number.isFinite(durationSeconds)
        ? durationSeconds
        : durationMs / 1000;

    const allCues = scriptCuesFromMessage(message, cueValue);
    await Promise.all([
      waitForAudioMetadata(audio),
      preloadScriptCueAssets(allCues),
    ]);

    const cues = allCues.filter(
      (cue) => cue.progress > scriptImmediateCueProgress,
    );
    await Promise.all([
      streamScriptMessageText(message, durationMs, messageDisplayText, {
        audio,
        durationSeconds: fallbackDurationSeconds,
        scriptWords,
      }),
      playPreparedScriptAudio(
        audio,
        cues,
        fallbackDurationSeconds,
      ),
    ]);
  }

  function revealScriptMessageText(message: ChatMessage, fallbackDisplayText = "") {
    const displayText =
      fallbackDisplayText.trim() || displayTextFromScriptAudioMessage(message);
    setMessages((current) =>
      current.map((currentMessage) =>
        currentMessage.id === message.id
          ? {
              ...currentMessage,
              content: displayText,
              metadata: {
                ...currentMessage.metadata,
                scriptHidden: false,
                streaming: false,
              },
            }
          : currentMessage,
      ),
    );
  }

  async function playScriptMessages(
    activeSession: TutoringSession,
    candidateMessages: ChatMessage[],
  ) {
    const scriptMessages = candidateMessages.filter(isScriptAudioMessage);
    if (!scriptMessages.length) return;

    for (const message of scriptMessages) {
      if (activeSessionIdRef.current !== activeSession.id) break;
      if (playedScriptMessageIdsRef.current.has(message.id)) continue;
      playedScriptMessageIdsRef.current.add(message.id);

      let payload: MessageAudioPayload | null = null;
      try {
        payload = cachedScriptAudioFromMessage(message);
        const messageCues = scriptCuesFromMessage(message);
        const needsAlignedTiming =
          !payload?.scriptWords?.length ||
          (messageCues.some(scriptCueNeedsTiming) &&
            !payload.scriptCues?.every(
              (cue) =>
                cue.progress <= scriptImmediateCueProgress ||
                typeof cue.time === "number",
            ));
        if (
          !payload ||
          payload.realtimeModel !== selectedModel ||
          payload.voice !== selectedVoice ||
          needsAlignedTiming
        ) {
          payload = await apiFetch<MessageAudioPayload>(
            `/api/sessions/${activeSession.id}/messages/${message.id}/audio/`,
            {
              method: "POST",
              body: JSON.stringify({
                model: selectedModel,
                voice: selectedVoice,
              }),
            },
          );
        }
        if (payload.timingWarning) {
          setChatError(payload.timingWarning);
        }
        await playScriptMessage(
          message,
          payload.audioUrl,
          payload.scriptCues,
          payload.durationSeconds,
          payload.displayText,
          payload.scriptWords ?? [],
        );
      } catch (error) {
        scriptTextSkipRef.current?.();
        revealScriptMessageText(message, payload?.displayText);
        const detail =
          error instanceof Error
            ? error.message
            : "Could not play the scripted audio recording.";
        setRealtimeStatus("audio-blocked");
        setChatError(detail);
        break;
      }
    }
  }

  function conversationChoiceActionsForEvent(event: ExperienceEvent | null) {
    if (!event) return [];

    return sortedEventConversationChoices(event.conversationChoices ?? [])
      .filter(
        (choice) =>
          choice.enabled &&
          choice.label.trim().length > 0 &&
          choice.triggersEvent.trim().length > 0,
      )
      .map((choice) => ({
        eventId: event.id,
        iconBackground: choiceIconBackgroundValue(choiceIconBackground),
        iconPath: choice.iconPath?.trim() ?? "",
        label: choice.label.trim(),
        source: "conversation-choice",
        stepId: `conversation-choice:${choice.id}`,
        triggersEvent: choice.triggersEvent.trim(),
        type: "button_choice",
      }));
  }

  function conversationChoiceActionsFromRanEvents(
    ranEvents: ExperienceEvent[] | undefined,
    fallbackEvent?: ExperienceEvent | null,
  ) {
    const finalEvent = ranEvents?.length
      ? ranEvents[ranEvents.length - 1]
      : fallbackEvent ?? null;
    return conversationChoiceActionsForEvent(finalEvent);
  }

  function conversationChoiceStepIds(actions: Array<Record<string, unknown>>) {
    return actions
      .filter((action) => action.source === "conversation-choice")
      .map((action) => (typeof action.stepId === "string" ? action.stepId : ""))
      .filter(Boolean);
  }

  function deferConversationChoiceActions(actions: Array<Record<string, unknown>>) {
    for (const stepId of conversationChoiceStepIds(actions)) {
      deferredConversationChoiceStepIdsRef.current.add(stepId);
    }
  }

  function revealConversationChoiceActions(actions: Array<Record<string, unknown>>) {
    for (const stepId of conversationChoiceStepIds(actions)) {
      deferredConversationChoiceStepIdsRef.current.delete(stepId);
    }
    applyRuntimeActions(actions);
  }

  function queueScriptMessages(
    activeSession: TutoringSession,
    candidateMessages: ChatMessage[] | undefined,
    afterEntryActions: Array<Record<string, unknown>> = [],
  ) {
    const scriptMessages = candidateMessages?.filter(isScriptAudioMessage) ?? [];
    if (!scriptMessages.length) {
      revealConversationChoiceActions(afterEntryActions);
      return;
    }
    setTurnAnchorMessageId(scriptMessages[0].id);
    deferConversationChoiceActions(afterEntryActions);

    const scriptMessageIds = new Set(scriptMessages.map((message) => message.id));
    const immediateActions = scriptMessages.flatMap((message) =>
      scriptCuesFromMessage(message)
        .filter((cue) => cue.progress <= scriptImmediateCueProgress)
        .map((cue) => cue.action),
    );
    applyRuntimeActions(immediateActions);

    setMessages((current) =>
      current.map((message) =>
        scriptMessageIds.has(message.id)
          ? {
              ...message,
              content: "",
              metadata: {
                ...message.metadata,
                scriptHidden: true,
                streaming: false,
              },
            }
          : message,
      ),
    );

    scriptAudioQueueRef.current = scriptAudioQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setIsScriptAudioPlaying(true);
        try {
          await playScriptMessages(activeSession, scriptMessages);
        } finally {
          if (activeSessionIdRef.current === activeSession.id) {
            revealConversationChoiceActions(afterEntryActions);
          }
          setIsScriptAudioPlaying(false);
        }
      });
  }

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      scriptTextSkipRef.current?.();
      scriptAudioSkipRef.current?.();
      stopRuntimeSoundEffects();
      scriptAudioRef.current?.pause();
      scriptAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    function skipCurrentScriptMessage(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!scriptTextSkipRef.current && !scriptAudioSkipRef.current) return;

      event.preventDefault();
      scriptTextSkipRef.current?.();
      scriptAudioSkipRef.current?.();
      stopRuntimeSoundEffects();
    }

    window.addEventListener("keydown", skipCurrentScriptMessage);
    return () => window.removeEventListener("keydown", skipCurrentScriptMessage);
  }, []);

  useEffect(() => {
    scriptAudioQueueRef.current = Promise.resolve();
    playedScriptMessageIdsRef.current.clear();
    deferredConversationChoiceStepIdsRef.current.clear();
    setIsScriptAudioPlaying(false);
    scriptTextSkipRef.current?.();
    scriptAudioSkipRef.current?.();
    stopRuntimeSoundEffects();
    scriptAudioRef.current?.pause();
    scriptAudioRef.current = null;
  }, [activeSessionId, selectedModel, selectedVoice]);

  return {
    conversationChoiceActionsFromRanEvents,
    isConversationChoiceDeferred,
    isScriptAudioPlaying,
    queueScriptMessages,
  };
}
