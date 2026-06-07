import {
  type MouseEvent as ReactMouseEvent,
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  apiFetch,
  experienceNextEditPath,
  experienceRunPath,
} from "../api";
import { publicAsset } from "../assets";
import { defaultChoiceIconPath } from "../tutorAssets";
import {
  HelpIcon,
  MicIcon,
  RefreshIcon,
  SettingsIcon,
  StopIcon,
  TrashIcon,
} from "../components/Icons";
import {
  readCheckpointRecordingMode,
  writeCheckpointRecordingMode,
  writeSelectedExperienceId,
} from "../persistence";
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
  buildScriptMarker,
  customSoundOptionValue,
  displayTranscriptSlotsFromText,
  normalizeScriptAudioText,
  parseScriptMarkerInstances,
  scriptSoundOptions,
  spokenTextFromMarkedScript,
  type ScriptMarkerInstance,
  type ScriptSlidePreview,
} from "../scriptMarkers";
import {
  scriptAudioItemIsReady,
  scriptAudioItemNeedsGeneration,
  scriptAudioMissingItems,
} from "../scriptAudio";
import type {
  ApiUser,
  CheckpointRecordingMode,
  ClassificationModelId,
  EventActionStep,
  EventConversationChoice,
  Experience,
  ExperienceEvent,
  ExperienceForm,
  ExperiencesPayload,
  ResolvedSlide,
  ScriptAudioItem,
  SessionPayload,
  TutorSettings,
} from "../types";
import { experienceAutosaveDelayMs, localMessageId } from "./eventEditorUtils";
import type { PythonDslScriptAction } from "./PythonDslEditor";
import {
  parsePythonDslChatActions,
  parsePythonDslContextActions,
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
import { NextFineTuningPanel } from "./NextFineTuningPanel";
import {
  clamp,
  dropIndexForTextTarget,
  isSlideMarker,
  nextAvailableSlideRef,
  slidePreviewKeyForDeck,
} from "./scriptActionEditorUtils";
import { useExperienceSnapshotContextMenu } from "./useExperienceSnapshotContextMenu";
import { useVoiceSample } from "./useVoiceSample";
import {
  clampScriptTextAudioRevealSpeed,
  readScriptTextAudioRevealSpeed,
  writeScriptTextAudioRevealSpeed,
} from "./useScriptAudioPlayback";

const tutorVoiceTextareaMinHeightPx = 36;
const tutorVoiceTextareaMaxHeightPx = 160;
const PythonDslEditor = lazy(() =>
  import("./PythonDslEditor").then((module) => ({
    default: module.PythonDslEditor,
  })),
);

type PendingEventAutosave = {
  chatInstructions: string;
  description: string;
  eventId: string;
  title: string;
};

type PendingOnEntryAutosave = {
  eventId: string;
  source: string;
};

type PendingConversationAutosave = {
  eventId: string;
  source: string;
};

type PendingScriptTextAutosave = {
  deckUrl?: string;
  eventId: string;
  stepId: string;
  text?: string;
};

type PendingScriptDisplayDraft = {
  displayBreaks: number[];
  text: string;
};

type ActiveScriptAction = PythonDslScriptAction & {
  eventId: string;
};

type ScriptDetailTab = "audio" | "display" | "script" | "fine-tuning";

type AudioPreparationState = {
  completed: number;
  message: string;
  total: number;
};

type AudioScriptDraft = {
  stepId: string;
  text: string;
};

type AudioScriptSelection = {
  direction: "backward" | "forward" | "none";
  end: number;
  start: number;
  stepId: string;
};

type ScriptImageOption = {
  label: string;
  path: string;
  source: string;
};

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

type ScriptActionMenuState =
  | {
      insertionIndex: number;
      mode: "insert";
      x: number;
      y: number;
    }
  | {
      markerKey: string;
      mode: "edit";
      x: number;
      y: number;
    };

type ScriptActionViewMarker = ScriptMarkerInstance & {
  sourceMarker: ScriptMarkerInstance;
};

type ScriptActionRow = {
  key: string;
  label: string;
  marker: ScriptActionViewMarker | null;
  slideRef: string;
  textEnd: number;
  textStart: number;
};

type ScriptInsertionPreview = {
  height: number;
  insertionIndex: number;
  x: number;
  y: number;
};

type SideImageActionState = {
  imagePath: string;
  side: "left" | "right";
  visible: boolean;
};

type ScriptSourceWordRange = {
  end: number;
  start: number;
};

const displayDocumentHistoryLimit = 80;
const scriptActionHistoryLimit = 80;
const onEntryScriptActionPattern = /\bscript\s*\([^)]*\)/g;
const onEntryDslContextStepSource = "next-on-entry-dsl";
const conversationDslContextStepSource = "next-conversation-dsl";
const defaultSideImagePath = "test-images/dLU-right.png";

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
  const tabValue = params.get("tab");
  const tab =
    tabValue === "display" ||
    tabValue === "script" ||
    tabValue === "fine-tuning"
      ? tabValue
      : "audio";
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
      if (state.scriptDetailTab && state.scriptDetailTab !== "audio") {
        params.set("tab", state.scriptDetailTab);
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
    avatarPath: defaultSideImagePath,
    choiceIconBackground: defaultChoiceIconBackground,
    classificationModel: "gpt-5.4-mini",
    realtimeModel: "gpt-realtime-mini",
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  };
}

function sideImageActionStateFromArgs(args: string[]): SideImageActionState {
  const firstArg = args[0]?.trim().toLowerCase() || "";
  const hasSideArg = [
    "agent",
    "avatar",
    "left",
    "main",
    "right",
    "side",
    "tutor",
  ].includes(firstArg);
  const side = ["right", "side"].includes(firstArg) ? "right" : "left";
  const remainingArgs = hasSideArg ? args.slice(1) : args;
  const rawMode = remainingArgs[0]?.trim() || "show";
  const mode = rawMode.toLowerCase();
  const hideModes = ["hide", "hidden", "off", "false", "0"];
  const showModes = ["show", "on", "visible", "true", "1"];
  const imagePath =
    remainingArgs.length > 1
      ? remainingArgs[1]
      : showModes.includes(mode) || hideModes.includes(mode)
        ? ""
        : remainingArgs[0] || "";

  return {
    imagePath,
    side,
    visible: !hideModes.includes(mode),
  };
}

