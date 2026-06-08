import type { ScriptMarkerInstance } from "../scriptMarkers";
import type { ScriptDisplayChunkSpec } from "./scriptDisplayTiming";
import { clamp, isSlideMarker } from "./scriptActionEditorUtils";

export type WaveformWindow = {
  end: number;
  start: number;
};

export type FineTuningTimelineLayer = "actions" | "chatCues" | "slides";

export type FineTuningTimelineVisibility = Record<
  FineTuningTimelineLayer,
  boolean
>;

export type TimelineMarkerLayout = {
  hasTimeMatch: boolean;
  index: number;
  lane: number;
  marker: ScriptMarkerInstance;
  timeSeconds: number;
};

export type DisplayCueLayout = {
  chunk: ScriptDisplayChunkSpec;
  hasTimeMatch: boolean;
  index: number;
  lane: number;
  timeSeconds: number;
};

export type TimelineMarkerLayoutCandidate = {
  index: number;
  marker: ScriptMarkerInstance;
  timeSeconds: number;
  widthPx: number;
};

export type DisplayCueLayoutCandidate = {
  chunk: ScriptDisplayChunkSpec;
  index: number;
  timeSeconds: number;
  widthPx: number;
};

export function normalizedWaveformWindow(
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

export function shiftedWaveformWindow(
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

export function waveformPercentForTime(
  seconds: number,
  durationForLayout: number,
  visibleWaveformWindow: WaveformWindow,
  visibleWaveformWindowSpan: number,
) {
  const normalizedTime = clamp(seconds / durationForLayout, 0, 1);
  return (
    ((normalizedTime - visibleWaveformWindow.start) /
      visibleWaveformWindowSpan) *
    100
  );
}

export function isTimeVisibleInWaveform(
  seconds: number,
  durationForLayout: number,
  visibleWaveformWindow: WaveformWindow,
) {
  const normalizedTime = clamp(seconds / durationForLayout, 0, 1);
  return (
    normalizedTime >= visibleWaveformWindow.start - 0.01 &&
    normalizedTime <= visibleWaveformWindow.end + 0.01
  );
}

export function visibleWaveformPeaksForWindow(
  peaks: number[],
  visibleWaveformWindow: WaveformWindow,
) {
  if (!peaks.length) return [];
  const firstPeakIndex = Math.max(
    0,
    Math.floor(visibleWaveformWindow.start * peaks.length),
  );
  const lastPeakIndex = Math.min(
    peaks.length,
    Math.ceil(visibleWaveformWindow.end * peaks.length),
  );
  return peaks.slice(firstPeakIndex, Math.max(firstPeakIndex + 1, lastPeakIndex));
}

export function buildFineTuningTimelineLayout({
  displayCues,
  durationForLayout,
  markers,
  timelineVisibility,
  visibleWaveformWindow,
  visibleWaveformWindowSpan,
  waveformWidth,
}: {
  displayCues: DisplayCueLayoutCandidate[];
  durationForLayout: number;
  markers: TimelineMarkerLayoutCandidate[];
  timelineVisibility: FineTuningTimelineVisibility;
  visibleWaveformWindow: WaveformWindow;
  visibleWaveformWindowSpan: number;
  waveformWidth: number;
}) {
  const visibleMarkers = markers
    .map((item) => ({
      ...item,
      category: isSlideMarker(item.marker)
        ? ("slide" as const)
        : ("action" as const),
      timeMs: Math.round(item.timeSeconds * 1000),
    }))
    .filter((item) =>
      isTimeVisibleInWaveform(
        item.timeSeconds,
        durationForLayout,
        visibleWaveformWindow,
      ),
    )
    .filter((item) =>
      item.category === "slide"
        ? timelineVisibility.slides
        : timelineVisibility.actions,
    );
  const visibleDisplayCues = displayCues
    .map((item) => ({
      ...item,
      timeMs: Math.round(item.timeSeconds * 1000),
    }))
    .filter(() => timelineVisibility.chatCues)
    .filter((item) =>
      isTimeVisibleInWaveform(
        item.timeSeconds,
        durationForLayout,
        visibleWaveformWindow,
      ),
    );
  const visibleTimelineLayoutItems = [
    ...visibleMarkers.map((item) => ({
      ...item,
      kind: "marker" as const,
      sortGroup: item.category === "slide" ? 0 : 1,
    })),
    ...visibleDisplayCues.map((item) => ({
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
        (waveformPercentForTime(
          item.timeSeconds,
          durationForLayout,
          visibleWaveformWindow,
          visibleWaveformWindowSpan,
        ) /
          100) *
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

  const timelineMarkers = visibleMarkers
    .map((item) => layoutByIndex.get(item.index))
    .filter((item): item is TimelineMarkerLayout => Boolean(item));
  const displayCueLayouts = visibleDisplayCues
    .map((item) => displayCueLayoutByIndex.get(item.index))
    .filter((item): item is DisplayCueLayout => Boolean(item));
  const laneCount = Math.max(
    1,
    ...timelineMarkers.map((item) => item.lane + 1),
    ...displayCueLayouts.map((item) => item.lane + 1),
  );

  return {
    displayCueLayouts,
    laneCount,
    timelineMarkers,
  };
}
