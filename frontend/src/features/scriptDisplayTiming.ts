import type {
  MessageAudioPayload,
  ScriptWord,
} from "../types";

type DisplayChunkSource = {
  displayBreaks?: number[];
  displayCueOffsets?: number[];
  displaySlots?: string[];
  durationSeconds?: number | null;
  messageId?: string;
  scriptWords?: ScriptWord[];
};

export type ScriptDisplayChunkSpec = {
  automaticStartTime: number;
  boundaryIndex: number;
  endSlot: number;
  endTime: number;
  fullText: string;
  id: string;
  index: number;
  offsetSeconds: number;
  startSlot: number;
  startTime: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeScriptDisplaySlots(value: string[] | undefined) {
  if (!Array.isArray(value)) return [];
  return value.map((slot) => (slot == null ? "" : String(slot).trim()));
}

export function normalizeScriptDisplayBreaks(
  value: number[] | undefined,
  slotCount: number,
) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter(
      (index) =>
        Number.isInteger(index) &&
        index >= 0 &&
        (!slotCount || index < slotCount - 1),
    )
    .sort((left, right) => left - right);
}

export function displayBreakCountMap(breaks: number[]) {
  const counts = new Map<number, number>();
  breaks.forEach((breakIndex) =>
    counts.set(breakIndex, (counts.get(breakIndex) ?? 0) + 1),
  );
  return counts;
}

export function normalizeScriptDisplayCueOffsets(
  value: number[] | undefined,
  cueCount: number,
) {
  const offsets = Array.isArray(value)
    ? value.map((item) => {
        const offset = Number(item);
        return Number.isFinite(offset) ? offset : 0;
      })
    : [];

  if (offsets.length < cueCount) {
    offsets.push(...Array.from({ length: cueCount - offsets.length }, () => 0));
  }
  return offsets.slice(0, cueCount);
}

export function stagedDisplaySplitIndexes(displayBreaks: number[]) {
  return [...displayBreakCountMap(displayBreaks).entries()]
    .filter(([, count]) => count >= 2)
    .map(([index]) => index)
    .sort((left, right) => left - right);
}

export function hasStagedDisplayBreak(displayBreaks: number[] | undefined) {
  return stagedDisplaySplitIndexes(normalizeScriptDisplayBreaks(displayBreaks, 0))
    .length > 0;
}