function sideImageActionArgs(state: SideImageActionState) {
  const imagePath = state.imagePath.trim();
  if (state.visible) {
    return imagePath ? [state.side, "show", imagePath] : [state.side, "show"];
  }
  return imagePath ? [state.side, "hide", imagePath] : [state.side, "hide"];
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

function firstTopLevelScriptActionFromDsl(
  source: string,
): PythonDslScriptAction | null {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  let lineStart = 0;

  for (const [lineIndex, line] of normalizedSource.split("\n").entries()) {
    const trimmed = line.trimStart();
    if (trimmed && !/^\s/.test(line) && !trimmed.startsWith("#")) {
      onEntryScriptActionPattern.lastIndex = 0;
      const match = onEntryScriptActionPattern.exec(line);
      if (match?.[0] && typeof match.index === "number") {
        const from = lineStart + match.index;
        return {
          actionIndex: 0,
          from,
          lineNumber: lineIndex + 1,
          source: match[0],
          to: from + match[0].length,
        };
      }
    }

    lineStart += line.length + 1;
  }

  return null;
}

function scriptActionAutoOpenKey(
  eventId: string,
  action: PythonDslScriptAction | null,
) {
  return action
    ? `${eventId}:${action.actionIndex}:${action.lineNumber}:${action.from}:${action.source}`
    : "";
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
  if (
    storedState.scriptDetailTab === "display" ||
    storedState.scriptDetailTab === "script" ||
    storedState.scriptDetailTab === "fine-tuning"
  ) {
    return storedState.scriptDetailTab;
  }
  return "audio";
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

function sortedConversationChoices(choices: EventConversationChoice[]) {
  return [...choices].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

function dslStringLiteral(value: string) {
  return JSON.stringify(value);
}

function conversationChoiceDslSourceFromChoices(
  choices: EventConversationChoice[],
) {
  return sortedConversationChoices(choices)
    .map(
      (choice) =>
        `button(text=${dslStringLiteral(choice.label || "Continue")}, destination=${dslStringLiteral(
          choice.triggersEvent || "",
        )}, icon=${choice.iconPath ? "True" : "False"})`,
    )
    .join("\n");
}

function splitDslArguments(args: string) {
  const values: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let isEscaped = false;

  for (const char of args) {
    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      isEscaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) values.push(current.trim());
  return values;
}

function parseDslValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(
        trimmed.startsWith("'")
          ? `"${trimmed.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
          : trimmed,
      );
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function parseDslBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0"].includes(normalized)) return false;
  return fallback;
}

function conversationChoicesFromDslSource(
  source: string,
  existingChoices: EventConversationChoice[],
) {
  const existingSorted = sortedConversationChoices(existingChoices);
  const choices: EventConversationChoice[] = [];

  source.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^(?:button|choice)\s*\((.*)\)\s*$/);
    const existingChoice = existingSorted[choices.length];
    if (!match) {
      if (
        (trimmed.includes("button") || trimmed.includes("choice")) &&
        existingChoice
      ) {
        choices.push({ ...existingChoice, sortOrder: choices.length });
      }
      return;
    }

    const namedArgs = new Map<string, string>();
    const positionalArgs: string[] = [];
    splitDslArguments(match[1] ?? "").forEach((arg) => {
      const equalsIndex = arg.indexOf("=");
      if (equalsIndex > 0) {
        namedArgs.set(
          arg.slice(0, equalsIndex).trim(),
          arg.slice(equalsIndex + 1).trim(),
        );
        return;
      }
      positionalArgs.push(arg);
    });

    const label = String(
      parseDslValue(
        namedArgs.get("text") ??
          namedArgs.get("label") ??
          positionalArgs[0] ??
          existingChoice?.label ??
          "Continue",
      ),
    ).trim();
    const destination = String(
      parseDslValue(
        namedArgs.get("destination") ??
          namedArgs.get("target") ??
          namedArgs.get("triggersEvent") ??
          positionalArgs[1] ??
          existingChoice?.triggersEvent ??
          "",
      ),
    ).trim();
    const hasIcon = parseDslBoolean(
      namedArgs.get("icon"),
      Boolean(existingChoice?.iconPath),
    );

    choices.push({
      enabled: existingChoice?.enabled ?? true,
      iconPath: hasIcon
        ? existingChoice?.iconPath || defaultChoiceIconPath
        : "",
      id: existingChoice?.id ?? localMessageId("conversation-choice"),
      label: label || "Continue",
      sortOrder: choices.length,
      triggersEvent: destination,
    });
  });

  return choices;
}

function markerEditKey(marker: ScriptMarkerInstance) {
  return `${marker.start}:${marker.end}:${marker.marker}`;
}

function sourceMarkerForView(marker: ScriptMarkerInstance | ScriptActionViewMarker) {
  return "sourceMarker" in marker ? marker.sourceMarker : marker;
}

function viewMarkerEditKey(marker: ScriptMarkerInstance | ScriptActionViewMarker) {
  return markerEditKey(sourceMarkerForView(marker));
}

function markerStyleType(marker: ScriptMarkerInstance) {
  return isSlideMarker(marker) ? "slide" : "action";
}

function insertScriptMarkerAt(text: string, insertionIndex: number, marker: string) {
  const safeIndex = Math.min(Math.max(0, insertionIndex), text.length);
  const before = text.slice(0, safeIndex);
  const after = text.slice(safeIndex);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  return `${before}${prefix}${marker}${suffix}${after}`;
}

function replaceScriptMarker(
  text: string,
  marker: ScriptMarkerInstance,
  nextMarker: string,
) {
  return `${text.slice(0, marker.start)}${nextMarker}${text.slice(marker.end)}`;
}

function removeScriptMarker(text: string, marker: ScriptMarkerInstance) {
  return `${text.slice(0, marker.start)}${text.slice(marker.end)}`
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function deckUrlForNewTab(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isNativeUndoTarget(target: EventTarget | null) {
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

function appendScriptActionHistoryEntry(stack: string[], value: string) {
  if (stack[stack.length - 1] === value) return stack;
  return [...stack, value].slice(-scriptActionHistoryLimit);
}

function wordInsertionIndex(text: string, wordIndex: number) {
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

function mergeMarkersIntoSpokenText(
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

function projectScriptActionsToDisplayText({
  displayBreaks,
  displaySlots,
  markers,
  sourceText,
}: {
  displayBreaks: number[];
  displaySlots: string[];
  markers: ScriptMarkerInstance[];
  sourceText: string;
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
      displayIndex: displayInsertionIndexForSourceIndex(
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
    Array.from(
      { length: columnCount },
      (): "delete" | "insert" | "slot" | "" => "",
    ),
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

function ScriptActionReadOnlyView({
  actionRows,
  deckUrl,
  displayBreaks,
  markers,
  onDeckUrlChange,
  onOpenInsert,
  onOpenMarker,
  onRemoveMarker,
  previews,
  sourceIndexByTextIndex,
  text,
}: {
  actionRows: ScriptActionRow[];
  deckUrl: string;
  displayBreaks: number[];
  markers: ScriptActionViewMarker[];
  onDeckUrlChange: (value: string) => void;
  onOpenInsert: (
    insertionIndex: number,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onOpenMarker: (
    marker: ScriptMarkerInstance,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onRemoveMarker: (marker: ScriptMarkerInstance) => void;
  previews: Record<string, ScriptSlidePreview>;
  sourceIndexByTextIndex: number[];
  text: string;
}) {
  const [insertionPreview, setInsertionPreview] =
    useState<ScriptInsertionPreview | null>(null);
  const breakCounts = new Map<number, number>();
  normalizeDisplayBreaks(displayBreaks).forEach((breakIndex) => {
    breakCounts.set(breakIndex, (breakCounts.get(breakIndex) ?? 0) + 1);
  });

  let wordIndex = 0;

  function elementFromEventTarget(target: EventTarget | null) {
    if (target instanceof HTMLElement) return target;
    if (target instanceof Text) return target.parentElement;
    return null;
  }

  function closestClientRectToPointer(
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ) {
    const rects = Array.from(element.getClientRects()).filter(
      (rect) => rect.width > 0 || rect.height > 0,
    );
    if (!rects.length) return element.getBoundingClientRect();

    return rects.reduce((closestRect, rect) => {
      const closestX = clamp(clientX, rect.left, rect.right);
      const closestY = clamp(clientY, rect.top, rect.bottom);
      const currentDistance =
        (clientX - closestX) ** 2 + (clientY - closestY) ** 2;
      const bestX = clamp(clientX, closestRect.left, closestRect.right);
      const bestY = clamp(clientY, closestRect.top, closestRect.bottom);
      const bestDistance = (clientX - bestX) ** 2 + (clientY - bestY) ** 2;
      return currentDistance < bestDistance ? rect : closestRect;
    }, rects[0]);
  }

  function previewForScriptPointer(event: ReactMouseEvent<HTMLElement>) {
    const target = elementFromEventTarget(event.target);
    if (!target || target.closest(".next-script-action-token")) return null;

    const insertRegion = target.closest<HTMLElement>("[data-default-insert]");
    const defaultInsertionIndex = Number(insertRegion?.dataset.defaultInsert);
    const insertTarget = target.closest<HTMLElement>("[data-insert-before]");

    if (!insertTarget) {
      const region = insertRegion ?? event.currentTarget;
      const rect = region.getBoundingClientRect();
      const styles = window.getComputedStyle(event.currentTarget);
      const lineHeight =
        Number.parseFloat(styles.lineHeight) ||
        Number.parseFloat(styles.fontSize) * 1.75 ||
        22;
      return {
        height: Math.max(16, lineHeight - 3),
        insertionIndex: Number.isFinite(defaultInsertionIndex)
          ? defaultInsertionIndex
          : text.length,
        x: Math.round(clamp(event.clientX, rect.left + 12, rect.right - 12)),
        y: Math.round(
          clamp(
            event.clientY - lineHeight / 2,
            rect.top + 8,
            Math.max(rect.top + 8, rect.bottom - lineHeight - 8),
          ),
        ),
      };
    }

    const beforeIndex = Number(insertTarget.dataset.insertBefore);
    const afterIndex = Number(insertTarget.dataset.insertAfter);
    const safeBeforeIndex = Number.isFinite(beforeIndex) ? beforeIndex : 0;
    const safeAfterIndex = Number.isFinite(afterIndex) ? afterIndex : text.length;
    const insertionIndex = dropIndexForTextTarget(
      insertTarget,
      safeBeforeIndex,
      safeAfterIndex,
      event.clientX,
    );
    const rect = closestClientRectToPointer(
      insertTarget,
      event.clientX,
      event.clientY,
    );
    const ratio = insertionIndex <= safeBeforeIndex ? 0 : 1;

    return {
      height: Math.max(16, rect.height - 3),
      insertionIndex,
      x: Math.round(rect.left + ratio * rect.width),
      y: Math.round(rect.top + 1),
    };
  }

  function sourceIndexForTextIndex(index: number) {
    return (
      sourceIndexByTextIndex[index] ??
      sourceIndexByTextIndex[sourceIndexByTextIndex.length - 1] ??
      0
    );
  }

  function renderActionToken(marker: ScriptActionViewMarker) {
    const sourceMarker = sourceMarkerForView(marker);
    return (
      <button
        className={[
          "next-script-action-token",
          markerStyleType(marker) === "slide" ? "is-slide" : "is-action",
        ].join(" ")}
        key={viewMarkerEditKey(marker)}
        onClick={(event) => onOpenMarker(sourceMarker, event)}
        onContextMenu={(event) => onOpenMarker(sourceMarker, event)}
        onKeyDown={(event) => {
          if (event.key !== "Backspace" && event.key !== "Delete") return;
          event.preventDefault();
          onRemoveMarker(sourceMarker);
        }}
        title={sourceMarker.marker}
        type="button"
      >
        {isSlideMarker(marker)
          ? `Slide ${marker.argList[0]?.trim() || "1"}`
          : marker.label}
      </button>
    );
  }

  function appendTextSegment(
    nodes: Array<JSX.Element | string>,
    segment: string,
    offset: number,
    keyPrefix: string,
  ) {
    const pieces = segment.match(/\s+|\S+/g) ?? [];
    let pieceOffset = 0;
    pieces.forEach((piece, index) => {
      const pieceStart = offset + pieceOffset;
      pieceOffset += piece.length;

      if (/^\s+$/.test(piece)) {
        if (piece.includes("\n")) {
          let whitespaceOffset = 0;
          piece.split(/(\n+)/).forEach((part, partIndex) => {
            if (!part) return;
            const partStart = pieceStart + whitespaceOffset;
            whitespaceOffset += part.length;

            if (!part.includes("\n")) {
              nodes.push(
                <span
                  className="next-script-view-space"
                  data-insert-after={sourceIndexForTextIndex(
                    partStart + part.length,
                  )}
                  data-insert-before={sourceIndexForTextIndex(partStart)}
                  key={`${keyPrefix}-space-${index}-${partIndex}-${partStart}`}
                >
                  {part}
                </span>,
              );
              return;
            }

            const insertIndex = sourceIndexForTextIndex(partStart + part.length);
            nodes.push(
              <span
                aria-label={
                  part.length > 1 ? "Page break" : "Line break"
                }
                className={
                  part.length > 1
                    ? "next-script-view-page-break"
                    : "next-script-view-line-break"
                }
                data-insert-after={insertIndex}
                data-insert-before={insertIndex}
                key={`${keyPrefix}-breakspace-${index}-${partIndex}-${partStart}`}
              />,
            );
          });
          return;
        }

        nodes.push(
          <span
            className="next-script-view-space"
            data-insert-after={sourceIndexForTextIndex(
              pieceStart + piece.length,
            )}
            data-insert-before={sourceIndexForTextIndex(pieceStart)}
            key={`${keyPrefix}-space-${index}-${pieceStart}`}
          >
            {piece}
          </span>,
        );
        return;
      }

      const beforeIndex = pieceStart;
      const afterIndex = pieceStart + piece.length;
      nodes.push(
        <span
          className="next-script-view-word"
          data-insert-after={sourceIndexForTextIndex(afterIndex)}
          data-insert-before={sourceIndexForTextIndex(beforeIndex)}
          key={`${keyPrefix}-word-${index}-${beforeIndex}`}
        >
          {piece}
        </span>,
      );

      const lineBreakCount = breakCounts.get(wordIndex) ?? 0;
      for (let breakIndex = 0; breakIndex < lineBreakCount; breakIndex += 1) {
        nodes.push(
          <br key={`${keyPrefix}-break-${index}-${breakIndex}-${beforeIndex}`} />,
        );
      }
      wordIndex += 1;
    });
  }

  function renderSegmentNodes(
    textStart: number,
    textEnd: number,
    keyPrefix: string,
  ) {
    const nodes: Array<JSX.Element | string> = [];
    let cursor = textStart;
    markers
      .filter(
        (marker) =>
          !isSlideMarker(marker) &&
          marker.start >= textStart &&
          marker.end <= textEnd,
      )
      .forEach((marker, index) => {
        if (marker.start > cursor) {
          appendTextSegment(
            nodes,
            text.slice(cursor, marker.start),
            cursor,
            `${keyPrefix}-text-${index}`,
          );
        }
        nodes.push(renderActionToken(marker));
        cursor = marker.end;
      });

    if (cursor < textEnd) {
      appendTextSegment(
        nodes,
        text.slice(cursor, textEnd),
        cursor,
        `${keyPrefix}-tail`,
      );
    }

    return nodes;
  }

  function handleScriptContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const preview = previewForScriptPointer(event);
    if (!preview) return;
    event.preventDefault();
    onOpenInsert(preview.insertionIndex, event);
    setInsertionPreview(preview);
  }

  function handleScriptMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const preview = previewForScriptPointer(event);
    setInsertionPreview((current) => {
      if (
        current &&
        preview &&
        current.insertionIndex === preview.insertionIndex &&
        current.x === preview.x &&
        current.y === preview.y &&
        current.height === preview.height
      ) {
        return current;
      }
      return preview;
    });
  }

  return (
    <div className="next-script-view">
      <label className="next-script-slides-link-row">
        <input
          aria-label="Slides link"
          onChange={(event) => onDeckUrlChange(event.target.value)}
          onMouseDown={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;

            const url = deckUrlForNewTab(deckUrl);
            if (!url) return;

            event.preventDefault();
            event.stopPropagation();
            const link = document.createElement("a");
            link.href = url;
            link.rel = "noopener noreferrer";
            link.target = "_blank";
            document.body.append(link);
            link.click();
            link.remove();
          }}
          placeholder="Slides link"
          spellCheck={false}
          title="Ctrl-click to open slides"
          type="url"
          value={deckUrl}
        />
      </label>
      <div
        aria-label="Slides and actions"
        className="next-script-slide-flow"
        role="table"
      >
        {actionRows.length ? (
          actionRows.map((row) => {
            const rowNodes = renderSegmentNodes(
              row.textStart,
              row.textEnd,
              row.key,
            );
            const previewKey = row.slideRef
              ? slidePreviewKeyForDeck(deckUrl, row.slideRef)
              : "";
            const preview = previewKey ? previews[previewKey] : null;

            return (
              <div
                className={[
                  "next-script-slide-row",
                  row.marker ? "has-slide" : "has-no-slide",
                ].join(" ")}
                key={row.key}
                role="row"
              >
                <div
                  className="next-script-slide-script"
                  data-default-insert={sourceIndexForTextIndex(row.textEnd)}
                  onContextMenu={handleScriptContextMenu}
                  onMouseLeave={() => setInsertionPreview(null)}
                  onMouseMove={handleScriptMouseMove}
                  role="cell"
                >
                  {row.marker ? (
                    <div className="next-script-slide-anchor">
                      {renderActionToken(row.marker)}
                    </div>
                  ) : row.label !== "No slide" ? (
                    <div className="next-script-slide-anchor is-muted">
                      <span>{row.label}</span>
                    </div>
                  ) : null}
                  <div className="next-script-segment-document">
                    {rowNodes.length ? rowNodes : (
                      <div
                        className="next-script-view-empty"
                        data-default-insert={sourceIndexForTextIndex(
                          row.textStart,
                        )}
                      />
                    )}
                  </div>
                </div>
                <div className="next-script-slide-preview" role="cell">
                  {row.slideRef &&
                  preview?.status === "ready" &&
                  preview.imageUrl ? (
                    <img alt={row.label} src={preview.imageUrl} />
                  ) : (
                    <span>
                      {!row.slideRef
                        ? "No slide"
                        : !deckUrl.trim()
                          ? "Deck URL needed"
                          : preview?.status === "loading"
                            ? "Loading"
                            : preview?.detail || "Slide unavailable"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="next-script-slide-row has-no-slide is-empty" role="row">
            <div
              className="next-script-slide-script"
              data-default-insert={sourceIndexForTextIndex(0)}
              onContextMenu={handleScriptContextMenu}
              onMouseLeave={() => setInsertionPreview(null)}
              onMouseMove={handleScriptMouseMove}
              role="cell"
            >
              <div className="next-script-view-empty" />
            </div>
            <div className="next-script-slide-preview" role="cell">
              <span>No slide</span>
            </div>
          </div>
        )}
      </div>
      {insertionPreview ? (
        <span
          aria-hidden="true"
          className="next-script-insertion-caret"
          style={{
            height: insertionPreview.height,
            left: insertionPreview.x,
            top: insertionPreview.y,
          }}
        />
      ) : null}
    </div>
  );
}

export function ExperienceEditorNext({ experienceId }: { experienceId: string }) {
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
  const [audioPreparation, setAudioPreparation] =
    useState<AudioPreparationState | null>(null);
  const [scriptTextRevealSpeed, setScriptTextRevealSpeed] = useState(() =>
    readScriptTextAudioRevealSpeed(),
  );
  const [scriptTextRevealSpeedDraft, setScriptTextRevealSpeedDraft] = useState(
    () => String(readScriptTextAudioRevealSpeed()),
  );
  const [checkpointRecordingMode, setCheckpointRecordingMode] =
    useState<CheckpointRecordingMode>(() => readCheckpointRecordingMode());
  const [runningEventId, setRunningEventId] = useState("");
  const [scriptActionMenu, setScriptActionMenu] =
    useState<ScriptActionMenuState | null>(null);
  const [scriptImageOptions, setScriptImageOptions] = useState<
    ScriptImageOption[]
  >([]);
  const [isLoadingScriptImages, setIsLoadingScriptImages] = useState(false);
  const [isScriptImagePickerOpen, setIsScriptImagePickerOpen] = useState(false);
  const [isUploadingScriptImage, setIsUploadingScriptImage] = useState(false);
  const [scriptSlidePreviews, setScriptSlidePreviews] = useState<
    Record<string, ScriptSlidePreview>
  >({});
  const [savingDisplayTextId, setSavingDisplayTextId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [onEntryDrafts, setOnEntryDrafts] = useState<Record<string, string>>({});
  const [conversationDrafts, setConversationDrafts] = useState<
    Record<string, string>
  >({});
  const [audioScriptDraft, setAudioScriptDraft] = useState<AudioScriptDraft>({
    stepId: "",
    text: "",
  });
  const eventAutosaveTimerRef = useRef<number | null>(null);
  const onEntryAutosaveTimerRef = useRef<number | null>(null);
  const conversationAutosaveTimerRef = useRef<number | null>(null);
  const scriptTextAutosaveTimerRef = useRef<number | null>(null);
  const pendingEventAutosaveRef = useRef<PendingEventAutosave | null>(null);
  const pendingOnEntryAutosaveRef = useRef<PendingOnEntryAutosave | null>(null);
  const pendingConversationAutosaveRef =
    useRef<PendingConversationAutosave | null>(null);
  const pendingScriptTextAutosaveRef =
    useRef<PendingScriptTextAutosave | null>(null);
  const pendingScriptDisplayDraftsRef = useRef<
    Record<string, PendingScriptDisplayDraft>
  >({});
  const failedDisplayAutosavesRef = useRef<Record<string, string>>({});
  const autoOpenedScriptActionKeyRef = useRef("");
  const scriptActionHistoryStepIdRef = useRef("");
  const scriptActionRedoStackRef = useRef<string[]>([]);
  const scriptActionUndoStackRef = useRef<string[]>([]);
  const scriptActionMenuRef = useRef<HTMLDivElement | null>(null);
  const audioScriptTextareaFocusedRef = useRef(false);
  const audioScriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingAudioScriptSelectionRef = useRef<AudioScriptSelection | null>(
    null,
  );
  const selectedEventChatInstructionsRef = useRef<HTMLTextAreaElement | null>(
    null,
  );
  const overviewDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedEventDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const scriptImageFileInputRef = useRef<HTMLInputElement | null>(null);
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
    generateScriptAudio,
    loadScriptAudioItems,
    playScriptAudioPreview,
    playingScriptAudioId,
    saveScriptAudioDisplayTranscript,
    scriptAudioError,
    scriptAudioItems,
    scriptAudioStatus,
    stopScriptAudioPreview,
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
  const activeScriptDeckUrl = activeScriptStep
    ? stringConfigValue(activeScriptStep.config, "deckUrl")
    : "";
  const activeScriptMarkers = useMemo(
    () => parseScriptMarkerInstances(activeScriptText),
    [activeScriptText],
  );
  const activeAudioScriptText = spokenTextFromMarkedScript(activeScriptText);
  const activeScriptAudioItem = scriptAudioItemForScriptText(
    scriptAudioItems,
    activeAudioScriptText,
  );
  const activeScriptAudioNeedsGeneration = activeScriptAudioItem
    ? scriptAudioItemNeedsGeneration(activeScriptAudioItem)
    : false;
  const activeScriptAudioReady = activeScriptAudioItem
    ? scriptAudioItemIsReady(activeScriptAudioItem)
    : false;
  const isActiveScriptAudioPlaying =
    Boolean(activeScriptAudioItem) &&
    playingScriptAudioId === activeScriptAudioItem?.id;
  const missingScriptAudioCount =
    scriptAudioMissingItems(scriptAudioItems).length;
  const activePendingDisplayDraft = activeScriptStep
    ? pendingScriptDisplayDraftsRef.current[activeScriptStep.id]
    : null;
  const activePendingDisplayDraftMatches =
    activePendingDisplayDraft &&
    normalizeScriptAudioText(activePendingDisplayDraft.text) ===
      activeAudioScriptText;
  const activeDisplayBreaks = activePendingDisplayDraftMatches
    ? normalizeDisplayBreaks(
        activePendingDisplayDraft.displayBreaks,
        displayTranscriptSlotsFromText(activeAudioScriptText).length,
      )
    : displayBreakDraftForItem(activeScriptAudioItem, displayBreakDrafts);
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
  const activeDisplayCueOffsets = activeScriptAudioItem?.displayCueOffsets ?? [];
  const activeScriptActionViewKey = displayDraftKey(
    activeDisplaySlots,
    activeDisplayEditorBreaks,
  );
  const activeScriptActionView = useMemo(
    () =>
      projectScriptActionsToDisplayText({
        displayBreaks: activeDisplayEditorBreaks,
        displaySlots: activeDisplaySlots,
        markers: activeScriptMarkers,
        sourceText: activeScriptText,
      }),
    [
      activeScriptActionViewKey,
      activeScriptMarkers,
      activeScriptText,
    ],
  );
  const activeAudioScriptVisualText =
    activeDisplayBreaks.length && activeAudioScriptText
      ? displayTextFromSlots(
          displayTranscriptSlotsFromText(activeAudioScriptText),
          activeDisplayBreaks,
        )
      : activeAudioScriptText;
  const activeAudioScriptDraftStepId = activeScriptStep?.id ?? "";
  const activeAudioScriptTextareaValue =
    audioScriptDraft.stepId === activeAudioScriptDraftStepId
      ? audioScriptDraft.text
      : activeAudioScriptVisualText;
  const snapshotContextMenu = useExperienceSnapshotContextMenu({
    actions: [
      {
        disabled: scriptAudioStatus === "generating" || !experience,
        label:
          scriptAudioStatus === "generating"
            ? "Generating audio..."
            : missingScriptAudioCount
              ? `Generate all audio (${missingScriptAudioCount} missing)`
              : "Generate all audio",
        onSelect: generateAllExperienceAudio,
      },
    ],
    experience,
    flushEditorAutosave: flushNextEditorAutosave,
    isReady: status === "ready",
    restorePath: experienceNextEditPath,
  });

  useEffect(() => {
    writeCheckpointRecordingMode(checkpointRecordingMode);
  }, [checkpointRecordingMode]);

  useEffect(() => {
    setAudioScriptDraft((current) => {
      if (!activeAudioScriptDraftStepId) {
        return current.stepId || current.text
          ? { stepId: "", text: "" }
          : current;
      }

      const isFocusedDraft =
        current.stepId === activeAudioScriptDraftStepId &&
        audioScriptTextareaFocusedRef.current &&
        document.activeElement === audioScriptTextareaRef.current;

      if (isFocusedDraft) return current;

      if (
        current.stepId === activeAudioScriptDraftStepId &&
        current.text === activeAudioScriptVisualText
      ) {
        return current;
      }

      return {
        stepId: activeAudioScriptDraftStepId,
        text: activeAudioScriptVisualText,
      };
    });
  }, [
    activeAudioScriptDraftStepId,
    activeAudioScriptText,
    activeAudioScriptVisualText,
  ]);

  useLayoutEffect(() => {
    const pendingSelection = pendingAudioScriptSelectionRef.current;
    const textarea = audioScriptTextareaRef.current;
    if (!pendingSelection || !textarea) return;
    if (pendingSelection.stepId !== activeAudioScriptDraftStepId) return;
    if (document.activeElement !== textarea) return;

    pendingAudioScriptSelectionRef.current = null;
    const textLength = textarea.value.length;
    textarea.setSelectionRange(
      Math.min(pendingSelection.start, textLength),
      Math.min(pendingSelection.end, textLength),
      pendingSelection.direction,
    );
  }, [activeAudioScriptDraftStepId, activeAudioScriptTextareaValue]);

  useEffect(() => {
    const stepId = activeScriptStep?.id ?? "";
    if (scriptActionHistoryStepIdRef.current === stepId) return;

    scriptActionHistoryStepIdRef.current = stepId;
    scriptActionRedoStackRef.current = [];
    scriptActionUndoStackRef.current = [];
  }, [activeScriptStep?.id]);

  useEffect(() => {
    function handleScriptActionHistoryShortcut(
      event: globalThis.KeyboardEvent,
    ) {
      if (
        activeScriptDetailTab !== "script" ||
        !activeScriptAction ||
        !activeScriptStep ||
        isNativeUndoTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const isMod = event.ctrlKey || event.metaKey;
      const isRedo =
        isMod &&
        !event.altKey &&
        (key === "y" || (key === "z" && event.shiftKey));
      const isUndo =
        isMod && !event.altKey && key === "z" && !event.shiftKey;
      if (!isRedo && !isUndo) return;

      const stack = isRedo
        ? scriptActionRedoStackRef.current
        : scriptActionUndoStackRef.current;
      if (!stack.length) return;

      event.preventDefault();
      event.stopPropagation();
      applyScriptActionHistory(isRedo ? "redo" : "undo");
    }

    document.addEventListener("keydown", handleScriptActionHistoryShortcut);
    return () =>
      document.removeEventListener(
        "keydown",
        handleScriptActionHistoryShortcut,
      );
  }, [
    activeScriptAction,
    activeScriptDetailTab,
    activeScriptStep,
    activeScriptText,
  ]);

  useEffect(() => {
    let isCancelled = false;

    async function loadEditor() {
      setStatus("loading");
      setError("");

      try {
        await apiFetch<{ user: ApiUser }>("/api/auth/me/");
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
      clearConversationAutosaveTimer();
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
    resizeTextareaToContent(selectedEventChatInstructionsRef.current);
  }, [selectedEvent?.chatInstructions, selectedEvent?.id]);

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
    if (!experience || status !== "ready") return;

    void loadScriptImages(experience.id);
  }, [experience?.id, status]);

  useEffect(() => {
    setScriptActionMenu(null);
  }, [activeScriptStep?.id]);

  useEffect(() => {
    setIsScriptImagePickerOpen(false);
  }, [
    scriptActionMenu?.mode,
    scriptActionMenu?.mode === "edit" ? scriptActionMenu.markerKey : "",
  ]);

  useEffect(() => {
    if (!scriptActionMenu) return;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && scriptActionMenuRef.current?.contains(target)) return;
      setScriptActionMenu(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setScriptActionMenu(null);
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [scriptActionMenu]);

  useEffect(() => {
    if (
      activeScriptDetailTab !== "script" &&
      activeScriptDetailTab !== "fine-tuning"
    ) {
      return;
    }

    const deckUrl = activeScriptDeckUrl.trim();
    const slideRefs = Array.from(
      new Set(
        activeScriptActionView.rows
          .map((row) => row.slideRef.trim())
          .filter(Boolean),
      ),
    );
    if (!deckUrl || !slideRefs.length) return;

    slideRefs.forEach((slideRef) => {
      const previewKey = slidePreviewKeyForDeck(deckUrl, slideRef);
      const currentPreview = scriptSlidePreviews[previewKey];
      if (
        currentPreview?.status === "loading" ||
        currentPreview?.status === "ready"
      ) {
        return;
      }

      setScriptSlidePreviews((current) => ({
        ...current,
        [previewKey]: { status: "loading" },
      }));

      void apiFetch<ResolvedSlide>("/api/slides/resolve/", {
        method: "POST",
        body: JSON.stringify({ deckUrl, slideRef }),
      })
        .then((payload) => {
          setScriptSlidePreviews((current) => ({
            ...current,
            [previewKey]: {
              detail: payload.pageId,
              imageUrl: `${payload.imageUrl}?v=${Date.now()}`,
              status: "ready",
            },
          }));
        })
        .catch((error) => {
          setScriptSlidePreviews((current) => ({
            ...current,
            [previewKey]: {
              detail:
                error instanceof Error
                  ? error.message
                  : "Could not load slide.",
              status: "error",
            },
          }));
        });
    });
  }, [
    activeScriptDeckUrl,
    activeScriptDetailTab,
    activeScriptActionView.rows,
  ]);

  useEffect(() => {
    if (
      (activeScriptDetailTab === "display" ||
        activeScriptDetailTab === "fine-tuning") &&
      !activeScriptAudioReady
    ) {
      setActiveScriptDetailTab("audio");
    }
  }, [activeScriptAudioReady, activeScriptDetailTab]);

  useEffect(() => {
    saveDisplayTranscriptRef.current = saveScriptAudioDisplayTranscript;
  }, [saveScriptAudioDisplayTranscript]);

  useEffect(() => {
    const item = activeScriptAudioItem;
    if (!item || !activeScriptStep) return;

    const pending = pendingScriptDisplayDraftsRef.current[activeScriptStep.id];
    if (
      !pending ||
      normalizeScriptAudioText(item.script || item.preview || "") !==
        pending.text
    ) {
      return;
    }

    const baseSlots = scriptAudioDisplayBaseSlots(item);
    if (!baseSlots.length) return;

    const nextBreaks = normalizeDisplayBreaks(
      pending.displayBreaks,
      baseSlots.length,
    );
    delete pendingScriptDisplayDraftsRef.current[activeScriptStep.id];
    delete failedDisplayAutosavesRef.current[item.id];

    setDisplaySlotDrafts((current) => ({
      ...current,
      [item.id]: baseSlots,
    }));
    setDisplayBreakDrafts((current) => ({
      ...current,
      [item.id]: nextBreaks,
    }));
  }, [activeScriptAudioItem, activeScriptStep]);

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

  function saveScriptTextRevealSpeed(value: number) {
    const nextSpeed = clampScriptTextAudioRevealSpeed(value);
    setScriptTextRevealSpeed(nextSpeed);
    writeScriptTextAudioRevealSpeed(nextSpeed);
    return nextSpeed;
  }

  function changeScriptTextRevealSpeed(value: string) {
    setScriptTextRevealSpeedDraft(value);

    const parsedSpeed = Number.parseFloat(value);
    if (!Number.isFinite(parsedSpeed)) return;

    saveScriptTextRevealSpeed(parsedSpeed);
  }

  function normalizeScriptTextRevealSpeedDraft() {
    const parsedSpeed = Number.parseFloat(scriptTextRevealSpeedDraft);
    const nextSpeed = saveScriptTextRevealSpeed(
      Number.isFinite(parsedSpeed) ? parsedSpeed : scriptTextRevealSpeed,
    );
    setScriptTextRevealSpeedDraft(String(nextSpeed));
  }

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

  function clearConversationAutosaveTimer() {
    if (!conversationAutosaveTimerRef.current) return;

    window.clearTimeout(conversationAutosaveTimerRef.current);
    conversationAutosaveTimerRef.current = null;
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
            chatInstructions: pending.chatInstructions,
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

  async function syncContextStepsFromDsl({
    eventPathId,
    experiencePathId,
    latestEvent,
    source,
    sourceLabel,
  }: {
    eventPathId: string;
    experiencePathId: string;
    latestEvent: ExperienceEvent;
    source: string;
    sourceLabel: string;
  }) {
    const nextContextActions = parsePythonDslContextActions(source);
    const existingContextSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "set_context" &&
        step.config.source === sourceLabel,
    );
    let nextEvent = latestEvent;

    for (const [index, contextAction] of nextContextActions.entries()) {
      const existingStep = existingContextSteps[index];
      const stepPayload = {
        actionType: "set_context" as const,
        condition: {},
        config: {
          key: contextAction.key,
          source: sourceLabel,
          value: contextAction.value,
        },
        enabled: true,
        label: `Set ${contextAction.key}`,
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
        nextEvent = replaceEventStep(nextEvent, payload.step);
        continue;
      }

      const payload = await apiFetch<{
        event: ExperienceEvent;
        step: EventActionStep;
      }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
        method: "POST",
        body: JSON.stringify(stepPayload),
      });
      nextEvent = payload.event;
    }

    for (const extraStep of existingContextSteps.slice(nextContextActions.length)) {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
          extraStep.id,
        )}/`,
        { method: "DELETE" },
      );
      nextEvent = payload.event;
    }

    return nextEvent;
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

      latestEvent = await syncContextStepsFromDsl({
        eventPathId,
        experiencePathId,
        latestEvent,
        source: pending.source,
        sourceLabel: onEntryDslContextStepSource,
      });

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

  async function flushConversationAutosave() {
    const pending = pendingConversationAutosaveRef.current;
    if (!experience || !pending) return true;

    const targetEvent = experience.events.find(
      (event) => event.id === pending.eventId,
    );
    if (!targetEvent) {
      pendingConversationAutosaveRef.current = null;
      return true;
    }

    clearConversationAutosaveTimer();
    pendingConversationAutosaveRef.current = null;

    const conversationChoices = conversationChoicesFromDslSource(
      pending.source,
      targetEvent.conversationChoices ?? [],
    );
    let latestEvent = targetEvent;

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${encodeURIComponent(
          experience.id,
        )}/events/${encodeURIComponent(pending.eventId)}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            conversationChoices,
            conversationDslSource: pending.source,
          }),
        },
      );
      latestEvent = payload.event;

      latestEvent = await syncContextStepsFromDsl({
        eventPathId: encodeURIComponent(pending.eventId),
        experiencePathId: encodeURIComponent(experience.id),
        latestEvent,
        source: pending.source,
        sourceLabel: conversationDslContextStepSource,
      });

      setExperience((current) =>
        current && current.id === experience.id
          ? replaceExperienceEvent(current, latestEvent)
          : current,
      );
      return true;
    } catch (saveError) {
      pendingConversationAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save In Conversation.",
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
    const nextConfig = { ...targetStep.config };
    const didUpdateScriptText = pending.text !== undefined;
    if (pending.text !== undefined) {
      nextConfig.text = pending.text;
    }
    if (pending.deckUrl !== undefined) {
      nextConfig.deckUrl = pending.deckUrl;
    }

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
            config: nextConfig,
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
      if (didUpdateScriptText) {
        void loadScriptAudioItems(experience.id, false);
      }
      return true;
    } catch (saveError) {
      pendingScriptTextAutosaveRef.current = pending;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save script.",
      );
      return false;
    }
  }

  function updateSelectedEventDraft(
    field: "chatInstructions" | "description" | "title",
    value: string,
  ) {
    if (!experience || !selectedEvent) return;

    const eventId = selectedEvent.id;
    const pending =
      pendingEventAutosaveRef.current?.eventId === eventId
        ? pendingEventAutosaveRef.current
        : {
            chatInstructions: selectedEvent.chatInstructions ?? "",
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

  function updateSelectedEventConversationDraft(value: string) {
    if (!experience || !selectedEvent) return;

    const eventId = selectedEvent.id;
    const conversationChoices = conversationChoicesFromDslSource(
      value,
      selectedEvent.conversationChoices ?? [],
    );

    setConversationDrafts((current) => ({
      ...current,
      [eventId]: value,
    }));
    pendingConversationAutosaveRef.current = { eventId, source: value };

    setExperience((current) => {
      if (!current || current.id !== experience.id) return current;

      const currentEvent = current.events.find((event) => event.id === eventId);
      if (!currentEvent) return current;

      return replaceExperienceEvent(current, {
        ...currentEvent,
        conversationDslSource: value,
        conversationChoices,
      });
    });

    clearConversationAutosaveTimer();
    conversationAutosaveTimerRef.current = window.setTimeout(() => {
      void flushConversationAutosave();
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

  function queueActiveScriptTextChange(
    nextMarkedScriptText: string,
    displayTextForBreaks?: string,
  ) {
    if (!experience || !selectedEvent || !activeScriptStep) return;

    const nextAudioScriptText = spokenTextFromMarkedScript(nextMarkedScriptText);
    const scriptId =
      activeScriptAudioItem && nextAudioScriptText === activeAudioScriptText
        ? activeScriptAudioItem.id
        : "";

    if (displayTextForBreaks !== undefined) {
      const nextDisplayBreaks = displayBreaksFromText(displayTextForBreaks);
      pendingScriptDisplayDraftsRef.current[activeScriptStep.id] = {
        displayBreaks: nextDisplayBreaks,
        text: nextAudioScriptText,
      };

      if (scriptId) {
        delete failedDisplayAutosavesRef.current[scriptId];
        setDisplayBreakDrafts((current) => ({
          ...current,
          [scriptId]: nextDisplayBreaks,
        }));
      }
    }

    const currentPending = pendingScriptTextAutosaveRef.current;
    const pendingForStep =
      currentPending?.eventId === selectedEvent.id &&
      currentPending.stepId === activeScriptStep.id
        ? currentPending
        : null;
    pendingScriptTextAutosaveRef.current = {
      ...pendingForStep,
      eventId: selectedEvent.id,
      stepId: activeScriptStep.id,
      text: nextMarkedScriptText,
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
          config: { ...currentStep.config, text: nextMarkedScriptText },
        }),
      );
    });

    clearScriptTextAutosaveTimer();
    scriptTextAutosaveTimerRef.current = window.setTimeout(() => {
      void flushScriptTextAutosave();
    }, experienceAutosaveDelayMs);
  }

  function updateActiveScriptDeckUrl(value: string) {
    if (!experience || !selectedEvent || !activeScriptStep) return;

    const currentPending = pendingScriptTextAutosaveRef.current;
    const pendingForStep =
      currentPending?.eventId === selectedEvent.id &&
      currentPending.stepId === activeScriptStep.id
        ? currentPending
        : null;
    pendingScriptTextAutosaveRef.current = {
      ...pendingForStep,
      deckUrl: value,
      eventId: selectedEvent.id,
      stepId: activeScriptStep.id,
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
          config: { ...currentStep.config, deckUrl: value },
        }),
      );
    });

    clearScriptTextAutosaveTimer();
    scriptTextAutosaveTimerRef.current = window.setTimeout(() => {
      void flushScriptTextAutosave();
    }, experienceAutosaveDelayMs);
  }

  function focusActiveScriptText(value: string) {
    audioScriptTextareaFocusedRef.current = true;
    if (!activeAudioScriptDraftStepId) return;

    setAudioScriptDraft((current) =>
      current.stepId === activeAudioScriptDraftStepId
        ? current
        : { stepId: activeAudioScriptDraftStepId, text: value },
    );
  }

  function blurActiveScriptText() {
    audioScriptTextareaFocusedRef.current = false;
  }

  function changeActiveScriptText(
    value: string,
    selectionStart: number | null,
    selectionEnd: number | null,
    selectionDirection: "backward" | "forward" | "none" | null,
  ) {
    if (activeAudioScriptDraftStepId) {
      if (selectionStart !== null && selectionEnd !== null) {
        pendingAudioScriptSelectionRef.current = {
          direction: selectionDirection ?? "none",
          end: selectionEnd,
          start: selectionStart,
          stepId: activeAudioScriptDraftStepId,
        };
      }

      setAudioScriptDraft({
        stepId: activeAudioScriptDraftStepId,
        text: value,
      });
    }
    updateActiveScriptText(value);
  }

  function updateActiveScriptText(value: string) {
    const nextAudioScriptText = normalizeScriptAudioText(value);
    const nextMarkedScriptText = mergeMarkersIntoSpokenText(
      nextAudioScriptText,
      activeScriptMarkers,
    );
    queueActiveScriptTextChange(nextMarkedScriptText, value);
  }

  function recordScriptActionHistory(previousText: string, nextText: string) {
    if (!activeScriptStep || previousText === nextText) return;

    scriptActionUndoStackRef.current = appendScriptActionHistoryEntry(
      scriptActionUndoStackRef.current,
      previousText,
    );
    scriptActionRedoStackRef.current = [];
  }

  function updateActiveScriptMarkedText(value: string, recordHistory = true) {
    if (value === activeScriptText) return;

    if (recordHistory) {
      recordScriptActionHistory(activeScriptText, value);
    }
    queueActiveScriptTextChange(value);
  }

  function applyScriptActionHistory(direction: "redo" | "undo") {
    if (!activeScriptStep) return;

    const sourceStack =
      direction === "undo"
        ? scriptActionUndoStackRef.current
        : scriptActionRedoStackRef.current;
    let targetText = sourceStack.pop();
    while (targetText !== undefined && targetText === activeScriptText) {
      targetText = sourceStack.pop();
    }
    if (targetText === undefined) return;

    if (direction === "undo") {
      scriptActionUndoStackRef.current = sourceStack;
      scriptActionRedoStackRef.current = appendScriptActionHistoryEntry(
        scriptActionRedoStackRef.current,
        activeScriptText,
      );
    } else {
      scriptActionRedoStackRef.current = sourceStack;
      scriptActionUndoStackRef.current = appendScriptActionHistoryEntry(
        scriptActionUndoStackRef.current,
        activeScriptText,
      );
    }

    setScriptActionMenu(null);
    updateActiveScriptMarkedText(targetText, false);
  }

  function openScriptInsertMenu(
    insertionIndex: number,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!activeScriptStep) return;

    setScriptActionMenu({
      insertionIndex,
      mode: "insert",
      x: Math.min(event.clientX, window.innerWidth - 260),
      y: Math.min(event.clientY, window.innerHeight - 240),
    });
  }

  function openScriptMarkerMenu(
    marker: ScriptMarkerInstance,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setScriptActionMenu({
      markerKey: markerEditKey(marker),
      mode: "edit",
      x: Math.min(event.clientX, window.innerWidth - 320),
      y: Math.min(event.clientY, window.innerHeight - 260),
    });
  }

  function insertScriptAction(type: "slide" | "side-image" | "sound") {
    if (!activeScriptStep || scriptActionMenu?.mode !== "insert") return;

    let marker = buildScriptMarker("play_sound", [
      scriptSoundOptions[0].path,
      "0.5",
    ]);
    if (type === "slide") {
      marker = buildScriptMarker("gslide", [
        nextAvailableSlideRef(activeScriptMarkers),
      ]);
    } else if (type === "side-image") {
      marker = buildScriptMarker("side_image", [
        "left",
        "show",
        tutorForm.avatarPath || defaultSideImagePath,
      ]);
    }
    updateActiveScriptMarkedText(
      insertScriptMarkerAt(
        activeScriptText,
        scriptActionMenu.insertionIndex,
        marker,
      ),
    );
    setActiveScriptDetailTab("script");
    setScriptActionMenu(null);
  }

  function replaceScriptActionMarker(
    marker: ScriptMarkerInstance,
    args: string[],
  ) {
    updateActiveScriptMarkedText(
      replaceScriptMarker(
        activeScriptText,
        marker,
        buildScriptMarker(marker.type, args),
      ),
    );
  }

  function removeScriptActionMarker(marker: ScriptMarkerInstance) {
    updateActiveScriptMarkedText(removeScriptMarker(activeScriptText, marker));
    setScriptActionMenu(null);
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

  async function updateActiveDisplayCueOffsets(offsets: number[]) {
    if (!activeScriptAudioItem) return;

    const scriptId = activeScriptAudioItem.id;
    setSavingDisplayTextId(scriptId);
    try {
      await saveDisplayTranscriptRef.current(
        scriptId,
        activeDisplaySlots,
        activeDisplayEditorBreaks,
        offsets,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save chat cue timing.",
      );
    } finally {
      setSavingDisplayTextId((current) => (current === scriptId ? "" : current));
    }
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

  async function generateAllExperienceAudio() {
    const payload = await generateScriptAudio();
    if (payload?.errors?.length) {
      setError(payload.errors.join(" "));
    }
  }

  async function playOrGenerateActiveScriptAudio() {
    const item = activeScriptAudioItem;
    if (!item) return;

    if (isActiveScriptAudioPlaying) {
      stopScriptAudioPreview();
      return;
    }

    if (item.audioUrl) {
      playScriptAudioPreview(item);
      return;
    }

    if (!item.canGenerate || scriptAudioStatus === "generating") return;

    const payload = await generateScriptAudio(item.id);
    if (payload?.errors?.length) {
      setError(payload.errors.join(" "));
      return;
    }

    const nextItem = payload?.scripts.find(
      (candidate) => candidate.id === item.id,
    );
    if (!nextItem?.audioUrl) {
      setError(item.generationReason || "Could not generate this script's audio.");
    }
  }

  async function regenerateActiveScriptAudio(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();

    const item = activeScriptAudioItem;
    if (!item || !item.canGenerate || scriptAudioStatus === "generating") return;

    if (isActiveScriptAudioPlaying) {
      stopScriptAudioPreview();
    }

    const payload = await generateScriptAudio(item.id, true);
    if (payload?.errors?.length) {
      setError(payload.errors.join(" "));
    }
  }

  async function generateMissingAudioBeforeRun() {
    if (!experience) return null;

    setAudioPreparation({
      completed: 0,
      message: "Generating missing audio",
      total: 0,
    });

    const inventoryPayload = await loadScriptAudioItems(experience.id, false);
    if (!inventoryPayload) {
      setAudioPreparation(null);
      setError("Could not check scripted audio before starting.");
      return null;
    }

    const inventoryItems = inventoryPayload.scripts;
    const missingItems = scriptAudioMissingItems(inventoryItems);
    if (!missingItems.length) {
      setAudioPreparation(null);
      return 0;
    }

    setAudioPreparation({
      completed: 0,
      message: "Generating missing audio",
      total: missingItems.length,
    });

    const payload = await generateScriptAudio("", false);
    if (!payload) {
      setAudioPreparation(null);
      setError("Could not generate missing audio before starting.");
      return null;
    }

    const remainingCount = scriptAudioMissingItems(payload.scripts).length;
    const completedCount = Math.max(0, missingItems.length - remainingCount);
    setAudioPreparation({
      completed: remainingCount ? completedCount : missingItems.length,
      message: remainingCount
        ? "Generating missing audio"
        : "Preparing experience",
      total: missingItems.length,
    });

    if (payload.errors?.length || remainingCount) {
      setAudioPreparation(null);
      setError(
        payload.errors?.join(" ") ||
          `Could not generate ${remainingCount} audio item${
            remainingCount === 1 ? "" : "s"
          }.`,
      );
      return null;
    }

    return missingItems.length;
  }

  async function flushNextEditorAutosave() {
    const didSaveOverview = await flushOverviewAutosave();
    const didSaveTutor = await flushTutorAutosave();
    const didSaveEvent = await flushEventAutosave();
    const didSaveOnEntry = await flushOnEntryAutosave();
    const didSaveConversation = await flushConversationAutosave();
    const didSaveScriptText = await flushScriptTextAutosave();
    return (
      didSaveOverview &&
      didSaveTutor &&
      didSaveEvent &&
      didSaveOnEntry &&
      didSaveConversation &&
      didSaveScriptText
    );
  }

  async function returnToExperiences() {
    const didSave = await flushNextEditorAutosave();
    if (!didSave) return;

    window.location.assign("/experiences");
  }

  async function runEvent(eventId: string) {
    if (!experience || runningEventId) return;

    setRunningEventId(eventId);
    const didSave = await flushNextEditorAutosave();
    if (!didSave) {
      setRunningEventId("");
      return;
    }

    const preparedAudioTotal = await generateMissingAudioBeforeRun();
    if (preparedAudioTotal === null) {
      setRunningEventId("");
      return;
    }

    try {
      await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({
          eventId,
          experienceId: experience.id,
          recordingMode: checkpointRecordingMode,
        }),
      });
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "Could not start from this event.",
      );
      setRunningEventId("");
      return;
    }

    setAudioPreparation({
      completed: preparedAudioTotal,
      message: "Preparing experience",
      total: preparedAudioTotal,
    });
    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceRunPath(experience.id));
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
    if (pendingConversationAutosaveRef.current?.eventId === eventId) {
      pendingConversationAutosaveRef.current = null;
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
      setConversationDrafts((current) => {
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

  async function loadScriptImages(targetExperienceId = experience?.id ?? "") {
    if (!targetExperienceId) return;

    setIsLoadingScriptImages(true);
    try {
      const payload = await apiFetch<{ images: ScriptImageOption[] }>(
        `/api/experiences/${encodeURIComponent(targetExperienceId)}/script-images/`,
      );
      setScriptImageOptions(payload.images);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load script images.",
      );
    } finally {
      setIsLoadingScriptImages(false);
    }
  }

  function selectScriptImage(imagePath: string) {
    if (!editingScriptMarker || !editingSideImageState) return;

    replaceScriptActionMarker(
      editingScriptMarker,
      sideImageActionArgs({
        ...editingSideImageState,
        imagePath,
      }),
    );
    setIsScriptImagePickerOpen(false);
  }

  async function uploadScriptImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !experience) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      event.target.value = "";
      return;
    }

    setError("");
    setIsUploadingScriptImage(true);

    try {
      const formData = new FormData();
      formData.append("image", file);
      const payload = await apiFetch<{
        imagePath: string;
        images: ScriptImageOption[];
      }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/script-images/`,
        {
          method: "POST",
          body: formData,
        },
      );

      setScriptImageOptions(payload.images);
      if (editingScriptMarker && editingSideImageState) {
        replaceScriptActionMarker(
          editingScriptMarker,
          sideImageActionArgs({
            ...editingSideImageState,
            imagePath: payload.imagePath,
          }),
        );
      }
      setIsScriptImagePickerOpen(false);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload script image.",
      );
    } finally {
      setIsUploadingScriptImage(false);
      event.target.value = "";
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
  const selectedEventInConversationSource = selectedEvent
    ? (conversationDrafts[selectedEvent.id] ??
      (selectedEvent.conversationDslSource ||
        conversationChoiceDslSourceFromChoices(
          selectedEvent.conversationChoices ?? [],
        )))
    : "";
  const firstSelectedEventScriptAction = useMemo(
    () => firstTopLevelScriptActionFromDsl(selectedEventOnEntrySource),
    [selectedEventOnEntrySource],
  );
  const firstSelectedEventScriptActionKey = selectedEvent
    ? scriptActionAutoOpenKey(selectedEvent.id, firstSelectedEventScriptAction)
    : "";

  useEffect(() => {
    if (!selectedEvent || status !== "ready") return;

    if (activeScriptAction?.eventId === selectedEvent.id) {
      autoOpenedScriptActionKeyRef.current = firstSelectedEventScriptActionKey;
      return;
    }

    if (
      !firstSelectedEventScriptAction ||
      !firstSelectedEventScriptActionKey ||
      !sortedScriptSteps(selectedEvent)[
        firstSelectedEventScriptAction.actionIndex
      ] ||
      autoOpenedScriptActionKeyRef.current === firstSelectedEventScriptActionKey
    ) {
      return;
    }

    autoOpenedScriptActionKeyRef.current = firstSelectedEventScriptActionKey;
    setActiveScriptAction({
      ...firstSelectedEventScriptAction,
      eventId: selectedEvent.id,
    });
  }, [
    activeScriptAction?.eventId,
    firstSelectedEventScriptAction,
    firstSelectedEventScriptActionKey,
    selectedEvent,
    status,
  ]);

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
          <button
            aria-label="On entry action help"
            className="next-event-script-help"
            data-tooltip="Ctrl-click chat actions to toggle on/off. Click script actions to open their panel."
            type="button"
          >
            <HelpIcon />
          </button>
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
      <section className="next-event-script-section">
        <div className="next-event-script-heading">
          <h3>In Conversation</h3>
        </div>
        <textarea
          aria-label="Extra conversation context"
          className="next-conversation-context-text"
          onChange={(event) =>
            updateSelectedEventDraft("chatInstructions", event.target.value)
          }
          onInput={(event) => resizeTextareaToContent(event.currentTarget)}
          placeholder="Extra conversation context"
          ref={selectedEventChatInstructionsRef}
          rows={1}
          value={selectedEvent.chatInstructions ?? ""}
        />
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
            ariaLabel="In Conversation script"
            eventTargets={(experience?.events ?? []).filter(
              (event) => event.id !== selectedEvent.id,
            )}
            mode="conversation"
            onChange={updateSelectedEventConversationDraft}
            value={selectedEventInConversationSource}
          />
        </Suspense>
      </section>
    </div>
  ) : null;

  const isDisplayTextResetDisabled = activeScriptAudioItem
    ? displaySlotsAreEqual(
        activeDisplaySlots,
        activeDisplayBaseSlots,
      )
    : true;
  const activeScriptAudioPreviewDisabled =
    !activeScriptAudioItem ||
    scriptAudioStatus === "generating" ||
    (!activeScriptAudioItem.audioUrl && !activeScriptAudioItem.canGenerate);
  const activeScriptAudioPreviewLabel = isActiveScriptAudioPlaying
    ? "Stop audio script preview"
    : activeScriptAudioItem?.audioUrl
      ? "Play audio script preview"
      : activeScriptAudioNeedsGeneration
        ? "Generate audio script"
        : "Audio script preview unavailable";
  const activeScriptAudioPreviewStateClass =
    scriptAudioStatus === "generating"
      ? "is-generating"
      : activeScriptAudioItem?.audioUrl
        ? "has-audio"
        : "is-empty";
  const editingScriptMarker =
    scriptActionMenu?.mode === "edit"
      ? (activeScriptMarkers.find(
          (marker) => markerEditKey(marker) === scriptActionMenu.markerKey,
        ) ?? null)
      : null;
  const editingSideImageState =
    editingScriptMarker?.type === "side_image"
      ? sideImageActionStateFromArgs(editingScriptMarker.argList)
      : null;
  const scriptImagePickerOptions = (() => {
    const currentPath = editingSideImageState?.imagePath.trim() ?? "";
    if (
      !currentPath ||
      scriptImageOptions.some((option) => option.path === currentPath)
    ) {
      return scriptImageOptions;
    }

    return [
      {
        label: "Current image",
        path: currentPath,
        source: "Custom",
      },
      ...scriptImageOptions,
    ];
  })();
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
        <div className="next-script-tabbar">
          <button
            aria-label={activeScriptAudioPreviewLabel}
            className={[
              "next-script-audio-preview-button",
              activeScriptAudioPreviewStateClass,
              isActiveScriptAudioPlaying ? "is-playing" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={activeScriptAudioPreviewDisabled}
            onClick={() => void playOrGenerateActiveScriptAudio()}
            onContextMenu={(event) => void regenerateActiveScriptAudio(event)}
            title={`${activeScriptAudioPreviewLabel}. Right-click to regenerate.`}
            type="button"
          >
            {isActiveScriptAudioPlaying ? <StopIcon /> : <MicIcon />}
          </button>
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
              Audio
            </button>
            <button
              aria-disabled={activeScriptAudioReady ? "false" : "true"}
              aria-selected={activeScriptDetailTab === "display" ? "true" : "false"}
              className={activeScriptDetailTab === "display" ? "is-active" : ""}
              onClick={() => {
                if (!activeScriptAudioReady) return;
                setActiveScriptDetailTab("display");
              }}
              role="tab"
              title={
                activeScriptAudioReady
                  ? "Edit display text"
                  : "Generate this audio before editing display text."
              }
              type="button"
            >
              Display Text
            </button>
            <button
              aria-selected={activeScriptDetailTab === "script" ? "true" : "false"}
              className={activeScriptDetailTab === "script" ? "is-active" : ""}
              onClick={() => setActiveScriptDetailTab("script")}
              role="tab"
              title="Place slides and actions"
              type="button"
            >
              Slides &amp; Actions
            </button>
            <button
              aria-disabled={activeScriptAudioReady ? "false" : "true"}
              aria-selected={
                activeScriptDetailTab === "fine-tuning" ? "true" : "false"
              }
              className={
                activeScriptDetailTab === "fine-tuning" ? "is-active" : ""
              }
              onClick={() => {
                if (!activeScriptAudioReady) return;
                setActiveScriptDetailTab("fine-tuning");
              }}
              role="tab"
              title={
                activeScriptAudioReady
                  ? "Fine tune generated audio"
                  : "Generate this audio before fine tuning."
              }
              type="button"
            >
              Fine Tuning
            </button>
          </div>
        </div>
        {activeScriptDetailTab === "audio" ? (
          <textarea
            aria-label="Audio script text"
            className="next-script-textarea"
            disabled={!activeScriptStep}
            onBlur={blurActiveScriptText}
            onChange={(event) =>
              changeActiveScriptText(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
                event.currentTarget.selectionDirection,
              )
            }
            onContextMenu={(event) => event.stopPropagation()}
            onFocus={(event) => focusActiveScriptText(event.currentTarget.value)}
            placeholder="No script text yet."
            ref={audioScriptTextareaRef}
            spellCheck
            value={activeAudioScriptTextareaValue}
          />
        ) : activeScriptDetailTab === "script" ? (
          <ScriptActionReadOnlyView
            actionRows={activeScriptActionView.rows}
            deckUrl={activeScriptDeckUrl}
            displayBreaks={[]}
            markers={activeScriptActionView.markers}
            onDeckUrlChange={updateActiveScriptDeckUrl}
            onOpenInsert={openScriptInsertMenu}
            onOpenMarker={openScriptMarkerMenu}
            onRemoveMarker={removeScriptActionMarker}
            previews={scriptSlidePreviews}
            sourceIndexByTextIndex={activeScriptActionView.sourceIndexByTextIndex}
            text={activeScriptActionView.text}
          />
        ) : activeScriptDetailTab === "fine-tuning" ? (
          <NextFineTuningPanel
            audioItem={activeScriptAudioItem}
            deckUrl={activeScriptDeckUrl}
            displayBreaks={activeDisplayEditorBreaks}
            displayCueOffsets={activeDisplayCueOffsets}
            displaySlots={activeDisplaySlots}
            onDisplayCueOffsetsChange={(offsets) =>
              void updateActiveDisplayCueOffsets(offsets)
            }
            onMarkedTextChange={updateActiveScriptMarkedText}
            previews={scriptSlidePreviews}
            text={activeScriptText}
            textRevealSpeed={scriptTextRevealSpeed}
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
        {scriptActionMenu ? (
          <div
            className="next-script-action-popover"
            ref={scriptActionMenuRef}
            role="menu"
            style={{ left: scriptActionMenu.x, top: scriptActionMenu.y }}
          >
            {scriptActionMenu.mode === "insert" ? (
              <>
                <button
                  className="next-script-action-menu-item is-slide"
                  onClick={() => insertScriptAction("slide")}
                  role="menuitem"
                  type="button"
                >
                  Slide
                </button>
                <button
                  className="next-script-action-menu-item is-action"
                  onClick={() => insertScriptAction("side-image")}
                  role="menuitem"
                  type="button"
                >
                  Interface image
                </button>
                <button
                  className="next-script-action-menu-item is-action"
                  onClick={() => insertScriptAction("sound")}
                  role="menuitem"
                  type="button"
                >
                  Sound
                </button>
              </>
            ) : editingScriptMarker ? (
              <div className="next-script-action-editor">
                <div className="next-script-action-editor-head">
                  <strong>{editingScriptMarker.label}</strong>
                  <button
                    onClick={() => removeScriptActionMarker(editingScriptMarker)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
                {isSlideMarker(editingScriptMarker) ? (
                  <label>
                    <span>Slide</span>
                    <input
                      aria-label="Slide reference"
                      onChange={(event) =>
                        replaceScriptActionMarker(editingScriptMarker, [
                          event.target.value,
                        ])
                      }
                      value={editingScriptMarker.argList[0] ?? ""}
                    />
                  </label>
                ) : editingScriptMarker.type === "side_image" &&
                  editingSideImageState ? (
                  <>
                    <label>
                      <span>Side</span>
                      <select
                        aria-label="Interface image side"
                        onChange={(event) =>
                          replaceScriptActionMarker(
                            editingScriptMarker,
                            sideImageActionArgs({
                              ...editingSideImageState,
                              side:
                                event.target.value === "right"
                                  ? "right"
                                  : "left",
                            }),
                          )
                        }
                        value={editingSideImageState.side}
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      <span>State</span>
                      <select
                        aria-label="Interface image state"
                        onChange={(event) =>
                          replaceScriptActionMarker(
                            editingScriptMarker,
                            sideImageActionArgs({
                              ...editingSideImageState,
                              visible: event.target.value !== "hide",
                            }),
                          )
                        }
                        value={editingSideImageState.visible ? "show" : "hide"}
                      >
                        <option value="show">Show</option>
                        <option value="hide">Hide</option>
                      </select>
                    </label>
                    <div className="next-script-image-field">
                      <span>Image</span>
                      <div className="next-script-image-control">
                        <button
                          aria-expanded={isScriptImagePickerOpen}
                          aria-label="Choose interface image"
                          className="next-script-image-preview-button"
                          onClick={() =>
                            setIsScriptImagePickerOpen((isOpen) => !isOpen)
                          }
                          title="Choose interface image"
                          type="button"
                        >
                          {editingSideImageState.imagePath ? (
                            <img
                              alt=""
                              src={publicAsset(editingSideImageState.imagePath)}
                            />
                          ) : (
                            <span>No image</span>
                          )}
                        </button>
                        <input
                          aria-label="Interface image path"
                          className="next-script-image-path-input"
                          onChange={(event) =>
                            replaceScriptActionMarker(
                              editingScriptMarker,
                              sideImageActionArgs({
                                ...editingSideImageState,
                                imagePath: event.target.value,
                              }),
                            )
                          }
                          placeholder={defaultSideImagePath}
                          value={editingSideImageState.imagePath}
                        />
                        <button
                          className="next-script-image-upload-button"
                          disabled={isUploadingScriptImage}
                          onClick={() => scriptImageFileInputRef.current?.click()}
                          type="button"
                        >
                          {isUploadingScriptImage ? "Uploading" : "Upload"}
                        </button>
                        <input
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="next-script-image-file-input"
                          onChange={(event) => void uploadScriptImage(event)}
                          ref={scriptImageFileInputRef}
                          type="file"
                        />
                        {isScriptImagePickerOpen ? (
                          <div
                            aria-label="Interface image options"
                            className="next-script-image-picker"
                          >
                            {isLoadingScriptImages ? (
                              <div className="next-script-image-picker-empty">
                                Loading images
                              </div>
                            ) : scriptImagePickerOptions.length ? (
                              scriptImagePickerOptions.map((option) => {
                                const isSelected =
                                  option.path === editingSideImageState.imagePath;
                                return (
                                  <button
                                    aria-pressed={isSelected}
                                    key={option.path}
                                    onClick={() => selectScriptImage(option.path)}
                                    type="button"
                                  >
                                    <img alt="" src={publicAsset(option.path)} />
                                    <span>{option.label}</span>
                                    <small>{option.source}</small>
                                  </button>
                                );
                              })
                            ) : (
                              <div className="next-script-image-picker-empty">
                                No images yet
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : editingScriptMarker.type === "play_sound" ? (
                  <>
                    <label>
                      <span>Sound</span>
                      <select
                        aria-label="Sound effect"
                        onChange={(event) => {
                          const currentVolume =
                            editingScriptMarker.argList[1]?.trim() || "0.5";
                          replaceScriptActionMarker(editingScriptMarker, [
                            event.target.value === customSoundOptionValue
                              ? editingScriptMarker.argList[0] || ""
                              : event.target.value,
                            currentVolume,
                          ]);
                        }}
                        value={
                          scriptSoundOptions.some(
                            (option) =>
                              option.path === editingScriptMarker.argList[0],
                          )
                            ? editingScriptMarker.argList[0]
                            : customSoundOptionValue
                        }
                      >
                        {scriptSoundOptions.map((option) => (
                          <option key={option.path} value={option.path}>
                            {option.label}
                          </option>
                        ))}
                        <option value={customSoundOptionValue}>Custom</option>
                      </select>
                    </label>
                    <label>
                      <span>Volume</span>
                      <input
                        aria-label="Sound volume"
                        max="1"
                        min="0"
                        onChange={(event) =>
                          replaceScriptActionMarker(editingScriptMarker, [
                            editingScriptMarker.argList[0] ||
                              scriptSoundOptions[0].path,
                            event.target.value,
                          ])
                        }
                        step="0.05"
                        type="number"
                        value={editingScriptMarker.argList[1] ?? "0.5"}
                      />
                    </label>
                    {!scriptSoundOptions.some(
                      (option) =>
                        option.path === editingScriptMarker.argList[0],
                    ) ? (
                      <label>
                        <span>Path</span>
                        <input
                          aria-label="Custom sound path"
                          onChange={(event) =>
                            replaceScriptActionMarker(editingScriptMarker, [
                              event.target.value,
                              editingScriptMarker.argList[1] || "0.5",
                            ])
                          }
                          value={editingScriptMarker.argList[0] ?? ""}
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <label>
                    <span>Args</span>
                    <input
                      aria-label="Action arguments"
                      onChange={(event) =>
                        replaceScriptActionMarker(
                          editingScriptMarker,
                          event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        )
                      }
                      value={editingScriptMarker.args}
                    />
                  </label>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <main
      className="panel-study experience-editor-page experience-editor-next-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
      onContextMenu={snapshotContextMenu.onContextMenu}
    >
      {audioPreparation ? (
        <div
          aria-label="Generating missing audio"
          aria-live="polite"
          className="next-audio-prep-overlay"
          role="status"
        >
          <div className="next-audio-prep-dialog">
            <span>{audioPreparation.message}</span>
            <strong>
              {audioPreparation.total
                ? `${audioPreparation.completed}/${audioPreparation.total}`
                : "Checking audio"}
            </strong>
            <div
              className={[
                "next-audio-prep-meter",
                audioPreparation.total ? "" : "is-indeterminate",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <i
                style={{
                  width: audioPreparation.total
                    ? `${Math.round(
                        (audioPreparation.completed /
                          audioPreparation.total) *
                          100,
                      )}%`
                    : undefined,
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
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
      </header>

      <section className="experience-editor experience-editor-next">
        {status === "loading" ? (
          <div className="experience-state">Loading experience...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        {experience ? (
          <section className="next-editor-overview-section">
            <div className="next-overview-editor">
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
                  <label
                    className="control-field next-tutor-speed-field"
                    title="Speed of pseudo generation of pre-generated scripts."
                  >
                    <span>Text reveal speed</span>
                    <input
                      aria-label="Text reveal speed"
                      max="4"
                      min="0.7"
                      onChange={(event) =>
                        changeScriptTextRevealSpeed(event.target.value)
                      }
                      onBlur={normalizeScriptTextRevealSpeedDraft}
                      step="0.05"
                      type="number"
                      value={scriptTextRevealSpeedDraft}
                    />
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
            checkpointRecordingMode={checkpointRecordingMode}
            detailPanel={actionDetailPanel}
            events={experience.events}
            experienceId={experience.id}
            inspector={eventInspector}
            isCreatingEvent={isCreatingEvent}
            onCheckpointRecordingModeChange={setCheckpointRecordingMode}
            onCreateEvent={() => void createEvent()}
            onDeleteEvent={(eventId) => void deleteEvent(eventId)}
            onRunEvent={(eventId) => void runEvent(eventId)}
            onSelectEvent={setSelectedEventId}
            runningEventId={runningEventId}
            selectedEventId={selectedEventId}
          />
        ) : null}
      </section>
      {snapshotContextMenu.menu}
    </main>
  );
}
