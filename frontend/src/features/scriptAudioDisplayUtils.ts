import type { CSSProperties } from "react";

import { displayTranscriptSlotsFromText } from "../scriptMarkers";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type ScriptAudioDisplayFields = {
  displayBaseSlots?: string[];
  displayBaseText?: string;
  displayBreaks?: number[];
  displayCueOffsets?: number[];
  displaySlots?: string[];
  displayText?: string;
  preview?: string;
  script?: string;
};

export function normalizeDisplaySlot(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function displaySlotsAreEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((slot, index) => slot.trim() === right[index]?.trim());
}

export function normalizeDisplayBreaks(value: unknown, slotCount = 0) {
  if (!Array.isArray(value)) return [];
  const breaks: number[] = [];
  value.forEach((item) => {
    const index = Number(item);
    if (!Number.isInteger(index) || index < 0) return;
    if (slotCount && index >= slotCount - 1) return;
    breaks.push(index);
  });
  return breaks.sort((left, right) => left - right);
}

export function displayBreaksAreEqual(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((breakIndex, index) => breakIndex === right[index]);
}

export function displayBreakCount(breaks: number[], slotIndex: number) {
  return breaks.filter((breakIndex) => breakIndex === slotIndex).length;
}

export function displayDraftKey(slots: string[], breaks: number[]) {
  return JSON.stringify({
    breaks,
    slots: slots.map((slot) => slot.trim()),
  });
}

export function displaySlotWidthStyle(value: string): CSSProperties {
  const label = value.trim() || "[blank]";
  return { width: `${clamp(label.length + 2, 7, 18)}ch` };
}

export function scriptAudioDisplayBaseText(item: ScriptAudioDisplayFields) {
  return item.displayBaseText?.trim() || item.script || item.preview || "";
}

export function scriptAudioDisplayBaseSlots(item: ScriptAudioDisplayFields) {
  const slots = Array.isArray(item.displayBaseSlots)
    ? item.displayBaseSlots.map(normalizeDisplaySlot)
    : [];
  if (slots.length) return slots;
  return displayTranscriptSlotsFromText(scriptAudioDisplayBaseText(item));
}

export function scriptAudioPersistedDisplaySlots(item: ScriptAudioDisplayFields) {
  const baseSlots = scriptAudioDisplayBaseSlots(item);
  const slots = Array.isArray(item.displaySlots)
    ? item.displaySlots.map(normalizeDisplaySlot)
    : [];
  if (slots.length === baseSlots.length) return slots;
  const displayTextSlots = displayTranscriptSlotsFromText(item.displayText || "");
  if (displayTextSlots.length === baseSlots.length) return displayTextSlots;
  return baseSlots;
}

export function scriptAudioPersistedDisplayBreaks(item: ScriptAudioDisplayFields) {
  return normalizeDisplayBreaks(
    item.displayBreaks,
    scriptAudioDisplayBaseSlots(item).length,
  );
}
