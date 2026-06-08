import type { ScriptMarkerInstance } from "../scriptMarkers";

export type ScriptMarkerReplacement = {
  marker: ScriptMarkerInstance;
  nextMarker: string | null;
};

export function replaceScriptMarkerText(
  text: string,
  marker: ScriptMarkerInstance,
  nextMarker: string,
) {
  return `${text.slice(0, marker.start)}${nextMarker}${text.slice(marker.end)}`;
}

export function insertScriptMarkerAt(
  text: string,
  insertionIndex: number,
  marker: string,
) {
  const safeIndex = Math.min(Math.max(0, insertionIndex), text.length);
  const before = text.slice(0, safeIndex);
  const after = text.slice(safeIndex);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  return `${before}${prefix}${marker}${suffix}${after}`;
}

export function replaceScriptMarkersInText(
  text: string,
  replacements: ScriptMarkerReplacement[],
) {
  const seen = new Set<string>();
  let nextText = text;
  [...replacements]
    .filter(({ marker }) => {
      const key = `${marker.start}:${marker.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.marker.start - left.marker.start)
    .forEach(({ marker, nextMarker }) => {
      nextText =
        nextText.slice(0, marker.start) +
        (nextMarker ?? "") +
        nextText.slice(marker.end);
    });

  return nextText;
}

export function sourceInsertionIndexBeforeSpokenWord({
  markers,
  text,
  wordIndex,
}: {
  markers: ScriptMarkerInstance[];
  text: string;
  wordIndex: number;
}) {
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

export function linkedMarkerIndexes(
  markers: ScriptMarkerInstance[],
  markerIndex: number,
) {
  const marker = markers[markerIndex];
  if (!marker?.linkId) return [markerIndex];
  return markers
    .map((candidate, index) =>
      candidate.linkId === marker.linkId ? index : -1,
    )
    .filter((index) => index >= 0);
}
