import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  apiFetch,
  experienceEditPath,
  experienceEditorMockupsPath,
  experienceNextEditPath,
  experienceRunPath,
} from "../api";
import { publicAsset } from "../assets";
import {
  MicIcon,
  PlayIcon,
  RefreshIcon,
  SettingsIcon,
  TrashIcon,
} from "../components/Icons";
import { writeSelectedExperienceId } from "../persistence";
import {
  type RealtimeModelId,
  type RealtimeVoiceId,
  classificationModelOptions,
  isRealtimeVoiceSupported,
  realtimeModelOptions,
  realtimeVoiceOptionsForModel,
} from "../realtime";
import {
  defaultChoiceIconBackground,
  resizeTextareaToContent,
} from "../uiHelpers";
import { stringConfigValue } from "../runtimeUtils";
import {
  displayTranscriptSlotsFromText,
  normalizeScriptAudioText,
  spokenTextFromMarkedScript,
} from "../scriptMarkers";
import type {
  ApiUser,
  ClassificationModelId,
  EventActionStep,
  Experience,
  ExperienceEvent,
  ExperienceForm,
  ExperiencesPayload,
  ScriptAudioItem,
  SessionPayload,
  TutorSettings,
} from "../types";
import { experienceAutosaveDelayMs } from "./eventEditorUtils";
import type { PythonDslScriptAction } from "./PythonDslEditor";
import {
  parsePythonDslChatActions,
  parsePythonDslScriptActions,
  pythonDslSourceFromEventSteps,
} from "./pythonDslActions";
import {
  displayBreakCount,
  displayBreaksAreEqual,
  displayDraftKey,
  displaySlotsAreEqual,
  normalizeDisplayBreaks,
  scriptAudioDisplayBaseSlots,
  scriptAudioPersistedDisplayBreaks,
  scriptAudioPersistedDisplaySlots,
} from "./scriptAudioDisplayUtils";
import { useEditorScriptAudio } from "./useEditorScriptAudio";
import {
  useOverviewAutosave,
  useTutorAutosave,
} from "./useExperienceAutosave";
import { ExperienceEventFlow } from "./ExperienceEventFlow";
import { useExperienceSnapshotContextMenu } from "./useExperienceSnapshotContextMenu";
import { useVoiceSample } from "./useVoiceSample";

const tutorVoiceTextareaMinHeightPx = 36;
const tutorVoiceTextareaMaxHeightPx = 160;
const PythonDslEditor = lazy(() =>
  import("./PythonDslEditor").then((module) => ({
    default: module.PythonDslEditor,
  })),
);

type PendingEventAutosave = {
  description: string;
  eventId: string;
  title: string;
};

type PendingOnEntryAutosave = {
  eventId: string;
  source: string;
};

type PendingScriptTextAutosave = {
  eventId: string;
  stepId: string;
  text: string;
};

type ActiveScriptAction = PythonDslScriptAction & {
  eventId: string;
};

type ScriptDetailTab = "audio" | "display";

type PersistedNextEditorUiState = {
  activeScriptAction?: {
    actionIndex?: number;
    eventId?: string;
    lineNumber?: number;
    source?: string;
  } | null;
  scriptDetailTab?: ScriptDetailTab;
  selectedEventId?: string;
};

type DisplayDocumentDraft = {
  displayBreaks: number[];
  displaySlots: string[];
};

type DisplayDocumentRead = DisplayDocumentDraft & {
  hasUnslottedWords: boolean;
};

type DisplayDocumentHistoryEntry = DisplayDocumentDraft & {
  selectionOffset: number | null;
};

const displayDocumentHistoryLimit = 80;

const nextEditorUiStoragePrefix = "dlu.next-editor-ui.v1";

function nextEditorUiStorageKey(experienceId: string) {
  return `${nextEditorUiStoragePrefix}:${experienceId}`;
}

function readStoredNextEditorUiState(
  experienceId: string,
): PersistedNextEditorUiState {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(
      nextEditorUiStorageKey(experienceId),
    );
    if (!stored) return {};

    const parsed = JSON.parse(stored) as PersistedNextEditorUiState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readLocationNextEditorUiState(): PersistedNextEditorUiState {
  if (typeof window === "undefined") return {};

  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};

  const params = new URLSearchParams(hash);
  const selectedEventId = params.get("event") ?? "";
  if (!selectedEventId) return {};

  const scriptIndexValue = Number.parseInt(params.get("script") ?? "", 10);
  const tab = params.get("tab") === "display" ? "display" : "audio";
  return {
    activeScriptAction: Number.isInteger(scriptIndexValue)
      ? {
          actionIndex: scriptIndexValue,
          eventId: selectedEventId,
          source: "script()",
        }
      : null,
    scriptDetailTab: tab,
    selectedEventId,
  };
}

function writeStoredNextEditorUiState(
  experienceId: string,
  state: PersistedNextEditorUiState,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      nextEditorUiStorageKey(experienceId),
      JSON.stringify(state),
    );
  } catch {
    // The editor can still work for this page view if browser storage is blocked.
  }
}

function writeLocationNextEditorUiState(state: PersistedNextEditorUiState) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();
  if (state.selectedEventId) {
    params.set("event", state.selectedEventId);

    const action = state.activeScriptAction;
    if (
      action?.eventId === state.selectedEventId &&
      typeof action.actionIndex === "number" &&
      Number.isInteger(action.actionIndex) &&
      action.actionIndex >= 0
    ) {
      params.set("script", String(action.actionIndex));
      if (state.scriptDetailTab === "display") {
        params.set("tab", "display");
      }
    }
  }

  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${
    nextHash ? `#${nextHash}` : ""
  }`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;

  window.history.replaceState(window.history.state, "", nextUrl);
}

function defaultTutorSettings(): TutorSettings {
  return {
    assistantName: "dee-lou",
    avatarPath: "test-images/dLU-right.png",
    choiceIconBackground: defaultChoiceIconBackground,
    classificationModel: "gpt-5.4-mini",
    realtimeModel: "gpt-realtime-mini",
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  };
}

function sortedExperienceEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function replaceExperienceEvent(
  experience: Experience,
  nextEvent: ExperienceEvent,
) {
  return {
    ...experience,
    events: sortedExperienceEvents(
      experience.events.map((event) =>
        event.id === nextEvent.id ? nextEvent : event,
      ),
    ),
  };
}

function sortedEventSteps(steps: EventActionStep[]) {
  return [...steps].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function sortedScriptSteps(event: ExperienceEvent) {
  return sortedEventSteps(event.steps).filter(
    (step) => step.actionType === "script",
  );
}

function selectedEventIdFromStored(
  storedState: PersistedNextEditorUiState,
  events: ExperienceEvent[],
) {
  return storedState.selectedEventId &&
    events.some((event) => event.id === storedState.selectedEventId)
    ? storedState.selectedEventId
    : "";
}

function activeScriptActionFromStored(
  storedState: PersistedNextEditorUiState,
  events: ExperienceEvent[],
): ActiveScriptAction | null {
  const storedAction = storedState.activeScriptAction;
  if (
    !storedAction ||
    typeof storedAction.eventId !== "string" ||
    typeof storedAction.actionIndex !== "number" ||
    !Number.isInteger(storedAction.actionIndex) ||
    storedAction.actionIndex < 0
  ) {
    return null;
  }

  const event = events.find((candidate) => candidate.id === storedAction.eventId);
  if (!event || !sortedScriptSteps(event)[storedAction.actionIndex]) {
    return null;
  }

  return {
    actionIndex: storedAction.actionIndex,
    eventId: storedAction.eventId,
    from: 0,
    lineNumber:
      typeof storedAction.lineNumber === "number" &&
      Number.isInteger(storedAction.lineNumber) &&
      storedAction.lineNumber > 0
        ? storedAction.lineNumber
        : 1,
    source:
      typeof storedAction.source === "string" && storedAction.source.trim()
        ? storedAction.source
        : "script()",
    to: 0,
  };
}

function scriptDetailTabFromStored(
  storedState: PersistedNextEditorUiState,
): ScriptDetailTab {
  return storedState.scriptDetailTab === "display" ? "display" : "audio";
}

function replaceEventStep(
  event: ExperienceEvent,
  nextStep: EventActionStep,
): ExperienceEvent {
  return {
    ...event,
    steps: sortedEventSteps(
      event.steps.map((step) => (step.id === nextStep.id ? nextStep : step)),
    ),
  };
}

function displayTextFromSlots(slots: string[], breaks: number[] = []) {
  const breakCounts = new Map<number, number>();
  normalizeDisplayBreaks(breaks, slots.length).forEach((breakIndex) => {
    breakCounts.set(breakIndex, (breakCounts.get(breakIndex) ?? 0) + 1);
  });

  const lines = [""];
  slots.forEach((slot, index) => {
    const text = slot.trim();
    if (text) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${text}`.trim();
    }

    for (let breakIndex = 0; breakIndex < (breakCounts.get(index) ?? 0); breakIndex += 1) {
      lines.push("");
    }
  });

  return lines.join("\n").replace(/\n+$/, "");
}

