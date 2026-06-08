import {
  displayTranscriptSlotsFromText,
  spokenTextFromMarkedScript,
  type ScriptMarkerInstance,
} from "../scriptMarkers";
import type { ScriptWord } from "../types";
import { normalizeDisplayBreaks } from "./scriptAudioDisplayUtils";
import { isSlideMarker } from "./scriptActionEditorUtils";

export type ScriptActionViewMarker = ScriptMarkerInstance & {
  sourceMarker: ScriptMarkerInstance;
};

export type ScriptActionRow = {
  key: string;
  label: string;
  marker: ScriptActionViewMarker | null;
  slideRef: string;
  textEnd: number;
  textStart: number;
};

type ScriptSourceWordRange = {
  end: number;
  start: number;
};

export function markerEditKeyFrom(start: number, end: number, marker: string) {
  return `${start}:${end}:${marker}`;
}

export function markerEditKey(marker: ScriptMarkerInstance) {
  return markerEditKeyFrom(marker.start, marker.end, marker.marker);
}

export function sourceMarkerForView(
  marker: ScriptMarkerInstance | ScriptActionViewMarker,
) {
  return "sourceMarker" in marker ? marker.sourceMarker : marker;
}

export function viewMarkerEditKey(
  marker: ScriptMarkerInstance | ScriptActionViewMarker,
) {
  return markerEditKey(sourceMarkerForView(marker));
}

