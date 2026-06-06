import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { publicAsset } from "../assets";
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
  clamp,
  isSlideMarker,
  markerTimelineTimeSeconds,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import { formatTimelineSeconds } from "./ScriptAudioPanel";

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

type ActiveMarkerDrag = {
  markerIndex: number;
  timeSeconds: number;
} | null;

type FineTuningPanelProps = {
  audioItem: ScriptAudioItem | null;
  deckUrl: string;
  onMarkedTextChange: (value: string) => void;
  previews: Record<string, ScriptSlidePreview>;
  text: string;
};

const defaultWaveformBucketCount = 520;
const markerFineDragRatio = 0.18;
const fineTuningSpeedStorageKey = "dlu.next-fine-tuning-speed.v1";

function markerEditKey(marker: ScriptMarkerInstance) {
  return `${marker.start}:${marker.end}:${marker.marker}`;
}

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

export function NextFineTuningPanel({
  audioItem,
  deckUrl,
  onMarkedTextChange,
  previews,
  text,
}: FineTuningPanelProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const ignoreMarkerClickRef = useRef(false);
  const ignoreWaveformClickRef = useRef(false);
  const markerDragRef = useRef<MarkerDragState | null>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggingMarker, setDraggingMarker] = useState<ActiveMarkerDrag>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(playbackRateFromStorage);
  const [waveformBucketCount, setWaveformBucketCount] = useState(
    defaultWaveformBucketCount,
  );
  const audioUrl = audioItem?.audioUrl ?? "";
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
  const visibleTime = draggingMarker?.timeSeconds ?? currentTime;
  const progressPercent = clamp((visibleTime / durationForLayout) * 100, 0, 100);
  const currentWord =
    timingWords.find((word) => visibleTime >= word.start && visibleTime <= word.end)
      ?.word ?? "";

  function timeFromClientX(clientX: number) {
    const rect = waveformRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || !durationSeconds) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * durationSeconds;
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

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

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
    if (!audioUrl || event.button !== 0) return;
    event.preventDefault();
    scrubPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(timeFromClientX(event.clientX), { pause: true });
  }

  function updateScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (scrubPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    seek(timeFromClientX(event.clientX), { pause: true });
  }

  function endScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (scrubPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    seek(timeFromClientX(event.clientX), { pause: true });
    scrubPointerRef.current = null;
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    function syncTime() {
      if (!markerDragRef.current && scrubPointerRef.current === null) {
        setCurrentTime(audio?.currentTime ?? 0);
      }
    }

    function syncDuration() {
      setAudioDuration(
        audio && Number.isFinite(audio.duration) ? audio.duration : 0,
      );
    }

    function syncPlaying() {
      setIsPlaying(Boolean(audio && !audio.paused && !audio.ended));
    }

    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("ended", syncPlaying);
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("pause", syncPlaying);
    audio.addEventListener("play", syncPlaying);
    audio.addEventListener("timeupdate", syncTime);
    syncDuration();
    syncPlaying();

    return () => {
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("ended", syncPlaying);
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("pause", syncPlaying);
      audio.removeEventListener("play", syncPlaying);
      audio.removeEventListener("timeupdate", syncTime);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    try {
      window.localStorage.setItem(fineTuningSpeedStorageKey, String(playbackRate));
    } catch {
      // Playback speed still works for this page view if storage is blocked.
    }
  }, [playbackRate]);

  useEffect(() => {
    setCurrentTime(0);
    setDraggingMarker(null);
    markerDragRef.current = null;
    scrubPointerRef.current = null;
  }, [audioItem?.id]);

  useEffect(() => {
    const element = waveformRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observedElement = element;

    function updateBucketCount() {
      const width = observedElement.getBoundingClientRect().width;
      if (!width) return;
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

  const slideMarker = activeSlideMarker();
  const slideRef = slideMarker?.argList[0]?.trim() || "";
  const slidePreview =
    slideRef && deckUrl
      ? previews[slidePreviewKeyForDeck(deckUrl, slideRef)]
      : null;
  const timelineMarkers = markers.map((marker, index) => {
    const timeSeconds = markerTime(marker, index);
    const timeMs = Math.round(timeSeconds * 1000);
    const lane = markers
      .slice(0, index)
      .filter(
        (previous, previousIndex) =>
          Math.round(markerTime(previous, previousIndex) * 1000) === timeMs,
      ).length;
    return { index, lane, marker, timeSeconds };
  });
  const laneCount = Math.max(1, ...timelineMarkers.map((item) => item.lane + 1));
  const waveformHeight = Math.min(260, Math.max(148, 118 + laneCount * 30));

  return (
    <div aria-label="Fine Tuning" className="next-fine-tuning-panel">
      <audio preload="auto" ref={audioRef} src={audioUrl} />
      <section className="next-fine-preview" aria-label="Main panel preview">
        {slidePreview?.status === "ready" && slidePreview.imageUrl ? (
          <img alt={slideRef ? `Slide ${slideRef}` : ""} src={slidePreview.imageUrl} />
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
      </section>

      <div className="next-fine-transport">
        <button
          aria-label={isPlaying ? "Pause fine tuning audio" : "Play fine tuning audio"}
          className="next-script-audio-preview-button has-audio"
          disabled={!audioUrl}
          onClick={togglePlayback}
          title={isPlaying ? "Pause" : "Play"}
          type="button"
        >
          {isPlaying ? <StopIcon /> : <MicIcon />}
        </button>
        <button
          className="next-fine-speed-button"
          disabled={!audioUrl}
          onClick={cyclePlaybackRate}
          title="Playback speed"
          type="button"
        >
          {playbackRate}x
        </button>
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
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(event) => {
          if (!audioUrl) return;
          if (ignoreWaveformClickRef.current) {
            event.preventDefault();
            return;
          }
          seek(timeFromClientX(event.clientX), { pause: true });
        }}
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
        <span
          aria-hidden="true"
          className="next-fine-playhead"
          style={{ left: `${progressPercent}%` }}
        />
        {timelineMarkers.map(({ index, lane, marker, timeSeconds }) => (
          <button
            className={[
              "next-fine-marker",
              isSlideMarker(marker) ? "is-slide" : "is-action",
            ].join(" ")}
            key={markerEditKey(marker)}
            onClick={(event) => {
              if (ignoreMarkerClickRef.current) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              event.stopPropagation();
              seek(timeSeconds);
            }}
            onPointerCancel={endMarkerDrag}
            onPointerDown={(event) => beginMarkerDrag(event, index, timeSeconds)}
            onPointerMove={updateMarkerDrag}
            onPointerUp={endMarkerDrag}
            style={{
              left: `${clamp((timeSeconds / durationForLayout) * 100, 0, 100)}%`,
              top: `${76 + lane * 30}px`,
            }}
            title={`${markerLabel(marker)} at ${formatTimelineSeconds(timeSeconds)}`}
            type="button"
          >
            <span>{scriptMarkerIcon(marker.type)}</span>
            <strong>{markerLabel(marker)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