function displayTextFromSlotRange(
  slots: string[],
  breaks: number[],
  startSlot: number,
  endSlot: number,
) {
  if (endSlot < startSlot) return "";

  const breakCounts = displayBreakCountMap(breaks);
  const lines = [""];
  for (let index = startSlot; index <= endSlot; index += 1) {
    const slotText = slots[index]?.trim() ?? "";
    if (slotText) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${slotText}`.trim();
    }

    const breakCount = breakCounts.get(index) ?? 0;
    if (breakCount === 1 && index < endSlot) {
      lines.push("");
    }
  }
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
}

function normalizeTimingToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[^a-z0-9]+/g, "");
}

function alignDisplaySlotsToScriptWords(
  displaySlots: string[],
  scriptWords: ScriptWord[],
) {
  if (!displaySlots.length || !scriptWords.length) return [];

  if (displaySlots.length === scriptWords.length) {
    return displaySlots.map((_, index) => index);
  }

  const displayTokens = displaySlots.map(normalizeTimingToken);
  const timingTokens = scriptWords.map((word) =>
    normalizeTimingToken(word.word),
  );
  const rowCount = displayTokens.length + 1;
  const columnCount = timingTokens.length + 1;
  const costs = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => 0),
  );

  for (let row = displayTokens.length - 1; row >= 0; row -= 1) {
    for (let column = timingTokens.length - 1; column >= 0; column -= 1) {
      costs[row][column] =
        displayTokens[row] && displayTokens[row] === timingTokens[column]
          ? (costs[row + 1]?.[column + 1] ?? 0) + 1
          : Math.max(
              costs[row + 1]?.[column] ?? 0,
              costs[row]?.[column + 1] ?? 0,
            );
    }
  }

  const indexes = Array.from({ length: displaySlots.length }, () => -1);
  let row = 0;
  let column = 0;
  while (row < displayTokens.length && column < timingTokens.length) {
    if (
      displayTokens[row] &&
      displayTokens[row] === timingTokens[column] &&
      costs[row][column] === (costs[row + 1]?.[column + 1] ?? 0) + 1
    ) {
      indexes[row] = column;
      row += 1;
      column += 1;
    } else if (
      (costs[row + 1]?.[column] ?? 0) >= (costs[row]?.[column + 1] ?? 0)
    ) {
      row += 1;
    } else {
      column += 1;
    }
  }

  return indexes;
}

function scriptWordStart(scriptWords: ScriptWord[], wordIndex: number) {
  const word = scriptWords[wordIndex];
  if (!word) return null;

  const start = Number(word.start);
  return Number.isFinite(start) ? Math.max(0, start) : null;
}

function approximateDisplaySlotStartTime({
  displaySlotCount,
  durationSeconds,
  scriptWords,
  slotWordIndexes,
  startSlot,
}: {
  displaySlotCount: number;
  durationSeconds: number;
  scriptWords: ScriptWord[];
  slotWordIndexes: number[];
  startSlot: number;
}) {
  for (let index = startSlot; index < slotWordIndexes.length; index += 1) {
    const mappedTime = scriptWordStart(scriptWords, slotWordIndexes[index]);
    if (mappedTime !== null) return mappedTime;
  }

  const directTime = scriptWordStart(
    scriptWords,
    Math.min(Math.max(0, startSlot), scriptWords.length - 1),
  );
  if (directTime !== null) return directTime;

  return durationSeconds * clamp(startSlot / Math.max(1, displaySlotCount), 0, 1);
}

export function scriptDisplayChunkSpecsFromValues({
  displayBreaks: rawDisplayBreaks,
  displayCueOffsets: rawDisplayCueOffsets,
  displaySlots: rawDisplaySlots,
  durationSeconds = 0,
  messageId = "",
  scriptWords: rawScriptWords,
}: DisplayChunkSource) {
  const displaySlots = normalizeScriptDisplaySlots(rawDisplaySlots);
  const displayBreaks = normalizeScriptDisplayBreaks(
    rawDisplayBreaks,
    displaySlots.length,
  );
  const scriptWords = Array.isArray(rawScriptWords) ? rawScriptWords : [];
  const splitAfterIndexes = stagedDisplaySplitIndexes(displayBreaks);

  if (!splitAfterIndexes.length) return [];
  if (!displaySlots.length || !scriptWords.length) return [];

  const displayCueOffsets = normalizeScriptDisplayCueOffsets(
    rawDisplayCueOffsets,
    splitAfterIndexes.length,
  );
  const specs: ScriptDisplayChunkSpec[] = [];
  const splitBoundaries = [...splitAfterIndexes, displaySlots.length - 1];
  const chunkStarts = [
    0,
    ...splitAfterIndexes.map((splitAfterIndex) => splitAfterIndex + 1),
  ];
  const slotWordIndexes = alignDisplaySlotsToScriptWords(displaySlots, scriptWords);
  const audioEndTime =
    durationSeconds ||
    scriptWords[scriptWords.length - 1]?.end ||
    scriptWords[scriptWords.length - 1]?.start ||
    0;
  const automaticStartTimes = chunkStarts.map((slotIndex, index) => {
    if (index === 0) return 0;
    return approximateDisplaySlotStartTime({
      displaySlotCount: displaySlots.length,
      durationSeconds: audioEndTime,
      scriptWords,
      slotWordIndexes,
      startSlot: slotIndex,
    });
  });
  const chunkStartTimes = automaticStartTimes.map((time, index) => {
    if (index === 0) return 0;
    return clamp(time + (displayCueOffsets[index - 1] ?? 0), 0, audioEndTime);
  });

  chunkStartTimes.forEach((time, index) => {
    if (index <= 0) return;
    const previousTime = chunkStartTimes[index - 1];
    if (time <= previousTime) {
      chunkStartTimes[index] = previousTime + 0.05;
    }
  });

  chunkStarts.forEach((startSlot, chunkIndex) => {
    const endSlot = splitBoundaries[chunkIndex];
    if (endSlot === undefined || endSlot < startSlot) return;

    const startTime = Math.max(0, chunkStartTimes[chunkIndex] ?? 0);
    const nextStartTime = chunkStartTimes[chunkIndex + 1];
    const endTime = Math.max(startTime, nextStartTime ?? audioEndTime);
    const textBreaks = displayBreaks.filter(
      (breakIndex) => breakIndex >= startSlot && breakIndex < endSlot,
    );
    const fullText = displayTextFromSlotRange(
      displaySlots,
      textBreaks,
      startSlot,
      endSlot,
    );

    specs.push({
      automaticStartTime: automaticStartTimes[chunkIndex] ?? startTime,
      boundaryIndex: chunkIndex - 1,
      endSlot,
      endTime,
      fullText,
      id: `${messageId || "script"}:chunk:${specs.length}`,
      index: specs.length,
      offsetSeconds: chunkIndex > 0 ? displayCueOffsets[chunkIndex - 1] ?? 0 : 0,
      startSlot,
      startTime,
    });
  });

  return specs.length > 1 ? specs : [];
}

export function scriptDisplayChunkSpecsFromPayload(
  messageId: string,
  payload: MessageAudioPayload,
  durationSeconds: number,
) {
  return scriptDisplayChunkSpecsFromValues({
    displayBreaks: payload.displayBreaks,
    displayCueOffsets: payload.displayCueOffsets,
    displaySlots: payload.displaySlots,
    durationSeconds,
    messageId,
    scriptWords: payload.scriptWords,
  });
}
