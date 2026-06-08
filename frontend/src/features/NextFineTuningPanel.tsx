import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { publicAsset } from "../assets";
import { MicIcon, RefreshIcon, StopIcon } from "../components/Icons";
import {
  appendScriptMarkerTimelineArg,
  buildScriptMarker,
  countScriptWords,
  parseScriptMarkerInstances,
  scriptMarkerIcon,
  scriptSoundOptions,
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
  nextSlideRefAfterInsertion,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import { formatTimelineSeconds } from "./ScriptAudioPanel";
import {
  alignScriptWordsToDisplaySlots,
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

type WaveformWindow = {
  end: number;
  start: number;
};

type ManualSeekState = {
  expiresAt: number;
  timeSeconds: number;
};

type TimelineContextMenuState =
  | {
      index: number;
      kind: "marker";
      targetTimeSeconds: number;
      x: number;
      y: number;
    }
  | {
      index: number;
      kind: "display-cue";
      targetTimeSeconds: number;
      x: number;
      y: number;
    }
  | {
      kind: "insert";
      targetTimeSeconds: number;
      x: number;
      y: number;
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

type FineTuningTimelineLayer = "actions" | "chatCues" | "slides";

type FineTuningTimelineVisibility = Record<FineTuningTimelineLayer, boolean>;

type FineTuningPanelProps = {
  audioItem: ScriptAudioItem | null;
  canRefreshSlides: boolean;
  deckUrl: string;
  displayBreaks: number[];
  displayCueOffsets: number[];
  displaySlots: string[];
  isRefreshingSlides: boolean;
  onBeforePlaybackStart: () => void;
  onDisplayCueOffsetsChange: (offsets: number[]) => void;
  onMarkedTextChange: (value: string) => void;
  onRefreshSlides: () => void;
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
const waveformPanWheelRatio = 0.0018;
const waveformZoomWheelRatio = 0.0015;
const chatPreviewAutoScrollResumeThresholdPx = 28;
const chatPreviewProgrammaticScrollIgnoreMs = 220;
const chatPreviewUserScrollIntentMs = 900;
const defaultFineTuningSideImagePath = "test-images/dLU-right.png";
const fineTuningSideImageScaleMin = 0.2;
const fineTuningSideImageScaleMax = 3;

type FineTuningSideImageState = {
  imagePath: string;
  scale: number;
  scaleText: string;
  side: "left" | "right";
  visible: boolean;
};

function replaceScriptMarker(
  text: string,
  marker: ScriptMarkerInstance,
  nextMarker: string,
) {
  return `${text.slice(0, marker.start)}${nextMarker}${text.slice(marker.end)}`;
}

function insertScriptMarkerAt(text: string, insertionIndex: number, marker: string) {
  const safeIndex = Math.min(Math.max(0, insertionIndex), text.length);
  const before = text.slice(0, safeIndex);
  const after = text.slice(safeIndex);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  return `${before}${prefix}${marker}${suffix}${after}`;
}

function markerLabel(marker: ScriptMarkerInstance) {
  if (isSlideMarker(marker)) {
    return `Slide ${marker.argList[0]?.trim() || "1"}`;
  }
  if (marker.type === "show_image" || marker.type === "agent_image_on") {
    return "left show";
  }
  if (marker.type === "agent_image_off") {
    return "left hide";
  }
  if (marker.type === "side_image") {
    const side = marker.argList[0]?.trim() || "left";
    const mode = (marker.argList[1] || "show").trim().toLowerCase();
    const state = ["hide", "hidden", "off", "false", "0"].includes(mode)
      ? "hide"
      : "show";
    return `${side} ${state}`;
  }
  return marker.detail || marker.label;
}

function markerHasIcon(marker: ScriptMarkerInstance) {
  return !isSlideMarker(marker) && marker.type !== "side_image";
}

function normalizeFineTuningSideImageScale(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return clamp(
    numeric,
    fineTuningSideImageScaleMin,
    fineTuningSideImageScaleMax,
  );
}

function sideImageStateFromMarker(
  marker: ScriptMarkerInstance,
): FineTuningSideImageState {
  if (marker.type === "show_image" || marker.type === "agent_image_on") {
    return {
      imagePath: marker.argList[0] || defaultFineTuningSideImagePath,
      scale: 1,
      scaleText: "1",
      side: "left",
      visible: true,
    };
  }

  if (marker.type === "agent_image_off") {
    return {
      imagePath: marker.argList[0] || "",
      scale: 1,
      scaleText: "1",
      side: "left",
      visible: false,
    };
  }

  const firstArg = marker.argList[0]?.trim().toLowerCase() || "";
  const hasSideArg = [
    "agent",
    "avatar",
    "left",
    "main",
    "right",
    "side",
    "tutor",
  ].includes(firstArg);
  const side = ["right", "side"].includes(firstArg) ? "right" : "left";
  const remainingArgs = hasSideArg ? marker.argList.slice(1) : marker.argList;
  const rawMode = remainingArgs[0]?.trim() || "show";
  const mode = rawMode.toLowerCase();
  const hideModes = ["hide", "hidden", "off", "false", "0"];
  const showModes = ["show", "on", "visible", "true", "1"];
  const usesExplicitMode = showModes.includes(mode) || hideModes.includes(mode);
  const imageArgIndex = usesExplicitMode ? 1 : 0;
  const imagePath =
    remainingArgs.length > imageArgIndex
      ? remainingArgs[imageArgIndex]
      : usesExplicitMode
        ? ""
        : remainingArgs[0] || "";
  const scaleText = remainingArgs[imageArgIndex + 1]?.trim() || "1";
  const scale = normalizeFineTuningSideImageScale(scaleText);

  return {
    imagePath,
    scale,
    scaleText,
    side,
    visible: !hideModes.includes(mode),
  };
}

function sideImageArgsFromState(state: FineTuningSideImageState) {
  const imagePath = state.imagePath.trim();
  const rawScaleText = state.scaleText.trim();
  const scale = normalizeFineTuningSideImageScale(rawScaleText || state.scale);
  const scaleArg =
    imagePath &&
    rawScaleText &&
    (Math.abs(scale - 1) > 0.001 || rawScaleText.endsWith("."))
      ? rawScaleText
      : "";
  const args = imagePath
    ? [state.side, state.visible ? "show" : "hide", imagePath]
    : [state.side, state.visible ? "show" : "hide"];
  if (scaleArg) args.push(scaleArg);
  return args;
}

function markerSupportsFineTuningSettings(marker: ScriptMarkerInstance) {
  return (
    isSlideMarker(marker) ||
    marker.type === "play_sound" ||
    marker.type === "side_image" ||
    marker.type === "show_image" ||
    marker.type === "agent_image_on" ||
    marker.type === "agent_image_off"
  );
}

function markerContextMenuEstimatedHeight(marker: ScriptMarkerInstance) {
  if (!markerSupportsFineTuningSettings(marker)) return 54;
  if (marker.type === "side_image" || marker.type === "show_image") return 336;
  if (marker.type === "agent_image_on" || marker.type === "agent_image_off") {
    return 336;
  }
  if (marker.type === "play_sound") return 214;
  return 138;
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

function normalizedWaveformWindow(
  windowValue: WaveformWindow,
  minSpan = 0.04,
): WaveformWindow {
  const span = clamp(windowValue.end - windowValue.start, minSpan, 1);
  const start = clamp(windowValue.start, 0, 1 - span);
  return {
    end: start + span,
    start,
  };
}

function shiftedWaveformWindow(
  windowValue: WaveformWindow,
  shift: number,
): WaveformWindow {
  const span = windowValue.end - windowValue.start;
  const start = clamp(windowValue.start + shift, 0, 1 - span);
  return {
    end: start + span,
    start,
  };
}

function timelineContextMenuPosition(
  clientX: number,
  clientY: number,
  height = 54,
  width = 220,
) {
  return {
    x: Math.max(12, Math.min(clientX, window.innerWidth - width - 12)),
    y: Math.max(12, Math.min(clientY, window.innerHeight - height - 12)),
  };
}

function isScrolledNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    chatPreviewAutoScrollResumeThresholdPx
  );
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
  canRefreshSlides,
  deckUrl,
  displayBreaks,
  displayCueOffsets,
  displaySlots,
  isRefreshingSlides,
  onBeforePlaybackStart,
  onDisplayCueOffsetsChange,
  onMarkedTextChange,
  onRefreshSlides,
  previews,
  text,
  textRevealSpeed,
}: FineTuningPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatPreviewAutoScrollRef = useRef(true);
  const chatPreviewChunkRefs = useRef(new Map<string, HTMLDivElement>());
  const chatPreviewProgrammaticScrollIgnoreUntilRef = useRef(0);
  const chatPreviewRef = useRef<HTMLDivElement | null>(null);
  const chatPreviewUserScrollIntentUntilRef = useRef(0);
  const timelineContextMenuRef = useRef<HTMLDivElement | null>(null);
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
  const [timelineVisibility, setTimelineVisibility] =
    useState<FineTuningTimelineVisibility>({
      actions: true,
      chatCues: true,
      slides: true,
    });
  const [draftDisplayCueOffsets, setDraftDisplayCueOffsets] =
    useState<number[]>(displayCueOffsets);
  const [timelineContextMenu, setTimelineContextMenu] =
    useState<TimelineContextMenuState | null>(null);
  const [waveformWindow, setWaveformWindow] = useState<WaveformWindow>({
    end: 1,
    start: 0,
  });
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
  const displayTimingWords = useMemo(
    () => alignScriptWordsToDisplaySlots(displaySlots, timingWords),
    [displaySlots, timingWords],
  );
  const durationSeconds = Math.max(
    0,
    audioItem?.durationSeconds ||
      audioDuration ||
      displayTimingWords[displayTimingWords.length - 1]?.end ||
      timingWords[timingWords.length - 1]?.end ||
      0,
  );
  const durationForLayout = durationSeconds || 1;
  const minimumWaveformWindowSpan = durationSeconds
    ? clamp(1 / durationSeconds, 0.04, 0.18)
    : 0.04;
  const visibleWaveformWindow = normalizedWaveformWindow(
    waveformWindow,
    minimumWaveformWindowSpan,
  );
  const visibleWaveformWindowSpan = Math.max(
    minimumWaveformWindowSpan,
    visibleWaveformWindow.end - visibleWaveformWindow.start,
  );
  const waveformIsZoomed = visibleWaveformWindowSpan < 0.995;
  const visibleTime =
    draggingMarker?.timeSeconds ?? draggingDisplayCue?.timeSeconds ?? currentTime;
  const visibleTimeProgress = clamp(
    visibleTime / durationForLayout,
    0,
    1,
  );
  const progressPercent = clamp(
    ((visibleTimeProgress - visibleWaveformWindow.start) /
      visibleWaveformWindowSpan) *
      100,
    0,
    100,
  );
  const currentWord =
    displayTimingWords.find(
      (word) => visibleTime >= word.start && visibleTime <= word.end,
    )
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
    scriptWords: displayTimingWords,
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
  const activeChatChunk = activeChatChunkId
    ? visibleChatChunks.find((chunk) => chunk.id === activeChatChunkId)
    : null;
  const activeChatChunkScrollKey = activeChatChunk
    ? `${activeChatChunk.id}:${activeChatChunk.text.length}`
    : "";

  function timeFromClientX(clientX: number) {
    const rect = waveformRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || !durationSeconds) return 0;
    const visibleProgress =
      visibleWaveformWindow.start +
      clamp((clientX - rect.left) / rect.width, 0, 1) *
        visibleWaveformWindowSpan;
    return clamp(visibleProgress, 0, 1) * durationSeconds;
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
    const visibleProgress =
      visibleWaveformWindow.start +
      clamp(offsetX / rect.width, 0, 1) * visibleWaveformWindowSpan;
    return clamp(visibleProgress, 0, 1) * durationSeconds;
  }

  function waveformPercentForTime(seconds: number) {
    const normalizedTime = clamp(seconds / durationForLayout, 0, 1);
    return (
      ((normalizedTime - visibleWaveformWindow.start) /
        visibleWaveformWindowSpan) *
      100
    );
  }

  function isTimeVisibleInWaveform(seconds: number) {
    const normalizedTime = clamp(seconds / durationForLayout, 0, 1);
    return (
      normalizedTime >= visibleWaveformWindow.start - 0.01 &&
      normalizedTime <= visibleWaveformWindow.end + 0.01
    );
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
      displayTimingWords,
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

  function updateMarkerArgs(
    markerIndex: number,
    nextArgs: string[],
    nextType?: string,
  ) {
    const marker = markers[markerIndex];
    if (!marker) return;

    const timeMs = Math.round(markerTime(marker, markerIndex) * 1000);
    const nextMarker = buildScriptMarker(
      nextType ?? marker.type,
      appendScriptMarkerTimelineArg(nextArgs, timeMs),
    );
    onMarkedTextChange(replaceScriptMarker(text, marker, nextMarker));
  }

  function sourceInsertionIndexBeforeSpokenWord(wordIndex: number) {
    if (wordIndex <= 0) return 0;

    const wordPattern = /[A-Za-z0-9]+(?:[.'_-][A-Za-z0-9]+)*/g;
    let spokenIndex = 0;
    let cursor = 0;

    function scanSegment(segment: string, offset: number) {
      wordPattern.lastIndex = 0;
      for (const match of segment.matchAll(wordPattern)) {
        if (spokenIndex === wordIndex) {
          return offset + (match.index ?? 0);
        }
        spokenIndex += 1;
      }
      return null;
    }

    for (const marker of [...markers].sort((left, right) => left.start - right.start)) {
      if (marker.start > cursor) {
        const matchIndex = scanSegment(text.slice(cursor, marker.start), cursor);
        if (matchIndex !== null) return matchIndex;
      }
      cursor = Math.max(cursor, marker.end);
    }

    if (cursor < text.length) {
      const matchIndex = scanSegment(text.slice(cursor), cursor);
      if (matchIndex !== null) return matchIndex;
    }

    return text.length;
  }

  function sourceInsertionIndexForTimelineTime(seconds: number) {
    if (timingWords.length) {
      const firstWordStart = timingWords[0]?.start ?? 0;
      if (seconds <= firstWordStart) return 0;

      const wordIndex = timingWords.findIndex(
        (word) => Number.isFinite(word.start) && word.start >= seconds,
      );
      return sourceInsertionIndexBeforeSpokenWord(
        wordIndex >= 0 ? wordIndex : timingWords.length,
      );
    }

    const approximateWordIndex = Math.round(
      spokenWordCount * clamp(seconds / durationForLayout, 0, 1),
    );
    return sourceInsertionIndexBeforeSpokenWord(approximateWordIndex);
  }

  function nextTimelineSlideRef(seconds: number, insertionIndex: number) {
    const previousSlide = markers
      .map((marker, index) => ({
        marker,
        timeSeconds: markerTime(marker, index),
      }))
      .filter(({ marker }) => isSlideMarker(marker))
      .filter(({ timeSeconds }) => timeSeconds <= seconds + 0.001)
      .sort((left, right) => left.timeSeconds - right.timeSeconds)
      .at(-1)?.marker;
    const previousRef = previousSlide?.argList[0]?.trim() ?? "";

    if (/^\d+$/.test(previousRef)) {
      const numericRef = Number.parseInt(previousRef, 10);
      if (Number.isFinite(numericRef) && numericRef > 0) {
        return String(numericRef + 1);
      }
    }

    return nextSlideRefAfterInsertion(markers, insertionIndex);
  }

  function insertTimelineMarker(type: "slide" | "side-image" | "sound") {
    if (!timelineContextMenu || timelineContextMenu.kind !== "insert") return;

    const targetTimeSeconds = clamp(
      timelineContextMenu.targetTimeSeconds,
      0,
      durationSeconds || 0,
    );
    const insertionIndex = sourceInsertionIndexForTimelineTime(targetTimeSeconds);
    const targetTimeMs = Math.round(targetTimeSeconds * 1000);
    let nextMarker = buildScriptMarker(
      "play_sound",
      appendScriptMarkerTimelineArg(
        [scriptSoundOptions[0]?.path ?? "sounds/thud.mp3", "0.5"],
        targetTimeMs,
      ),
    );

    if (type === "slide") {
      nextMarker = buildScriptMarker(
        "gslide",
        appendScriptMarkerTimelineArg(
          [nextTimelineSlideRef(targetTimeSeconds, insertionIndex)],
          targetTimeMs,
        ),
      );
    } else if (type === "side-image") {
      nextMarker = buildScriptMarker(
        "side_image",
        appendScriptMarkerTimelineArg(
          ["left", "show", defaultFineTuningSideImagePath],
          targetTimeMs,
        ),
      );
    }

    onMarkedTextChange(insertScriptMarkerAt(text, insertionIndex, nextMarker));
    seek(targetTimeSeconds, { pause: true });
    setTimelineContextMenu(null);
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
      onBeforePlaybackStart();
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

  function toggleTimelineLayer(layer: FineTuningTimelineLayer) {
    setTimelineContextMenu(null);
    setTimelineVisibility((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  }

  function handleWaveformWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!audioUrl || !durationSeconds) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    event.preventDefault();
    event.stopPropagation();

    const currentWindow = visibleWaveformWindow;
    const currentSpan = visibleWaveformWindowSpan;
    const horizontalWheel =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;

    if (horizontalWheel && waveformIsZoomed) {
      const wheelDelta = event.deltaX || event.deltaY;
      const shift = wheelDelta * waveformPanWheelRatio * currentSpan;
      setWaveformWindow(
        shiftedWaveformWindow(currentWindow, shift),
      );
      return;
    }

    const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const anchor = currentWindow.start + pointerRatio * currentSpan;
    const zoomFactor = Math.exp(event.deltaY * waveformZoomWheelRatio);
    const nextSpan = clamp(
      currentSpan * zoomFactor,
      minimumWaveformWindowSpan,
      1,
    );
    const nextStart = anchor - pointerRatio * nextSpan;
    setWaveformWindow(
      normalizedWaveformWindow(
        {
          end: nextStart + nextSpan,
          start: nextStart,
        },
        minimumWaveformWindowSpan,
      ),
    );
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
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      const marker = markers[markerIndex];
      setSelectedMarkerIndex(markerIndex);
      setSelectedDisplayCueIndex(null);
      setTimelineContextMenu({
        index: markerIndex,
        kind: "marker",
        targetTimeSeconds: clamp(visibleTime, 0, durationSeconds || 0),
        ...timelineContextMenuPosition(
          event.clientX,
          event.clientY,
          marker ? markerContextMenuEstimatedHeight(marker) : 54,
          marker && markerSupportsFineTuningSettings(marker) ? 312 : 220,
        ),
      });
      return;
    }
    if (event.button > 0) {
      event.stopPropagation();
      return;
    }
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
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedDisplayCueIndex(cueIndex);
      setSelectedMarkerIndex(null);
      setTimelineContextMenu({
        index: cueIndex,
        kind: "display-cue",
        targetTimeSeconds: clamp(visibleTime, 0, durationSeconds || 0),
        ...timelineContextMenuPosition(event.clientX, event.clientY),
      });
      return;
    }
    if (event.button > 0) {
      event.stopPropagation();
      return;
    }
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

  function openMarkerContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    markerIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const marker = markers[markerIndex];
    setSelectedMarkerIndex(markerIndex);
    setSelectedDisplayCueIndex(null);
    setTimelineContextMenu({
      index: markerIndex,
      kind: "marker",
      targetTimeSeconds: clamp(visibleTime, 0, durationSeconds || 0),
      ...timelineContextMenuPosition(
        event.clientX,
        event.clientY,
        marker ? markerContextMenuEstimatedHeight(marker) : 54,
        marker && markerSupportsFineTuningSettings(marker) ? 312 : 220,
      ),
    });
  }

  function openDisplayCueContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    cueIndex: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedDisplayCueIndex(cueIndex);
    setSelectedMarkerIndex(null);
    setTimelineContextMenu({
      index: cueIndex,
      kind: "display-cue",
      targetTimeSeconds: clamp(visibleTime, 0, durationSeconds || 0),
      ...timelineContextMenuPosition(event.clientX, event.clientY),
    });
  }

  function openWaveformInsertMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!audioUrl || !durationSeconds) return;

    event.preventDefault();
    event.stopPropagation();
    const targetTimeSeconds = timeFromWaveformEvent(event, currentTime);
    setSelectedMarkerIndex(null);
    setSelectedDisplayCueIndex(null);
    setTimelineContextMenu({
      kind: "insert",
      targetTimeSeconds,
      ...timelineContextMenuPosition(event.clientX, event.clientY, 118),
    });
    seek(targetTimeSeconds, { pause: true });
  }

  function handleMarkerMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
    markerIndex: number,
  ) {
    event.stopPropagation();
    if (event.button === 2) openMarkerContextMenu(event, markerIndex);
  }

  function handleDisplayCueMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
    cueIndex: number,
  ) {
    event.stopPropagation();
    if (event.button === 2) openDisplayCueContextMenu(event, cueIndex);
  }

  function moveContextMenuItemToCurrentTime() {
    if (!timelineContextMenu) return;
    if (timelineContextMenu.kind === "insert") return;

    const nextTime = clamp(
      timelineContextMenu.targetTimeSeconds,
      0,
      durationSeconds || 0,
    );

    if (timelineContextMenu.kind === "marker") {
      updateMarkerTime(timelineContextMenu.index, nextTime);
      setSelectedMarkerIndex(timelineContextMenu.index);
      setSelectedDisplayCueIndex(null);
    } else {
      updateDisplayCueTime(timelineContextMenu.index, nextTime);
      setSelectedDisplayCueIndex(timelineContextMenu.index);
      setSelectedMarkerIndex(null);
    }

    seek(nextTime, { pause: true });
    setTimelineContextMenu(null);
  }

  function handleContextMenuMoveClick(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    moveContextMenuItemToCurrentTime();
  }

  function renderMarkerSettingsEditor(markerIndex: number) {
    const marker = markers[markerIndex];
    if (!marker || !markerSupportsFineTuningSettings(marker)) return null;

    if (isSlideMarker(marker)) {
      return (
        <div className="next-fine-context-editor">
          <div className="next-fine-context-title">Settings</div>
          <label>
            <span>Slide</span>
            <input
              aria-label="Slide reference"
              onChange={(event) =>
                updateMarkerArgs(markerIndex, [event.target.value])
              }
              value={marker.argList[0] ?? ""}
            />
          </label>
        </div>
      );
    }

    if (
      marker.type === "side_image" ||
      marker.type === "show_image" ||
      marker.type === "agent_image_on" ||
      marker.type === "agent_image_off"
    ) {
      const imageState = sideImageStateFromMarker(marker);
      const updateImageState = (nextState: FineTuningSideImageState) =>
        updateMarkerArgs(
          markerIndex,
          sideImageArgsFromState(nextState),
          "side_image",
        );

      return (
        <div className="next-fine-context-editor">
          <div className="next-fine-context-title">Interface image</div>
          <label>
            <span>Side</span>
            <select
              aria-label="Interface image side"
              onChange={(event) =>
                updateImageState({
                  ...imageState,
                  side: event.target.value === "right" ? "right" : "left",
                })
              }
              value={imageState.side}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            <span>State</span>
            <select
              aria-label="Interface image state"
              onChange={(event) =>
                updateImageState({
                  ...imageState,
                  visible: event.target.value !== "hide",
                })
              }
              value={imageState.visible ? "show" : "hide"}
            >
              <option value="show">Show</option>
              <option value="hide">Hide</option>
            </select>
          </label>
          <div className="next-fine-image-field">
            <span>Image</span>
            <div className="next-fine-image-control">
              <div className="next-fine-image-preview" aria-hidden="true">
                {imageState.imagePath ? (
                  <img alt="" src={publicAsset(imageState.imagePath)} />
                ) : (
                  <span>No image</span>
                )}
              </div>
              <input
                aria-label="Interface image path"
                onChange={(event) =>
                  updateImageState({
                    ...imageState,
                    imagePath: event.target.value,
                  })
                }
                placeholder={defaultFineTuningSideImagePath}
                value={imageState.imagePath}
              />
            </div>
          </div>
          <label>
            <span>Scale</span>
            <input
              aria-label="Interface image scale"
              max={fineTuningSideImageScaleMax}
              min={fineTuningSideImageScaleMin}
              onChange={(event) =>
                updateImageState({
                  ...imageState,
                  scale: normalizeFineTuningSideImageScale(event.target.value),
                  scaleText: event.target.value,
                })
              }
              inputMode="decimal"
              step="0.05"
              type="text"
              value={imageState.scaleText}
            />
          </label>
        </div>
      );
    }

    if (marker.type === "play_sound") {
      const soundPath = marker.argList[0] || scriptSoundOptions[0]?.path || "";
      const volume = marker.argList[1] || "0.5";
      const isKnownSound = scriptSoundOptions.some(
        (option) => option.path === soundPath,
      );

      return (
        <div className="next-fine-context-editor">
          <div className="next-fine-context-title">Sound</div>
          <label>
            <span>Sound</span>
            <select
              aria-label="Sound effect"
              onChange={(event) =>
                updateMarkerArgs(markerIndex, [
                  event.target.value === "custom" ? soundPath : event.target.value,
                  volume,
                ])
              }
              value={isKnownSound ? soundPath : "custom"}
            >
              {scriptSoundOptions.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            <span>Volume</span>
            <input
              aria-label="Sound volume"
              max="1"
              min="0"
              onChange={(event) =>
                updateMarkerArgs(markerIndex, [soundPath, event.target.value])
              }
              step="0.05"
              type="number"
              value={volume}
            />
          </label>
          {!isKnownSound ? (
            <label>
              <span>Path</span>
              <input
                aria-label="Custom sound path"
                onChange={(event) =>
                  updateMarkerArgs(markerIndex, [event.target.value, volume])
                }
                value={soundPath}
              />
            </label>
          ) : null}
        </div>
      );
    }

    return null;
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
    if (!timelineContextMenu) return undefined;

    function closeTimelineContextMenu(event: Event) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".next-fine-context-menu")
      ) {
        return;
      }
      setTimelineContextMenu(null);
    }

    function closeTimelineContextMenuOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setTimelineContextMenu(null);
    }

    window.addEventListener("pointerdown", closeTimelineContextMenu);
    window.addEventListener("keydown", closeTimelineContextMenuOnEscape);
    window.addEventListener("resize", closeTimelineContextMenu);
    return () => {
      window.removeEventListener("pointerdown", closeTimelineContextMenu);
      window.removeEventListener("keydown", closeTimelineContextMenuOnEscape);
      window.removeEventListener("resize", closeTimelineContextMenu);
    };
  }, [timelineContextMenu]);

  useLayoutEffect(() => {
    if (!timelineContextMenu) return;

    const menuElement = timelineContextMenuRef.current;
    if (!menuElement) return;

    const rect = menuElement.getBoundingClientRect();
    const nextX = Math.max(
      12,
      Math.min(timelineContextMenu.x, window.innerWidth - rect.width - 12),
    );
    const nextY = Math.max(
      12,
      Math.min(timelineContextMenu.y, window.innerHeight - rect.height - 12),
    );
    if (nextX === timelineContextMenu.x && nextY === timelineContextMenu.y) {
      return;
    }
    setTimelineContextMenu((current) =>
      current
        ? {
            ...current,
            x: Math.round(nextX),
            y: Math.round(nextY),
          }
        : current,
    );
  }, [text, timelineContextMenu]);

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
    setTimelineContextMenu(null);
  }, [audioItem?.id]);

  useEffect(() => {
    setWaveformWindow((current) =>
      normalizedWaveformWindow(current, minimumWaveformWindowSpan),
    );
  }, [minimumWaveformWindowSpan]);

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
      const nextBucketCount = Math.round(clamp(width * 2.4, 720, 2600));
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
    if (!chatPreviewAutoScrollRef.current) return;

    const container = chatPreviewRef.current;
    const target = chatPreviewChunkRefs.current.get(activeChatChunkId);
    if (!container || !target) return;

    chatPreviewProgrammaticScrollIgnoreUntilRef.current =
      window.performance.now() + chatPreviewProgrammaticScrollIgnoreMs;
    container.scrollTo({
      top: Math.max(0, target.offsetTop - 10),
    });
  }, [activeChatChunkId, activeChatChunkScrollKey]);

  function handleChatPreviewScroll() {
    const container = chatPreviewRef.current;
    if (!container) return;
    const now = window.performance.now();
    const hasUserScrollIntent = now < chatPreviewUserScrollIntentUntilRef.current;
    if (
      !hasUserScrollIntent &&
      now <
      chatPreviewProgrammaticScrollIgnoreUntilRef.current
    ) {
      return;
    }

    chatPreviewAutoScrollRef.current = isScrolledNearBottom(container);
  }

  function markChatPreviewUserScrollIntent() {
    chatPreviewUserScrollIntentUntilRef.current =
      window.performance.now() + chatPreviewUserScrollIntentMs;
  }

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
  const visibleWaveformPeaks = (() => {
    if (!waveform.peaks.length) return [];
    const firstPeakIndex = Math.max(
      0,
      Math.floor(visibleWaveformWindow.start * waveform.peaks.length),
    );
    const lastPeakIndex = Math.min(
      waveform.peaks.length,
      Math.ceil(visibleWaveformWindow.end * waveform.peaks.length),
    );
    return waveform.peaks.slice(
      firstPeakIndex,
      Math.max(firstPeakIndex + 1, lastPeakIndex),
    );
  })();
  const rawTimelineMarkers = markers
    .map((marker, index) => {
      const timeSeconds = markerTime(marker, index);
      return {
        category: isSlideMarker(marker) ? ("slide" as const) : ("action" as const),
        index,
        marker,
        timeMs: Math.round(timeSeconds * 1000),
        timeSeconds,
        widthPx: estimateMarkerWidthPx(marker),
      };
    })
    .filter((item) => isTimeVisibleInWaveform(item.timeSeconds))
    .filter((item) =>
      item.category === "slide"
        ? timelineVisibility.slides
        : timelineVisibility.actions,
    );
  const rawDisplayCueMarkers = displayCueChunks
    .map((chunk, index) => {
      const timeSeconds = displayCueTime(index);
      return {
        chunk,
        index,
        timeMs: Math.round(timeSeconds * 1000),
        timeSeconds,
        widthPx: estimateDisplayCueWidthPx(chunk),
      };
    })
    .filter((item) => timelineVisibility.chatCues)
    .filter((item) => isTimeVisibleInWaveform(item.timeSeconds));
  const visibleTimelineLayoutItems = [
    ...rawTimelineMarkers.map((item) => ({
      ...item,
      kind: "marker" as const,
      sortGroup: item.category === "slide" ? 0 : 1,
    })),
    ...rawDisplayCueMarkers.map((item) => ({
      ...item,
      kind: "display-cue" as const,
      sortGroup: 2,
    })),
  ];
  const visibleTimeMatchCounts = new Map<number, number>();
  visibleTimelineLayoutItems.forEach((item) => {
    visibleTimeMatchCounts.set(
      item.timeMs,
      (visibleTimeMatchCounts.get(item.timeMs) ?? 0) + 1,
    );
  });
  const laneRightEdges: number[] = [];
  const waveformWidthForLayout = Math.max(waveformWidth || 0, 1);
  const layoutByIndex = new Map<number, TimelineMarkerLayout>();
  const displayCueLayoutByIndex = new Map<number, DisplayCueLayout>();
  [...visibleTimelineLayoutItems]
    .sort(
      (left, right) =>
        left.timeSeconds - right.timeSeconds ||
        left.sortGroup - right.sortGroup ||
        left.index - right.index,
    )
    .forEach((item) => {
      const markerCenterPx =
        (waveformPercentForTime(item.timeSeconds) / 100) *
        waveformWidthForLayout;
      const markerLeftPx = markerCenterPx - item.widthPx / 2;
      const markerRightPx = markerCenterPx + item.widthPx / 2;
      const laneIndex = laneRightEdges.findIndex(
        (rightEdge) => markerLeftPx > rightEdge + 6,
      );
      const lane = laneIndex >= 0 ? laneIndex : laneRightEdges.length;
      laneRightEdges[lane] = markerRightPx;

      if (item.kind === "marker") {
        layoutByIndex.set(item.index, {
          hasTimeMatch: (visibleTimeMatchCounts.get(item.timeMs) ?? 0) > 1,
          index: item.index,
          lane,
          marker: item.marker,
          timeSeconds: item.timeSeconds,
        });
        return;
      }

      displayCueLayoutByIndex.set(item.index, {
        chunk: item.chunk,
        hasTimeMatch: (visibleTimeMatchCounts.get(item.timeMs) ?? 0) > 1,
        index: item.index,
        lane,
        timeSeconds: item.timeSeconds,
      });
    });
  const timelineMarkers = rawTimelineMarkers
    .map((item) => layoutByIndex.get(item.index))
    .filter((item): item is TimelineMarkerLayout => Boolean(item));
  const displayCueLayouts = rawDisplayCueMarkers
    .map((item) => displayCueLayoutByIndex.get(item.index))
    .filter((item): item is DisplayCueLayout => Boolean(item));
  const laneCount = Math.max(
    1,
    ...timelineMarkers.map((item) => item.lane + 1),
    ...displayCueLayouts.map((item) => item.lane + 1),
  );
  const waveformMarkerTop = 68;
  const waveformMarkerGap = 28;
  const waveformHeight = Math.max(124, 96 + laneCount * waveformMarkerGap);
  const timelineContextMarker =
    timelineContextMenu?.kind === "marker"
      ? markers[timelineContextMenu.index] ?? null
      : null;
  const timelineContextMenuHasEditor = Boolean(
    timelineContextMarker &&
      markerSupportsFineTuningSettings(timelineContextMarker),
  );

  return (
    <div aria-label="Fine Tuning" className="next-fine-tuning-panel">
      <audio preload="auto" ref={audioRef} src={audioPlaybackUrl} />
      <section className="next-fine-preview" aria-label="Playback preview">
        <div className="next-fine-slide-preview" aria-label="Main panel preview">
          <button
            aria-label="Refresh slide previews"
            className="next-fine-slide-refresh-button"
            disabled={!canRefreshSlides || isRefreshingSlides}
            onClick={onRefreshSlides}
            title={
              canRefreshSlides
                ? "Refresh slide previews from the deck"
                : "Add a slides link and slide action first"
            }
            type="button"
          >
            <RefreshIcon />
          </button>
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
          <div
            className={[
              "next-fine-chat-scroll",
              activeChatChunkId ? "is-turn-anchored" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onPointerDown={markChatPreviewUserScrollIntent}
            onScroll={handleChatPreviewScroll}
            onTouchStart={markChatPreviewUserScrollIntent}
            onWheel={markChatPreviewUserScrollIntent}
            ref={chatPreviewRef}
          >
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
        <div className="next-fine-mode-toggle" role="group" aria-label="Timeline layers">
          <button
            aria-label={
              timelineVisibility.slides ? "Slides visible" : "Slides hidden"
            }
            aria-pressed={timelineVisibility.slides}
            className={[
              "is-slides",
              timelineVisibility.slides ? "is-active" : "is-inactive",
            ].join(" ")}
            onClick={() => toggleTimelineLayer("slides")}
            title={timelineVisibility.slides ? "Slides visible" : "Slides hidden"}
            type="button"
          >
            <span aria-hidden="true" className="next-fine-layer-dot" />
            <span>Slides</span>
            <span className="next-fine-layer-state">
              {timelineVisibility.slides ? "On" : "Off"}
            </span>
          </button>
          <button
            aria-label={
              timelineVisibility.actions ? "Actions visible" : "Actions hidden"
            }
            aria-pressed={timelineVisibility.actions}
            className={[
              "is-actions",
              timelineVisibility.actions ? "is-active" : "is-inactive",
            ].join(" ")}
            onClick={() => toggleTimelineLayer("actions")}
            title={
              timelineVisibility.actions ? "Actions visible" : "Actions hidden"
            }
            type="button"
          >
            <span aria-hidden="true" className="next-fine-layer-dot" />
            <span>Actions</span>
            <span className="next-fine-layer-state">
              {timelineVisibility.actions ? "On" : "Off"}
            </span>
          </button>
          <button
            aria-label={
              timelineVisibility.chatCues
                ? "Chat cues visible"
                : "Chat cues hidden"
            }
            aria-pressed={timelineVisibility.chatCues}
            className={[
              "is-chat-cues",
              timelineVisibility.chatCues ? "is-active" : "is-inactive",
            ].join(" ")}
            onClick={() => toggleTimelineLayer("chatCues")}
            title={
              timelineVisibility.chatCues
                ? "Chat cues visible"
                : "Chat cues hidden"
            }
            type="button"
          >
            <span aria-hidden="true" className="next-fine-layer-dot" />
            <span>Chat cues</span>
            <span className="next-fine-layer-state">
              {timelineVisibility.chatCues ? "On" : "Off"}
            </span>
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
        onContextMenu={openWaveformInsertMenu}
        onPointerCancel={endScrub}
        onPointerDown={beginScrub}
        onPointerMove={updateScrub}
        onPointerUp={endScrub}
        onWheel={handleWaveformWheel}
        ref={waveformRef}
        role="slider"
        style={{ height: `${waveformHeight}px` }}
        tabIndex={audioUrl ? 0 : -1}
      >
        <div className="next-fine-wave-bars">
          {visibleWaveformPeaks.map((peak, index) => (
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
        timelineVisibility.chatCues &&
        !displayCueChunks.length ? (
          <span className="next-fine-wave-status">No chat cues</span>
        ) : null}
        <span
          aria-hidden="true"
          className="next-fine-playhead"
          style={{ left: `${progressPercent}%` }}
        />
        {waveformIsZoomed ? (
          <span className="next-fine-zoom-status">
            {formatTimelineSeconds(
              visibleWaveformWindow.start * durationForLayout,
            )}{" "}
            -{" "}
            {formatTimelineSeconds(visibleWaveformWindow.end * durationForLayout)}
          </span>
        ) : null}
        {timelineMarkers.map(({ hasTimeMatch, index, lane, marker, timeSeconds }) => {
          const markerPercent = clamp(waveformPercentForTime(timeSeconds), 0, 100);
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
              onContextMenu={(event) => openMarkerContextMenu(event, index)}
              onMouseDown={(event) => handleMarkerMouseDown(event, index)}
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
        })}
        {displayCueLayouts.map(({ chunk, hasTimeMatch, index, lane, timeSeconds }) => {
              const markerPercent = clamp(waveformPercentForTime(timeSeconds), 0, 100);
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
                  onContextMenu={(event) =>
                    openDisplayCueContextMenu(event, index)
                  }
                  onMouseDown={(event) =>
                    handleDisplayCueMouseDown(event, index)
                  }
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
        {timelineContextMenu && typeof document !== "undefined" ? (
          createPortal(
          <div
            className={[
              "next-fine-context-menu",
              timelineContextMenuHasEditor ? "is-editor" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onMouseUp={(event) => {
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
            }}
            ref={timelineContextMenuRef}
            role="menu"
            style={{
              left: `${timelineContextMenu.x}px`,
              top: `${timelineContextMenu.y}px`,
            }}
          >
            {timelineContextMenu.kind === "insert" ? (
              <>
                <button
                  className="next-fine-context-action"
                  onClick={() => insertTimelineMarker("slide")}
                  role="menuitem"
                  type="button"
                >
                  Add slide at{" "}
                  {formatTimelineSeconds(timelineContextMenu.targetTimeSeconds)}
                </button>
                <button
                  className="next-fine-context-action"
                  onClick={() => insertTimelineMarker("side-image")}
                  role="menuitem"
                  type="button"
                >
                  Add interface image
                </button>
                <button
                  className="next-fine-context-action"
                  onClick={() => insertTimelineMarker("sound")}
                  role="menuitem"
                  type="button"
                >
                  Add sound
                </button>
              </>
            ) : (
              <>
                <button
                  className="next-fine-context-action"
                  onClick={handleContextMenuMoveClick}
                  role="menuitem"
                  type="button"
                >
                  Move to{" "}
                  {formatTimelineSeconds(timelineContextMenu.targetTimeSeconds)}
                </button>
                {timelineContextMenu.kind === "marker"
                  ? renderMarkerSettingsEditor(timelineContextMenu.index)
                  : null}
              </>
            )}
          </div>,
            document.body,
          )
        ) : null}
      </div>
    </div>
  );
}