function markedScriptSourceWordRanges(
  text: string,
  markers: ScriptMarkerInstance[],
) {
  const ranges: ScriptSourceWordRange[] = [];
  const wordPattern = /[A-Za-z0-9]+(?:[.'_-][A-Za-z0-9]+)*/g;

  function appendSegment(segment: string, offset: number) {
    wordPattern.lastIndex = 0;
    for (const match of segment.matchAll(wordPattern)) {
      const start = offset + (match.index ?? 0);
      ranges.push({
        end: start + match[0].length,
        start,
      });
    }
  }

  let cursor = 0;
  [...markers]
    .sort((left, right) => left.start - right.start)
    .forEach((marker) => {
      if (marker.start > cursor) {
        appendSegment(text.slice(cursor, marker.start), cursor);
      }
      cursor = Math.max(cursor, marker.end);
    });

  if (cursor < text.length) {
    appendSegment(text.slice(cursor), cursor);
  }

  return ranges;
}

function appendMappedText(
  characters: string[],
  sourceIndexByTextIndex: number[],
  value: string,
  sourceStart: number,
  sourceEnd: number,
) {
  if (!value) return;
  sourceIndexByTextIndex[characters.length] = sourceStart;
  for (let index = 0; index < value.length; index += 1) {
    characters.push(value[index]);
    const ratio = (index + 1) / value.length;
    sourceIndexByTextIndex[characters.length] = Math.round(
      sourceStart + (sourceEnd - sourceStart) * ratio,
    );
  }
}

function appendMappedBoundary(
  characters: string[],
  sourceIndexByTextIndex: number[],
  value: string,
  sourceStart: number,
  sourceEnd: number,
) {
  if (!value) return;
  sourceIndexByTextIndex[characters.length] = sourceStart;
  characters.push(value);
  sourceIndexByTextIndex[characters.length] = sourceEnd;
}

function appendMappedLineBreaks(
  characters: string[],
  sourceIndexByTextIndex: number[],
  count: number,
  sourceStart: number,
  sourceEnd: number,
) {
  if (count <= 0) return;

  sourceIndexByTextIndex[characters.length] = sourceStart;
  for (let index = 0; index < count; index += 1) {
    characters.push("\n");
    sourceIndexByTextIndex[characters.length] =
      index === count - 1 ? sourceEnd : sourceStart;
  }
}

function buildDisplayActionBaseText(
  sourceText: string,
  sourceMarkers: ScriptMarkerInstance[],
  displaySlots: string[],
  displayBreaks: number[],
) {
  const sourceWordRanges = markedScriptSourceWordRanges(sourceText, sourceMarkers);
  const slots = displaySlots.length
    ? displaySlots
    : displayTranscriptSlotsFromText(spokenTextFromMarkedScript(sourceText));
  const breakCounts = new Map<number, number>();
  normalizeDisplayBreaks(displayBreaks, slots.length).forEach((breakIndex) => {
    breakCounts.set(breakIndex, (breakCounts.get(breakIndex) ?? 0) + 1);
  });

  const characters: string[] = [];
  const displayRangesBySourceWord: Array<
    { end: number; start: number } | undefined
  > = [];
  const sourceIndexByTextIndex = [0];
  let lineHasText = false;
  let previousVisibleSourceEnd = 0;

  slots.forEach((slot, slotIndex) => {
    const sourceRange = sourceWordRanges[slotIndex] ?? {
      end: sourceText.length,
      start: sourceText.length,
    };
    const displayText = slot.trim();

    if (displayText) {
      if (lineHasText) {
        appendMappedBoundary(
          characters,
          sourceIndexByTextIndex,
          " ",
          previousVisibleSourceEnd,
          sourceRange.start,
        );
      }

      const displayStart = characters.length;
      appendMappedText(
        characters,
        sourceIndexByTextIndex,
        displayText,
        sourceRange.start,
        sourceRange.end,
      );
      displayRangesBySourceWord[slotIndex] = {
        end: characters.length,
        start: displayStart,
      };
      lineHasText = true;
      previousVisibleSourceEnd = sourceRange.end;
    }

    const lineBreakCount = breakCounts.get(slotIndex) ?? 0;
    if (lineBreakCount) {
      appendMappedLineBreaks(
        characters,
        sourceIndexByTextIndex,
        lineBreakCount,
        sourceRange.end,
        sourceWordRanges[slotIndex + 1]?.start ?? sourceRange.end,
      );
      lineHasText = false;
      previousVisibleSourceEnd = sourceRange.end;
    }
  });

  return {
    displayRangesBySourceWord,
    sourceIndexByTextIndex,
    text: characters.join("").replace(/\n+$/, ""),
  };
}

function displayInsertionIndexForSourceWordIndex(
  wordIndex: number,
  displayText: string,
  displayRangesBySourceWord: Array<{ end: number; start: number } | undefined>,
) {
  if (wordIndex <= 0) return 0;

  for (let index = wordIndex - 1; index >= 0; index -= 1) {
    const range = displayRangesBySourceWord[index];
    if (range) return range.end;
  }

  for (let index = wordIndex; index < displayRangesBySourceWord.length; index += 1) {
    const range = displayRangesBySourceWord[index];
    if (range) return range.start;
  }

  return displayText.length;
}

function displayInsertionIndexForSourceIndex(
  sourceIndex: number,
  fallbackWordIndex: number,
  displayText: string,
  displayRangesBySourceWord: Array<{ end: number; start: number } | undefined>,
  sourceIndexByTextIndex: number[],
) {
  for (let index = 0; index < sourceIndexByTextIndex.length; index += 1) {
    if ((sourceIndexByTextIndex[index] ?? 0) >= sourceIndex) return index;
  }

  return displayInsertionIndexForSourceWordIndex(
    fallbackWordIndex,
    displayText,
    displayRangesBySourceWord,
  );
}

function displayWordIndexForTimelineTime(
  timeSeconds: number,
  timingWords: ScriptWord[],
) {
  if (!timingWords.length || !Number.isFinite(timeSeconds)) return null;

  const firstStart = timingWords[0]?.start ?? 0;
  if (timeSeconds <= firstStart) return 0;

  const nextWordIndex = timingWords.findIndex(
    (word) => Number.isFinite(word.start) && word.start >= timeSeconds,
  );
  return nextWordIndex >= 0 ? nextWordIndex : timingWords.length;
}

function timedDisplayInsertionIndexForMarker(
  marker: ScriptMarkerInstance,
  timingWords: ScriptWord[],
  displayText: string,
  displayRangesBySourceWord: Array<{ end: number; start: number } | undefined>,
) {
  if (typeof marker.timeMs !== "number" || !Number.isFinite(marker.timeMs)) {
    return null;
  }

  const displayWordIndex = displayWordIndexForTimelineTime(
    marker.timeMs / 1000,
    timingWords,
  );
  if (displayWordIndex === null) return null;

  return displayInsertionIndexForSourceWordIndex(
    displayWordIndex,
    displayText,
    displayRangesBySourceWord,
  );
}

function insertViewMarkerAt(
  text: string,
  sourceIndexByTextIndex: number[],
  insertionIndex: number,
  marker: ScriptMarkerInstance,
) {
  const safeIndex = Math.min(Math.max(0, insertionIndex), text.length);
  const before = text.slice(0, safeIndex);
  const after = text.slice(safeIndex);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const insertedText = `${prefix}${marker.marker}${suffix}`;
  const nextText = `${before}${insertedText}${after}`;
  const nextSourceIndexByTextIndex: number[] = [];
  const insertedLength = insertedText.length;
  const markerStart = safeIndex + prefix.length;
  const markerEnd = markerStart + marker.marker.length;

  for (let index = 0; index <= nextText.length; index += 1) {
    if (index <= safeIndex) {
      nextSourceIndexByTextIndex[index] = sourceIndexByTextIndex[index] ?? 0;
    } else if (index <= markerStart) {
      nextSourceIndexByTextIndex[index] = marker.start;
    } else if (index <= markerEnd) {
      const ratio = (index - markerStart) / Math.max(1, marker.marker.length);
      nextSourceIndexByTextIndex[index] = Math.round(
        marker.start + (marker.end - marker.start) * ratio,
      );
    } else if (index <= safeIndex + insertedLength) {
      nextSourceIndexByTextIndex[index] = marker.end;
    } else {
      nextSourceIndexByTextIndex[index] =
        sourceIndexByTextIndex[index - insertedLength] ?? marker.end;
    }
  }

  return {
    markerEnd,
    markerStart,
    sourceIndexByTextIndex: nextSourceIndexByTextIndex,
    text: nextText,
  };
}

function slideRowTextStart(text: string, start: number, end: number) {
  const leadingWhitespace = text.slice(start, end).match(/^\s+/)?.[0] ?? "";
  return start + leadingWhitespace.length;
}

function scriptActionRowsFromScript(
  text: string,
  markers: ScriptActionViewMarker[],
) {
  const slideMarkers = markers.filter(isSlideMarker);
  if (!slideMarkers.length) {
    return text.trim()
      ? [
          {
            key: "script",
            label: "No slide",
            marker: null,
            slideRef: "",
            textEnd: text.length,
            textStart: 0,
          },
        ]
      : [];
  }

  const rows: ScriptActionRow[] = [];
  const firstSlide = slideMarkers[0];
  if (text.slice(0, firstSlide.start).trim()) {
    rows.push({
      key: "before",
      label: "No slide",
      marker: null,
      slideRef: "",
      textEnd: firstSlide.start,
      textStart: 0,
    });
  }

  slideMarkers.forEach((marker, index) => {
    const nextMarker = slideMarkers[index + 1] ?? null;
    const slideRef = marker.argList[0]?.trim() || "1";
    const textEnd = nextMarker?.start ?? text.length;
    rows.push({
      key: viewMarkerEditKey(marker),
      label: `Slide ${slideRef}`,
      marker,
      slideRef,
      textEnd,
      textStart: slideRowTextStart(text, marker.end, textEnd),
    });
  });

  return rows;
}

export function projectScriptActionsToDisplayText({
  displayBreaks,
  displaySlots,
  markers,
  sourceText,
  timingWords = [],
}: {
  displayBreaks: number[];
  displaySlots: string[];
  markers: ScriptMarkerInstance[];
  sourceText: string;
  timingWords?: ScriptWord[];
}) {
  let {
    displayRangesBySourceWord,
    sourceIndexByTextIndex,
    text,
  } = buildDisplayActionBaseText(
    sourceText,
    markers,
    displaySlots,
    displayBreaks,
  );
  const baseTextLength = text.length;
  const viewMarkers: ScriptActionViewMarker[] = [];
  let offset = 0;

  markers
    .map((marker, index) => ({
      displayIndex:
        timedDisplayInsertionIndexForMarker(
          marker,
          timingWords,
          text,
          displayRangesBySourceWord,
        ) ??
        displayInsertionIndexForSourceIndex(
          marker.start,
          marker.wordIndex,
          text,
          displayRangesBySourceWord,
          sourceIndexByTextIndex,
        ),
      index,
      marker,
    }))
    .sort((left, right) =>
      left.displayIndex === right.displayIndex
        ? left.index - right.index
        : left.displayIndex - right.displayIndex,
    )
    .forEach(({ displayIndex, marker }) => {
      const next = insertViewMarkerAt(
        text,
        sourceIndexByTextIndex,
        displayIndex + offset,
        marker,
      );
      viewMarkers.push({
        ...marker,
        end: next.markerEnd,
        sourceMarker: marker,
        start: next.markerStart,
      });
      offset = next.text.length - baseTextLength;
      text = next.text;
      sourceIndexByTextIndex = next.sourceIndexByTextIndex;
    });

  viewMarkers.sort((left, right) => left.start - right.start);
  return {
    markers: viewMarkers,
    rows: scriptActionRowsFromScript(text, viewMarkers),
    sourceIndexByTextIndex,
    text,
  };
}
