import { useEffect, useRef, useState } from "react";

import {
  normalizedWaveformWindow,
  type WaveformWindow,
} from "./fineTuningTimelineLayout";

export type MarkerDragState = {
  lastClientX: number;
  markerIndex: number;
  moved: boolean;
  timeSeconds: number;
};

export type DisplayCueDragState = {
  cueIndex: number;
  lastClientX: number;
  moved: boolean;
  timeSeconds: number;
};

export type ActiveMarkerDrag = {
  markerIndex: number;
  timeSeconds: number;
} | null;

export type ActiveDisplayCueDrag = {
  cueIndex: number;
  timeSeconds: number;
} | null;

export type ScrubState = {
  fineDrag: boolean;
  lastClientX: number;
  pointerId: number;
  timeSeconds: number;
};

export type MouseScrubState = {
  fineDrag: boolean;
  lastClientX: number;
  timeSeconds: number;
};

export type WaveformPanState = {
  lastClientX: number;
  moved: boolean;
  pointerId: number;
};

export type ManualSeekState = {
  expiresAt: number;
  timeSeconds: number;
};

export type TimelineContextMenuState =
  | {
      index: number;
      kind: "marker";
      linkTargetIndex: number | null;
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

export function useFineTuningTimelineState({
  audioItemId,
  displayCueCount,
  markerCount,
  minimumWaveformWindowSpan,
}: {
  audioItemId: string | undefined;
  displayCueCount: number;
  markerCount: number;
  minimumWaveformWindowSpan: number;
}) {
  const displayCueDragRef = useRef<DisplayCueDragState | null>(null);
  const ignoreMarkerClickRef = useRef(false);
  const ignoreWaveformContextMenuRef = useRef(false);
  const ignoreWaveformClickRef = useRef(false);
  const manualSeekRef = useRef<ManualSeekState | null>(null);
  const markerDragRef = useRef<MarkerDragState | null>(null);
  const mouseScrubRef = useRef<MouseScrubState | null>(null);
  const scrubRef = useRef<ScrubState | null>(null);
  const waveformPanRef = useRef<WaveformPanState | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggingDisplayCue, setDraggingDisplayCue] =
    useState<ActiveDisplayCueDrag>(null);
  const [draggingMarker, setDraggingMarker] = useState<ActiveMarkerDrag>(null);
  const [isPanningWaveform, setIsPanningWaveform] = useState(false);
  const [selectedDisplayCueIndex, setSelectedDisplayCueIndex] = useState<
    number | null
  >(null);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(
    null,
  );
  const [timelineContextMenu, setTimelineContextMenu] =
    useState<TimelineContextMenuState | null>(null);
  const [waveformWindow, setWaveformWindow] = useState<WaveformWindow>({
    end: 1,
    start: 0,
  });

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
    waveformPanRef.current = null;
    setIsPanningWaveform(false);
    setTimelineContextMenu(null);
  }, [audioItemId]);

  useEffect(() => {
    setWaveformWindow((current) =>
      normalizedWaveformWindow(current, minimumWaveformWindowSpan),
    );
  }, [minimumWaveformWindowSpan]);

  useEffect(() => {
    setSelectedMarkerIndex((current) =>
      current !== null && current >= markerCount ? null : current,
    );
  }, [markerCount]);

  useEffect(() => {
    setSelectedDisplayCueIndex((current) =>
      current !== null && current >= displayCueCount ? null : current,
    );
  }, [displayCueCount]);

  return {
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
  };
}