function scriptAudioItemForScriptText(
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

function displayBreakDraftForItem(
  item: ScriptAudioItem | null,
  drafts: Record<string, number[]>,
) {
  if (!item) return [];

  const persistedBreaks = scriptAudioPersistedDisplayBreaks(item);
  const slotCount = scriptAudioDisplayBaseSlots(item).length;
  return normalizeDisplayBreaks(drafts[item.id] ?? persistedBreaks, slotCount);
}

function displayAlignmentWord(value: string) {
  return value.trim().toLocaleLowerCase();
}

function displayDocumentTextFromElement(element: HTMLElement) {
  const blockTags = new Set(["DIV", "LI", "OL", "P", "UL"]);
  let text = "";

  function appendLineBreak() {
    text += "\n";
  }

  function visitNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const childElement = node as HTMLElement;
    if (childElement.classList.contains("next-display-missing-word")) {
      return;
    }

    if (childElement.tagName === "BR") {
      appendLineBreak();
      return;
    }

    const isNestedBlock =
      childElement !== element && blockTags.has(childElement.tagName);
    if (isNestedBlock && text && !text.endsWith("\n")) {
      appendLineBreak();
    }

    Array.from(childElement.childNodes).forEach(visitNode);

    if (isNestedBlock && text && !text.endsWith("\n")) {
      appendLineBreak();
    }
  }

  Array.from(element.childNodes).forEach(visitNode);
  return text.replace(/\u00a0/g, " ").replace(/\n+$/, "");
}

function displayWordsAndBreaksFromText(text: string) {
  const words: string[] = [];
  const breakCountsAfterWord = new Map<number, number>();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((line, lineIndex) => {
    line
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => words.push(word));

    if (lineIndex < lines.length - 1 && words.length) {
      const wordIndex = words.length - 1;
      breakCountsAfterWord.set(
        wordIndex,
        (breakCountsAfterWord.get(wordIndex) ?? 0) + 1,
      );
    }
  });

  return { breakCountsAfterWord, words };
}

function displayBreaksFromText(text: string) {
  const { breakCountsAfterWord, words } = displayWordsAndBreaksFromText(text);
  const displayBreaks: number[] = [];

  breakCountsAfterWord.forEach((breakCount, wordIndex) => {
    for (let index = 0; index < breakCount; index += 1) {
      displayBreaks.push(wordIndex);
    }
  });

  return normalizeDisplayBreaks(displayBreaks, words.length);
}

function alignDisplayWordsToBase(displayWords: string[], baseSlots: string[]) {
  const baseWords = baseSlots.map(displayAlignmentWord);
  const nextWords = displayWords.map(displayAlignmentWord);
  const rowCount = baseWords.length + 1;
  const columnCount = nextWords.length + 1;
  const costs = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => Number.POSITIVE_INFINITY),
  );
  const operations = Array.from({ length: rowCount }, () =>
    Array.from<"delete" | "insert" | "slot" | "">({ length: columnCount }, () => ""),
  );

  costs[0][0] = 0;
  for (let index = 1; index < rowCount; index += 1) {
    costs[index][0] = costs[index - 1][0] + 1;
    operations[index][0] = "delete";
  }
  for (let index = 1; index < columnCount; index += 1) {
    costs[0][index] = costs[0][index - 1] + 1.4;
    operations[0][index] = "insert";
  }

  for (let baseIndex = 1; baseIndex < rowCount; baseIndex += 1) {
    for (let wordIndex = 1; wordIndex < columnCount; wordIndex += 1) {
      const isMatch = baseWords[baseIndex - 1] === nextWords[wordIndex - 1];
      const slotCost = costs[baseIndex - 1][wordIndex - 1] + (isMatch ? 0 : 0.85);
      const deleteCost = costs[baseIndex - 1][wordIndex] + 1;
      const insertCost = costs[baseIndex][wordIndex - 1] + 1.4;

      costs[baseIndex][wordIndex] = slotCost;
      operations[baseIndex][wordIndex] = "slot";

      if (deleteCost < costs[baseIndex][wordIndex]) {
        costs[baseIndex][wordIndex] = deleteCost;
        operations[baseIndex][wordIndex] = "delete";
      }

      if (insertCost < costs[baseIndex][wordIndex]) {
        costs[baseIndex][wordIndex] = insertCost;
        operations[baseIndex][wordIndex] = "insert";
      }
    }
  }

  const displaySlots = Array.from({ length: baseSlots.length }, () => "");
  const wordSlotIndexes = Array.from({ length: displayWords.length }, () => -1);
  let baseIndex = baseSlots.length;
  let wordIndex = displayWords.length;

  while (baseIndex > 0 || wordIndex > 0) {
    const operation = operations[baseIndex]?.[wordIndex];
    if (operation === "slot") {
      displaySlots[baseIndex - 1] = displayWords[wordIndex - 1] ?? "";
      wordSlotIndexes[wordIndex - 1] = baseIndex - 1;
      baseIndex -= 1;
      wordIndex -= 1;
      continue;
    }

    if (operation === "delete") {
      displaySlots[baseIndex - 1] = "";
      baseIndex -= 1;
      continue;
    }

    if (operation === "insert") {
      wordIndex -= 1;
      continue;
    }

    break;
  }

  return { displaySlots, wordSlotIndexes };
}

function displayDocumentReadFromElement(
  element: HTMLElement,
  baseSlots: string[],
): DisplayDocumentRead {
  const { breakCountsAfterWord, words } = displayWordsAndBreaksFromText(
    displayDocumentTextFromElement(element),
  );
  const { displaySlots, wordSlotIndexes } = alignDisplayWordsToBase(
    words,
    baseSlots,
  );
  const displayBreaks: number[] = [];

  breakCountsAfterWord.forEach((breakCount, wordIndex) => {
    let slotIndex = wordSlotIndexes[wordIndex] ?? -1;
    for (
      let previousWordIndex = wordIndex - 1;
      slotIndex < 0 && previousWordIndex >= 0;
      previousWordIndex -= 1
    ) {
      slotIndex = wordSlotIndexes[previousWordIndex] ?? -1;
    }

    if (slotIndex < 0 || slotIndex >= baseSlots.length - 1) return;
    for (let index = 0; index < breakCount; index += 1) {
      displayBreaks.push(slotIndex);
    }
  });

  return {
    displayBreaks: normalizeDisplayBreaks(displayBreaks, baseSlots.length),
    displaySlots,
    hasUnslottedWords: wordSlotIndexes.some((slotIndex) => slotIndex < 0),
  };
}

function displayDocumentDraftFromElement(
  element: HTMLElement,
  baseSlots: string[],
): DisplayDocumentDraft {
  const { displayBreaks, displaySlots } = displayDocumentReadFromElement(
    element,
    baseSlots,
  );
  return { displayBreaks, displaySlots };
}

