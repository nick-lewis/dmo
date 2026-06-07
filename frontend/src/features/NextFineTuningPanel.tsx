import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MicIcon, StopIcon } from "../components/Icons";
import {
  appendScriptMarkerTimelineArg,
  buildScriptMarker,
  countScriptWords,
  parseScriptMarkerInstances,
  scriptMarkerIcon,
  spokenTextFromMarkedScript,
  type ScriptMarkerInstance,
  type ScriptSlidePreview,
} from "../scriptMarkers";
import { scriptAudioPlaybackRateOptions } from "../scriptAudio";
import type { ScriptAudioItem } from "../types";
import {
  scriptDisplayChunkStatesAt,
  type ScriptDisplayChunkState,
} from "./useScriptAudioPlayback";
import {
  clamp,
  isSlideMarker,
  markerTimelineTimeSeconds,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import { formatTimelineSeconds } from "./ScriptAudioPanel";
import {
  normalizeScriptDisplayCueOffsets,
  scriptDisplayChunkSpecsFromValues,
  type ScriptDisplayChunkSpec,
} from "./scriptDisplayTiming";

type WaveformState = {
  peaks: number[];
  status: "empty" | "error" | "loading" | "ready";
};

type MarkerDragState = {
  lastClientX: number;
  markerIndex: number;
  moved: boolean;
  timeSeconds: number;
};

type DisplayCueDragState = {
  cueIndex: number;
  lastClientX: number;
  moved: boolean;
  timeSeconds: number;
};

type ActiveMarkerDrag = {
  markerIndex: number;
  timeSeconds: number;
} | null;

type ActiveDisplayCueDrag = {
  cueIndex: number;
  timeSeconds: number;
} | null;

type ScrubState = {
  fineDrag: boolean;
  lastClientX: number;
  pointerId: number;
  timeSeconds: number;
};

type MouseScrubState = {
  fineDrag: boolean;
  lastClientX: number;
  timeSeconds: number;
};

type ManualSeekState = {
  expiresAt: number;
  timeSeconds: number;
};

type TimelineMarkerLayout = {
  hasTimeMatch: boolean;
  index: number;
  lane: number;
  marker: ScriptMarkerInstance;
  timeSeconds: number;
};

type DisplayCueLayout = {
  chunk: ScriptDisplayChunkSpec;
  hasTimeMatch: boolean;
  index: number;
  lane: number;
  timeSeconds: number;
};

type FineTuningTimelineMode = "actions" | "chat-cues";

type FineTuningPanelProps = {
  audioItem: ScriptAudioItem | null;
  deckUrl: string;
  displayBreaks: number[];
  displayCueOffsets: number[];
  displaySlots: string[];
  onDisplayCueOffsetsChange: (offsets: number[]) => void;
  onMarkedTextChange: (value: string) => void;
  previews: Record<string, ScriptSlidePreview>;
  text: string;
  textRevealSpeed: number;
};

const defaultWaveformBucketCount = 520;
const markerFineDragRatio = 0.08;
const markerKeyboardStepSeconds = 0.005;
const markerKeyboardFineStepSeconds = 0.001;
const markerSnapThresholdSeconds = 0.03;
const fineTuningSpeedStorageKey = "dlu.next-fine-tuning-speed.v1";

function replaceScriptMarker(
  text: string,
  marker: ScriptMarkerInstance,
  nextMarker: string,
) {
  return `${text.slice(0, marker.start)}${nextMarker}${text.slice(marker.end)}`;
}

function markerLabel(marker: ScriptMarkerInstance) {
  if (isSlideMarker(marker)) {
    return `Slide ${marker.argList[0]?.trim() || "1"}`;
  }
  return marker.detail || marker.label;
}

function markerHasIcon(marker: ScriptMarkerInstance) {
  return !isSlideMarker(marker) && marker.type !== "side_image";
}

function estimateMarkerWidthPx(marker: ScriptMarkerInstance) {
  const labelLength = markerLabel(marker).length;
  const iconWidth = markerHasIcon(marker) ? 20 : 0;
  return Math.min(178, Math.max(74, 48 + iconWidth + labelLength * 6.2));
}

function displayCueLabel(chunk: ScriptDisplayChunkSpec) {
  return `Chunk ${chunk.index + 1}`;
}

function estimateDisplayCueWidthPx(chunk: ScriptDisplayChunkSpec) {
  return Math.min(150, Math.max(92, 66 + displayCueLabel(chunk).length * 6.2));
}

function decodePeaks(audioBuffer: AudioBuffer, bucketCount: number) {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const length = audioBuffer.length;
  const samplesPerBucket = Math.max(1, Math.floor(length / bucketCount));
  const peaks: number[] = [];

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * samplesPerBucket;
    const end =
      bucket === bucketCount - 1
        ? length
        : Math.min(length, start + samplesPerBucket);
    let peak = 0;

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const data = audioBuffer.getChannelData(channelIndex);
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index] ?? 0));
      }
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0);
  if (!maxPeak) return peaks.map(() => 0);
  return peaks.map((peak) => peak / maxPeak);
}

