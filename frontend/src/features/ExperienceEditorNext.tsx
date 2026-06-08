import {
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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
  appendScriptMarkerTimelineArg,
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
  parsePythonDslStepActions,
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
import {
  DisplayTextEditor,
  displayBreaksFromText,
  displayTextFromSlots,
  type DisplayDocumentDraft,
} from "./DisplayTextEditor";
import {
  markerEditKey,
  markerEditKeyFrom,
  projectScriptActionsToDisplayText,
  sourceMarkerForView,
  viewMarkerEditKey,
  type ScriptActionRow,
  type ScriptActionViewMarker,
} from "./scriptActionProjection";
import {
  ImageLibraryPicker,
  type ImageLibraryOption,
} from "./ImageLibraryPicker";
import { NextFineTuningPanel } from "./NextFineTuningPanel";
import { alignScriptWordsToDisplaySlots } from "./scriptDisplayTiming";
import {
  clamp,
  dropIndexForTextTarget,
  isSlideMarker,
  nextSlideRefAfterInsertion,
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

type ScriptAudioMenuState = {
  x: number;
  y: number;
};

type ScriptInsertionPreview = {
  height: number;
  insertionIndex: number;
  x: number;
  y: number;
};

type SideImageActionState = {
  imagePath: string;
  scale: number;
  scaleText: string;
  side: "left" | "right";
  visible: boolean;
};

type ScriptActionMenuDragState = {
  menuX: number;
  menuY: number;
  pointerId: number;
  startX: number;
  startY: number;
};

const scriptActionHistoryLimit = 80;
const onEntryScriptActionPattern = /\bscript\s*\([^)]*\)/g;
const onEntryDslStepSource = "next-on-entry-dsl";
const conversationDslStepSource = "next-conversation-dsl";
const defaultSideImagePath = "test-images/dLU-right.png";
const sideImageScaleMin = 0.2;
const sideImageScaleMax = 3;
const scriptActionMenuViewportPadding = 12;

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

function normalizeSideImageScale(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return clamp(numeric, sideImageScaleMin, sideImageScaleMax);
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
  const usesExplicitMode = showModes.includes(mode) || hideModes.includes(mode);
  const imageArgIndex = usesExplicitMode ? 1 : 0;
  const imagePath =
    remainingArgs.length > imageArgIndex
      ? remainingArgs[imageArgIndex]
      : usesExplicitMode
        ? ""
        : remainingArgs[0] || "";
  const scaleText = remainingArgs[imageArgIndex + 1]?.trim() || "1";
  const scale = normalizeSideImageScale(scaleText);

  return {
    imagePath,
    scale,
    scaleText,
    side,
    visible: !hideModes.includes(mode),
  };
}

function sideImageActionArgs(state: SideImageActionState) {
  const imagePath = state.imagePath.trim();
  const rawScaleText = state.scaleText.trim();
  const scale = normalizeSideImageScale(rawScaleText || state.scale);
  const scaleArg =
    imagePath &&
    rawScaleText &&
    (Math.abs(scale - 1) > 0.001 || rawScaleText.endsWith("."))
      ? rawScaleText
      : "";
  if (state.visible) {
    const args = imagePath
      ? [state.side, "show", imagePath]
      : [state.side, "show"];
    if (scaleArg) args.push(scaleArg);
    return args;
  }
  const args = imagePath
    ? [state.side, "hide", imagePath]
    : [state.side, "hide"];
  if (scaleArg) args.push(scaleArg);
  return args;
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

function clampFloatingMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (typeof window === "undefined") return { x, y };

  const maxX = Math.max(
    scriptActionMenuViewportPadding,
    window.innerWidth - width - scriptActionMenuViewportPadding,
  );
  const maxY = Math.max(
    scriptActionMenuViewportPadding,
    window.innerHeight - height - scriptActionMenuViewportPadding,
  );

  return {
    x: Math.round(clamp(x, scriptActionMenuViewportPadding, maxX)),
    y: Math.round(clamp(y, scriptActionMenuViewportPadding, maxY)),
  };
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

function ScriptActionReadOnlyView({
  actionRows,
  canRefreshSlides,
  deckUrl,
  displayBreaks,
  isRefreshingSlides,
  markers,
  onDeckUrlChange,
  onOpenInsert,
  onOpenMarker,
  onMoveMarker,
  onRefreshSlides,
  onRemoveMarker,
  previews,
  sourceIndexByTextIndex,
  text,
}: {
  actionRows: ScriptActionRow[];
  canRefreshSlides: boolean;
  deckUrl: string;
  displayBreaks: number[];
  isRefreshingSlides: boolean;
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
  onMoveMarker: (
    marker: ScriptActionViewMarker,
    targetSourceIndex: number,
  ) => string | null;
  onRefreshSlides: () => void;
  onRemoveMarker: (marker: ScriptMarkerInstance) => void;
  previews: Record<string, ScriptSlidePreview>;
  sourceIndexByTextIndex: number[];
  text: string;
}) {
  const [insertionPreview, setInsertionPreview] =
    useState<ScriptInsertionPreview | null>(null);
  const [pendingFocusMarkerKey, setPendingFocusMarkerKey] = useState("");
  const [selectedMarkerKey, setSelectedMarkerKey] = useState("");
  const pendingFocusMarkerRef = useRef<HTMLButtonElement | null>(null);
  const breakCounts = new Map<number, number>();
  normalizeDisplayBreaks(displayBreaks).forEach((breakIndex) => {
    breakCounts.set(breakIndex, (breakCounts.get(breakIndex) ?? 0) + 1);
  });

  let wordIndex = 0;

  useEffect(() => {
    setInsertionPreview(null);
  }, [text]);

  useEffect(() => {
    setSelectedMarkerKey((current) =>
      current && markers.some((marker) => viewMarkerEditKey(marker) === current)
        ? current
        : "",
    );
  }, [markers]);

  useLayoutEffect(() => {
    if (!pendingFocusMarkerKey || selectedMarkerKey !== pendingFocusMarkerKey) {
      return;
    }

    pendingFocusMarkerRef.current?.focus({ preventScroll: true });
    setPendingFocusMarkerKey("");
  }, [markers, pendingFocusMarkerKey, selectedMarkerKey]);

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
    const defaultStartInsertionIndex = Number(
      insertRegion?.dataset.defaultInsertStart,
    );
    const insertTarget = target.closest<HTMLElement>("[data-insert-before]");

    if (!insertTarget) {
      const region = insertRegion ?? event.currentTarget;
      const rect = region.getBoundingClientRect();
      const styles = window.getComputedStyle(event.currentTarget);
      const lineHeight =
        Number.parseFloat(styles.lineHeight) ||
        Number.parseFloat(styles.fontSize) * 1.75 ||
        22;
      const firstInsertTarget =
        region.querySelector<HTMLElement>("[data-insert-before]");
      const firstInsertRect = firstInsertTarget
        ? closestClientRectToPointer(
            firstInsertTarget,
            event.clientX,
            event.clientY,
          )
        : null;
      const firstTargetInsertionIndex = Number(
        firstInsertTarget?.dataset.insertBefore,
      );
      const isAtOrAboveFirstLine =
        firstInsertRect !== null &&
        event.clientY <= firstInsertRect.bottom + lineHeight * 0.35;
      const insertionIndex =
        isAtOrAboveFirstLine &&
        Number.isFinite(defaultStartInsertionIndex)
          ? defaultStartInsertionIndex
          : isAtOrAboveFirstLine && Number.isFinite(firstTargetInsertionIndex)
            ? firstTargetInsertionIndex
            : Number.isFinite(defaultInsertionIndex)
              ? defaultInsertionIndex
              : text.length;

      return {
        height: Math.max(16, lineHeight - 3),
        insertionIndex,
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

  function textTokenRangesOutsideMarkers() {
    const ranges: Array<{ end: number; start: number }> = [];
    const wordPattern = /\S+/g;
    let cursor = 0;

    [...markers]
      .sort((left, right) => left.start - right.start)
      .forEach((marker) => {
        if (marker.start > cursor) {
          const segment = text.slice(cursor, marker.start);
          wordPattern.lastIndex = 0;
          for (const match of segment.matchAll(wordPattern)) {
            const start = cursor + (match.index ?? 0);
            ranges.push({
              end: start + match[0].length,
              start,
            });
          }
        }
        cursor = Math.max(cursor, marker.end);
      });

    if (cursor < text.length) {
      const segment = text.slice(cursor);
      wordPattern.lastIndex = 0;
      for (const match of segment.matchAll(wordPattern)) {
        const start = cursor + (match.index ?? 0);
        ranges.push({
          end: start + match[0].length,
          start,
        });
      }
    }

    return ranges;
  }

  function sourceIndexForMarkerNudge(
    marker: ScriptActionViewMarker,
    direction: -1 | 1,
  ) {
    const tokenRanges = textTokenRangesOutsideMarkers();
    const targetTextIndex =
      direction < 0
        ? tokenRanges
            .filter((range) => range.end <= marker.start)
            .at(-1)?.start
        : tokenRanges.find((range) => range.start >= marker.end)?.end;

    if (targetTextIndex === undefined) return null;
    return sourceIndexForTextIndex(targetTextIndex);
  }

  function renderActionToken(marker: ScriptActionViewMarker) {
    const sourceMarker = sourceMarkerForView(marker);
    const markerKey = viewMarkerEditKey(marker);
    return (
      <button
        className={[
          "next-script-action-token",
          markerStyleType(marker) === "slide" ? "is-slide" : "is-action",
          selectedMarkerKey === markerKey ? "is-selected" : "",
        ].join(" ")}
        key={markerKey}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSelectedMarkerKey(markerKey);
        }}
        onContextMenu={(event) => {
          setSelectedMarkerKey(markerKey);
          onOpenMarker(sourceMarker, event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onRemoveMarker(sourceMarker);
            return;
          }

          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

          const targetSourceIndex = sourceIndexForMarkerNudge(
            marker,
            event.key === "ArrowLeft" ? -1 : 1,
          );
          if (targetSourceIndex === null) return;

          event.preventDefault();
          event.stopPropagation();
          const nextMarkerKey = onMoveMarker(marker, targetSourceIndex);
          if (nextMarkerKey) {
            setSelectedMarkerKey(nextMarkerKey);
            setPendingFocusMarkerKey(nextMarkerKey);
          }
        }}
        ref={
          pendingFocusMarkerKey === markerKey ? pendingFocusMarkerRef : undefined
        }
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
      <div className="next-script-slides-link-row">
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
        <button
          aria-label="Refresh slide previews"
          disabled={!canRefreshSlides || isRefreshingSlides}
          onClick={onRefreshSlides}
          title={
            canRefreshSlides
              ? "Refresh slide previews from the deck"
              : "Add a slides link and slide action first"
          }
          type="button"
        >
          <RefreshIcon />
        </button>
      </div>
      <div
        aria-label="Slides and actions"
        className="next-script-slide-flow"
        role="table"
      >
        {actionRows.length ? (
          actionRows.map((row, rowIndex) => {
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
                  data-default-insert-start={sourceIndexForTextIndex(
                    rowIndex === 0 ? 0 : row.textStart,
                  )}
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
              data-default-insert-start={sourceIndexForTextIndex(0)}
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
  const [isTutorAvatarPickerOpen, setIsTutorAvatarPickerOpen] = useState(false);
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
  const [scriptAudioMenu, setScriptAudioMenu] =
    useState<ScriptAudioMenuState | null>(null);
  const [scriptImageOptions, setScriptImageOptions] = useState<
    ImageLibraryOption[]
  >([]);
  const [deletingScriptImagePath, setDeletingScriptImagePath] = useState("");
  const [isLoadingScriptImages, setIsLoadingScriptImages] = useState(false);
  const [isScriptImagePickerOpen, setIsScriptImagePickerOpen] = useState(false);
  const [isUploadingScriptImage, setIsUploadingScriptImage] = useState(false);
  const [scriptSlidePreviews, setScriptSlidePreviews] = useState<
    Record<string, ScriptSlidePreview>
  >({});
  const [isRefreshingScriptSlides, setIsRefreshingScriptSlides] =
    useState(false);
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
  const [isAudioVoiceSettingsOpen, setIsAudioVoiceSettingsOpen] =
    useState(false);
  const [audioVoiceInstructionsDraft, setAudioVoiceInstructionsDraft] =
    useState("");
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
  const scriptActionMenuDragRef = useRef<ScriptActionMenuDragState | null>(null);
  const scriptActionMenuRef = useRef<HTMLDivElement | null>(null);
  const scriptAudioMenuRef = useRef<HTMLDivElement | null>(null);
  const audioScriptTextareaFocusedRef = useRef(false);
  const audioScriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const audioVoiceInstructionsRef = useRef<HTMLInputElement | null>(null);
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
    isScriptAudioInventoryLoaded,
    loadScriptAudioItems,
    playScriptAudioPreview,
    playingScriptAudioId,
    saveScriptAudioDisplayTranscript,
    saveScriptAudioVoiceInstructionsOverride,
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
  const activeAudioDefaultVoiceInstructions =
    activeScriptAudioItem?.defaultVoiceInstructions ?? tutorForm.voiceInstructions;
  const activeAudioVoiceInstructionsOverride =
    activeScriptAudioItem?.voiceInstructionsOverride ?? "";
  const activeAudioVoiceInstructions =
    activeAudioVoiceInstructionsOverride || activeAudioDefaultVoiceInstructions;
  const activeAudioVoiceSettingsStepId = activeScriptStep?.id ?? "";
  const activeAudioHasCustomVoiceInstructions = Boolean(
    activeScriptAudioItem?.hasVoiceInstructionsOverride,
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
  const activeScriptActionTimingWords = useMemo(
    () =>
      alignScriptWordsToDisplaySlots(
        activeDisplaySlots,
        activeScriptAudioItem?.timingWords ?? [],
      ),
    [activeScriptActionViewKey, activeScriptAudioItem?.timingWords],
  );
  const activeScriptActionView = useMemo(
    () =>
      projectScriptActionsToDisplayText({
        displayBreaks: activeDisplayEditorBreaks,
        displaySlots: activeDisplaySlots,
        markers: activeScriptMarkers,
        sourceText: activeScriptText,
        timingWords: activeScriptActionTimingWords,
      }),
    [
      activeScriptActionViewKey,
      activeScriptMarkers,
      activeScriptActionTimingWords,
      activeScriptText,
    ],
  );
  const activeScriptSlideRefs = useMemo(
    () =>
      Array.from(
        new Set(
          activeScriptActionView.rows
            .map((row) => row.slideRef.trim())
            .filter(Boolean),
        ),
      ),
    [activeScriptActionView.rows],
  );
  const canRefreshActiveScriptSlides =
    Boolean(activeScriptDeckUrl.trim()) && activeScriptSlideRefs.length > 0;
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

  useEffect(() => {
    setAudioVoiceInstructionsDraft(activeAudioVoiceInstructions);
  }, [
    activeAudioVoiceInstructions,
    activeAudioVoiceSettingsStepId,
    activeScriptAudioItem?.id,
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

  useLayoutEffect(() => {
    if (!scriptActionMenu) return;

    const menuElement = scriptActionMenuRef.current;
    if (!menuElement) return;

    const rect = menuElement.getBoundingClientRect();
    const nextPosition = clampFloatingMenuPosition(
      scriptActionMenu.x,
      scriptActionMenu.y,
      rect.width,
      rect.height,
    );

    if (
      nextPosition.x === scriptActionMenu.x &&
      nextPosition.y === scriptActionMenu.y
    ) {
      return;
    }

    setScriptActionMenu((current) =>
      current
        ? {
            ...current,
            ...nextPosition,
          }
        : current,
    );
  }, [
    isLoadingScriptImages,
    isScriptImagePickerOpen,
    scriptActionMenu,
    scriptImageOptions.length,
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
    if (!scriptActionMenu) return;

    function moveWhileDragging(event: PointerEvent) {
      const dragState = scriptActionMenuDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      moveScriptActionMenuToPointer(event.clientX, event.clientY);
    }

    function stopDragging(event: PointerEvent) {
      const dragState = scriptActionMenuDragRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      scriptActionMenuDragRef.current = null;
    }

    window.addEventListener("pointermove", moveWhileDragging);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", moveWhileDragging);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [scriptActionMenu]);

  useLayoutEffect(() => {
    if (!scriptAudioMenu) return;

    const menuElement = scriptAudioMenuRef.current;
    if (!menuElement) return;

    const rect = menuElement.getBoundingClientRect();
    const nextPosition = clampFloatingMenuPosition(
      scriptAudioMenu.x,
      scriptAudioMenu.y,
      rect.width,
      rect.height,
    );
    if (
      nextPosition.x === scriptAudioMenu.x &&
      nextPosition.y === scriptAudioMenu.y
    ) {
      return;
    }
    setScriptAudioMenu(nextPosition);
  }, [scriptAudioMenu]);

  useEffect(() => {
    if (!scriptAudioMenu) return;

    function closeIfOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && scriptAudioMenuRef.current?.contains(target)) return;
      setScriptAudioMenu(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setScriptAudioMenu(null);
    }

    document.addEventListener("pointerdown", closeIfOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [scriptAudioMenu]);

  function resolveScriptSlidePreview(
    deckUrl: string,
    slideRef: string,
    forceRefresh = false,
  ) {
    const previewKey = slidePreviewKeyForDeck(deckUrl, slideRef);
    setScriptSlidePreviews((current) => ({
      ...current,
      [previewKey]: { status: "loading" },
    }));

    return apiFetch<ResolvedSlide>("/api/slides/resolve/", {
      method: "POST",
      body: JSON.stringify({ deckUrl, forceRefresh, slideRef }),
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
              error instanceof Error ? error.message : "Could not load slide.",
            status: "error",
          },
        }));
      });
  }

  async function refreshActiveScriptSlidePreviews() {
    const deckUrl = activeScriptDeckUrl.trim();
    if (!deckUrl || !activeScriptSlideRefs.length || isRefreshingScriptSlides) {
      return;
    }

    setIsRefreshingScriptSlides(true);
    try {
      await Promise.all(
        activeScriptSlideRefs.map((slideRef) =>
          resolveScriptSlidePreview(deckUrl, slideRef, true),
        ),
      );
    } finally {
      setIsRefreshingScriptSlides(false);
    }
  }

  useEffect(() => {
    if (
      activeScriptDetailTab !== "script" &&
      activeScriptDetailTab !== "fine-tuning"
    ) {
      return;
    }

    const deckUrl = activeScriptDeckUrl.trim();
    if (!deckUrl || !activeScriptSlideRefs.length) return;

    activeScriptSlideRefs.forEach((slideRef) => {
      const previewKey = slidePreviewKeyForDeck(deckUrl, slideRef);
      const currentPreview = scriptSlidePreviews[previewKey];
      if (
        currentPreview?.status === "loading" ||
        currentPreview?.status === "ready"
      ) {
        return;
      }

      void resolveScriptSlidePreview(deckUrl, slideRef);
    });
  }, [
    activeScriptDeckUrl,
    activeScriptDetailTab,
    activeScriptSlideRefs,
  ]);

  useEffect(() => {
    if (!isScriptAudioInventoryLoaded) return;
    if (!activeScriptAudioItem) return;

    if (
      (activeScriptDetailTab === "display" ||
        activeScriptDetailTab === "fine-tuning") &&
      !activeScriptAudioReady
    ) {
      setActiveScriptDetailTab("audio");
    }
  }, [
    activeScriptAudioItem,
    activeScriptAudioReady,
    activeScriptDetailTab,
    isScriptAudioInventoryLoaded,
  ]);

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

  useEffect(() => {
    if (isTutorSettingsOpen) return;
    setIsTutorAvatarPickerOpen(false);
  }, [isTutorSettingsOpen]);

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
    : "Upload tutor image";

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

  async function syncDslActionStepsFromSource({
    eventPathId,
    experiencePathId,
    includeChatActions = false,
    includeScriptActions = false,
    latestEvent,
    source,
    sourceLabel,
  }: {
    eventPathId: string;
    experiencePathId: string;
    includeChatActions?: boolean;
    includeScriptActions?: boolean;
    latestEvent: ExperienceEvent;
    source: string;
    sourceLabel: string;
  }) {
    const nextActions = parsePythonDslStepActions(source).filter((action) => {
      if (action.actionType === "chat_availability") return includeChatActions;
      if (action.actionType === "script") return includeScriptActions;
      return true;
    });
    const existingContextSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "set_context" &&
        step.config.source === sourceLabel,
    );
    const existingGotoSteps = sortedEventSteps(latestEvent.steps).filter(
      (step) =>
        step.actionType === "goto_event" &&
        step.config.source === sourceLabel,
    );
    const existingChatSteps = includeChatActions
      ? sortedEventSteps(latestEvent.steps).filter(
          (step) => step.actionType === "chat_availability",
        )
      : [];
    const existingScriptSteps = includeScriptActions
      ? sortedScriptSteps(latestEvent)
      : [];
    let contextIndex = 0;
    let gotoIndex = 0;
    let chatIndex = 0;
    let scriptIndex = 0;
    let nextEvent = latestEvent;
    const desiredStepIds: string[] = [];

    async function upsertDslStep(
      existingStep: EventActionStep | undefined,
      stepPayload: {
        actionType: EventActionStep["actionType"];
        condition: Record<string, unknown>;
        config: Record<string, unknown>;
        enabled: boolean;
        label: string;
      },
    ) {
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
        return payload.step;
      }

      const payload = await apiFetch<{
        event: ExperienceEvent;
        step: EventActionStep;
      }>(`/api/experiences/${experiencePathId}/events/${eventPathId}/steps/`, {
        method: "POST",
        body: JSON.stringify(stepPayload),
      });
      nextEvent = payload.event;
      return payload.step;
    }

    for (const action of nextActions) {
      if (action.actionType === "script") {
        const existingStep = existingScriptSteps[scriptIndex];
        scriptIndex += 1;
        const step = await upsertDslStep(existingStep, {
          actionType: "script",
          condition: existingStep?.condition ?? {},
          config: existingStep?.config ?? { deckUrl: "", text: "" },
          enabled: true,
          label: existingStep?.label || "Script",
        });
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "chat_availability") {
        const step = await upsertDslStep(existingChatSteps[chatIndex], {
          actionType: "chat_availability",
          condition: {},
          config: { enabled: action.enabled },
          enabled: true,
          label: "Set chat availability",
        });
        chatIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "set_context") {
        const step = await upsertDslStep(existingContextSteps[contextIndex], {
          actionType: "set_context",
          condition: {},
          config: {
            key: action.key,
            source: sourceLabel,
            value: action.value,
          },
          enabled: true,
          label: `Set ${action.key}`,
        });
        contextIndex += 1;
        desiredStepIds.push(step.id);
        continue;
      }

      if (action.actionType === "goto_event") {
        const step = await upsertDslStep(existingGotoSteps[gotoIndex], {
          actionType: "goto_event",
          condition: {},
          config: {
            source: sourceLabel,
            triggersEvent: action.triggersEvent,
          },
          enabled: true,
          label: `Go to ${action.triggersEvent}`,
        });
        gotoIndex += 1;
        desiredStepIds.push(step.id);
      }
    }

    const extraSteps = [
      ...existingChatSteps.slice(chatIndex),
      ...existingContextSteps.slice(contextIndex),
      ...existingGotoSteps.slice(gotoIndex),
    ];

    if (
      !desiredStepIds.length &&
      extraSteps.length > 0 &&
      extraSteps.length === nextEvent.steps.length
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
      nextEvent = payload.event;
    }

    for (const extraStep of extraSteps) {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/${encodeURIComponent(
          extraStep.id,
        )}/`,
        { method: "DELETE" },
      );
      nextEvent = payload.event;
    }

    if (desiredStepIds.length) {
      const desiredStepIdSet = new Set(desiredStepIds);
      const remainingStepIds = sortedEventSteps(nextEvent.steps)
        .map((step) => step.id)
        .filter((stepId) => !desiredStepIdSet.has(stepId));
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experiencePathId}/events/${eventPathId}/steps/reorder/`,
        {
          method: "POST",
          body: JSON.stringify({
            stepIds: [...desiredStepIds, ...remainingStepIds],
          }),
        },
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

      latestEvent = await syncDslActionStepsFromSource({
        eventPathId,
        experiencePathId,
        includeChatActions: true,
        includeScriptActions: true,
        latestEvent,
        source: pending.source,
        sourceLabel: onEntryDslStepSource,
      });

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

      latestEvent = await syncDslActionStepsFromSource({
        eventPathId: encodeURIComponent(pending.eventId),
        experiencePathId: encodeURIComponent(experience.id),
        latestEvent,
        source: pending.source,
        sourceLabel: conversationDslStepSource,
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

  async function saveActiveAudioVoiceInstructionsOverride() {
    const item = activeScriptAudioItem;
    if (!item) return;

    const normalizedDraft = audioVoiceInstructionsDraft.trim();
    const normalizedDefault = activeAudioDefaultVoiceInstructions.trim();
    const currentOverride = activeAudioVoiceInstructionsOverride.trim();
    const nextOverride =
      normalizedDraft && normalizedDraft !== normalizedDefault
        ? normalizedDraft
        : "";
    if (nextOverride === currentOverride) return;

    await saveScriptAudioVoiceInstructionsOverride(item.id, nextOverride);
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

    const position = clampFloatingMenuPosition(event.clientX, event.clientY, 290, 180);
    setScriptActionMenu({
      insertionIndex,
      mode: "insert",
      ...position,
    });
  }

  function openScriptMarkerMenu(
    marker: ScriptMarkerInstance,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const position = clampFloatingMenuPosition(event.clientX, event.clientY, 320, 300);
    setScriptActionMenu({
      markerKey: markerEditKey(marker),
      mode: "edit",
      ...position,
    });
  }

  function beginScriptActionMenuDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!scriptActionMenu || event.button > 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scriptActionMenuDragRef.current = {
      menuX: scriptActionMenu.x,
      menuY: scriptActionMenu.y,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function moveScriptActionMenuToPointer(clientX: number, clientY: number) {
    const dragState = scriptActionMenuDragRef.current;
    if (!dragState) return;

    const rect = scriptActionMenuRef.current?.getBoundingClientRect();
    const nextPosition = clampFloatingMenuPosition(
      dragState.menuX + clientX - dragState.startX,
      dragState.menuY + clientY - dragState.startY,
      rect?.width ?? 290,
      rect?.height ?? 260,
    );
    setScriptActionMenu((current) =>
      current
        ? {
            ...current,
            ...nextPosition,
          }
        : current,
    );
  }

  function moveScriptActionMenuDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const dragState = scriptActionMenuDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    moveScriptActionMenuToPointer(event.clientX, event.clientY);
  }

  function endScriptActionMenuDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const dragState = scriptActionMenuDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scriptActionMenuDragRef.current = null;
  }

  function insertScriptAction(type: "slide" | "side-image" | "sound") {
    if (!activeScriptStep || scriptActionMenu?.mode !== "insert") return;

    let marker = buildScriptMarker("play_sound", [
      scriptSoundOptions[0].path,
      "0.5",
    ]);
    if (type === "slide") {
      marker = buildScriptMarker("gslide", [
        nextSlideRefAfterInsertion(
          activeScriptMarkers,
          scriptActionMenu.insertionIndex,
        ),
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
    const nextMarker = buildScriptMarker(
      marker.type,
      appendScriptMarkerTimelineArg(args, marker.timeMs),
    );
    const currentMarkerKey = markerEditKey(marker);
    const nextMarkerKey = markerEditKeyFrom(
      marker.start,
      marker.start + nextMarker.length,
      nextMarker,
    );

    updateActiveScriptMarkedText(
      replaceScriptMarker(activeScriptText, marker, nextMarker),
    );
    setScriptActionMenu((current) => {
      if (
        current?.mode !== "edit" ||
        current.markerKey !== currentMarkerKey
      ) {
        return current;
      }

      return {
        ...current,
        markerKey: nextMarkerKey,
      };
    });
  }

  function moveScriptActionMarker(
    marker: ScriptActionViewMarker,
    targetSourceIndex: number,
  ) {
    if (!activeScriptStep) return null;

    const sourceMarker = sourceMarkerForView(marker);
    const insertionIndex = Math.round(
      clamp(targetSourceIndex, 0, activeScriptText.length),
    );
    if (
      insertionIndex >= sourceMarker.start &&
      insertionIndex <= sourceMarker.end
    ) {
      return viewMarkerEditKey(marker);
    }

    const markerWithoutTimeline = buildScriptMarker(
      sourceMarker.type,
      sourceMarker.argList,
    );
    const textWithoutMarker = `${activeScriptText.slice(
      0,
      sourceMarker.start,
    )}${activeScriptText.slice(sourceMarker.end)}`;
    const adjustedInsertionIndex =
      insertionIndex > sourceMarker.start
        ? insertionIndex - sourceMarker.marker.length
        : insertionIndex;
    const beforeInsertion = textWithoutMarker.slice(0, adjustedInsertionIndex);
    const afterInsertion = textWithoutMarker.slice(adjustedInsertionIndex);
    const prefix =
      beforeInsertion && !/\s$/.test(beforeInsertion) ? " " : "";
    const suffix =
      afterInsertion && !/^\s/.test(afterInsertion) ? " " : "";
    const nextMarkerStart = beforeInsertion.length + prefix.length;
    const nextMarkerEnd = nextMarkerStart + markerWithoutTimeline.length;

    updateActiveScriptMarkedText(
      `${beforeInsertion}${prefix}${markerWithoutTimeline}${suffix}${afterInsertion}`,
    );
    setScriptActionMenu(null);
    setActiveScriptDetailTab("script");
    return markerEditKeyFrom(
      nextMarkerStart,
      nextMarkerEnd,
      markerWithoutTimeline,
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

  function openScriptAudioMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!activeScriptAudioItem) return;

    setScriptActionMenu(null);
    setScriptAudioMenu(
      clampFloatingMenuPosition(event.clientX, event.clientY, 220, 48),
    );
  }

  async function regenerateActiveScriptAudio() {
    setScriptAudioMenu(null);

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

  function handleRegenerateScriptAudioMenuClick(
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    void regenerateActiveScriptAudio();
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
      const payload = await apiFetch<{ images: ImageLibraryOption[] }>(
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

  function selectTutorAvatar(imagePath: string) {
    updateTutorDraft("avatarPath", imagePath);
    setIsTutorAvatarPickerOpen(false);
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
        images: ImageLibraryOption[];
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
      const payload = await apiFetch<{
        imagePath: string;
        images: ImageLibraryOption[];
      }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/script-images/`,
        {
          method: "POST",
          body: formData,
        },
      );

      setScriptImageOptions(payload.images);
      updateTutorDraft("avatarPath", payload.imagePath);
      setIsTutorAvatarPickerOpen(false);
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

  async function deleteUploadedScriptImage(imagePath: string, label: string) {
    if (!experience || !imagePath) return;

    const didConfirm = window.confirm(
      `Delete "${label || imagePath}" from uploaded images? Existing scripts that use it may need a new image.`,
    );
    if (!didConfirm) return;

    setError("");
    setDeletingScriptImagePath(imagePath);
    try {
      const payload = await apiFetch<{
        deletedImagePath: string;
        images: ImageLibraryOption[];
      }>(
        `/api/experiences/${encodeURIComponent(experience.id)}/script-images/`,
        {
          method: "DELETE",
          body: JSON.stringify({ imagePath }),
        },
      );

      setScriptImageOptions(payload.images);
      if (editingScriptMarker && editingSideImageState?.imagePath === imagePath) {
        replaceScriptActionMarker(
          editingScriptMarker,
          sideImageActionArgs({
            ...editingSideImageState,
            imagePath: "",
          }),
        );
      }
      if (tutorForm.avatarPath === imagePath) {
        updateTutorDraft("avatarPath", defaultSideImagePath);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete script image.",
      );
    } finally {
      setDeletingScriptImagePath((current) =>
        current === imagePath ? "" : current,
      );
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
            data-tooltip="Ctrl-click chat actions to toggle on/off. Ctrl-click goto destinations to choose an event. Click script actions to open their panel."
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
            activeScriptAction={
              activeScriptAction?.eventId === selectedEvent.id
                ? activeScriptAction
                : null
            }
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
        <label className="next-conversation-context-field">
          <span>extra conversation context</span>
          <textarea
            aria-label="Extra conversation context"
            className="next-conversation-context-text"
            onChange={(event) =>
              updateSelectedEventDraft("chatInstructions", event.target.value)
            }
            onInput={(event) => resizeTextareaToContent(event.currentTarget)}
            ref={selectedEventChatInstructionsRef}
            rows={1}
            value={selectedEvent.chatInstructions ?? ""}
          />
        </label>
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
  const activeScriptAudioRegenerateDisabled =
    !activeScriptAudioItem ||
    !activeScriptAudioItem.canGenerate ||
    scriptAudioStatus === "generating";
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
  const tutorAvatarPickerOptions = (() => {
    const currentPath = tutorForm.avatarPath.trim();
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
            onContextMenu={openScriptAudioMenu}
            title={`${activeScriptAudioPreviewLabel}. Right-click for audio options.`}
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
              onContextMenu={openScriptAudioMenu}
              role="tab"
              title="Right-click for audio options."
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
          <div
            className={[
              "next-audio-script-panel",
              isAudioVoiceSettingsOpen ? "has-voice-settings" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="next-audio-script-toolbar">
              {activeAudioHasCustomVoiceInstructions ? (
                <span>custom personality and tone</span>
              ) : null}
              <button
                aria-label="Audio script personality and tone"
                aria-expanded={isAudioVoiceSettingsOpen}
                aria-pressed={isAudioVoiceSettingsOpen}
                className={[
                  "next-script-voice-settings-button",
                  activeAudioHasCustomVoiceInstructions ? "has-custom" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!activeScriptAudioItem}
                onClick={() =>
                  setIsAudioVoiceSettingsOpen((current) => !current)
                }
                title={
                  activeAudioHasCustomVoiceInstructions
                    ? "Custom personality and tone for this audio script"
                    : "Personality and tone for this audio script"
                }
                type="button"
              >
                <SettingsIcon />
              </button>
            </div>
            <div
              aria-hidden={!isAudioVoiceSettingsOpen}
              className={[
                "next-script-voice-panel",
                isAudioVoiceSettingsOpen ? "is-open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                aria-label="Audio script personality and tone"
                className="next-script-voice-input"
                disabled={!activeScriptAudioItem || !isAudioVoiceSettingsOpen}
                onBlur={() => void saveActiveAudioVoiceInstructionsOverride()}
                onChange={(event) =>
                  setAudioVoiceInstructionsDraft(event.currentTarget.value)
                }
                onContextMenu={(event) => event.stopPropagation()}
                ref={audioVoiceInstructionsRef}
                spellCheck
                tabIndex={isAudioVoiceSettingsOpen ? 0 : -1}
                type="text"
                value={audioVoiceInstructionsDraft}
              />
            </div>
            <div className="next-script-textarea-shell">
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
            </div>
          </div>
        ) : activeScriptDetailTab === "script" ? (
          <ScriptActionReadOnlyView
            actionRows={activeScriptActionView.rows}
            canRefreshSlides={canRefreshActiveScriptSlides}
            deckUrl={activeScriptDeckUrl}
            displayBreaks={[]}
            isRefreshingSlides={isRefreshingScriptSlides}
            markers={activeScriptActionView.markers}
            onDeckUrlChange={updateActiveScriptDeckUrl}
            onOpenInsert={openScriptInsertMenu}
            onOpenMarker={openScriptMarkerMenu}
            onMoveMarker={moveScriptActionMarker}
            onRefreshSlides={refreshActiveScriptSlidePreviews}
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
            canRefreshSlides={canRefreshActiveScriptSlides}
            isRefreshingSlides={isRefreshingScriptSlides}
            onBeforePlaybackStart={stopScriptAudioPreview}
            onDisplayCueOffsetsChange={(offsets) =>
              void updateActiveDisplayCueOffsets(offsets)
            }
            onMarkedTextChange={updateActiveScriptMarkedText}
            onRefreshSlides={refreshActiveScriptSlidePreviews}
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
        {scriptActionMenu && typeof document !== "undefined" ? (
          createPortal(
          <div
            className="next-script-action-popover"
            ref={scriptActionMenuRef}
            role="menu"
            style={{ left: scriptActionMenu.x, top: scriptActionMenu.y }}
          >
            <button
              aria-label="Move action menu"
              className="next-script-action-popover-grip"
              onPointerCancel={endScriptActionMenuDrag}
              onPointerDown={beginScriptActionMenuDrag}
              onPointerMove={moveScriptActionMenuDrag}
              onPointerUp={endScriptActionMenuDrag}
              title="Drag to move"
              type="button"
            >
              <span aria-hidden="true" />
            </button>
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
                          <ImageLibraryPicker
                            ariaLabel="Interface image options"
                            classNames={{
                              deleteButton:
                                "next-script-image-delete-button",
                              empty: "next-script-image-picker-empty",
                              option: "next-script-image-option",
                              optionMain: "next-script-image-option-main",
                              picker: "next-script-image-picker",
                            }}
                            deletingPath={deletingScriptImagePath}
                            emptyLabel="No images yet"
                            isLoading={isLoadingScriptImages}
                            onDelete={(path, label) =>
                              void deleteUploadedScriptImage(path, label)
                            }
                            onSelect={selectScriptImage}
                            options={scriptImagePickerOptions}
                            selectedPath={editingSideImageState.imagePath}
                          />
                        ) : null}
                      </div>
                    </div>
                    <label>
                      <span>Scale</span>
                      <input
                        aria-label="Interface image scale"
                        max={sideImageScaleMax}
                        min={sideImageScaleMin}
                        onChange={(event) =>
                          replaceScriptActionMarker(
                            editingScriptMarker,
                            sideImageActionArgs({
                              ...editingSideImageState,
                              scale: normalizeSideImageScale(
                                event.target.value,
                              ),
                              scaleText: event.target.value,
                            }),
                          )
                        }
                        inputMode="decimal"
                        step="0.05"
                        type="text"
                        value={editingSideImageState.scaleText}
                      />
                    </label>
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
          </div>,
            document.body,
          )
        ) : null}
        {scriptAudioMenu && typeof document !== "undefined" ? (
          createPortal(
            <div
              aria-label="Audio options"
              className="next-script-audio-menu"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              ref={scriptAudioMenuRef}
              role="menu"
              style={{ left: scriptAudioMenu.x, top: scriptAudioMenu.y }}
            >
              <button
                disabled={activeScriptAudioRegenerateDisabled}
                onClick={handleRegenerateScriptAudioMenuClick}
                role="menuitem"
                type="button"
              >
                {activeScriptAudioRegenerateDisabled
                  ? "Regenerate unavailable"
                  : "Regenerate audio"}
              </button>
            </div>,
            document.body,
          )
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
                    <span>Image</span>
                    <div className="next-tutor-avatar-control">
                      <button
                        aria-expanded={isTutorAvatarPickerOpen}
                        aria-label="Choose tutor image"
                        className="next-tutor-avatar-preview-button"
                        onClick={() => {
                          setIsTutorAvatarPickerOpen((isOpen) => !isOpen);
                          if (
                            !isTutorAvatarPickerOpen &&
                            !scriptImageOptions.length &&
                            !isLoadingScriptImages &&
                            experience
                          ) {
                            void loadScriptImages(experience.id);
                          }
                        }}
                        title="Choose tutor image"
                        type="button"
                      >
                        <img alt="" src={publicAsset(tutorForm.avatarPath)} />
                      </button>
                      <button
                        className="next-tutor-avatar-upload-button"
                        disabled={isUploadingTutorAvatar}
                        onClick={() => tutorAvatarFileInputRef.current?.click()}
                        title={tutorAvatarUploadLabel}
                        type="button"
                      >
                        {isUploadingTutorAvatar ? "Uploading" : "Upload"}
                      </button>
                      {isTutorAvatarPickerOpen ? (
                        <ImageLibraryPicker
                          ariaLabel="Tutor image options"
                          classNames={{
                            deleteButton: "next-tutor-avatar-delete-button",
                            empty: "next-tutor-avatar-picker-empty",
                            option: "next-tutor-avatar-option",
                            optionMain: "next-tutor-avatar-option-main",
                            picker: "next-tutor-avatar-picker",
                          }}
                          deletingPath={deletingScriptImagePath}
                          emptyLabel="No images yet"
                          isLoading={isLoadingScriptImages}
                          onDelete={(path, label) =>
                            void deleteUploadedScriptImage(path, label)
                          }
                          onSelect={selectTutorAvatar}
                          options={tutorAvatarPickerOptions}
                          selectedPath={tutorForm.avatarPath}
                        />
                      ) : null}
                    </div>
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