function renderDisplayDocument(
  element: HTMLElement,
  displaySlots: string[],
  displayBreaks: number[],
) {
  const fragment = document.createDocumentFragment();

  displaySlots.forEach((slot, index) => {
    const text = slot.trim();
    if (text) {
      fragment.appendChild(document.createTextNode(text));
    } else {
      const missingWord = document.createElement("span");
      missingWord.className = "next-display-missing-word";
      missingWord.contentEditable = "false";
      missingWord.dataset.slotIndex = String(index);
      missingWord.setAttribute("aria-label", `Missing display word ${index + 1}`);
      fragment.appendChild(missingWord);
    }

    if (index < displaySlots.length - 1) {
      fragment.appendChild(document.createTextNode(" "));
    }

    for (
      let breakIndex = 0;
      breakIndex < displayBreakCount(displayBreaks, index);
      breakIndex += 1
    ) {
      const lineBreak = document.createElement("br");
      lineBreak.className = "next-display-line-break";
      fragment.appendChild(lineBreak);
    }
  });

  element.replaceChildren(fragment);
}

function displayMissingSlotCount(displaySlots: string[]) {
  return displaySlots.filter((slot) => !slot.trim()).length;
}

function displayMissingArtifactCount(element: HTMLElement) {
  return element.querySelectorAll(".next-display-missing-word").length;
}

function cloneDisplayDocumentDraft(
  draft: DisplayDocumentDraft,
): DisplayDocumentDraft {
  return {
    displayBreaks: [...draft.displayBreaks],
    displaySlots: [...draft.displaySlots],
  };
}

function cloneDisplayDocumentHistoryEntry(
  entry: DisplayDocumentHistoryEntry,
): DisplayDocumentHistoryEntry {
  return {
    ...cloneDisplayDocumentDraft(entry),
    selectionOffset: entry.selectionOffset,
  };
}

function displayDocumentDraftFromValues(
  displaySlots: string[],
  displayBreaks: number[],
): DisplayDocumentDraft {
  return {
    displayBreaks: normalizeDisplayBreaks(displayBreaks, displaySlots.length),
    displaySlots: [...displaySlots],
  };
}

function displayDocumentDraftsAreEqual(
  left: DisplayDocumentDraft,
  right: DisplayDocumentDraft,
) {
  return (
    displaySlotsAreEqual(left.displaySlots, right.displaySlots) &&
    displayBreaksAreEqual(left.displayBreaks, right.displayBreaks)
  );
}

function displayDocumentHistoryEntryFromDraft(
  draft: DisplayDocumentDraft,
  selectionOffset: number | null,
): DisplayDocumentHistoryEntry {
  return {
    ...cloneDisplayDocumentDraft(draft),
    selectionOffset,
  };
}

function appendDisplayDocumentHistoryEntry(
  stack: DisplayDocumentHistoryEntry[],
  entry: DisplayDocumentHistoryEntry,
) {
  const previousEntry = stack[stack.length - 1];
  if (previousEntry && displayDocumentDraftsAreEqual(previousEntry, entry)) {
    return stack;
  }

  return [...stack, cloneDisplayDocumentHistoryEntry(entry)].slice(
    -displayDocumentHistoryLimit,
  );
}

function displayDocumentDraftTextLength(draft: DisplayDocumentDraft) {
  return displayTextFromSlots(draft.displaySlots, draft.displayBreaks).length;
}

function displayDocumentSelectionOffset(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.focusNode) return null;
  if (!element.contains(selection.focusNode)) return null;

  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(selection.focusNode, selection.focusOffset);
  } catch {
    return null;
  }

  const selectedFragment = document.createElement("div");
  selectedFragment.appendChild(range.cloneContents());
  return displayDocumentTextFromElement(selectedFragment).length;
}

function setDisplayDocumentSelectionOffset(
  element: HTMLElement,
  targetOffset: number | null,
) {
  if (targetOffset === null) return;

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  let remainingOffset = Math.max(0, targetOffset);
  let didPlaceSelection = false;

  function placeSelection(node: Node) {
    if (didPlaceSelection) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const textLength = node.textContent?.length ?? 0;
      if (remainingOffset <= textLength) {
        range.setStart(node, remainingOffset);
        range.collapse(true);
        didPlaceSelection = true;
        return;
      }
      remainingOffset -= textLength;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const childElement = node as HTMLElement;
    if (childElement.classList.contains("next-display-missing-word")) {
      return;
    }

    if (childElement.tagName === "BR") {
      if (remainingOffset <= 1) {
        range.setStartAfter(childElement);
        range.collapse(true);
        didPlaceSelection = true;
        return;
      }
      remainingOffset -= 1;
      return;
    }

    Array.from(childElement.childNodes).forEach(placeSelection);
  }

  Array.from(element.childNodes).forEach(placeSelection);

  if (!didPlaceSelection) {
    range.selectNodeContents(element);
    range.collapse(false);
  }

  element.focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
}

function DisplayTextEditor({
  baseSlots,
  displayBreaks,
  displaySlots,
  isSaving,
  item,
  onChange,
  onReset,
  resetDisabled,
}: {
  baseSlots: string[];
  displayBreaks: number[];
  displaySlots: string[];
  isSaving: boolean;
  item: ScriptAudioItem;
  onChange: (draft: DisplayDocumentDraft) => void;
  onReset: () => void;
  resetDisabled: boolean;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastHistoryDraftRef = useRef<DisplayDocumentDraft | null>(null);
  const redoStackRef = useRef<DisplayDocumentHistoryEntry[]>([]);
  const undoStackRef = useRef<DisplayDocumentHistoryEntry[]>([]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (document.activeElement === editor || editor.contains(document.activeElement)) {
      return;
    }
    renderDisplayDocument(editor, displaySlots, displayBreaks);
    lastHistoryDraftRef.current = displayDocumentDraftFromValues(
      displaySlots,
      displayBreaks,
    );
    redoStackRef.current = [];
    undoStackRef.current = [];
  }, [displayBreaks, displaySlots, item.id]);

  if (!displaySlots.length) {
    return <div aria-label="Display Text" className="next-display-text-empty" />;
  }

  function applyDisplayDocumentHistoryEntry(
    element: HTMLElement,
    entry: DisplayDocumentHistoryEntry,
  ) {
    const draft = cloneDisplayDocumentDraft(entry);
    const scrollTop = element.scrollTop;
    const textLength = displayDocumentDraftTextLength(draft);
    const selectionOffset =
      entry.selectionOffset === null
        ? textLength
        : Math.min(entry.selectionOffset, textLength);

    lastHistoryDraftRef.current = cloneDisplayDocumentDraft(draft);
    onChange(draft);
    renderDisplayDocument(element, draft.displaySlots, draft.displayBreaks);
    element.scrollTop = scrollTop;
    setDisplayDocumentSelectionOffset(element, selectionOffset);
  }

  function readDocumentDraft(element: HTMLElement, recordHistory = true) {
    const selectionOffset = displayDocumentSelectionOffset(element);
    const scrollTop = element.scrollTop;
    const documentRead = displayDocumentReadFromElement(element, baseSlots);
    const draft = {
      displayBreaks: documentRead.displayBreaks,
      displaySlots: documentRead.displaySlots,
    };
    const previousDraft =
      lastHistoryDraftRef.current ??
      displayDocumentDraftFromValues(displaySlots, displayBreaks);

    if (
      recordHistory &&
      !displayDocumentDraftsAreEqual(previousDraft, draft)
    ) {
      undoStackRef.current = appendDisplayDocumentHistoryEntry(
        undoStackRef.current,
        displayDocumentHistoryEntryFromDraft(previousDraft, selectionOffset),
      );
      redoStackRef.current = [];
    }

    lastHistoryDraftRef.current = cloneDisplayDocumentDraft(draft);
    onChange(draft);
    if (
      documentRead.hasUnslottedWords ||
      displayMissingArtifactCount(element) !==
      displayMissingSlotCount(draft.displaySlots)
    ) {
      renderDisplayDocument(element, draft.displaySlots, draft.displayBreaks);
      element.scrollTop = scrollTop;
      setDisplayDocumentSelectionOffset(
        element,
        selectionOffset === null
          ? null
          : Math.min(selectionOffset, displayDocumentDraftTextLength(draft)),
      );
    }
    return draft;
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

    const key = event.key.toLocaleLowerCase();
    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = key === "y" || (key === "z" && event.shiftKey);

    if (!isUndo && !isRedo) return;

    event.preventDefault();

    const element = event.currentTarget;
    const currentDraft = displayDocumentDraftFromElement(element, baseSlots);
    const currentEntry = displayDocumentHistoryEntryFromDraft(
      currentDraft,
      displayDocumentSelectionOffset(element),
    );

    if (isUndo) {
      let targetEntry = undoStackRef.current.pop();
      while (
        targetEntry &&
        displayDocumentDraftsAreEqual(targetEntry, currentDraft)
      ) {
        targetEntry = undoStackRef.current.pop();
      }

      if (!targetEntry) return;

      redoStackRef.current = appendDisplayDocumentHistoryEntry(
        redoStackRef.current,
        currentEntry,
      );
      applyDisplayDocumentHistoryEntry(element, targetEntry);
      return;
    }

    const targetEntry = redoStackRef.current.pop();
    if (!targetEntry) return;

    undoStackRef.current = appendDisplayDocumentHistoryEntry(
      undoStackRef.current,
      currentEntry,
    );
    applyDisplayDocumentHistoryEntry(element, targetEntry);
  }

  return (
    <div
      aria-busy={isSaving ? "true" : "false"}
      aria-label="Display Text"
      className="next-display-text-editor"
      onContextMenu={(event) => event.stopPropagation()}
      role="group"
    >
      <button
        aria-label="Reset display text to audio script"
        className="next-display-reset-button"
        disabled={resetDisabled}
        onClick={onReset}
        title="Reset display text to audio script"
        type="button"
      >
        <RefreshIcon />
      </button>
      <div
        aria-label="Display Text document"
        aria-keyshortcuts="Control+Z Control+Y Meta+Z Meta+Y"
        className="next-display-document-editor"
        contentEditable
        onBlur={(event) => {
          const draft = readDocumentDraft(event.currentTarget, false);
          renderDisplayDocument(
            event.currentTarget,
            draft.displaySlots,
            draft.displayBreaks,
          );
        }}
        onFocus={(event) => {
          lastHistoryDraftRef.current = displayDocumentDraftFromElement(
            event.currentTarget,
            baseSlots,
          );
        }}
        onInput={(event) => readDocumentDraft(event.currentTarget)}
        onKeyDown={handleEditorKeyDown}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand(
            "insertText",
            false,
            event.clipboardData.getData("text/plain"),
          );
        }}
        ref={editorRef}
        role="textbox"
        spellCheck
        suppressContentEditableWarning
        tabIndex={0}
      />
    </div>
  );
}

