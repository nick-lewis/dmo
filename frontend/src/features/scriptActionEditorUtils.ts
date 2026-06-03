import type {
  ScriptMarkerInstance,
  ScriptMarkerOption,
} from "../scriptMarkers";
import type { ScriptWord } from "../types";

export const scriptTextareaMinHeightPx = 220;
export const scriptTextareaMaxHeightPx = 680;
export const scriptSlideTextareaMinHeightPx = 82;
export const scriptSlideTextareaMaxHeightPx = 360;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function isSlideMarker(marker: ScriptMarkerInstance) {
  return marker.type === "gslide" || marker.type === "slide";
}

export function isVisualPanelMarker(marker: ScriptMarkerInstance) {
  return isSlideMarker(marker) || marker.type === "show_image";
}

export function slidePreviewKeyForDeck(deckUrl: string, slideRef: string) {
  return `${deckUrl.trim()}::${slideRef.trim() || "1"}`;
}

export function nextAvailableSlideRef(markers: ScriptMarkerInstance[]) {
  const usedRefs = new Set<number>();
  markers.filter(isSlideMarker).forEach((marker) => {
    const rawRef = marker.argList[0]?.trim() || "";
    if (!/^\d+$/.test(rawRef)) return;

    const numericRef = Number.parseInt(rawRef, 10);
    if (Number.isFinite(numericRef) && numericRef > 0) {
      usedRefs.add(numericRef);
    }
  });

  let nextRef = 1;
  while (usedRefs.has(nextRef)) {
    nextRef += 1;
  }
  return String(nextRef);
}

export function scriptMarkerTypeForOption(option: ScriptMarkerOption) {
  const match = option.marker.match(/^\[([a-z_]+)(?::|\])/i);
  return match?.[1] ?? "marker";
}

export function menuCoordinate(value: number, size: number, max: number) {
  return Math.round(clamp(value, 12, Math.max(12, max - size - 12)));
}

export function dropIndexForTextTarget(
  element: HTMLElement,
  beforeIndex: number,
  afterIndex: number,
  clientX: number,
) {
  const rect = element.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? beforeIndex : afterIndex;
}

export function clickIndexForTextTarget(
  element: HTMLElement,
  beforeIndex: number,
  afterIndex: number,
  clientX: number,
) {
  const textLength = Math.max(0, afterIndex - beforeIndex);
  if (textLength <= 1) {
    return dropIndexForTextTarget(element, beforeIndex, afterIndex, clientX);
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) {
    return dropIndexForTextTarget(element, beforeIndex, afterIndex, clientX);
  }

  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return Math.round(beforeIndex + ratio * textLength);
}

export function timelinePointerTime(
  element: HTMLElement,
  clientX: number,
  timelineDurationSeconds: number,
  fallbackTime: number,
) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !timelineDurationSeconds) return fallbackTime;
  return clamp((clientX - rect.left) / rect.width, 0, 1) * timelineDurationSeconds;
}

export function markerTimelineTimeSeconds(
  marker: ScriptMarkerInstance,
  timelineWords: ScriptWord[],
  timelineDurationSeconds: number,
  spokenTimelineWordCount: number,
) {
  if (typeof marker.timeMs === "number" && Number.isFinite(marker.timeMs)) {
    return marker.timeMs / 1000;
  }
  if (timelineWords.length) {
    if (marker.wordIndex <= 0) return 0;
    if (marker.wordIndex >= timelineWords.length) {
      return timelineWords[timelineWords.length - 1]?.end ?? 0;
    }
    return timelineWords[marker.wordIndex]?.start ?? 0;
  }
  return (
    timelineDurationSeconds *
    clamp(marker.wordIndex / Math.max(1, spokenTimelineWordCount), 0, 1)
  );
}