function useAudioWaveform(audioUrl: string, bucketCount: number) {
  const [waveform, setWaveform] = useState<WaveformState>({
    peaks: [],
    status: "empty",
  });

  useEffect(() => {
    if (!audioUrl) {
      setWaveform({ peaks: [], status: "empty" });
      return undefined;
    }

    let isCancelled = false;
    setWaveform({ peaks: [], status: "loading" });

    const AudioContextConstructor =
      window.AudioContext ||
      (
        window as Window &
          typeof globalThis & {
            webkitAudioContext?: typeof AudioContext;
          }
      ).webkitAudioContext;

    if (!AudioContextConstructor) {
      setWaveform({ peaks: [], status: "error" });
      return undefined;
    }

    const audioContext = new AudioContextConstructor();

    void fetch(audioUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load audio.");
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
      .then((audioBuffer) => {
        if (isCancelled) return;
        setWaveform({
          peaks: decodePeaks(audioBuffer, bucketCount),
          status: "ready",
        });
      })
      .catch(() => {
        if (!isCancelled) setWaveform({ peaks: [], status: "error" });
      })
      .finally(() => {
        void audioContext.close().catch(() => undefined);
      });

    return () => {
      isCancelled = true;
      void audioContext.close().catch(() => undefined);
    };
  }, [audioUrl, bucketCount]);

  return waveform;
}

function useSeekableAudioUrl(audioUrl: string) {
  const [seekableAudioUrl, setSeekableAudioUrl] = useState("");

  useEffect(() => {
    let isCancelled = false;
    let objectUrl = "";
    setSeekableAudioUrl("");

    if (!audioUrl) return undefined;

    void fetch(audioUrl, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load fine tuning audio.");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (isCancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          return;
        }
        setSeekableAudioUrl(objectUrl);
      })
      .catch(() => {
        if (!isCancelled) setSeekableAudioUrl(audioUrl);
      });

    return () => {
      isCancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [audioUrl]);

  return seekableAudioUrl;
}

function playbackRateFromStorage() {
  try {
    const saved = Number(window.localStorage.getItem(fineTuningSpeedStorageKey));
    return scriptAudioPlaybackRateOptions.includes(
      saved as (typeof scriptAudioPlaybackRateOptions)[number],
    )
      ? saved
      : 1;
  } catch {
    return 1;
  }
}

function FineTuningChatBubble({
  chunk,
  registerRef,
}: {
  chunk: ScriptDisplayChunkState;
  registerRef: (element: HTMLDivElement | null) => void;
}) {
  const body =
    chunk.text || (chunk.streaming || chunk.active ? "..." : chunk.fullText);

  return (
    <div
      className={[
        "next-fine-chat-bubble",
        chunk.active ? "is-active" : "",
        chunk.streaming ? "is-streaming" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={registerRef}
    >
      {body}
    </div>
  );
}

export function NextFineTuningPanel({
  audioItem,
  deckUrl,
  displayBreaks,
  displayCueOffsets,
  displaySlots,
  onDisplayCueOffsetsChange,
  onMarkedTextChange,
  previews,
  text,
  textRevealSpeed,
}: FineTuningPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatPreviewChunkRefs = useRef(new Map<string, HTMLDivElement>());
  const chatPreviewRef = useRef<HTMLDivElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const displayCueDragRef = useRef<DisplayCueDragState | null>(null);
  const ignoreMarkerClickRef = useRef(false);
  const ignoreWaveformClickRef = useRef(false);
  const manualSeekRef = useRef<ManualSeekState | null>(null);
  const markerDragRef = useRef<MarkerDragState | null>(null);
  const mouseScrubRef = useRef<MouseScrubState | null>(null);
  const scrubRef = useRef<ScrubState | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggingDisplayCue, setDraggingDisplayCue] =
    useState<ActiveDisplayCueDrag>(null);
  const [draggingMarker, setDraggingMarker] = useState<ActiveMarkerDrag>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(playbackRateFromStorage);
  const [selectedDisplayCueIndex, setSelectedDisplayCueIndex] = useState<
    number | null
  >(null);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(
    null,
  );
  const [timelineMode, setTimelineMode] =
    useState<FineTuningTimelineMode>("actions");
  const [draftDisplayCueOffsets, setDraftDisplayCueOffsets] =
    useState<number[]>(displayCueOffsets);
  const displayCueOffsetKey = displayCueOffsets.join("|");
  const [waveformBucketCount, setWaveformBucketCount] = useState(
    defaultWaveformBucketCount,
  );
  const [waveformWidth, setWaveformWidth] = useState(0);
  const audioUrl = audioItem?.audioUrl ?? "";
  const audioPlaybackUrl = useSeekableAudioUrl(audioUrl);
  const waveform = useAudioWaveform(audioUrl, waveformBucketCount);
  const markers = parseScriptMarkerInstances(text);
  const spokenText = spokenTextFromMarkedScript(text);
  const spokenWordCount = countScriptWords(spokenText);
  const timingWords = audioItem?.timingWords ?? [];
  const durationSeconds = Math.max(
    0,
    audioItem?.durationSeconds ||
      audioDuration ||
      timingWords[timingWords.length - 1]?.end ||
      0,
  );
  const durationForLayout = durationSeconds || 1;
  const visibleTime =
    draggingMarker?.timeSeconds ?? draggingDisplayCue?.timeSeconds ?? currentTime;
  const progressPercent = clamp((visibleTime / durationForLayout) * 100, 0, 100);
  const currentWord =
    timingWords.find((word) => visibleTime >= word.start && visibleTime <= word.end)
      ?.word ?? "";
  const effectiveDisplayCueOffsets = draftDisplayCueOffsets.length
    ? draftDisplayCueOffsets
    : displayCueOffsets;
  const displayChunks = scriptDisplayChunkSpecsFromValues({
    displayBreaks,
    displayCueOffsets: effectiveDisplayCueOffsets,
    displaySlots,
    durationSeconds,
    messageId: audioItem?.id ?? "",
    scriptWords: timingWords,
  });
  const displayCueChunks = displayChunks.filter(
    (chunk) => chunk.boundaryIndex >= 0,
  );
  const chatPreviewState = displayChunks.length
    ? scriptDisplayChunkStatesAt(
        displayChunks,
        visibleTime,
        durationSeconds > 0 && visibleTime + 0.015 >= durationSeconds,
        textRevealSpeed,
      )
    : null;
  const visibleChatChunks = chatPreviewState?.states.filter(
    (chunk) => chunk.visible,
  ) ?? [];
  const activeChatChunkId = chatPreviewState?.activeChunkId ?? "";

  function timeFromClientX(clientX: number) {
    const rect = waveformRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || !durationSeconds) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * durationSeconds;
  }

  function timeFromWaveformEvent(
    event: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>,
    fallbackSeconds = 0,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || !durationSeconds) return fallbackSeconds;

    const clientOffset = event.clientX - rect.left;
    const nativeOffset = Number(
      (event.nativeEvent as MouseEvent | PointerEvent).offsetX,
    );
    const hasUsableClientOffset =
      Number.isFinite(clientOffset) &&
      clientOffset >= -1 &&
      clientOffset <= rect.width + 1;
    const hasUsableNativeOffset =
      Number.isFinite(nativeOffset) &&
      nativeOffset >= 0 &&
      nativeOffset <= rect.width;
    const offsetX = hasUsableClientOffset
      ? clientOffset
      : hasUsableNativeOffset
        ? nativeOffset
        : Number.NaN;

    if (!Number.isFinite(offsetX)) return fallbackSeconds;
    return clamp(offsetX / rect.width, 0, 1) * durationSeconds;
  }

  function dragAdjustedTime(
    clientX: number,
    lastClientX: number,
    currentSeconds: number,
    isFineDrag: boolean,
  ) {
    if (!isFineDrag) return timeFromClientX(clientX);

    const previousPointerSeconds = timeFromClientX(lastClientX);
    const nextPointerSeconds = timeFromClientX(clientX);
    return clamp(
      currentSeconds +
        (nextPointerSeconds - previousPointerSeconds) * markerFineDragRatio,
      0,
      durationSeconds || 0,
    );
  }

  function markerTime(marker: ScriptMarkerInstance, index: number) {
    if (draggingMarker?.markerIndex === index) return draggingMarker.timeSeconds;
    return markerTimelineTimeSeconds(
      marker,
      timingWords,
      durationSeconds,
      spokenWordCount,
    );
  }

  function seek(seconds: number, options?: { pause?: boolean }) {
    const nextTime = clamp(seconds, 0, durationSeconds || 0);
    manualSeekRef.current = {
      expiresAt: window.performance.now() + 650,
      timeSeconds: nextTime,
    };
    setCurrentTime(nextTime);
    if (audioRef.current) {
      if (options?.pause) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
      audioRef.current.currentTime = nextTime;
    }
  }

  function updateMarkerTime(markerIndex: number, seconds: number) {
    const marker = markers[markerIndex];
    if (!marker) return;

    const nextMarker = buildScriptMarker(
      marker.type,
      appendScriptMarkerTimelineArg(marker.argList, seconds * 1000),
    );
    onMarkedTextChange(replaceScriptMarker(text, marker, nextMarker));
  }

  function displayCueTime(cueIndex: number) {
    if (draggingDisplayCue?.cueIndex === cueIndex) {
      return draggingDisplayCue.timeSeconds;
    }
    return displayCueChunks[cueIndex]?.startTime ?? 0;
  }

  function clampDisplayCueTime(cueIndex: number, seconds: number) {
    const previousTime = cueIndex > 0 ? displayCueTime(cueIndex - 1) + 0.05 : 0;
    const nextTime =
      cueIndex < displayCueChunks.length - 1
        ? displayCueTime(cueIndex + 1) - 0.05
        : durationSeconds || seconds;
    return clamp(seconds, previousTime, Math.max(previousTime, nextTime));
  }

  function updateDisplayCueTime(cueIndex: number, seconds: number) {
    const cue = displayCueChunks[cueIndex];
    if (!cue) return;

    const nextOffsets = normalizeScriptDisplayCueOffsets(
      effectiveDisplayCueOffsets,
      displayCueChunks.length,
    );
    const nextTime = clampDisplayCueTime(cueIndex, seconds);
    nextOffsets[cueIndex] = Number(
      (nextTime - cue.automaticStartTime).toFixed(3),
    );
    setDraftDisplayCueOffsets(nextOffsets);
    onDisplayCueOffsetsChange(nextOffsets);
  }

  function snapMarkerTime(seconds: number, markerIndex: number) {
    const match = markers
      .map((marker, index) => ({
        index,
        timeSeconds: markerTime(marker, index),
      }))
      .filter(({ index }) => index !== markerIndex)
      .find(
        ({ timeSeconds }) =>
          Math.abs(timeSeconds - seconds) <= markerSnapThresholdSeconds,
      );
    return match ? match.timeSeconds : seconds;
  }

  function activeSlideMarker(): ScriptMarkerInstance | null {
    let active: ScriptMarkerInstance | null = null;
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      if (!marker) continue;
      if (!isSlideMarker(marker)) continue;
      if (markerTime(marker, index) <= visibleTime + 0.001) active = marker;
    }
    return active;
  }

  function slidePreviewForMarker(marker: ScriptMarkerInstance) {
    const markerSlideRef = marker.argList[0]?.trim() || "";
    if (!markerSlideRef || !deckUrl.trim()) return null;
    return previews[slidePreviewKeyForDeck(deckUrl, markerSlideRef)] ?? null;
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !audioPlaybackUrl) return;

    audio.playbackRate = playbackRate;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
      return;
    }
    audio.pause();
  }

  function cyclePlaybackRate() {
    const currentIndex = scriptAudioPlaybackRateOptions.indexOf(
      playbackRate as (typeof scriptAudioPlaybackRateOptions)[number],
    );
    const nextRate =
      scriptAudioPlaybackRateOptions[
        (currentIndex + 1) % scriptAudioPlaybackRateOptions.length
      ] ?? 1;
    setPlaybackRate(nextRate);
  }

  function beginScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (!audioUrl || event.button > 0) return;
    event.preventDefault();
    const nextTime = event.shiftKey
      ? currentTime
      : timeFromWaveformEvent(event);
    scrubRef.current = {
      fineDrag: event.shiftKey,
      lastClientX: event.clientX,
      pointerId: event.pointerId,
      timeSeconds: nextTime,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(nextTime, { pause: true });
  }

  function updateScrub(event: ReactPointerEvent<HTMLDivElement>) {
    const scrubState = scrubRef.current;
    if (!scrubState || scrubState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextTime = scrubState.fineDrag || event.shiftKey
      ? dragAdjustedTime(
          event.clientX,
          scrubState.lastClientX,
          scrubState.timeSeconds,
          true,
        )
      : timeFromWaveformEvent(event, scrubState.timeSeconds);
    scrubState.lastClientX = event.clientX;
    scrubState.timeSeconds = nextTime;
    seek(nextTime, { pause: true });
  }

  function endScrub(event: ReactPointerEvent<HTMLDivElement>) {
    const scrubState = scrubRef.current;
    if (!scrubState || scrubState.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    seek(scrubState.timeSeconds, { pause: true });
    scrubRef.current = null;
    ignoreWaveformClickRef.current = true;
    window.setTimeout(() => {
      ignoreWaveformClickRef.current = false;
    }, 120);
  }

  function beginMouseScrub(event: ReactMouseEvent<HTMLDivElement>) {
    if (!audioUrl || event.button > 0 || scrubRef.current) return;
    event.preventDefault();
    const nextTime = event.shiftKey
      ? currentTime
      : timeFromWaveformEvent(event);
    mouseScrubRef.current = {
      fineDrag: event.shiftKey,
      lastClientX: event.clientX,
      timeSeconds: nextTime,
    };
    seek(nextTime, { pause: true });
  }

  function updateMouseScrub(event: ReactMouseEvent<HTMLDivElement>) {
    const scrubState = mouseScrubRef.current;
    if (!scrubState) return;
    event.preventDefault();
    const nextTime = scrubState.fineDrag || event.shiftKey
      ? dragAdjustedTime(
          event.clientX,
          scrubState.lastClientX,
          scrubState.timeSeconds,
          true,
        )
      : timeFromWaveformEvent(event, scrubState.timeSeconds);
    scrubState.lastClientX = event.clientX;
    scrubState.timeSeconds = nextTime;
    seek(nextTime, { pause: true });
  }

  function endMouseScrub(event: ReactMouseEvent<HTMLDivElement>) {
    const scrubState = mouseScrubRef.current;
    if (!scrubState) return;
    event.preventDefault();
    seek(scrubState.timeSeconds, { pause: true });
    mouseScrubRef.current = null;
    ignoreWaveformClickRef.current = true;
    window.setTimeout(() => {
      ignoreWaveformClickRef.current = false;
    }, 120);
  }

  function beginMarkerDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    markerIndex: number,
    seconds: number,
  ) {
    if (!durationSeconds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    markerDragRef.current = {
      lastClientX: event.clientX,
      markerIndex,
      moved: false,
      timeSeconds: seconds,
    };
    setSelectedMarkerIndex(markerIndex);
    setDraggingMarker({ markerIndex, timeSeconds: seconds });
    setCurrentTime(seconds);
  }

  function updateMarkerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = markerDragRef.current;
    if (!dragState) return;
    const previousPointerSeconds = timeFromClientX(dragState.lastClientX);
    const nextPointerSeconds = timeFromClientX(event.clientX);
    const dragRatio = event.shiftKey ? markerFineDragRatio : 1;
    const nextSeconds = clamp(
      dragState.timeSeconds +
        (nextPointerSeconds - previousPointerSeconds) * dragRatio,
      0,
      durationSeconds || 0,
    );
    const snappedSeconds = event.shiftKey
      ? nextSeconds
      : snapMarkerTime(nextSeconds, dragState.markerIndex);
    dragState.lastClientX = event.clientX;
    dragState.timeSeconds = snappedSeconds;
    dragState.moved = true;
    setDraggingMarker({
      markerIndex: dragState.markerIndex,
      timeSeconds: snappedSeconds,
    });
    setCurrentTime(snappedSeconds);
  }

  function endMarkerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = markerDragRef.current;
    if (!dragState || !draggingMarker) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragState.moved) {
      ignoreMarkerClickRef.current = true;
      window.setTimeout(() => {
        ignoreMarkerClickRef.current = false;
      }, 120);
      updateMarkerTime(dragState.markerIndex, draggingMarker.timeSeconds);
    }
    seek(draggingMarker.timeSeconds);
    markerDragRef.current = null;
    setDraggingMarker(null);
  }

  function beginDisplayCueDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    cueIndex: number,
    seconds: number,
  ) {
    if (!durationSeconds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    displayCueDragRef.current = {
      cueIndex,
      lastClientX: event.clientX,
      moved: false,
      timeSeconds: seconds,
    };
    setSelectedDisplayCueIndex(cueIndex);
    setDraggingDisplayCue({ cueIndex, timeSeconds: seconds });
    setCurrentTime(seconds);
  }

  function updateDisplayCueDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = displayCueDragRef.current;
    if (!dragState) return;
    const previousPointerSeconds = timeFromClientX(dragState.lastClientX);
    const nextPointerSeconds = timeFromClientX(event.clientX);
    const dragRatio = event.shiftKey ? markerFineDragRatio : 1;
    const nextSeconds = clampDisplayCueTime(
      dragState.cueIndex,
      dragState.timeSeconds +
        (nextPointerSeconds - previousPointerSeconds) * dragRatio,
    );
    dragState.lastClientX = event.clientX;
    dragState.timeSeconds = nextSeconds;
    dragState.moved = true;
    setDraggingDisplayCue({
      cueIndex: dragState.cueIndex,
      timeSeconds: nextSeconds,
    });
    setCurrentTime(nextSeconds);
  }

  function endDisplayCueDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragState = displayCueDragRef.current;
    if (!dragState || !draggingDisplayCue) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragState.moved) {
      ignoreMarkerClickRef.current = true;
      window.setTimeout(() => {
        ignoreMarkerClickRef.current = false;
      }, 120);
      updateDisplayCueTime(dragState.cueIndex, draggingDisplayCue.timeSeconds);
    }
    seek(draggingDisplayCue.timeSeconds);
    displayCueDragRef.current = null;
    setDraggingDisplayCue(null);
  }

  function moveMarkerByKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    markerIndex: number,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    event.stopPropagation();
    const marker = markers[markerIndex];
    if (!marker) return;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const step = event.shiftKey
      ? markerKeyboardFineStepSeconds
      : markerKeyboardStepSeconds;
    const nextTime = clamp(
      markerTime(marker, markerIndex) + direction * step,
      0,
      durationSeconds || 0,
    );
    setSelectedMarkerIndex(markerIndex);
    updateMarkerTime(markerIndex, nextTime);
    seek(nextTime, { pause: true });
  }

  function moveDisplayCueByKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    cueIndex: number,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    event.stopPropagation();
    const cue = displayCueChunks[cueIndex];
    if (!cue) return;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const step = event.shiftKey
      ? markerKeyboardFineStepSeconds
      : markerKeyboardStepSeconds;
    const nextTime = clampDisplayCueTime(
      cueIndex,
      displayCueTime(cueIndex) + direction * step,
    );
    setSelectedDisplayCueIndex(cueIndex);
    updateDisplayCueTime(cueIndex, nextTime);
    seek(nextTime, { pause: true });
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const audioElement = audio;

    function syncTime() {
      if (
        displayCueDragRef.current ||
        markerDragRef.current ||
        scrubRef.current !== null ||
        mouseScrubRef.current !== null
      ) {
        return;
      }
      if (audioElement.paused) return;

      const manualSeek = manualSeekRef.current;
      if (manualSeek && window.performance.now() < manualSeek.expiresAt) {
        const audioTime = audioElement.currentTime;
        if (Math.abs(audioTime - manualSeek.timeSeconds) > 0.35) {
          setCurrentTime(manualSeek.timeSeconds);
          return;
        }
        manualSeekRef.current = null;
      }

      setCurrentTime(audioElement.currentTime || 0);
    }

    function syncDuration() {
      setAudioDuration(
        Number.isFinite(audioElement.duration) ? audioElement.duration : 0,
      );
    }

    function syncPlaying() {
      setIsPlaying(Boolean(!audioElement.paused && !audioElement.ended));
    }

    function handleEnded() {
      setIsPlaying(false);
      setCurrentTime(
        clamp(
          audioElement.currentTime ||
            (Number.isFinite(audioElement.duration)
              ? audioElement.duration
              : durationSeconds),
          0,
          durationSeconds || 0,
        ),
      );
    }

    audioElement.addEventListener("durationchange", syncDuration);
    audioElement.addEventListener("ended", handleEnded);
    audioElement.addEventListener("loadedmetadata", syncDuration);
    audioElement.addEventListener("pause", syncPlaying);
    audioElement.addEventListener("play", syncPlaying);
    audioElement.addEventListener("seeked", syncTime);
    audioElement.addEventListener("timeupdate", syncTime);
    syncDuration();
    syncPlaying();

    return () => {
      audioElement.removeEventListener("durationchange", syncDuration);
      audioElement.removeEventListener("ended", handleEnded);
      audioElement.removeEventListener("loadedmetadata", syncDuration);
      audioElement.removeEventListener("pause", syncPlaying);
      audioElement.removeEventListener("play", syncPlaying);
      audioElement.removeEventListener("seeked", syncTime);
      audioElement.removeEventListener("timeupdate", syncTime);
    };
  }, [audioPlaybackUrl, durationSeconds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioPlaybackUrl || !currentTime) return undefined;

    const restoreSeekPosition = () => {
      audio.currentTime = clamp(currentTime, 0, durationSeconds || currentTime);
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      restoreSeekPosition();
      return undefined;
    }

    audio.addEventListener("loadedmetadata", restoreSeekPosition, { once: true });
    return () => {
      audio.removeEventListener("loadedmetadata", restoreSeekPosition);
    };
  }, [audioPlaybackUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    try {
      window.localStorage.setItem(fineTuningSpeedStorageKey, String(playbackRate));
    } catch {
      // Playback speed still works for this page view if storage is blocked.
    }
  }, [playbackRate]);

  useEffect(() => {
    setDraftDisplayCueOffsets(displayCueOffsets);
  }, [audioItem?.id, displayCueOffsetKey]);

  useEffect(() => {
    setCurrentTime(0);
    setDraggingDisplayCue(null);
    setDraggingMarker(null);
    setSelectedDisplayCueIndex(null);
    setSelectedMarkerIndex(null);
    manualSeekRef.current = null;
    displayCueDragRef.current = null;
    markerDragRef.current = null;
    mouseScrubRef.current = null;
    scrubRef.current = null;
  }, [audioItem?.id]);

  useEffect(() => {
    setSelectedMarkerIndex((current) =>
      current !== null && current >= markers.length ? null : current,
    );
  }, [markers.length]);

  useEffect(() => {
    setSelectedDisplayCueIndex((current) =>
      current !== null && current >= displayCueChunks.length ? null : current,
    );
  }, [displayCueChunks.length]);

  useEffect(() => {
    const element = waveformRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observedElement = element;

    function updateBucketCount() {
      const width = observedElement.getBoundingClientRect().width;
      if (!width) return;
      const roundedWidth = Math.round(width);
      setWaveformWidth((current) =>
        current === roundedWidth ? current : roundedWidth,
      );
      const nextBucketCount = Math.round(clamp(width / 1.45, 360, 960));
      setWaveformBucketCount((current) =>
        current === nextBucketCount ? current : nextBucketCount,
      );
    }

    updateBucketCount();
    const observer = new ResizeObserver(updateBucketCount);
    observer.observe(observedElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeChatChunkId) return;

    const container = chatPreviewRef.current;
    const target = chatPreviewChunkRefs.current.get(activeChatChunkId);
    if (!container || !target) return;

    container.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
    });
  }, [activeChatChunkId]);

  const chatPreviewPlaceholder = useMemo(() => {
    if (!audioUrl) return "Generate audio first";
    if (!displayBreaks.length) return "Add double line breaks in Display Text";
    if (!displaySlots.length) return "Display text needed";
    if (!timingWords.length) return "Word timing needed";
    return "No staged chat cues";
  }, [audioUrl, displayBreaks.length, displaySlots.length, timingWords.length]);

  const slideMarker = activeSlideMarker();
  const slideRef = slideMarker?.argList[0]?.trim() || "";
  const slidePreview =
    slideRef && deckUrl
      ? previews[slidePreviewKeyForDeck(deckUrl, slideRef)]
      : null;
  const rawTimelineMarkers = markers.map((marker, index) => {
    const timeSeconds = markerTime(marker, index);
    return {
      index,
      marker,
      timeMs: Math.round(timeSeconds * 1000),
      timeSeconds,
      widthPx: estimateMarkerWidthPx(marker),
    };
  });
  const timeMatchCounts = new Map<number, number>();
  rawTimelineMarkers.forEach((item) => {
    timeMatchCounts.set(item.timeMs, (timeMatchCounts.get(item.timeMs) ?? 0) + 1);
  });
  const laneRightEdges: number[] = [];
  const waveformWidthForLayout = Math.max(waveformWidth || 0, 1);
  const layoutByIndex = new Map<number, TimelineMarkerLayout>();
  [...rawTimelineMarkers]
    .sort(
      (left, right) =>
        left.timeSeconds - right.timeSeconds || left.index - right.index,
    )
    .forEach((item) => {
      const markerCenterPx =
        (item.timeSeconds / durationForLayout) * waveformWidthForLayout;
      const markerLeftPx = markerCenterPx - item.widthPx / 2;
      const markerRightPx = markerCenterPx + item.widthPx / 2;
      const laneIndex = laneRightEdges.findIndex(
        (rightEdge) => markerLeftPx > rightEdge + 6,
      );
      const lane = laneIndex >= 0 ? laneIndex : laneRightEdges.length;
      laneRightEdges[lane] = markerRightPx;
      layoutByIndex.set(item.index, {
        hasTimeMatch: (timeMatchCounts.get(item.timeMs) ?? 0) > 1,
        index: item.index,
        lane,
        marker: item.marker,
        timeSeconds: item.timeSeconds,
      });
    });
  const timelineMarkers = rawTimelineMarkers
    .map((item) => layoutByIndex.get(item.index))
    .filter((item): item is TimelineMarkerLayout => Boolean(item));
  const rawDisplayCueMarkers = displayCueChunks.map((chunk, index) => {
    const timeSeconds = displayCueTime(index);
    return {
      chunk,
      index,
      timeMs: Math.round(timeSeconds * 1000),
      timeSeconds,
      widthPx: estimateDisplayCueWidthPx(chunk),
    };
  });
  const displayCueTimeMatchCounts = new Map<number, number>();
  rawDisplayCueMarkers.forEach((item) => {
    displayCueTimeMatchCounts.set(
      item.timeMs,
      (displayCueTimeMatchCounts.get(item.timeMs) ?? 0) + 1,
    );
  });
  const displayCueLaneRightEdges: number[] = [];
  const displayCueLayoutByIndex = new Map<number, DisplayCueLayout>();
  [...rawDisplayCueMarkers]
    .sort(
      (left, right) =>
        left.timeSeconds - right.timeSeconds || left.index - right.index,
    )
    .forEach((item) => {
      const markerCenterPx =
        (item.timeSeconds / durationForLayout) * waveformWidthForLayout;
      const markerLeftPx = markerCenterPx - item.widthPx / 2;
      const markerRightPx = markerCenterPx + item.widthPx / 2;
      const laneIndex = displayCueLaneRightEdges.findIndex(
        (rightEdge) => markerLeftPx > rightEdge + 6,
      );
      const lane = laneIndex >= 0 ? laneIndex : displayCueLaneRightEdges.length;
      displayCueLaneRightEdges[lane] = markerRightPx;
      displayCueLayoutByIndex.set(item.index, {
        chunk: item.chunk,
        hasTimeMatch: (displayCueTimeMatchCounts.get(item.timeMs) ?? 0) > 1,
        index: item.index,
        lane,
        timeSeconds: item.timeSeconds,
      });
    });
  const displayCueLayouts = rawDisplayCueMarkers
    .map((item) => displayCueLayoutByIndex.get(item.index))
    .filter((item): item is DisplayCueLayout => Boolean(item));
  const actionLaneCount = Math.max(
    1,
    ...timelineMarkers.map((item) => item.lane + 1),
  );
  const displayCueLaneCount = Math.max(
    1,
    ...displayCueLayouts.map((item) => item.lane + 1),
  );
  const laneCount =
    timelineMode === "chat-cues" ? displayCueLaneCount : actionLaneCount;
  const waveformMarkerTop = 68;
  const waveformMarkerGap = 28;
  const waveformHeight = Math.max(124, 96 + laneCount * waveformMarkerGap);

  return (
    <div aria-label="Fine Tuning" className="next-fine-tuning-panel">
      <audio preload="auto" ref={audioRef} src={audioPlaybackUrl} />
      <section className="next-fine-preview" aria-label="Playback preview">
        <div className="next-fine-slide-preview" aria-label="Main panel preview">
          {slidePreview?.status === "ready" && slidePreview.imageUrl ? (
            <img
              alt={slideRef ? `Slide ${slideRef}` : ""}
              src={slidePreview.imageUrl}
            />
          ) : (
            <span>
              {!slideRef
                ? "No slide"
                : !deckUrl.trim()
                  ? "Deck URL needed"
                  : slidePreview?.status === "loading"
                    ? "Loading"
                    : slidePreview?.detail || `Slide ${slideRef}`}
            </span>
          )}
        </div>
        <div className="next-fine-chat-preview" aria-label="Chat simulator">
          <div className="next-fine-chat-scroll" ref={chatPreviewRef}>
            {visibleChatChunks.length ? (
              visibleChatChunks.map((chunk) => (
                <FineTuningChatBubble
                  chunk={chunk}
                  key={chunk.id}
                  registerRef={(element) => {
                    if (element) {
                      chatPreviewChunkRefs.current.set(chunk.id, element);
                    } else {
                      chatPreviewChunkRefs.current.delete(chunk.id);
                    }
                  }}
                />
              ))
            ) : (
              <div className="next-fine-chat-empty">{chatPreviewPlaceholder}</div>
            )}
          </div>
        </div>
      </section>

      <div className="next-fine-transport">
        <button
          aria-label={isPlaying ? "Pause fine tuning audio" : "Play fine tuning audio"}
          className="next-script-audio-preview-button has-audio"
          disabled={!audioPlaybackUrl}
          onClick={togglePlayback}
          title={isPlaying ? "Pause" : "Play"}
          type="button"
        >
          {isPlaying ? <StopIcon /> : <MicIcon />}
        </button>
        <button
          className="next-fine-speed-button"
          disabled={!audioPlaybackUrl}
          onClick={cyclePlaybackRate}
          title="Playback speed"
          type="button"
        >
          {playbackRate}x
        </button>
        <div className="next-fine-mode-toggle" role="group" aria-label="Fine tuning view">
          <button
            aria-pressed={timelineMode === "actions"}
            className={timelineMode === "actions" ? "is-active" : ""}
            onClick={() => setTimelineMode("actions")}
            type="button"
          >
            Actions
          </button>
          <button
            aria-pressed={timelineMode === "chat-cues"}
            className={timelineMode === "chat-cues" ? "is-active" : ""}
            onClick={() => setTimelineMode("chat-cues")}
            type="button"
          >
            Chat cues
          </button>
        </div>
        <span className="next-fine-time">
          {formatTimelineSeconds(visibleTime)} / {formatTimelineSeconds(durationSeconds)}
        </span>
        <strong className="next-fine-current-word">{currentWord || "---"}</strong>
      </div>

      <div
        aria-disabled={!audioUrl}
        aria-label="Audio waveform"
        className={[
          "next-fine-waveform",
          audioUrl ? "" : "is-disabled",
          draggingMarker || draggingDisplayCue ? "is-dragging-marker" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(event) => {
          if (!audioUrl) return;
          if (ignoreWaveformClickRef.current) {
            event.preventDefault();
            return;
          }
          seek(timeFromWaveformEvent(event, currentTime), { pause: true });
        }}
        onMouseDown={beginMouseScrub}
        onMouseLeave={endMouseScrub}
        onMouseMove={updateMouseScrub}
        onMouseUp={endMouseScrub}
        onPointerCancel={endScrub}
        onPointerDown={beginScrub}
        onPointerMove={updateScrub}
        onPointerUp={endScrub}
        ref={waveformRef}
        role="slider"
        style={{ height: `${waveformHeight}px` }}
        tabIndex={audioUrl ? 0 : -1}
      >
        <div className="next-fine-wave-bars">
          {waveform.peaks.map((peak, index) => (
            <span
              aria-hidden="true"
              key={index}
              style={{ transform: `scaleY(${Math.max(0.04, peak)})` }}
            />
          ))}
        </div>
        {waveform.status === "loading" ? (
          <span className="next-fine-wave-status">Loading waveform</span>
        ) : null}
        {waveform.status === "error" ? (
          <span className="next-fine-wave-status">Waveform unavailable</span>
        ) : null}
        {!audioUrl ? (
          <span className="next-fine-wave-status">Generate audio first</span>
        ) : null}
        {audioUrl &&
        timelineMode === "chat-cues" &&
        !displayCueLayouts.length ? (
          <span className="next-fine-wave-status">No chat cues</span>
        ) : null}
        <span
          aria-hidden="true"
          className="next-fine-playhead"
          style={{ left: `${progressPercent}%` }}
        />
        {timelineMode === "actions"
          ? timelineMarkers.map(({ hasTimeMatch, index, lane, marker, timeSeconds }) => {
          const markerPercent = clamp(
            (timeSeconds / durationForLayout) * 100,
            0,
            100,
          );
          const slideMarkerForPreview = isSlideMarker(marker);
          const markerPreview = slideMarkerForPreview
            ? slidePreviewForMarker(marker)
            : null;
          const previewImageUrl =
            markerPreview?.status === "ready" ? markerPreview.imageUrl : "";
          const previewLabel =
            markerPreview?.status === "loading"
              ? "Loading"
              : markerPreview?.detail || markerLabel(marker);
          const guideHeight = Math.max(
            18,
            waveformMarkerTop + lane * waveformMarkerGap - 12,
          );

          return (
            <button
              aria-label={`${markerLabel(marker)} at ${formatTimelineSeconds(
                timeSeconds,
              )}`}
              aria-pressed={selectedMarkerIndex === index}
              className={[
                "next-fine-marker",
                slideMarkerForPreview ? "is-slide" : "is-action",
                slideMarkerForPreview ? "has-preview" : "",
                markerHasIcon(marker) ? "has-icon" : "",
                selectedMarkerIndex === index ? "is-selected" : "",
                hasTimeMatch ? "is-time-match" : "",
                markerPercent < 28
                  ? "is-preview-left"
                  : markerPercent > 72
                    ? "is-preview-right"
                    : "is-preview-center",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${index}-${marker.start}-${marker.type}`}
              onClick={(event) => {
                if (ignoreMarkerClickRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                event.stopPropagation();
                setSelectedMarkerIndex(index);
                seek(timeSeconds);
              }}
              onKeyDown={(event) => moveMarkerByKeyboard(event, index)}
              onPointerCancel={endMarkerDrag}
              onPointerDown={(event) => beginMarkerDrag(event, index, timeSeconds)}
              onPointerMove={updateMarkerDrag}
              onPointerUp={endMarkerDrag}
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                left: `${markerPercent}%`,
                top: `${waveformMarkerTop + lane * waveformMarkerGap}px`,
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                className="next-fine-marker-guide"
                style={{ height: `${guideHeight}px` }}
              />
              {markerHasIcon(marker) ? (
                <span className="next-fine-marker-icon">
                  {scriptMarkerIcon(marker.type)}
                </span>
              ) : null}
              <strong>{markerLabel(marker)}</strong>
              <span className="next-fine-marker-time">
                {timeSeconds.toFixed(2)}
              </span>
              {slideMarkerForPreview ? (
                <span aria-hidden="true" className="next-fine-marker-preview">
                  {previewImageUrl ? (
                    <img alt="" src={previewImageUrl} />
                  ) : (
                    <span>{previewLabel}</span>
                  )}
                </span>
              ) : null}
            </button>
          );
        })
          : displayCueLayouts.map(({ chunk, hasTimeMatch, index, lane, timeSeconds }) => {
              const markerPercent = clamp(
                (timeSeconds / durationForLayout) * 100,
                0,
                100,
              );
              const previewText = chunk.fullText.replace(/\s+/g, " ").trim();
              const offsetLabel =
                Math.abs(chunk.offsetSeconds) < 0.001
                  ? "auto"
                  : `${chunk.offsetSeconds > 0 ? "+" : ""}${chunk.offsetSeconds.toFixed(
                      2,
                    )}s`;
              const guideHeight = Math.max(
                18,
                waveformMarkerTop + lane * waveformMarkerGap - 12,
              );

              return (
                <button
                  aria-label={`${displayCueLabel(chunk)} at ${formatTimelineSeconds(
                    timeSeconds,
                  )}`}
                  aria-pressed={selectedDisplayCueIndex === index}
                  className={[
                    "next-fine-marker",
                    "is-chat-cue",
                    selectedDisplayCueIndex === index ? "is-selected" : "",
                    hasTimeMatch ? "is-time-match" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={`cue-${chunk.boundaryIndex}-${chunk.startSlot}`}
                  onClick={(event) => {
                    if (ignoreMarkerClickRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    event.stopPropagation();
                    setSelectedDisplayCueIndex(index);
                    seek(timeSeconds);
                  }}
                  onKeyDown={(event) => moveDisplayCueByKeyboard(event, index)}
                  onPointerCancel={endDisplayCueDrag}
                  onPointerDown={(event) =>
                    beginDisplayCueDrag(event, index, timeSeconds)
                  }
                  onPointerMove={updateDisplayCueDrag}
                  onPointerUp={endDisplayCueDrag}
                  onMouseDown={(event) => event.stopPropagation()}
                  style={{
                    left: `${markerPercent}%`,
                    top: `${waveformMarkerTop + lane * waveformMarkerGap}px`,
                  }}
                  title={`${previewText || displayCueLabel(chunk)} (${offsetLabel})`}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="next-fine-marker-guide"
                    style={{ height: `${guideHeight}px` }}
                  />
                  <strong>{displayCueLabel(chunk)}</strong>
                  <span className="next-fine-marker-time">
                    {timeSeconds.toFixed(2)}
                  </span>
                </button>
              );
            })}
      </div>
    </div>
  );
}