export function ExperienceEditorNext({ experienceId }: { experienceId: string }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [experienceForm, setExperienceForm] = useState<ExperienceForm>({
    description: "",
    title: "",
  });
  const [tutorForm, setTutorForm] = useState<TutorSettings>(defaultTutorSettings);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [isTutorSettingsOpen, setIsTutorSettingsOpen] = useState(false);
  const [isUploadingTutorAvatar, setIsUploadingTutorAvatar] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [activeScriptAction, setActiveScriptAction] =
    useState<ActiveScriptAction | null>(null);
  const [activeScriptDetailTab, setActiveScriptDetailTab] =
    useState<ScriptDetailTab>("audio");
  const [displaySlotDrafts, setDisplaySlotDrafts] = useState<
    Record<string, string[]>
  >({});
  const [displayBreakDrafts, setDisplayBreakDrafts] = useState<
    Record<string, number[]>
  >({});
  const [savingDisplayTextId, setSavingDisplayTextId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [onEntryDrafts, setOnEntryDrafts] = useState<Record<string, string>>({});
  const eventAutosaveTimerRef = useRef<number | null>(null);
  const onEntryAutosaveTimerRef = useRef<number | null>(null);
  const scriptTextAutosaveTimerRef = useRef<number | null>(null);
  const pendingEventAutosaveRef = useRef<PendingEventAutosave | null>(null);
  const pendingOnEntryAutosaveRef = useRef<PendingOnEntryAutosave | null>(null);
  const pendingScriptTextAutosaveRef =
    useRef<PendingScriptTextAutosave | null>(null);
  const failedDisplayAutosavesRef = useRef<Record<string, string>>({});
  const overviewDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedEventDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const tutorAvatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const tutorPresenceRef = useRef<HTMLDivElement | null>(null);
  const tutorVoiceInstructionsRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    clearOverviewAutosaveTimer,
    flushOverviewAutosave,
    updateOverviewDraft,
  } = useOverviewAutosave({
    delayMs: experienceAutosaveDelayMs,
    experience,
    experienceForm,
    setError,
    setExperience,
    setExperienceForm,
  });
  const {
    loadScriptAudioItems,
    saveScriptAudioDisplayTranscript,
    scriptAudioError,
    scriptAudioItems,
    scriptAudioStatus,
  } = useEditorScriptAudio({
    experience,
    flushEditorAutosave: flushNextEditorAutosave,
  });
  const saveDisplayTranscriptRef = useRef(saveScriptAudioDisplayTranscript);
  const {
    clearTutorAutosaveTimer,
    flushTutorAutosave,
    updateTutorDraft,
    updateTutorModelDraft,
  } = useTutorAutosave({
    delayMs: experienceAutosaveDelayMs,
    experience,
    loadScriptAudioItems,
    setError,
    setExperience,
    setTutorForm,
    tutorForm,
  });
  const { playVoiceSample, voiceSampleStatus } = useVoiceSample({
    experience,
    setError,
    tutor: tutorForm,
  });
  const selectedEvent =
    experience?.events.find((event) => event.id === selectedEventId) ?? null;
  const activeScriptStep =
    selectedEvent && activeScriptAction?.eventId === selectedEvent.id
      ? (sortedScriptSteps(selectedEvent)[activeScriptAction.actionIndex] ?? null)
      : null;
  const activeScriptText = activeScriptStep
    ? stringConfigValue(activeScriptStep.config, "text")
    : "";
  const activeAudioScriptText = spokenTextFromMarkedScript(activeScriptText);
  const activeScriptAudioItem = scriptAudioItemForScriptText(
    scriptAudioItems,
    activeAudioScriptText,
  );
  const activeDisplayBreaks = displayBreakDraftForItem(
    activeScriptAudioItem,
    displayBreakDrafts,
  );
  const activeAudioScriptVisualText =
    activeDisplayBreaks.length && activeAudioScriptText
      ? displayTextFromSlots(
          displayTranscriptSlotsFromText(activeAudioScriptText),
          activeDisplayBreaks,
        )
      : activeAudioScriptText;
  const snapshotContextMenu = useExperienceSnapshotContextMenu({
    experience,
    flushEditorAutosave: flushNextEditorAutosave,
    isReady: status === "ready",
    restorePath: experienceNextEditPath,
  });

  useEffect(() => {
    let isCancelled = false;

    async function loadEditor() {
      setStatus("loading");
      setError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        const nextExperience =
          payload.experiences.find((candidate) => candidate.id === experienceId) ??
          null;

        if (!nextExperience) {
          throw new Error("Experience not found.");
        }

        if (isCancelled) return;

        const locationUiState = readLocationNextEditorUiState();
        const storedUiState = readStoredNextEditorUiState(nextExperience.id);
        const uiState =
          selectedEventIdFromStored(locationUiState, nextExperience.events)
            ? locationUiState
            : storedUiState;
        const restoredSelectedEventId = selectedEventIdFromStored(
          uiState,
          nextExperience.events,
        );
        const restoredActiveScriptAction = activeScriptActionFromStored(
          uiState,
          nextExperience.events,
        );
        const restoredScriptDetailTab =
          restoredActiveScriptAction?.eventId === restoredSelectedEventId
            ? scriptDetailTabFromStored(uiState)
            : "audio";

        setUser(me.user);
        setExperience(nextExperience);
        setExperienceForm({
          description: nextExperience.description,
          title: nextExperience.title,
        });
        setTutorForm(nextExperience.tutor);
        setSelectedEventId(restoredSelectedEventId);
        setActiveScriptAction(
          restoredActiveScriptAction?.eventId === restoredSelectedEventId
            ? restoredActiveScriptAction
            : null,
        );
        setActiveScriptDetailTab(restoredScriptDetailTab);
        writeSelectedExperienceId(nextExperience.id);
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;

        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load experience.",
        );
      }
    }

    loadEditor();

    return () => {
      isCancelled = true;
      clearEventAutosaveTimer();
      clearOnEntryAutosaveTimer();
      clearScriptTextAutosaveTimer();
      clearOverviewAutosaveTimer();
      clearTutorAutosaveTimer();
    };
  }, [experienceId]);

  useEffect(() => {
    resizeTextareaToContent(overviewDescriptionRef.current);
  }, [experienceForm.description]);

  useEffect(() => {
    resizeTextareaToContent(selectedEventDescriptionRef.current);
  }, [selectedEvent?.description, selectedEvent?.id]);

  useEffect(() => {
    if (!selectedEventId) {
      setActiveScriptAction(null);
      return;
    }

    setActiveScriptAction((current) =>
      current && current.eventId !== selectedEventId ? null : current,
    );
  }, [selectedEventId]);

  useEffect(() => {
    if (!experience || status !== "ready") return;

    const nextUiState = {
      activeScriptAction:
        activeScriptAction && activeScriptAction.eventId === selectedEventId
          ? {
              actionIndex: activeScriptAction.actionIndex,
              eventId: activeScriptAction.eventId,
              lineNumber: activeScriptAction.lineNumber,
              source: activeScriptAction.source,
            }
          : null,
      scriptDetailTab: activeScriptAction ? activeScriptDetailTab : "audio",
      selectedEventId,
    };
    writeStoredNextEditorUiState(experience.id, nextUiState);
    writeLocationNextEditorUiState(nextUiState);
  }, [
    activeScriptAction,
    activeScriptDetailTab,
    experience,
    selectedEventId,
    status,
  ]);

  useEffect(() => {
    if (!experience || status !== "ready") return;

    void loadScriptAudioItems(experience.id, false);
  }, [experience?.id, status]);

  useEffect(() => {
    saveDisplayTranscriptRef.current = saveScriptAudioDisplayTranscript;
  }, [saveScriptAudioDisplayTranscript]);

  useEffect(() => {
    const item = activeScriptAudioItem;
    if (!item || savingDisplayTextId) return undefined;

    const baseSlots = scriptAudioDisplayBaseSlots(item);
    const expectedSlotCount =
      baseSlots.length ||
      item.displayExpectedWordCount ||
      item.timingWordCount ||
      item.wordCount ||
      0;
    const persistedSlots = scriptAudioPersistedDisplaySlots(item);
    const persistedBreaks = scriptAudioPersistedDisplayBreaks(item);
    const draftSlots = displaySlotDrafts[item.id] ?? persistedSlots;
    const draftBreaks = normalizeDisplayBreaks(
      displayBreakDrafts[item.id] ?? persistedBreaks,
      draftSlots.length,
    );

    if (expectedSlotCount && draftSlots.length !== expectedSlotCount) {
      return undefined;
    }

    const draftKey = displayDraftKey(draftSlots, draftBreaks);
    if (failedDisplayAutosavesRef.current[item.id] === draftKey) {
      return undefined;
    }

    if (
      displaySlotsAreEqual(draftSlots, persistedSlots) &&
      displayBreaksAreEqual(draftBreaks, persistedBreaks)
    ) {
      return undefined;
    }

    const scriptId = item.id;
    const timeoutId = window.setTimeout(() => {
      setSavingDisplayTextId(scriptId);
      delete failedDisplayAutosavesRef.current[scriptId];
      void saveDisplayTranscriptRef.current(scriptId, draftSlots, draftBreaks)
        .then((payload) => {
          const savedSlots = scriptAudioPersistedDisplaySlots(payload);
          const savedBreaks = scriptAudioPersistedDisplayBreaks(payload);
          setDisplaySlotDrafts((current) => {
            const currentSlots = current[scriptId];
            if (!currentSlots || !displaySlotsAreEqual(currentSlots, draftSlots)) {
              return current;
            }

            return {
              ...current,
              [scriptId]: savedSlots,
            };
          });
          setDisplayBreakDrafts((current) => {
            const currentBreaks = normalizeDisplayBreaks(
              current[scriptId] ?? draftBreaks,
              savedSlots.length,
            );
            if (!displayBreaksAreEqual(currentBreaks, draftBreaks)) {
              return current;
            }

            return {
              ...current,
              [scriptId]: savedBreaks,
            };
          });
        })
        .catch(() => {
          failedDisplayAutosavesRef.current[scriptId] = draftKey;
        })
        .finally(() =>
          setSavingDisplayTextId((current) =>
            current === scriptId ? "" : current,
          ),
        );
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeScriptAudioItem,
    displayBreakDrafts,
    displaySlotDrafts,
    savingDisplayTextId,
  ]);

  useEffect(() => {
    if (!isTutorSettingsOpen) return;

    resizeTextareaToContent(tutorVoiceInstructionsRef.current, {
      maxHeight: tutorVoiceTextareaMaxHeightPx,
      minHeight: tutorVoiceTextareaMinHeightPx,
    });
  }, [isTutorSettingsOpen, tutorForm.voiceInstructions]);

  useEffect(() => {
    if (!isTutorSettingsOpen) return;

    function closeIfOutsideTarget(target: EventTarget | null) {
      const node = target as Node | null;
      if (node && tutorPresenceRef.current?.contains(node)) return;

      setIsTutorSettingsOpen(false);
      void flushTutorAutosave();
    }

    function closeIfOutsidePointer(event: PointerEvent) {
      closeIfOutsideTarget(event.target);
    }

    function closeIfOutsideContextMenu(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && tutorPresenceRef.current?.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      setIsTutorSettingsOpen(false);
      void flushTutorAutosave();
    }

    document.addEventListener("pointerdown", closeIfOutsidePointer, true);
    document.addEventListener("contextmenu", closeIfOutsideContextMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutsidePointer, true);
      document.removeEventListener(
        "contextmenu",
        closeIfOutsideContextMenu,
        true,
      );
    };
  }, [flushTutorAutosave, isTutorSettingsOpen]);

  const voiceOptions = realtimeVoiceOptionsForModel(tutorForm.realtimeModel);
  const activeVoice = isRealtimeVoiceSupported(
    tutorForm.realtimeModel,
    tutorForm.voice,
  )
    ? tutorForm.voice
    : (voiceOptions[0]?.id ?? tutorForm.voice);
  const classificationChoices = classificationModelOptions.some(
    (option) => option.id === tutorForm.classificationModel,
  )
    ? classificationModelOptions
    : [
        {
          id: tutorForm.classificationModel,
          label: tutorForm.classificationModel,
        },
        ...classificationModelOptions,
      ];
  const sampleActionLabel =
    voiceSampleStatus === "playing"
      ? "Stop voice sample"
      : voiceSampleStatus === "loading"
        ? "Loading voice sample"
        : "Play voice sample";
  const tutorAvatarUploadLabel = isUploadingTutorAvatar
    ? "Uploading tutor image"
    : "Choose tutor image";

  function clearEventAutosaveTimer() {
    if (!eventAutosaveTimerRef.current) return;

    window.clearTimeout(eventAutosaveTimerRef.current);
    eventAutosaveTimerRef.current = null;
  }

  function clearOnEntryAutosaveTimer() {
    if (!onEntryAutosaveTimerRef.current) return;

    window.clearTimeout(onEntryAutosaveTimerRef.current);
    onEntryAutosaveTimerRef.current = null;
  }

  function clearScriptTextAutosaveTimer() {
    if (!scriptTextAutosaveTimerRef.current) return;

    window.clearTimeout(scriptTextAutosaveTimerRef.current);
    scriptTextAutosaveTimerRef.current = null;
  }

  async function flushEventAutosave() {
    const pending = pendingEventAutosaveRef.current;
    if (!experience || !pending) return true;

    clearEventAutosaveTimer();
    pendingEventAutosaveRef.current = null;

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(pending.eventId)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            description: pending.description,
            title: pending.title,
          }),
        },
      );

      setExperience((current) =>
        current && current.id === experience.id
          ? replaceExperienceEvent(current, payload.event)
          : current,
      );
      return true;
    } catch (saveError) {
      pendingEventAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save event.",
      );
      return false;
    }
  }

  async function flushOnEntryAutosave() {
    const pending = pendingOnEntryAutosaveRef.current;
    if (!experience || !pending) return true;

    const targetEvent = experience.events.find(
      (event) => event.id === pending.eventId,
    );
    if (!targetEvent) {
      pendingOnEntryAutosaveRef.current = null;
      return true;
    }

    clearOnEntryAutosaveTimer();
    pendingOnEntryAutosaveRef.current = null;

    const experiencePathId = encodeURIComponent(experience.id);
    const eventPathId = encodeURIComponent(pending.eventId);
    const nextChatActions = parsePythonDslChatActions(pending.source);
    const nextScriptActions = parsePythonDslScriptActions(pending.source);
    const existingChatSteps = sortedEventSteps(targetEvent.steps).filter(
      (step) => step.actionType === "chat_availability",
    );
    const existingScriptSteps = sortedScriptSteps(targetEvent);
    let latestEvent = targetEvent;

    try {
      const sourcePayload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ onEntryDslSource: pending.source }),
        },
      );
      latestEvent = sourcePayload.event;

      for (
        let index = existingScriptSteps.length;
        index < nextScriptActions.length;
        index += 1
      ) {
        const payload = await apiFetch<{
          event: ExperienceEvent;
          step: EventActionStep;
        }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
          method: "POST",
          body: JSON.stringify({
            actionType: "script",
            condition: {},
            config: { deckUrl: "", text: "" },
            enabled: true,
            label: "Script",
          }),
        });
        latestEvent = payload.event;
      }

      if (
        nextChatActions.length === 0 &&
        nextScriptActions.length === 0 &&
        existingChatSteps.length > 0 &&
        existingChatSteps.length === targetEvent.steps.length
      ) {
        const payload = await apiFetch<{
          event: ExperienceEvent;
          step: EventActionStep;
        }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
          method: "POST",
          body: JSON.stringify({
            actionType: "script",
            condition: {},
            config: { deckUrl: "", text: "" },
            enabled: true,
            label: "Script",
          }),
        });
        latestEvent = payload.event;
      }

      for (const [index, chatAction] of nextChatActions.entries()) {
        const existingStep = existingChatSteps[index];
        const stepPayload = {
          actionType: "chat_availability",
          condition: {},
          config: { enabled: chatAction.enabled },
          enabled: true,
          label: "Set chat availability",
        };

        if (existingStep) {
          const payload = await apiFetch<{ step: EventActionStep }>(
            `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
              existingStep.id,
            )}/`,
            {
              method: "PATCH",
              body: JSON.stringify({
                ...stepPayload,
                sortOrder: existingStep.sortOrder,
              }),
            },
          );
          latestEvent = replaceEventStep(latestEvent, payload.step);
          continue;
        }

        const payload = await apiFetch<{
          event: ExperienceEvent;
          step: EventActionStep;
        }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
          method: "POST",
          body: JSON.stringify(stepPayload),
        });
        latestEvent = payload.event;
      }

      for (const extraStep of existingChatSteps.slice(nextChatActions.length)) {
        const payload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
            extraStep.id,
          )}/`,
          { method: "DELETE" },
        );
        latestEvent = payload.event;
      }

      setExperience((current) =>
        current && current.id === experience.id
          ? replaceExperienceEvent(current, latestEvent)
          : current,
      );
      return true;
    } catch (saveError) {
      pendingOnEntryAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save On entry.",
      );
      return false;
    }
  }

  async function flushScriptTextAutosave() {
    const pending = pendingScriptTextAutosaveRef.current;
    if (!experience || !pending) return true;

    const targetEvent = experience.events.find(
      (event) => event.id === pending.eventId,
    );
    const targetStep = targetEvent?.steps.find(
      (step) => step.id === pending.stepId,
    );
    if (!targetEvent || !targetStep) {
      pendingScriptTextAutosaveRef.current = null;
      return true;
    }

    clearScriptTextAutosaveTimer();
    pendingScriptTextAutosaveRef.current = null;

    try {
      const payload = await apiFetch<{ step: EventActionStep }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(
          pending.eventId,
        )}/steps/${encodeURIComponent(pending.stepId)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            actionType: targetStep.actionType,
            condition: targetStep.condition,
            config: { ...targetStep.config, text: pending.text },
            enabled: targetStep.enabled,
            label: targetStep.label,
            sortOrder: targetStep.sortOrder,
          }),
        },
      );

      setExperience((current) => {
        if (!current || current.id !== experience.id) return current;

        const currentEvent = current.events.find(
          (event) => event.id === pending.eventId,
        );
        if (!currentEvent) return current;

        return replaceExperienceEvent(
          current,
          replaceEventStep(currentEvent, payload.step),
        );
      });
      return true;
    } catch (saveError) {
      pendingScriptTextAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save script text.",
      );
      return false;
    }
  }

  function updateSelectedEventDraft(
    field: "description" | "title",
    value: string,
  ) {
    if (!experience || !selectedEvent) return;

    const eventId = selectedEvent.id;
    const pending =
      pendingEventAutosaveRef.current?.eventId === eventId
        ? pendingEventAutosaveRef.current
        : {
            description: selectedEvent.description,
            eventId,
            title: selectedEvent.title,
          };
    const nextPending = {
      ...pending,
      [field]: value,
    };

    pendingEventAutosaveRef.current = nextPending;
    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find((event) => event.id === eventId);
      if (!currentEvent) return current;

      return replaceExperienceEvent(current, {
        ...currentEvent,
        [field]: value,
      });
    });

    clearEventAutosaveTimer();
    eventAutosaveTimerRef.current = window.setTimeout(() => {
      void flushEventAutosave();
    }, experienceAutosaveDelayMs);
  }

  function updateSelectedEventOnEntryDraft(value: string) {
    if (!selectedEvent) return;

    const eventId = selectedEvent.id;
    setOnEntryDrafts((current) => ({
      ...current,
      [eventId]: value,
    }));
    pendingOnEntryAutosaveRef.current = { eventId, source: value };

    clearOnEntryAutosaveTimer();
    onEntryAutosaveTimerRef.current = window.setTimeout(() => {
      void flushOnEntryAutosave();
    }, experienceAutosaveDelayMs);
  }

  function openSelectedEventScriptAction(action: PythonDslScriptAction) {
    if (!selectedEvent) return;

    setActiveScriptAction((current) => {
      const nextAction = {
        ...action,
        eventId: selectedEvent.id,
      };
      const isSameAction =
        current?.eventId === nextAction.eventId &&
        current.actionIndex === nextAction.actionIndex;

      return isSameAction ? null : nextAction;
    });
  }

  function updateActiveScriptText(value: string) {
    if (!experience || !selectedEvent || !activeScriptStep) return;

    const nextAudioScriptText = normalizeScriptAudioText(value);
    const nextDisplayBreaks = displayBreaksFromText(value);
    const scriptId =
      activeScriptAudioItem && nextAudioScriptText === activeAudioScriptText
        ? activeScriptAudioItem.id
        : "";

    if (scriptId) {
      delete failedDisplayAutosavesRef.current[scriptId];
      setDisplayBreakDrafts((current) => ({
        ...current,
        [scriptId]: nextDisplayBreaks,
      }));
    }

    pendingScriptTextAutosaveRef.current = {
      eventId: selectedEvent.id,
      stepId: activeScriptStep.id,
      text: nextAudioScriptText,
    };

    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find(
        (event) => event.id === selectedEvent.id,
      );
      if (!currentEvent) return current;

      const currentStep = currentEvent.steps.find(
        (step) => step.id === activeScriptStep.id,
      );
      if (!currentStep) return current;

      return replaceExperienceEvent(
        current,
        replaceEventStep(currentEvent, {
          ...currentStep,
          config: { ...currentStep.config, text: nextAudioScriptText },
        }),
      );
    });

    clearScriptTextAutosaveTimer();
    scriptTextAutosaveTimerRef.current = window.setTimeout(() => {
      void flushScriptTextAutosave();
    }, experienceAutosaveDelayMs);
  }

  function updateDisplayDocumentDraft(draft: DisplayDocumentDraft) {
    if (!activeScriptAudioItem) return;

    const scriptId = activeScriptAudioItem.id;
    setDisplaySlotDrafts((current) => {
      return {
        ...current,
        [scriptId]: draft.displaySlots,
      };
    });
    setDisplayBreakDrafts((current) => {
      return {
        ...current,
        [scriptId]: normalizeDisplayBreaks(
          draft.displayBreaks,
          draft.displaySlots.length,
        ),
      };
    });
  }

  function resetDisplayTextToAudioScript() {
    if (!activeScriptAudioItem) return;

    const scriptId = activeScriptAudioItem.id;
    delete failedDisplayAutosavesRef.current[scriptId];
    setDisplaySlotDrafts((current) => ({
      ...current,
      [scriptId]: scriptAudioDisplayBaseSlots(activeScriptAudioItem),
    }));
  }

  async function flushNextEditorAutosave() {
    const didSaveOverview = await flushOverviewAutosave();
    const didSaveTutor = await flushTutorAutosave();
    const didSaveEvent = await flushEventAutosave();
    const didSaveOnEntry = await flushOnEntryAutosave();
    const didSaveScriptText = await flushScriptTextAutosave();
    return (
      didSaveOverview &&
      didSaveTutor &&
      didSaveEvent &&
      didSaveOnEntry &&
      didSaveScriptText
    );
  }

  async function returnToExperiences() {
    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    window.location.assign("/experiences");
  }

  async function openCurrentEditor() {
    if (!experience) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceEditPath(experience.id));
  }

  async function openMockups() {
    if (!experience) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceEditorMockupsPath(experience.id));
  }

  async function runExperience() {
    if (!experience) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    try {
      await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({ experienceId: experience.id }),
      });
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Could not start a fresh run.",
      );
      return;
    }

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceRunPath(experience.id));
  }

  async function signOut() {
    setIsSigningOut(true);

    try {
      await apiFetch<{ ok: boolean }>("/api/auth/logout/", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } finally {
      window.location.assign("/accounts/login/");
    }
  }

  async function createEvent() {
    if (!experience) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    setError("");
    setIsCreatingEvent(true);

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/events/`,
        {
          method: "POST",
          body: JSON.stringify({ description: "", title: "New event" }),
        },
      );

      setExperience((current) => {
        if (!current || current.id !== experience.id) return current;

        return {
          ...current,
          events: sortedExperienceEvents([...current.events, payload.event]),
        };
      });
      setSelectedEventId(payload.event.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create event.",
      );
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function deleteEvent(eventId: string) {
    if (!experience || deletingEventId) return;

    const targetEvent = experience.events.find((event) => event.id === eventId);
    if (!targetEvent) return;

    if (experience.events.length <= 1) {
      setError("An experience needs at least one event.");
      return;
    }

    const label = targetEvent.title || targetEvent.slug || "Untitled event";
    if (!window.confirm(`Delete event "${label}"?`)) return;

    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    setError("");
    setDeletingEventId(eventId);

    if (pendingEventAutosaveRef.current?.eventId === eventId) {
      pendingEventAutosaveRef.current = null;
    }
    if (pendingOnEntryAutosaveRef.current?.eventId === eventId) {
      pendingOnEntryAutosaveRef.current = null;
    }
    if (pendingScriptTextAutosaveRef.current?.eventId === eventId) {
      pendingScriptTextAutosaveRef.current = null;
    }

    try {
      const payload = await apiFetch<{ events: ExperienceEvent[] }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(eventId)}/`,
        { method: "DELETE" },
      );
      const nextEvents = sortedExperienceEvents(payload.events);

      setExperience((current) =>
        current && current.id === experience.id
          ? { ...current, events: nextEvents }
          : current,
      );
      setOnEntryDrafts((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      setSelectedEventId((current) => {
        if (current && nextEvents.some((event) => event.id === current)) {
          return current;
        }

        return (
          nextEvents.find((event) => event.isStart)?.id ??
          nextEvents[0]?.id ??
          ""
        );
      });
      setActiveScriptAction(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete event.",
      );
    } finally {
      setDeletingEventId(null);
    }
  }

  async function uploadTutorAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !experience) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }

    setError("");
    setIsUploadingTutorAvatar(true);

    try {
      const formData = new FormData();
      formData.append("image", file);
      const payload = await apiFetch<{ avatarPath: string }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/tutor-avatar/`,
        {
          method: "POST",
          body: formData,
        },
      );

      updateTutorDraft("avatarPath", payload.avatarPath);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload tutor image.",
      );
    } finally {
      setIsUploadingTutorAvatar(false);
      event.target.value = "";
    }
  }

  const selectedEventOnEntrySource = selectedEvent
    ? (onEntryDrafts[selectedEvent.id] ??
      (selectedEvent.onEntryDslSource ||
        pythonDslSourceFromEventSteps(selectedEvent.steps)))
    : "";

  const eventInspector = selectedEvent ? (
    <div className="next-event-inspector">
      <div className="next-event-title-row">
        <input
          aria-label="Event title"
          className="next-event-title-text"
          onChange={(event) =>
            updateSelectedEventDraft("title", event.target.value)
          }
          placeholder="Untitled event"
          type="text"
          value={selectedEvent.title}
        />
        <button
          aria-label="Delete event"
          className="next-event-delete-button"
          disabled={
            deletingEventId === selectedEvent.id ||
            (experience?.events.length ?? 0) <= 1
          }
          onClick={() => void deleteEvent(selectedEvent.id)}
          title="Delete event"
          type="button"
        >
          <TrashIcon />
        </button>
      </div>
      <textarea
        aria-label="Event description"
        className="next-event-description-text"
        onChange={(event) =>
          updateSelectedEventDraft("description", event.target.value)
        }
        onInput={(event) => resizeTextareaToContent(event.currentTarget)}
        placeholder="No description yet."
        ref={selectedEventDescriptionRef}
        rows={1}
        value={selectedEvent.description}
      />
      <section className="next-event-script-section">
        <div className="next-event-script-heading">
          <h3>On entry</h3>
        </div>
        <Suspense
          fallback={
            <div
              aria-label="Loading code editor"
              className="python-dsl-loading"
              role="status"
            />
          }
        >
          <PythonDslEditor
            ariaLabel="On entry script"
            eventTargets={experience?.events ?? []}
            onChange={updateSelectedEventOnEntryDraft}
            onOpenScriptAction={openSelectedEventScriptAction}
            value={selectedEventOnEntrySource}
          />
        </Suspense>
      </section>
    </div>
  ) : null;

  const activeDisplaySlots = activeScriptAudioItem
    ? (displaySlotDrafts[activeScriptAudioItem.id] ??
      scriptAudioPersistedDisplaySlots(activeScriptAudioItem))
    : [];
  const activeDisplayBaseSlots = activeScriptAudioItem
    ? scriptAudioDisplayBaseSlots(activeScriptAudioItem)
    : [];
  const activeDisplayEditorBreaks = activeScriptAudioItem
    ? normalizeDisplayBreaks(
        displayBreakDrafts[activeScriptAudioItem.id] ??
          scriptAudioPersistedDisplayBreaks(activeScriptAudioItem),
        activeDisplaySlots.length,
      )
    : [];
  const isDisplayTextResetDisabled = activeScriptAudioItem
    ? displaySlotsAreEqual(
        activeDisplaySlots,
        activeDisplayBaseSlots,
      )
    : true;
  const displayTextPanel = activeScriptAudioItem ? (
    <DisplayTextEditor
      baseSlots={activeDisplayBaseSlots}
      displayBreaks={activeDisplayEditorBreaks}
      displaySlots={activeDisplaySlots}
      isSaving={savingDisplayTextId === activeScriptAudioItem.id}
      item={activeScriptAudioItem}
      onChange={updateDisplayDocumentDraft}
      onReset={resetDisplayTextToAudioScript}
      resetDisabled={isDisplayTextResetDisabled}
    />
  ) : (
    <div
      aria-busy={scriptAudioStatus === "loading" ? "true" : "false"}
      aria-label="Display Text"
      className="next-display-text-empty"
    />
  );

  const actionDetailPanel =
    activeScriptAction && selectedEvent?.id === activeScriptAction.eventId ? (
      <div aria-label="Spoken voice script" className="next-event-action-detail">
        <div
          aria-label="Script detail views"
          className="next-script-tabs"
          role="tablist"
        >
          <button
            aria-selected={activeScriptDetailTab === "audio" ? "true" : "false"}
            className={activeScriptDetailTab === "audio" ? "is-active" : ""}
            onClick={() => setActiveScriptDetailTab("audio")}
            role="tab"
            type="button"
          >
            Audio script
          </button>
          <button
            aria-selected={activeScriptDetailTab === "display" ? "true" : "false"}
            className={activeScriptDetailTab === "display" ? "is-active" : ""}
            onClick={() => setActiveScriptDetailTab("display")}
            role="tab"
            type="button"
          >
            Display Text
          </button>
        </div>
        {activeScriptDetailTab === "audio" ? (
          <textarea
            aria-label="Audio script text"
            className="next-script-textarea"
            disabled={!activeScriptStep}
            onChange={(event) => updateActiveScriptText(event.target.value)}
            onContextMenu={(event) => event.stopPropagation()}
            placeholder="No script text yet."
            spellCheck
            value={activeAudioScriptVisualText}
          />
        ) : (
          <>
            {displayTextPanel}
            {scriptAudioError ? (
              <p className="control-error next-display-text-error">
                {scriptAudioError}
              </p>
            ) : null}
          </>
        )}
      </div>
    ) : null;

  return (
    <main
      className="panel-study experience-editor-page experience-editor-next-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
      onContextMenu={snapshotContextMenu.onContextMenu}
    >
      <header className="study-header">
        <div className="study-actions">
          <button
            className="header-action secondary"
            onClick={() => void returnToExperiences()}
            type="button"
          >
            Experiences
          </button>
        </div>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action secondary"
            disabled={!experience}
            onClick={() => void openMockups()}
            type="button"
          >
            Mockups
          </button>
          <button
            className="header-action secondary"
            disabled={!experience}
            onClick={() => void openCurrentEditor()}
            type="button"
          >
            Current editor
          </button>
          <button
            className="header-action secondary"
            disabled={isSigningOut}
            onClick={() => void signOut()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="experience-editor experience-editor-next">
        {status === "loading" ? (
          <div className="experience-state">Loading experience...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        {experience ? (
          <section className="editor-section next-editor-overview-section">
            <div className="next-overview-editor">
              <button
                aria-label="Run experience"
                className="next-overview-run-button"
                disabled={!experience}
                onClick={() => void runExperience()}
                title="Run experience"
                type="button"
              >
                <PlayIcon />
              </button>
              <div className="overview-editor">
                <input
                  aria-label="Experience title"
                  className="overview-title-text"
                  onChange={(event) =>
                    updateOverviewDraft("title", event.target.value)
                  }
                  type="text"
                  value={experienceForm.title}
                />
                <textarea
                  aria-label="Experience description"
                  className="overview-description-text"
                  onChange={(event) =>
                    updateOverviewDraft("description", event.target.value)
                  }
                  onInput={(event) => resizeTextareaToContent(event.currentTarget)}
                  placeholder="---"
                  ref={overviewDescriptionRef}
                  rows={1}
                  value={experienceForm.description}
                />
              </div>
            </div>
            <div
              className="next-tutor-presence"
              ref={tutorPresenceRef}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setIsTutorSettingsOpen(false);
                  void flushTutorAutosave();
                }
              }}
            >
              <div
                className="next-tutor-avatar-wrap"
                data-settings-open={isTutorSettingsOpen ? "true" : "false"}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setIsTutorSettingsOpen(true);
                }}
              >
                <img
                  alt=""
                  className="next-tutor-avatar"
                  src={publicAsset(tutorForm.avatarPath)}
                />
                <button
                  aria-label={sampleActionLabel}
                  className="next-tutor-play-button"
                  disabled={voiceSampleStatus === "loading"}
                  onClick={() => void playVoiceSample()}
                  title={sampleActionLabel}
                  type="button"
                >
                  <MicIcon />
                </button>
                <button
                  aria-label="Tutor settings"
                  aria-expanded={isTutorSettingsOpen}
                  className="next-tutor-settings-button"
                  onClick={() => setIsTutorSettingsOpen((isOpen) => !isOpen)}
                  title="Tutor settings"
                  type="button"
                >
                  <SettingsIcon />
                </button>
              </div>
              {isTutorSettingsOpen ? (
                <div
                  aria-label="Tutor settings"
                  className="next-tutor-settings-menu"
                >
                  <div className="next-tutor-avatar-options">
                    <button
                      aria-label={tutorAvatarUploadLabel}
                      disabled={isUploadingTutorAvatar}
                      onClick={() => tutorAvatarFileInputRef.current?.click()}
                      title={tutorAvatarUploadLabel}
                      type="button"
                    >
                      <img alt="" src={publicAsset(tutorForm.avatarPath)} />
                    </button>
                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="next-tutor-avatar-file-input"
                      onChange={(event) => void uploadTutorAvatar(event)}
                      ref={tutorAvatarFileInputRef}
                      type="file"
                    />
                  </div>
                  <label className="control-field">
                    <span>Name</span>
                    <input
                      onChange={(event) =>
                        updateTutorDraft("assistantName", event.target.value)
                      }
                      type="text"
                      value={tutorForm.assistantName}
                    />
                  </label>
                  <label className="control-field">
                    <span>Voice</span>
                    <select
                      onChange={(event) =>
                        updateTutorDraft(
                          "voice",
                          event.target.value as RealtimeVoiceId,
                        )
                      }
                      value={activeVoice}
                    >
                      {voiceOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="control-field">
                    <span>Chat model</span>
                    <select
                      onChange={(event) =>
                        updateTutorModelDraft(
                          event.target.value as RealtimeModelId,
                        )
                      }
                      value={tutorForm.realtimeModel}
                    >
                      {realtimeModelOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="control-field">
                    <span>Classification model</span>
                    <select
                      onChange={(event) =>
                        updateTutorDraft(
                          "classificationModel",
                          event.target.value as ClassificationModelId,
                        )
                      }
                      value={tutorForm.classificationModel}
                    >
                      {classificationChoices.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="control-field">
                    <span>Personality and tone</span>
                    <textarea
                      className="prompt-textarea compact"
                      onChange={(event) => {
                        resizeTextareaToContent(event.currentTarget, {
                          maxHeight: tutorVoiceTextareaMaxHeightPx,
                          minHeight: tutorVoiceTextareaMinHeightPx,
                        });
                        updateTutorDraft(
                          "voiceInstructions",
                          event.target.value,
                        );
                      }}
                      ref={tutorVoiceInstructionsRef}
                      rows={1}
                      value={tutorForm.voiceInstructions}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {experience ? (
          <ExperienceEventFlow
            detailPanel={actionDetailPanel}
            events={experience.events}
            experienceId={experience.id}
            inspector={eventInspector}
            isCreatingEvent={isCreatingEvent}
            onCreateEvent={() => void createEvent()}
            onDeleteEvent={(eventId) => void deleteEvent(eventId)}
            onSelectEvent={setSelectedEventId}
            selectedEventId={selectedEventId}
          />
        ) : null}
      </section>
      {snapshotContextMenu.menu}
    </main>
  );
}
