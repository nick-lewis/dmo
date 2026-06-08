import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
} from "./useScriptAudioPlayback";
import {
  useAudioWaveform,
  useSeekableAudioUrl,
} from "./useFineTuningAudio";
import { useFloatingMenuLifecycle } from "./useFloatingMenuLifecycle";
import { useFineTuningTimelineState } from "./useFineTuningTimelineState";
import {
  buildFineTuningTimelineLayout,
  normalizedWaveformWindow,
  shiftedWaveformWindow,
  visibleWaveformPeaksForWindow,
  waveformPercentForTime as waveformPercentForTimeInWindow,
  type FineTuningTimelineLayer,
  type FineTuningTimelineVisibility,
} from "./fineTuningTimelineLayout";
import { NextFineTuningContextMenu } from "./NextFineTuningContextMenu";
import { clampFloatingMenuPosition } from "./floatingMenuPosition";
import {
  insertScriptMarkerAt,
  linkedMarkerIndexes,
  replaceScriptMarkerText,
  replaceScriptMarkersInText,
  sourceInsertionIndexBeforeSpokenWord,
  type ScriptMarkerReplacement,
} from "./fineTuningMarkerText";
import {
  clamp,
  isSlideMarker,
  markerTimelineTimeSeconds,
  nextSlideRefAfterInsertion,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import {
  defaultScriptSideImagePath,
  estimateFineTuningMarkerWidthPx,
  fineTuningMarkerHasIcon,
  fineTuningMarkerLabel,
  markerContextMenuEstimatedHeight,
  markerSupportsFineTuningSettings,
} from "./scriptMarkerActionMetadata";
import { formatTimelineSeconds } from "./ScriptAudioPanel";
import {
  alignScriptWordsToDisplaySlots,
  normalizeScriptDisplayCueOffsets,
  scriptDisplayChunkSpecsFromValues,
  type ScriptDisplayChunkSpec,
} from "./scriptDisplayTiming";
import { NextFineTuningPlaybackPreview } from "./NextFineTuningPlaybackPreview";
import { NextFineTuningTransportControls } from "./NextFineTuningTransportControls";

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
const fineTuningSpeedStorageKey = "dlu.next-fine-tuning-speed.v1";
const waveformPanWheelRatio = 0.0018;
const waveformZoomWheelRatio = 0.0015;
const chatPreviewAutoScrollResumeThresholdPx = 28;
const chatPreviewProgrammaticScrollIgnoreMs = 220;
const chatPreviewUserScrollIntentMs = 900;

function displayCueLabel(chunk: ScriptDisplayChunkSpec) {
  return `Chunk ${chunk.index + 1}`;
}

function estimateDisplayCueWidthPx(chunk: ScriptDisplayChunkSpec) {
  return Math.min(150, Math.max(92, 66 + displayCueLabel(chunk).length * 6.2));
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

function timelineContextMenuPosition(
  clientX: number,
  clientY: number,
  height = 54,
  width = 220,
) {
  return clampFloatingMenuPosition(clientX, clientY, width, height);
}

function isScrolledNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    chatPreviewAutoScrollResumeThresholdPx
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
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(playbackRateFromStorage);
  const [timelineVisibility, setTimelineVisibility] =
    useState<FineTuningTimelineVisibility>({
      actions: true,
      chatCues: true,
      slides: true,
    });
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
  const {
    currentTime,
    displayCueDragRef,
    draggingDisplayCue,
    draggingMarker,
    ignoreMarkerClickRef,
    ignoreWaveformClickRef,
    ignoreWaveformContextMenuRef,
    isPanningWaveform,
    manualSeekRef,
    markerDragRef,
    mouseScrubRef,
    scrubRef,
    selectedDisplayCueIndex,
    selectedMarkerIndex,
    setCurrentTime,
    setDraggingDisplayCue,
    setDraggingMarker,
    setIsPanningWaveform,
    setSelectedDisplayCueIndex,
    setSelectedMarkerIndex,
    setTimelineContextMenu,
    setWaveformWindow,
    timelineContextMenu,
    waveformPanRef,
    waveformWindow,
  } = useFineTuningTimelineState({
    audioItemId: audioItem?.id,
    displayCueCount: displayCueChunks.length,
    markerCount: markers.length,
    minimumWaveformWindowSpan,
  });
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
    return waveformPercentForTimeInWindow(
      seconds,
      durationForLayout,
      visibleWaveformWindow,
      visibleWaveformWindowSpan,
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
    if (draggingMarker) {
      const draggingSource = markers[draggingMarker.markerIndex];
      const isDraggedMarker = draggingMarker.markerIndex === index;
      const isDraggedLinkGroup =
        Boolean(marker.linkId) &&
        marker.linkId === draggingSource?.linkId;
      if (isDraggedMarker || isDraggedLinkGroup) {
        return draggingMarker.timeSeconds;
      }
    }
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

    const linkedIndexes = marker.linkId
      ? markers
          .map((linkedMarker, index) =>
            linkedMarker.linkId === marker.linkId ? index : -1,
          )
          .filter((index) => index >= 0)
      : [markerIndex];
    const replacements = linkedIndexes
      .map((index) => markers[index])
      .filter((linkedMarker): linkedMarker is ScriptMarkerInstance =>
        Boolean(linkedMarker),
      )
      .map((linkedMarker) => ({
        marker: linkedMarker,
        nextMarker: buildScriptMarker(
          linkedMarker.type,
          appendScriptMarkerTimelineArg(
            linkedMarker.argList,
            seconds * 1000,
            linkedMarker.linkId,
          ),
        ),
      }));

    onMarkedTextChange(replaceScriptMarkersInText(text, replacements));
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
      appendScriptMarkerTimelineArg(nextArgs, timeMs, marker.linkId),
    );
    onMarkedTextChange(replaceScriptMarkerText(text, marker, nextMarker));
  }

  function sourceInsertionIndexForTimelineTime(seconds: number) {
    if (timingWords.length) {
      const firstWordStart = timingWords[0]?.start ?? 0;
      if (seconds <= firstWordStart) return 0;

      const wordIndex = timingWords.findIndex(
        (word) => Number.isFinite(word.start) && word.start >= seconds,
      );
      return sourceInsertionIndexBeforeSpokenWord({
        markers,
        text,
        wordIndex: wordIndex >= 0 ? wordIndex : timingWords.length,
      });
    }

    const approximateWordIndex = Math.round(
      spokenWordCount * clamp(seconds / durationForLayout, 0, 1),
    );
    return sourceInsertionIndexBeforeSpokenWord({
      markers,
      text,
      wordIndex: approximateWordIndex,
    });
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
          ["left", "show", defaultScriptSideImagePath],
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

  function openWaveformInsertMenuAt(
    clientX: number,
    clientY: number,
    targetTimeSeconds: number,
  ) {
    setSelectedMarkerIndex(null);
    setSelectedDisplayCueIndex(null);
    setTimelineContextMenu({
      kind: "insert",
      targetTimeSeconds,
      ...timelineContextMenuPosition(clientX, clientY, 118),
    });
    seek(targetTimeSeconds, { pause: true });
  }

  function beginWaveformPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.button === 2 &&
      audioUrl &&
      durationSeconds &&
      waveformIsZoomed
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      waveformPanRef.current = {
        lastClientX: event.clientX,
        moved: false,
        pointerId: event.pointerId,
      };
      setIsPanningWaveform(true);
      setTimelineContextMenu(null);
      return;
    }

    beginScrub(event);
  }

  function updateWaveformPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const panState = waveformPanRef.current;
    if (panState && panState.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();

      const rect = event.currentTarget.getBoundingClientRect();
      const deltaX = event.clientX - panState.lastClientX;
      if (rect.width > 0 && Math.abs(deltaX) > 0) {
        panState.moved = panState.moved || Math.abs(deltaX) > 2;
        const shift = (-deltaX / rect.width) * visibleWaveformWindowSpan;
        setWaveformWindow((current) =>
          shiftedWaveformWindow(
            normalizedWaveformWindow(current, minimumWaveformWindowSpan),
            shift,
          ),
        );
      }

      panState.lastClientX = event.clientX;
      return;
    }

    updateScrub(event);
  }

  function endWaveformPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const panState = waveformPanRef.current;
    if (panState && panState.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (panState.moved) {
        ignoreWaveformClickRef.current = true;
        ignoreWaveformContextMenuRef.current = true;
        window.setTimeout(() => {
          ignoreWaveformClickRef.current = false;
          ignoreWaveformContextMenuRef.current = false;
        }, 160);
      } else {
        const targetTimeSeconds = timeFromWaveformEvent(event, currentTime);
        openWaveformInsertMenuAt(
          event.clientX,
          event.clientY,
          targetTimeSeconds,
        );
        ignoreWaveformContextMenuRef.current = true;
        window.setTimeout(() => {
          ignoreWaveformContextMenuRef.current = false;
        }, 160);
      }

      waveformPanRef.current = null;
      setIsPanningWaveform(false);
      return;
    }

    endScrub(event);
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
      event.stopPropagation();
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
    dragState.lastClientX = event.clientX;
    dragState.timeSeconds = nextSeconds;
    dragState.moved = true;
    setDraggingMarker({
      markerIndex: dragState.markerIndex,
      timeSeconds: nextSeconds,
    });
    setCurrentTime(nextSeconds);
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
      event.stopPropagation();
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
    const linkTargetIndex =
      selectedMarkerIndex !== null && selectedMarkerIndex !== markerIndex
        ? selectedMarkerIndex
        : null;
    setSelectedMarkerIndex(markerIndex);
    setSelectedDisplayCueIndex(null);
    setTimelineContextMenu({
      index: markerIndex,
      kind: "marker",
      linkTargetIndex,
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
    if (ignoreWaveformContextMenuRef.current) {
      return;
    }

    const targetTimeSeconds = timeFromWaveformEvent(event, currentTime);
    openWaveformInsertMenuAt(event.clientX, event.clientY, targetTimeSeconds);
  }

  function handleMarkerMouseDown(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  function handleDisplayCueMouseDown(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
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

  function markerWithTimeline(
    marker: ScriptMarkerInstance,
    markerIndex: number,
    options: {
      args?: string[];
      linkId?: string | null;
      seconds?: number;
      type?: string;
    } = {},
  ) {
    const seconds = options.seconds ?? markerTime(marker, markerIndex);
    const linkId =
      options.linkId === undefined ? marker.linkId : options.linkId ?? undefined;
    return buildScriptMarker(
      options.type ?? marker.type,
      appendScriptMarkerTimelineArg(
        options.args ?? marker.argList,
        Math.round(seconds * 1000),
        linkId,
      ),
    );
  }

  function markerLinkedIndexes(markerIndex: number) {
    return linkedMarkerIndexes(markers, markerIndex);
  }

  function markerHasLinkedGroup(markerIndex: number) {
    return markerLinkedIndexes(markerIndex).length > 1;
  }

  function newMarkerLinkId(sourceIndex: number, targetIndex: number) {
    const left = Math.min(sourceIndex, targetIndex);
    const right = Math.max(sourceIndex, targetIndex);
    return `m${left}-${right}-${Date.now().toString(36)}`;
  }

  function deleteTimelineMarker(markerIndex: number) {
    const marker = markers[markerIndex];
    if (!marker) return;

    const linkedIndexes = markerLinkedIndexes(markerIndex).filter(
      (index) => index !== markerIndex,
    );
    const replacements: ScriptMarkerReplacement[] = [
      { marker, nextMarker: null },
    ];

    if (marker.linkId && linkedIndexes.length === 1) {
      const remainingIndex = linkedIndexes[0];
      const remainingMarker = markers[remainingIndex];
      if (remainingMarker) {
        replacements.push({
          marker: remainingMarker,
          nextMarker: markerWithTimeline(remainingMarker, remainingIndex, {
            linkId: null,
          }),
        });
      }
    }

    onMarkedTextChange(replaceScriptMarkersInText(text, replacements));
    setSelectedMarkerIndex(null);
    setTimelineContextMenu(null);
  }

  function unlinkTimelineMarker(markerIndex: number) {
    const marker = markers[markerIndex];
    if (!marker?.linkId) return;

    const linkedIndexes = markerLinkedIndexes(markerIndex).filter(
      (index) => index !== markerIndex,
    );
    const replacements: ScriptMarkerReplacement[] = [
      {
        marker,
        nextMarker: markerWithTimeline(marker, markerIndex, { linkId: null }),
      },
    ];

    if (linkedIndexes.length === 1) {
      const remainingIndex = linkedIndexes[0];
      const remainingMarker = markers[remainingIndex];
      if (remainingMarker) {
        replacements.push({
          marker: remainingMarker,
          nextMarker: markerWithTimeline(remainingMarker, remainingIndex, {
            linkId: null,
          }),
        });
      }
    }

    onMarkedTextChange(replaceScriptMarkersInText(text, replacements));
    setTimelineContextMenu(null);
  }

  function linkContextMarkerToSelected() {
    if (!timelineContextMenu || timelineContextMenu.kind !== "marker") return;
    const sourceIndex = timelineContextMenu.index;
    const targetIndex = timelineContextMenu.linkTargetIndex;
    if (targetIndex === null || targetIndex === sourceIndex) return;

    const sourceMarker = markers[sourceIndex];
    const targetMarker = markers[targetIndex];
    if (!sourceMarker || !targetMarker) return;

    const linkId =
      targetMarker.linkId ||
      newMarkerLinkId(sourceIndex, targetIndex);
    const targetTime = markerTime(targetMarker, targetIndex);
    const oldLinkedIndexes =
      sourceMarker.linkId && sourceMarker.linkId !== linkId
        ? markerLinkedIndexes(sourceIndex).filter((index) => index !== sourceIndex)
        : [];
    const replacements: ScriptMarkerReplacement[] = [
      {
        marker: sourceMarker,
        nextMarker: markerWithTimeline(sourceMarker, sourceIndex, {
          linkId,
          seconds: targetTime,
        }),
      },
    ];

    if (targetMarker.linkId !== linkId) {
      replacements.push({
        marker: targetMarker,
        nextMarker: markerWithTimeline(targetMarker, targetIndex, { linkId }),
      });
    }

    if (oldLinkedIndexes.length === 1) {
      const remainingIndex = oldLinkedIndexes[0];
      const remainingMarker = markers[remainingIndex];
      if (remainingMarker) {
        replacements.push({
          marker: remainingMarker,
          nextMarker: markerWithTimeline(remainingMarker, remainingIndex, {
            linkId: null,
          }),
        });
      }
    }

    onMarkedTextChange(replaceScriptMarkersInText(text, replacements));
    setSelectedMarkerIndex(sourceIndex);
    setSelectedDisplayCueIndex(null);
    seek(targetTime, { pause: true });
    setTimelineContextMenu(null);
  }

  function handleContextMenuDeleteClick(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (timelineContextMenu?.kind === "marker") {
      deleteTimelineMarker(timelineContextMenu.index);
    }
  }

  function handleContextMenuLinkClick(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    linkContextMarkerToSelected();
  }

  function handleContextMenuUnlinkClick(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (timelineContextMenu?.kind === "marker") {
      unlinkTimelineMarker(timelineContextMenu.index);
    }
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

  useFloatingMenuLifecycle({
    isOpen: Boolean(timelineContextMenu),
    menuRef: timelineContextMenuRef,
    onClose: () => setTimelineContextMenu(null),
    position: timelineContextMenu,
    setPosition: setTimelineContextMenu,
    updateDependencies: [text],
  });

  useEffect(() => {
    setDraftDisplayCueOffsets(displayCueOffsets);
  }, [audioItem?.id, displayCueOffsetKey]);

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
  const visibleWaveformPeaks = visibleWaveformPeaksForWindow(
    waveform.peaks,
    visibleWaveformWindow,
  );
  const {
    displayCueLayouts,
    laneCount,
    timelineMarkers,
  } = buildFineTuningTimelineLayout({
    displayCues: displayCueChunks.map((chunk, index) => {
      const timeSeconds = displayCueTime(index);
      return {
        chunk,
        index,
        timeSeconds,
        widthPx: estimateDisplayCueWidthPx(chunk),
      };
    }),
    durationForLayout,
    markers: markers.map((marker, index) => {
      const timeSeconds = markerTime(marker, index);
      return {
        index,
        marker,
        timeSeconds,
        widthPx: estimateFineTuningMarkerWidthPx(marker),
      };
    }),
    timelineVisibility,
    visibleWaveformWindow,
    visibleWaveformWindowSpan,
    waveformWidth,
  });
  const waveformMarkerTop = 68;
  const waveformMarkerGap = 28;
  const waveformHeight = Math.max(124, 96 + laneCount * waveformMarkerGap);
  const timelineContextMarker =
    timelineContextMenu?.kind === "marker"
      ? markers[timelineContextMenu.index] ?? null
      : null;
  const timelineContextLinkTarget =
    timelineContextMenu?.kind === "marker" &&
    timelineContextMenu.linkTargetIndex !== null
      ? markers[timelineContextMenu.linkTargetIndex] ?? null
      : null;
  const timelineContextCanLink = Boolean(
    timelineContextMarker &&
      timelineContextLinkTarget &&
      (!timelineContextMarker.linkId ||
        !timelineContextLinkTarget.linkId ||
        timelineContextMarker.linkId !== timelineContextLinkTarget.linkId),
  );
  const timelineContextMarkerIsLinked =
    timelineContextMenu?.kind === "marker"
      ? markerHasLinkedGroup(timelineContextMenu.index)
      : false;
  const timelineContextMenuHasEditor = Boolean(
    timelineContextMarker &&
      markerSupportsFineTuningSettings(timelineContextMarker),
  );

  return (
    <div aria-label="Fine Tuning" className="next-fine-tuning-panel">
      <audio preload="auto" ref={audioRef} src={audioPlaybackUrl} />
      <NextFineTuningPlaybackPreview
        activeChatChunkId={activeChatChunkId}
        canRefreshSlides={canRefreshSlides}
        chatPreviewPlaceholder={chatPreviewPlaceholder}
        chatPreviewRef={chatPreviewRef}
        deckUrl={deckUrl}
        isRefreshingSlides={isRefreshingSlides}
        onChatPointerDown={markChatPreviewUserScrollIntent}
        onChatScroll={handleChatPreviewScroll}
        onChatTouchStart={markChatPreviewUserScrollIntent}
        onChatWheel={markChatPreviewUserScrollIntent}
        onRefreshSlides={onRefreshSlides}
        registerChatChunkRef={(chunkId, element) => {
          if (element) {
            chatPreviewChunkRefs.current.set(chunkId, element);
          } else {
            chatPreviewChunkRefs.current.delete(chunkId);
          }
        }}
        slidePreview={slidePreview}
        slideRef={slideRef}
        visibleChatChunks={visibleChatChunks}
      />

      <NextFineTuningTransportControls
        canPlay={Boolean(audioPlaybackUrl)}
        currentWord={currentWord}
        durationSeconds={durationSeconds}
        isPlaying={isPlaying}
        onCyclePlaybackRate={cyclePlaybackRate}
        onToggleLayer={toggleTimelineLayer}
        onTogglePlayback={togglePlayback}
        playbackRate={playbackRate}
        timelineVisibility={timelineVisibility}
        visibleTime={visibleTime}
      />

      <div
        aria-disabled={!audioUrl}
        aria-label="Audio waveform"
        className={[
          "next-fine-waveform",
          audioUrl ? "" : "is-disabled",
          draggingMarker || draggingDisplayCue ? "is-dragging-marker" : "",
          isPanningWaveform ? "is-panning" : "",
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
        onPointerCancel={endWaveformPointer}
        onPointerDown={beginWaveformPointer}
        onPointerMove={updateWaveformPointer}
        onPointerUp={endWaveformPointer}
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
              : markerPreview?.detail || fineTuningMarkerLabel(marker);
          const guideHeight = Math.max(
            18,
            waveformMarkerTop + lane * waveformMarkerGap - 12,
          );

          return (
            <button
              aria-label={`${fineTuningMarkerLabel(marker)} at ${formatTimelineSeconds(
                timeSeconds,
              )}`}
              aria-pressed={selectedMarkerIndex === index}
              className={[
                "next-fine-marker",
                slideMarkerForPreview ? "is-slide" : "is-action",
                slideMarkerForPreview ? "has-preview" : "",
                fineTuningMarkerHasIcon(marker) ? "has-icon" : "",
                selectedMarkerIndex === index ? "is-selected" : "",
                hasTimeMatch ? "is-time-match" : "",
                markerHasLinkedGroup(index) ? "is-linked" : "",
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
              onMouseDown={handleMarkerMouseDown}
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
              {fineTuningMarkerHasIcon(marker) ? (
                <span className="next-fine-marker-icon">
                  {scriptMarkerIcon(marker.type)}
                </span>
              ) : null}
              <strong>{fineTuningMarkerLabel(marker)}</strong>
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
                    handleDisplayCueMouseDown(event)
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
        <NextFineTuningContextMenu
          canLink={timelineContextCanLink}
          hasEditor={timelineContextMenuHasEditor}
          isLinked={timelineContextMarkerIsLinked}
          marker={timelineContextMarker}
          menu={timelineContextMenu}
          menuRef={timelineContextMenuRef}
          onAddMarker={insertTimelineMarker}
          onDelete={handleContextMenuDeleteClick}
          onLink={handleContextMenuLinkClick}
          onMoveToCurrentTime={handleContextMenuMoveClick}
          onUnlink={handleContextMenuUnlinkClick}
          onUpdateMarkerArgs={updateMarkerArgs}
        />
      </div>
    </div>
  );
}
