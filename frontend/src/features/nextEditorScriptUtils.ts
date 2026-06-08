import {
  normalizeScriptAudioText,
  type ScriptMarkerInstance,
} from "../scriptMarkers";
import type { ScriptAudioItem } from "../types";
import {
  normalizeDisplayBreaks,
  scriptAudioDisplayBaseSlots,
  scriptAudioPersistedDisplayBreaks,
} from "./scriptAudioDisplayUtils";

const scriptActionHistoryLimit = 80;

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

export function replaceScriptMarker(
  text: string,
  marker: ScriptMarkerInstance,
  nextMarker: string,
) {
  return `${text.slice(0, marker.start)}${nextMarker}${text.slice(marker.end)}`;
}

export function removeScriptMarker(text: string, marker: ScriptMarkerInstance) {
  return `${text.slice(0, marker.start)}${text.slice(marker.end)}`
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

export function isNativeUndoTarget(target: EventTarget | null) {
  const element =
    target instanceof HTMLElement
      ? target
      : target instanceof Text
        ? target.parentElement
        : null;

  return Boolean(
    element?.closest(
      "input, textarea, select, [contenteditable='true'], .cm-editor, .python-dsl-editor",
    ),
  );
}

export function appendScriptActionHistoryEntry(stack: string[], value: string) {
  if (stack[stack.length - 1] === value) return stack;
  return [...stack, value].slice(-scriptActionHistoryLimit);
}

export function wordInsertionIndex(text: string, wordIndex: number) {
  if (wordIndex <= 0) return 0;

  const pattern = /\S+/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    index += 1;
    if (index === wordIndex) {
      return (match.index ?? 0) + match[0].length;
    }
  }
  return text.length;
}

export function mergeMarkersIntoSpokenText(
  spokenText: string,
  markers: ScriptMarkerInstance[],
) {
  const markerInserts = markers.map((marker, index) => ({
    index,
    insertionIndex: wordInsertionIndex(spokenText, marker.wordIndex),
    marker: marker.marker,
  }));

  return markerInserts
    .sort((left, right) =>
      left.insertionIndex === right.insertionIndex
        ? right.index - left.index
        : right.insertionIndex - left.insertionIndex,
    )
    .reduce(
      (currentText, markerInsert) =>
        insertScriptMarkerAt(
          currentText,
          markerInsert.insertionIndex,
          markerInsert.marker,
        ),
      spokenText,
    );
}

export function scriptAudioItemForScriptText(
  items: ScriptAudioItem[],
  scriptText: string,
) {
  const normalizedScriptText = normalizeScriptAudioText(scriptText);
  if (!normalizedScriptText) return null;

  return (
    items.find(
      (item) =>
        normalizeScriptAudioText(item.script || item.preview || "") ===
        normalizedScriptText,
    ) ?? null
  );
}

export function displayBreakDraftForItem(
  item: ScriptAudioItem | null,
  drafts: Record<string, number[]>,
) {
  if (!item) return [];

  const persistedBreaks = scriptAudioPersistedDisplayBreaks(item);
  const slotCount = scriptAudioDisplayBaseSlots(item).length;
  return normalizeDisplayBreaks(drafts[item.id] ?? persistedBreaks, slotCount);
}
