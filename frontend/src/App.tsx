import {
  type CSSProperties,
  type DragEvent,
  type Dispatch,
  type FocusEvent,
  type FormEvent,
  Fragment,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DluRealtimeConnection,
  type RealtimeModelId,
  type RealtimeStatus,
  type RealtimeToolCall,
  type RealtimeVoiceId,
  isRealtimeVoiceSupported,
  realtimeModelOptions,
  realtimeVoiceOptionsForModel,
} from "./realtime";
import {
  cloneMainPanelAppConfig,
  defaultMainPanelApp,
  getMainPanelAppDefinition,
  mainPanelAppDefinitions,
  type MainPanelAppConfigField,
  type MainPanelAppHost,
  type RuntimeInteractive,
} from "./mainPanelApps";

const classificationModelOptions = [
  { id: "gpt-5.4-mini", label: "5.4 mini" },
  { id: "gpt-5.4-nano", label: "5.4 nano" },
  { id: "gpt-5.4", label: "5.4" },
  { id: "gpt-5.5", label: "5.5" },
  { id: "gpt-5.5-pro", label: "5.5 pro" },
] as const;

type ClassificationModelId = string;

const leftPanels = [
  { density: "tall", kind: "experience", label: "Experience" },
  { density: "tutor", kind: "tutor", label: "Tutor settings" },
  { density: "compact", kind: "slides", label: "Slide controls" },
  { density: "compact", kind: "checks", label: "Left panel four" },
] as const;

const rowDividerHeight = 12;
const minMainPanelHeight = 120;
const minLowerPanelHeight = 170;
const defaultLowerPanelHeight = 300;
const standardWorkspaceWidth = 1180;
const minWorkspaceWidth = 860;
const maxWorkspaceWidth = 1800;
const panelLayoutStorageKey = "dlu.panel-layout.v1";
const slideSettingsStorageKey = "dlu.slide-settings.v1";
const experienceSelectionStorageKey = "dlu.selected-experience.v1";
const experienceAutosaveDelayMs = 700;
const editorUndoLimit = 80;
const scriptTextStreamFallbackMs = 7000;
const scriptTextStreamMinMs = 1400;
const scriptTextStreamMaxMs = 16000;
const scriptImmediateCueProgress = 0.001;
const sampleSlideDeckUrl =
  "https://docs.google.com/presentation/d/1laLiG097c6sTnRqTEMYSclNNgGPRqkvTVM_6BSUuj3k/";
const tutorAvatarOptions = [
  { label: "dLU right", path: "test-images/dLU-right.png" },
  { label: "dLU left", path: "test-images/dLU-left.png" },
] as const;
const eventActionOptions = [
  { id: "script", label: "Say" },
  { id: "set_context", label: "Set context" },
  { id: "append_context_list", label: "Append context" },
  { id: "get_ui_state", label: "Read UI" },
  { id: "highlight_on", label: "Highlight" },
  { id: "highlight_off", label: "Clear highlight" },
  { id: "interactive", label: "Main panel app" },
  { id: "interactive_update", label: "Update app" },
  { id: "set_ui_trigger", label: "UI trigger" },
  { id: "goto_event", label: "Go to event" },
  { id: "button_choice", label: "Button choice" },
] as const;
const scriptMarkerOptions = [
  {
    label: "Slide",
    marker: "[gslide: 1]",
    title: "Insert a timed Google slide change at the cursor.",
  },
  {
    label: "Highlight",
    marker: "[highlight_on: .runtime-notes-toggle, rgba(59, 130, 246, 0.6)]",
    title: "Insert a timed highlight at the cursor.",
  },
  {
    label: "Clear highlight",
    marker: "[highlight_off: .runtime-notes-toggle]",
    title: "Clear a highlight at this point in the script.",
  },
  {
    label: "App",
    marker: "[interactive: delivery_data, table]",
    title:
      "Mount a registered app. Add a third argument to route on submit, like [interactive: delivery_data, table, next_event].",
  },
  {
    label: "Update app",
    marker: "[interactive_update: delivery_data, graph]",
    title: "Update the current main-panel app at this point in the script.",
  },
  {
    label: "Clear app",
    marker: "[interactive_clear]",
    title: "Clear the main-panel app at this point in the script.",
  },
  {
    label: "Pause",
    marker: "[pause: 500]",
    title: "Insert a timed pause marker.",
  },
  {
    label: "Chat off",
    marker: "[chat_off]",
    title: "Pause student typing at this point in the script.",
  },
  {
    label: "Chat on",
    marker: "[chat_on]",
    title: "Allow student typing again at this point in the script.",
  },
] as const;
const chatExitCaptureSaveMapKey = "x-dluCaptureSaves";
const chatExitDisplayTitleKey = "x-dluDisplayTitle";
const scriptMarkerPattern =
  /\[(show_image|slide|gslide|interactive|interactive_update|interactive_clear|highlight|highlight_on|highlight_off|overlay|overlay_off|pause|chat_off|chat_on|add_note|play_sound)(?::\s*[^\]]+)?\]/gi;
const scriptMarkerParsePattern =
  /\[(show_image|slide|gslide|interactive|interactive_update|interactive_clear|highlight|highlight_on|highlight_off|overlay|overlay_off|pause|chat_off|chat_on|add_note|play_sound)(?::\s*([^\]]+))?\]/gi;
const scriptAudioSources = new Set([
  "event-action",
  "conversation-tool-action",
  "conversation-check-action",
  "classifier-group-action",
]);

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type ApiUser = {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

type TutoringSession = {
  id: string;
  experienceId: string;
  title: string;
  runtimeContext?: Record<string, unknown>;
  runtimeState?: Record<string, unknown>;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

type SessionPayload = {
  session: TutoringSession;
  messages: ChatMessage[];
};

type TutorSettings = {
  assistantName: string;
  avatarPath: string;
  classificationModel: ClassificationModelId;
  realtimeModel: RealtimeModelId;
  scriptActionOffsetMs: number;
  systemPrompt: string;
  voice: RealtimeVoiceId;
  voiceInstructions: string;
};

type EventActionStep = {
  id: string;
  eventId: string;
  actionType:
    | "script"
    | "set_context"
    | "append_context_list"
    | "get_ui_state"
    | "highlight_on"
    | "highlight_off"
    | "interactive"
    | "interactive_update"
    | "set_ui_trigger"
    | "goto_event"
    | "button_choice";
  label: string;
  config: Record<string, unknown>;
  condition: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type ActionSequenceStep = {
  actionType: EventActionStep["actionType"];
  condition: Record<string, unknown>;
  config: Record<string, unknown>;
  enabled: boolean;
  id: string;
  label: string;
  sortOrder: number;
};

type EventChatTool = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  handlerActions: ActionSequenceStep[];
  parameters: Record<string, unknown>;
  triggersEvent: string;
  saveArgument: string;
  saveContextKey: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type EventConversationCheck = {
  id: string;
  eventId: string;
  title: string;
  instructions: string;
  resultContextKey: string;
  handlerActions: ActionSequenceStep[];
  triggersEvent: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type EventClassifier = {
  id: string;
  groupId: string;
  name: string;
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
  condition: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type EventClassifierGroup = {
  id: string;
  eventId: string;
  title: string;
  instructions: string;
  resultContextKey: string;
  handlerActions: ActionSequenceStep[];
  triggersEvent: string;
  condition: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
  classifiers: EventClassifier[];
  createdAt: string;
  updatedAt: string;
};

type ExperienceEvent = {
  id: string;
  experienceId: string;
  title: string;
  slug: string;
  description: string;
  chatInstructions: string;
  isStart: boolean;
  sortOrder: number;
  steps: EventActionStep[];
  chatTools: EventChatTool[];
  conversationChecks: EventConversationCheck[];
  classifierGroups: EventClassifierGroup[];
  createdAt: string;
  updatedAt: string;
};

type Experience = {
  id: string;
  title: string;
  slug: string;
  description: string;
  tutor: TutorSettings;
  events: ExperienceEvent[];
  createdAt: string;
  updatedAt: string;
};

type ExperiencesPayload = {
  currentExperienceId: string;
  experiences: Experience[];
};

type ExperienceForm = {
  title: string;
  description: string;
};

type StepConditionDraft = {
  type: "always" | "context_equals" | "custom";
  key: string;
  raw?: Record<string, unknown>;
  value: string;
};

type EventStepDraft = {
  id: string;
  actionType: EventActionStep["actionType"];
  label: string;
  config: Record<string, unknown>;
  condition: StepConditionDraft;
  enabled: boolean;
  sortOrder: number;
};

type EventChatCaptureDraft = {
  description: string;
  id: string;
  saveAs: string;
};

type EventChatToolDraft = {
  captures: EventChatCaptureDraft[];
  description: string;
  enabled: boolean;
  handlerActions: EventStepDraft[];
  id: string;
  name: string;
  sortOrder: number;
  title: string;
  triggersEvent: string;
};

type EventConversationCheckDraft = {
  enabled: boolean;
  handlerActions: EventStepDraft[];
  id: string;
  instructions: string;
  resultContextKey: string;
  sortOrder: number;
  title: string;
  triggersEvent: string;
};

type EventClassifierDraft = {
  condition: StepConditionDraft;
  enabled: boolean;
  id: string;
  model: string;
  name: string;
  prompt: string;
  schema: Record<string, unknown>;
  sortOrder: number;
};

type EventClassifierGroupDraft = {
  classifiers: EventClassifierDraft[];
  condition: StepConditionDraft;
  enabled: boolean;
  handlerActions: EventStepDraft[];
  id: string;
  instructions: string;
  resultContextKey: string;
  sortOrder: number;
  title: string;
  triggersEvent: string;
};

type EventDraft = {
  chatInstructions: string;
  title: string;
  description: string;
  steps: EventStepDraft[];
  chatTools: EventChatToolDraft[];
  conversationChecks: EventConversationCheckDraft[];
  classifierGroups: EventClassifierGroupDraft[];
};

type StartEventPayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  event: ExperienceEvent;
  ran: boolean;
  ranEvents?: ExperienceEvent[];
  ranMessages?: ChatMessage[];
};

type ConversationCheckPayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  checks: Array<Record<string, unknown>>;
  classifierGroups: Array<Record<string, unknown>>;
  handled: boolean;
  ran: boolean;
  ranEvents?: ExperienceEvent[];
  ranMessages?: ChatMessage[];
};

type InteractiveRuntimePayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
};

type RuntimeUiState = {
  interactive?: Record<string, unknown>;
  notesVisible: boolean;
};

type RuntimeHighlight = {
  color: string;
  selector: string;
};

type RuntimeUiTrigger = {
  eventId: string;
  selector: string;
  stepId: string;
  triggersEvent: string;
};

type RuntimeButton = {
  eventId: string;
  label: string;
  stepId: string;
  triggersEvent: string;
};

type RuntimeActionLogEntry = {
  detail: string;
  id: string;
  time: string;
  type: string;
};

type RuntimeDebugTraceEntry = {
  at: string;
  details: Record<string, unknown>;
  summary: string;
  type: string;
};

type EventOutgoingLink = {
  condition?: string;
  kind: string;
  slug: string;
  source: string;
};

type VoiceSampleStatus = "idle" | "loading" | "playing";

type VoiceSamplePayload = {
  audioUrl: string;
  cached: boolean;
  realtimeModel: RealtimeModelId;
  script: string;
  scriptModel: string;
  ttsModel: string;
  voice: RealtimeVoiceId;
};

type MessageAudioPayload = {
  audioUrl: string;
  cached: boolean;
  durationSeconds?: number | null;
  messageId: string;
  realtimeModel: RealtimeModelId;
  scriptCues?: ScriptCue[];
  scriptWords?: ScriptWord[];
  timingModel?: string;
  timingWarning?: string;
  ttsModel: string;
  voice: RealtimeVoiceId;
};

type ScriptAudioItem = {
  audioUrl: string;
  cached: boolean;
  cacheKey: string;
  canGenerate: boolean;
  characterCount?: number;
  durationSeconds: number | null;
  generationReason?: string;
  id: string;
  preview: string;
  realtimeModel?: RealtimeModelId;
  script?: string;
  source: string;
  timingModel?: string;
  ttsModel?: string;
  voice?: RealtimeVoiceId;
  wordCount?: number;
  wordsCached: boolean;
};

type ScriptAudioPayload = {
  errors?: string[];
  generated?: number;
  scripts: ScriptAudioItem[];
  totalScripts: number;
};

type ScriptMarkerInstance = {
  args: string;
  argList: string[];
  detail: string;
  end: number;
  id: string;
  label: string;
  marker: string;
  start: number;
  type: string;
  wordIndex: number;
};

type ScriptCue = {
  action: Record<string, unknown>;
  progress: number;
  time?: number;
  wordIndex?: number;
};

type ScriptWord = {
  end: number;
  start: number;
  word: string;
};

type StoredPanelLayout = {
  leftWidth?: number;
  lowerHeight?: number;
  workspaceWidth?: number;
};

type SlideSettings = {
  deckUrl: string;
  slideRef: string;
};

type ResolvedSlide = {
  cached: boolean;
  imageUrl: string;
  pageId: string;
  presentationId: string;
  slideRef: string;
};

type SlideStatus = "empty" | "loading" | "ready" | "error";

const pythonKeywords = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const pythonBuiltins = new Set([
  "bool",
  "dict",
  "float",
  "int",
  "list",
  "set",
  "str",
  "tuple",
]);

const pythonTokenPattern =
  /("""[\s\S]*?"""|'''[\s\S]*?'''|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_]\w*(?=\()|\b[A-Za-z_]\w*\b|\b\d+(?:\.\d+)?\b|[{}()[\].,:=+\-*/<>!]+)/g;

const realtimeStatusLabels: Record<RealtimeStatus, string> = {
  "audio-blocked": "Audio blocked",
  connected: "Voice ready",
  connecting: "Connecting",
  error: "Voice error",
  idle: "Voice idle",
  streaming: "Speaking",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCookie(name: string) {
  const cookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
}

function getCurrentPath() {
  return `${window.location.pathname}${window.location.search}`;
}

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

function localMessageId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resizeTextareaToContent(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function inlineFieldWidthStyle(
  value: string,
  fallback: string,
  minCh: number,
  maxCh: number,
): CSSProperties {
  const length = (value.trim() || fallback).length + 1;
  return { width: `${clamp(length, minCh, maxCh)}ch` };
}

function countScriptWords(text: string) {
  const words = text.trim().match(/[A-Za-z0-9]+(?:[.'_-][A-Za-z0-9]+)*/g);
  return words?.length ?? 0;
}

function scriptMarkerLabel(type: string) {
  const labels: Record<string, string> = {
    add_note: "Note",
    chat_off: "Chat off",
    chat_on: "Chat on",
    gslide: "Slide",
    highlight: "Highlight",
    highlight_off: "Clear highlight",
    highlight_on: "Highlight",
    interactive: "App",
    interactive_clear: "Clear app",
    interactive_update: "Update app",
    overlay: "Overlay",
    overlay_off: "Clear overlay",
    pause: "Pause",
    play_sound: "Sound",
    show_image: "Image",
    slide: "Slide",
  };
  return labels[type] ?? type;
}

function parseScriptMarkerArgs(argsText: string) {
  if (!argsText.trim()) return [];

  const args: string[] = [];
  let current = "";
  let parenDepth = 0;
  for (const char of argsText) {
    if (char === "(") parenDepth += 1;
    if (char === ")" && parenDepth > 0) parenDepth -= 1;

    if (char === "," && parenDepth === 0) {
      const arg = current.trim();
      if (arg) args.push(arg);
      current = "";
      continue;
    }

    current += char;
  }

  const arg = current.trim();
  if (arg) args.push(arg);
  return args;
}

function scriptMarkerDetail(type: string, args: string, argList: string[]) {
  if (type === "interactive" || type === "interactive_update") {
    const appId = argList[0] ?? "";
    const view = argList[1] ?? "";
    const destination = argList[2] ?? "";
    const appDefinition = getMainPanelAppDefinition(appId);
    const appLabel = appDefinition?.label ?? appId;
    const viewLabel =
      appDefinition?.views.find((item) => item.id === view)?.label ?? view;
    const appDetail = [appLabel, viewLabel].filter(Boolean).join(" / ");
    if (destination) return `${appDetail || "app"} -> ${destination}`;
    return appDetail || args;
  }

  if (type === "interactive_clear") return "";
  return args;
}

function buildScriptMarker(type: string, args: string[]) {
  const trimmedArgs = args.map((arg) => arg.trim());
  let lastValueIndex = -1;
  for (let index = trimmedArgs.length - 1; index >= 0; index -= 1) {
    if (trimmedArgs[index].length > 0) {
      lastValueIndex = index;
      break;
    }
  }
  if (lastValueIndex < 0) return `[${type}]`;
  return `[${type}: ${trimmedArgs.slice(0, lastValueIndex + 1).join(", ")}]`;
}

function parseScriptMarkerInstances(text: string) {
  const markers: ScriptMarkerInstance[] = [];
  const pattern = new RegExp(scriptMarkerParsePattern);

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const marker = match[0];
    const type = (match[1] ?? "").toLowerCase();
    const args = (match[2] ?? "").trim();
    const argList = parseScriptMarkerArgs(args);
    const spokenBefore = text.slice(0, start).replace(scriptMarkerPattern, " ");
    markers.push({
      args,
      argList,
      detail: scriptMarkerDetail(type, args, argList),
      end: start + marker.length,
      id: `${start}-${marker}`,
      label: scriptMarkerLabel(type),
      marker,
      start,
      type,
      wordIndex: countScriptWords(spokenBefore),
    });
  }

  return markers;
}

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((left, right) => left.sequence - right.sequence);
}

function scriptStreamDurationMs(text: string, audioDurationSeconds?: number) {
  if (
    typeof audioDurationSeconds === "number" &&
    Number.isFinite(audioDurationSeconds) &&
    audioDurationSeconds > 0
  ) {
    return clamp(audioDurationSeconds * 1000, scriptTextStreamMinMs, scriptTextStreamMaxMs);
  }

  return clamp(text.length * 42, scriptTextStreamMinMs, scriptTextStreamFallbackMs);
}

function scriptStreamIndexAt(text: string, progress: number) {
  if (progress >= 1) return text.length;

  const rawIndex = Math.max(1, Math.floor(text.length * progress));
  const nextWhitespace = text.slice(rawIndex).search(/\s/);
  if (nextWhitespace >= 0 && nextWhitespace <= 14) {
    return Math.min(text.length, rawIndex + nextWhitespace + 1);
  }

  return rawIndex;
}

type ScriptWordRevealPoint = {
  index: number;
  time: number;
};

function scriptWordRevealPoints(text: string, words: ScriptWord[]) {
  const textWords = [...text.matchAll(/\S+/g)];
  const pointCount = Math.min(textWords.length, words.length);
  const points: ScriptWordRevealPoint[] = [];

  for (let index = 0; index < pointCount; index += 1) {
    const match = textWords[index];
    const matchIndex = match.index ?? 0;
    let revealIndex = matchIndex + match[0].length;
    while (revealIndex < text.length && /\s/.test(text[revealIndex])) {
      revealIndex += 1;
    }
    points.push({
      index: revealIndex,
      time: words[index].start,
    });
  }

  if (points.length && points[points.length - 1].index < text.length) {
    points.push({
      index: text.length,
      time: words[Math.min(pointCount, words.length) - 1]?.end ?? 0,
    });
  }

  return points;
}

function scriptStreamIndexAtAudioTime(points: ScriptWordRevealPoint[], time: number) {
  if (!points.length) return 0;

  let nextIndex = 0;
  for (const point of points) {
    if (time + 0.015 < point.time) break;
    nextIndex = point.index;
  }
  return nextIndex;
}

function spokenScriptText(text: string) {
  return text.replace(scriptMarkerPattern, " ").replace(/\s+/g, " ").trim();
}

function getStartEvent(experience: Experience | null) {
  if (!experience) return null;
  return (
    experience.events.find((event) => event.isStart) ??
    experience.events[0] ??
    null
  );
}

function sortedExperienceEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function getSelectedExperienceEvent(
  experience: Experience | null,
  eventId: string,
) {
  if (!experience) return null;

  return (
    experience.events.find((event) => event.id === eventId) ??
    getStartEvent(experience)
  );
}

function sortedEventSteps(steps: EventActionStep[]) {
  return [...steps].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function sortedActionSequenceSteps(steps: ActionSequenceStep[] = []) {
  return [...steps].sort((left, right) => left.sortOrder - right.sortOrder);
}

function sortedEventChatTools(tools: EventChatTool[]) {
  return [...tools].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function sortedEventConversationChecks(checks: EventConversationCheck[]) {
  return [...checks].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function sortedEventClassifierGroups(groups: EventClassifierGroup[]) {
  return [...groups].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function sortedEventClassifiers(classifiers: EventClassifier[]) {
  return [...classifiers].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function stringConfigValue(
  config: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function numberConfigValue(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function conditionDraftFromStep(step: ActionSequenceStep): StepConditionDraft {
  const conditionType = step.condition?.type;
  if (conditionType === "context_equals") {
    return {
      key: stringConfigValue(step.condition, "key"),
      type: "context_equals",
      value: stringConfigValue(step.condition, "value"),
    };
  }

  if (conditionType && conditionType !== "always") {
    return {
      key: "",
      raw: step.condition,
      type: "custom",
      value: "",
    };
  }

  return {
    key: "",
    type: "always",
    value: "",
  };
}

function conditionDraftFromRecord(
  condition: Record<string, unknown> = {},
): StepConditionDraft {
  return conditionDraftFromStep({
    actionType: "script",
    condition,
    config: {},
    enabled: true,
    id: "condition",
    label: "",
    sortOrder: 0,
  });
}

function stepDraftFromStep(step: ActionSequenceStep): EventStepDraft {
  return {
    actionType: step.actionType,
    condition: conditionDraftFromStep(step),
    config: step.config,
    enabled: step.enabled,
    id: step.id,
    label: step.label,
    sortOrder: step.sortOrder,
  };
}

function toolCaptureDraftsFromTool(tool: EventChatTool): EventChatCaptureDraft[] {
  const parameters = tool.parameters;
  const properties =
    parameters.properties &&
    typeof parameters.properties === "object" &&
    !Array.isArray(parameters.properties)
      ? (parameters.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((item): item is string => typeof item === "string")
    : [];
  const rawCaptureSaveMap = parameters[chatExitCaptureSaveMapKey];
  const captureSaveMap =
    rawCaptureSaveMap &&
    typeof rawCaptureSaveMap === "object" &&
    !Array.isArray(rawCaptureSaveMap)
      ? (rawCaptureSaveMap as Record<string, unknown>)
      : {};
  const orderedArgumentNames = [
    ...required,
    ...Object.keys(properties).filter((name) => !required.includes(name)),
  ];

  const captures = orderedArgumentNames.map((argumentName) => {
    const argumentValue = properties[argumentName];
    const argumentObject =
      argumentValue &&
      typeof argumentValue === "object" &&
      !Array.isArray(argumentValue)
        ? (argumentValue as Record<string, unknown>)
        : {};
    const mappedSaveKey = captureSaveMap[argumentName];
    const legacySaveKey =
      tool.saveArgument === argumentName || (!tool.saveArgument && required.length <= 1)
        ? tool.saveContextKey
        : "";

    return {
      description:
        typeof argumentObject.description === "string"
          ? argumentObject.description
          : "",
      id: localMessageId("capture"),
      saveAs:
        (typeof mappedSaveKey === "string" ? mappedSaveKey : "") ||
        legacySaveKey ||
        argumentName,
    };
  });

  if (!captures.length && tool.saveContextKey) {
    captures.push({
      description: "",
      id: localMessageId("capture"),
      saveAs: tool.saveContextKey,
    });
  }

  return captures;
}

function chatToolDisplayTitle(tool: EventChatTool) {
  const rawTitle = tool.parameters[chatExitDisplayTitleKey];
  return typeof rawTitle === "string" ? rawTitle : "";
}

function chatToolDraftFromTool(tool: EventChatTool): EventChatToolDraft {
  return {
    captures: toolCaptureDraftsFromTool(tool),
    description: tool.description,
    enabled: tool.enabled,
    handlerActions: sortedActionSequenceSteps(tool.handlerActions ?? []).map(
      stepDraftFromStep,
    ),
    id: tool.id,
    name: tool.name,
    sortOrder: tool.sortOrder,
    title: chatToolDisplayTitle(tool),
    triggersEvent: tool.triggersEvent,
  };
}

function conversationCheckDraftFromCheck(
  check: EventConversationCheck,
): EventConversationCheckDraft {
  return {
    enabled: check.enabled,
    handlerActions: sortedActionSequenceSteps(check.handlerActions ?? []).map(
      stepDraftFromStep,
    ),
    id: check.id,
    instructions: check.instructions,
    resultContextKey: check.resultContextKey,
    sortOrder: check.sortOrder,
    title: check.title,
    triggersEvent: check.triggersEvent,
  };
}

function classifierDraftFromClassifier(
  classifier: EventClassifier,
): EventClassifierDraft {
  return {
    condition: conditionDraftFromRecord(classifier.condition),
    enabled: classifier.enabled,
    id: classifier.id,
    model: classifier.model,
    name: classifier.name,
    prompt: classifier.prompt,
    schema: classifier.schema,
    sortOrder: classifier.sortOrder,
  };
}

function classifierGroupDraftFromGroup(
  group: EventClassifierGroup,
): EventClassifierGroupDraft {
  return {
    classifiers: sortedEventClassifiers(group.classifiers ?? []).map(
      classifierDraftFromClassifier,
    ),
    condition: conditionDraftFromRecord(group.condition),
    enabled: group.enabled,
    handlerActions: sortedActionSequenceSteps(group.handlerActions ?? []).map(
      stepDraftFromStep,
    ),
    id: group.id,
    instructions: group.instructions,
    resultContextKey: group.resultContextKey,
    sortOrder: group.sortOrder,
    title: group.title,
    triggersEvent: group.triggersEvent,
  };
}

function eventDraftFromEvent(event: ExperienceEvent | null): EventDraft {
  return {
    chatInstructions: event?.chatInstructions ?? "",
    chatTools: event
      ? sortedEventChatTools(event.chatTools).map(chatToolDraftFromTool)
      : [],
    classifierGroups: event
      ? sortedEventClassifierGroups(event.classifierGroups ?? []).map(
          classifierGroupDraftFromGroup,
        )
      : [],
    conversationChecks: event
      ? sortedEventConversationChecks(event.conversationChecks ?? []).map(
          conversationCheckDraftFromCheck,
        )
      : [],
    description: event?.description ?? "",
    steps: event ? sortedEventSteps(event.steps).map(stepDraftFromStep) : [],
    title: event?.title ?? "Start",
  };
}

function defaultStepConfig(actionType: EventActionStep["actionType"]) {
  if (actionType === "script") {
    return { deckUrl: "", text: "" };
  }
  if (actionType === "set_context") {
    return { key: "entry_ready", value: "yes" };
  }
  if (actionType === "append_context_list") {
    return { key: "fruits_mentioned", value: "banana" };
  }
  if (actionType === "get_ui_state") {
    return { contextKey: "notes_visible", stateKey: "notesVisible" };
  }
  if (actionType === "highlight_on") {
    return {
      color: "rgba(59, 130, 246, 0.6)",
      selector: ".runtime-notes-toggle",
    };
  }
  if (actionType === "highlight_off") {
    return { selector: ".runtime-notes-toggle" };
  }
  if (actionType === "interactive") {
    return {
      config: cloneMainPanelAppConfig(defaultMainPanelApp),
      interactiveId: defaultMainPanelApp.id,
      mode: defaultMainPanelApp.defaultView,
      prompt: "",
      title: "",
      triggersEvent: "",
    };
  }
  if (actionType === "interactive_update") {
    return {
      config: {},
      interactiveId: defaultMainPanelApp.id,
      mode: defaultMainPanelApp.views[1]?.id ?? defaultMainPanelApp.defaultView,
      prompt: "",
      title: "",
    };
  }
  if (actionType === "set_ui_trigger") {
    return {
      selector: ".runtime-notes-toggle",
      triggersEvent: "",
    };
  }
  if (actionType === "goto_event") {
    return { triggersEvent: "" };
  }
  if (actionType === "button_choice") {
    return { label: "Continue", triggersEvent: "" };
  }

  return { text: "" };
}

function defaultStepConfigForEvent(
  actionType: EventActionStep["actionType"],
  events: ExperienceEvent[],
  currentEventId: string,
) {
  const config = defaultStepConfig(actionType);
  if (
    actionType !== "set_ui_trigger" &&
    actionType !== "goto_event" &&
    actionType !== "button_choice" &&
    actionType !== "interactive"
  ) {
    return config;
  }

  const destination = sortedExperienceEvents(events).find(
    (event) => event.id !== currentEventId,
  );
  return destination ? { ...config, triggersEvent: destination.slug } : config;
}

function defaultStepLabel(actionType: EventActionStep["actionType"]) {
  if (actionType === "set_context") return "Set entry_ready";
  if (actionType === "append_context_list") return "Append context";
  if (actionType === "get_ui_state") return "Read UI state";
  if (actionType === "highlight_on") return "Highlight UI";
  if (actionType === "highlight_off") return "Clear highlight";
  if (actionType === "interactive") return "Show main-panel app";
  if (actionType === "interactive_update") return "Update app";
  if (actionType === "set_ui_trigger") return "Wait for UI";
  if (actionType === "goto_event") return "Go to event";
  if (actionType === "button_choice") return "Show choice";
  return "Say";
}

function defaultChatToolPayload(events: ExperienceEvent[], currentEventId: string) {
  const destination = sortedExperienceEvents(events).find(
    (event) => event.id !== currentEventId,
  );

  return {
    description: "Call this when the learner is ready to move on.",
    enabled: true,
    handlerActions: [],
    name: "student_done",
    parameters: {
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    },
    saveArgument: "",
    saveContextKey: "",
    triggersEvent: destination?.slug ?? "",
  };
}

function defaultConversationCheckPayload(
  events: ExperienceEvent[],
  currentEventId: string,
) {
  const destination = sortedExperienceEvents(events).find(
    (event) => event.id !== currentEventId,
  );

  return {
    enabled: true,
    handlerActions: [],
    instructions:
      "Return true when the learner is confused, stuck, unsure, or asking for help.",
    resultContextKey: "conversation_check_result",
    title: "Check",
    triggersEvent: destination?.slug ?? "",
  };
}

function defaultClassifierGroupPayload(
  events: ExperienceEvent[],
  currentEventId: string,
) {
  const destination = sortedExperienceEvents(events).find(
    (event) => event.id !== currentEventId,
  );

  return {
    condition: {},
    enabled: true,
    handlerActions: [],
    instructions:
      "Run these classifiers independently before the assistant replies.",
    resultContextKey: "_classifier_results",
    title: "Classifier group",
    triggersEvent: destination?.slug ?? "",
  };
}

function eventActionLabel(actionType: EventActionStep["actionType"]) {
  return (
    eventActionOptions.find((option) => option.id === actionType)?.label ??
    "Action"
  );
}

function eventActionDescription(actionType: EventActionStep["actionType"]) {
  if (actionType === "set_context") {
    return "Write a value into the run context";
  }
  if (actionType === "append_context_list") {
    return "Add a value to a context list once";
  }
  if (actionType === "get_ui_state") {
    return "Copy current interface state into context";
  }
  if (actionType === "highlight_on") {
    return "Visually mark an interface target";
  }
  if (actionType === "highlight_off") {
    return "Remove a highlight from an interface target";
  }
  if (actionType === "interactive") {
    return "Mount a registered main-panel app";
  }
  if (actionType === "interactive_update") {
    return "Send an update to the mounted app";
  }
  if (actionType === "set_ui_trigger") {
    return "Run another event after a UI click";
  }
  if (actionType === "goto_event") {
    return "Immediately continue to another event";
  }
  if (actionType === "button_choice") {
    return "Show a runtime button that starts another event";
  }

  return "Have the agent speak in the chat";
}

function eventActionToneClass(actionType: EventActionStep["actionType"]) {
  if (
    actionType === "set_context" ||
    actionType === "append_context_list" ||
    actionType === "get_ui_state"
  ) {
    return "state";
  }
  if (
    actionType === "set_ui_trigger" ||
    actionType === "goto_event" ||
    actionType === "button_choice"
  ) {
    return "flow";
  }
  if (
    actionType === "highlight_on" ||
    actionType === "highlight_off" ||
    actionType === "interactive" ||
    actionType === "interactive_update"
  ) {
    return "ui";
  }
  return "speech";
}

function eventTitleForTrigger(events: ExperienceEvent[], eventSlug: string) {
  const target = events.find(
    (event) => event.slug === eventSlug || event.id === eventSlug,
  );
  return target?.title ?? eventSlug;
}

function actionSequenceOutgoingLinks(
  steps: ActionSequenceStep[] = [],
  sourcePrefix = "Action",
) {
  const links: EventOutgoingLink[] = [];
  for (const step of steps) {
    const condition = conditionRecordSummary(step.condition);
    if (step.actionType === "script") {
      const markers = parseScriptMarkerInstances(
        stringConfigValue(step.config, "text"),
      );
      const fallbackDestination = stringConfigValue(
        step.config,
        "triggersEvent",
      ).trim();
      markers.forEach((marker) => {
        if (marker.type !== "interactive" && marker.type !== "interactive_update") {
          return;
        }
        const markerDestination = (marker.argList[2] ?? "").trim();
        const triggersEvent = markerDestination || fallbackDestination;
        if (!triggersEvent) return;
        links.push({
          condition,
          kind: marker.type === "interactive" ? "App submit" : "App update submit",
          slug: triggersEvent,
          source: `${sourcePrefix}: ${step.label || "Say"} / ${
            marker.detail || marker.marker
          }`,
        });
      });
    }

    if (
      step.actionType !== "set_ui_trigger" &&
      step.actionType !== "goto_event" &&
      step.actionType !== "button_choice" &&
      step.actionType !== "interactive" &&
      step.actionType !== "interactive_update"
    ) {
      continue;
    }
    const triggersEvent = stringConfigValue(step.config, "triggersEvent").trim();
    if (!triggersEvent) continue;
    links.push({
      condition,
      kind: eventActionLabel(step.actionType),
      slug: triggersEvent,
      source: `${sourcePrefix}: ${step.label || eventActionLabel(step.actionType)}`,
    });
  }
  return links;
}

function eventOutgoingLinks(event: ExperienceEvent) {
  const links = actionSequenceOutgoingLinks(event.steps, "On entry");
  for (const tool of event.chatTools) {
    const triggersEvent = tool.triggersEvent.trim();
    if (triggersEvent) {
      links.push({
        condition: "function called",
        kind: "FC route",
        slug: triggersEvent,
        source: tool.description || tool.name,
      });
    }
    links.push(...actionSequenceOutgoingLinks(tool.handlerActions, `FC route ${tool.name}`));
  }
  for (const check of event.conversationChecks ?? []) {
    const triggersEvent = check.triggersEvent.trim();
    if (triggersEvent) {
      links.push({
        condition: "check matched",
        kind: "Check",
        slug: triggersEvent,
        source: check.title || "Conversation check",
      });
    }
    links.push(...actionSequenceOutgoingLinks(check.handlerActions, `Check ${check.title}`));
  }
  for (const group of event.classifierGroups ?? []) {
    const triggersEvent = group.triggersEvent.trim();
    if (triggersEvent) {
      links.push({
        condition:
          conditionRecordSummary(group.condition) || "classifier matched",
        kind: "Classifiers",
        slug: triggersEvent,
        source: group.title || "Classifier group",
      });
    }
    links.push(
      ...actionSequenceOutgoingLinks(group.handlerActions, `Classifiers ${group.title}`),
    );
  }
  return links;
}

function eventOutgoingSlugs(event: ExperienceEvent) {
  const slugs = new Set<string>();
  for (const link of eventOutgoingLinks(event)) {
    slugs.add(link.slug);
  }
  return [...slugs];
}

function eventTransitionStats(events: ExperienceEvent[], event: ExperienceEvent) {
  const outgoingSlugs = eventOutgoingSlugs(event);
  const incomingCount = events.filter((candidate) => {
    if (candidate.id === event.id) return false;
    return eventOutgoingSlugs(candidate).some(
      (slug) => slug === event.slug || slug === event.id,
    );
  }).length;
  const unresolvedCount = outgoingSlugs.filter(
    (slug) =>
      !events.some((candidate) => candidate.slug === slug || candidate.id === slug),
  ).length;

  return {
    incomingCount,
    isUnlinked: !event.isStart && incomingCount === 0,
    outgoingCount: outgoingSlugs.length,
    unresolvedCount,
  };
}

function compactPreview(value: string, fallback: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return fallback;
  return compact.length > 112 ? `${compact.slice(0, 109)}...` : compact;
}

function compactRuntimeValue(value: unknown, fallback = "---") {
  if (value === null) return "null";
  if (value === undefined) return fallback;
  if (typeof value === "string") return compactPreview(value, fallback);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return compactPreview(JSON.stringify(value), fallback);
  } catch {
    return fallback;
  }
}

function fullRuntimeValue(value: unknown, fallback = "---") {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || fallback;

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function runtimeValueTypeLabel(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (value === undefined) return "unset";
  if (typeof value === "object") return "object";
  return typeof value;
}

function runtimeActionText(action: Record<string, unknown>) {
  const type = typeof action.type === "string" ? action.type : "action";
  if (type === "conversation_check_result") {
    const result = action.result ? "matched" : "missed";
    const reason = compactRuntimeValue(action.reason, "");
    return reason ? `${result}: ${reason}` : result;
  }
  if (type === "classifier_result") {
    return `${compactRuntimeValue(action.classifierName, "classifier")}: ${compactRuntimeValue(
      action.result,
      "result",
    )}`;
  }
  if (type === "classifier_group_result") {
    return `${compactRuntimeValue(action.classifierGroupTitle, "classifiers")}: ${compactRuntimeValue(
      action.results,
      "results",
    )}`;
  }
  if (type === "classifier_skipped" || type === "classifier_group_skipped") {
    return `${compactRuntimeValue(
      action.classifierName || action.classifierGroupTitle,
      "classifier",
    )} skipped`;
  }
  if (type === "chat_tool_call") {
    return compactRuntimeValue(action.toolName, "function call");
  }
  if (type === "set_context") {
    return `${compactRuntimeValue(action.key, "key")} = ${compactRuntimeValue(
      action.value,
      "value",
    )}`;
  }
  if (type === "append_context_list") {
    return `${compactRuntimeValue(action.key, "key")} += ${compactRuntimeValue(
      action.value,
      "value",
    )}`;
  }
  if (type === "get_ui_state") {
    return `${compactRuntimeValue(action.stateKey, "ui")} -> ${compactRuntimeValue(
      action.contextKey,
      "context",
    )}`;
  }
  if (type === "chat_message") {
    const message = recordFromUnknown(action.message);
    if (typeof message.content === "string") {
      return compactRuntimeValue(message.content, "message");
    }
    return compactRuntimeValue(action.content, "message");
  }
  if (type === "goto_event" || type === "set_ui_trigger") {
    return `-> ${compactRuntimeValue(action.triggersEvent, "event")}`;
  }
  if (type === "button_choice") {
    return `${compactRuntimeValue(action.label, "button")} -> ${compactRuntimeValue(
      action.triggersEvent,
      "event",
    )}`;
  }
  if (type === "highlight_on" || type === "highlight_off") {
    return compactRuntimeValue(action.selector, "selector");
  }
  if (type === "interactive") {
    return `mount ${compactRuntimeValue(
      action.interactiveId,
      "app",
    )} ${compactRuntimeValue(
      action.mode,
      "",
    )}`;
  }
  if (type === "interactive_update") {
    return `${compactRuntimeValue(
      action.interactiveId,
      "app",
    )} -> ${compactRuntimeValue(action.mode, "update")}`;
  }
  if (type === "interactive_state") {
    return `${compactRuntimeValue(action.interactiveId, "app")} state saved`;
  }
  if (type === "interactive_error") {
    return `${compactRuntimeValue(action.interactiveId, "app")}: ${compactRuntimeValue(
      action.detail,
      "not registered",
    )}`;
  }
  if (type === "interactive_clear") {
    return "clear main-panel app";
  }
  if (type === "chat_availability") {
    return action.enabled === false ? "chat off" : "chat on";
  }
  if (type === "gslide") {
    return `slide ${compactRuntimeValue(action.slideRef, "1")}`;
  }
  if (type === "slide_error") {
    return compactRuntimeValue(action.detail, "slide unavailable");
  }
  if (type === "transition_missing") {
    return `missing ${compactRuntimeValue(action.triggersEvent, "event")}`;
  }
  if (type === "event_skipped") {
    return compactRuntimeValue(action.reason, "skipped");
  }

  return compactRuntimeValue(action, type);
}

function runtimeDebugEntries(value: unknown): RuntimeDebugTraceEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "action";
    const at = typeof record.at === "string" ? record.at : "";
    const summary =
      typeof record.summary === "string"
        ? record.summary
        : compactRuntimeValue(record, type);
    return [
      {
        at,
        details: recordFromUnknown(record.details),
        summary,
        type,
      },
    ];
  });
}

function runtimeTraceDetailsText(details: Record<string, unknown>) {
  const entries = Object.entries(details);
  if (!entries.length) return "";

  return entries
    .map(([key, value]) => `${key}: ${compactRuntimeValue(value)}`)
    .join(" | ");
}

function runtimeTraceTime(value: string) {
  if (!value) return "---";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function runtimeSlideFromRecord(value: unknown): (ResolvedSlide & { deckUrl: string }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const slide = value as Record<string, unknown>;
  const imageUrl = typeof slide.imageUrl === "string" ? slide.imageUrl : "";
  if (!imageUrl) return null;

  return {
    cached: Boolean(slide.cached),
    deckUrl: typeof slide.deckUrl === "string" ? slide.deckUrl : "",
    imageUrl,
    pageId: typeof slide.pageId === "string" ? slide.pageId : "",
    presentationId:
      typeof slide.presentationId === "string" ? slide.presentationId : "",
    slideRef: typeof slide.slideRef === "string" ? slide.slideRef : "1",
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function runtimeInteractiveFromRecord(value: unknown): RuntimeInteractive | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const interactive = value as Record<string, unknown>;
  const interactiveId =
    typeof interactive.interactiveId === "string"
      ? interactive.interactiveId.trim()
      : "";
  if (!interactiveId) return null;

  const title =
    typeof interactive.title === "string" && interactive.title.trim()
      ? interactive.title.trim()
      : interactiveId;

  return {
    config: recordFromUnknown(interactive.config),
    eventId: typeof interactive.eventId === "string" ? interactive.eventId : "",
    interactiveId,
    mode: typeof interactive.mode === "string" ? interactive.mode : "default",
    prompt: typeof interactive.prompt === "string" ? interactive.prompt : "",
    stepId: typeof interactive.stepId === "string" ? interactive.stepId : "",
    title,
    triggersEvent:
      typeof interactive.triggersEvent === "string"
        ? interactive.triggersEvent.trim()
        : "",
  };
}

function scriptCuesFromValue(value: unknown): ScriptCue[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ScriptCue | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const cue = item as Record<string, unknown>;
      const action = cue.action;
      if (!action || typeof action !== "object" || Array.isArray(action)) return null;

      const rawProgress = Number(cue.progress);
      const rawTime = Number(cue.time);
      const rawWordIndex = Number(cue.wordIndex);
      const parsedCue: ScriptCue = {
        action: action as Record<string, unknown>,
        progress: Number.isFinite(rawProgress) ? clamp(rawProgress, 0, 1) : 0,
      };
      if (Number.isFinite(rawTime) && rawTime >= 0) {
        parsedCue.time = rawTime;
      }
      if (Number.isFinite(rawWordIndex) && rawWordIndex >= 0) {
        parsedCue.wordIndex = Math.floor(rawWordIndex);
      }
      return parsedCue;
    })
    .filter((cue): cue is ScriptCue => Boolean(cue))
    .sort((left, right) => {
      const leftSort =
        typeof left.time === "number" ? left.time : left.progress * 100000;
      const rightSort =
        typeof right.time === "number" ? right.time : right.progress * 100000;
      return leftSort - rightSort;
    });
}

function scriptWordsFromValue(value: unknown): ScriptWord[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const word = item as Record<string, unknown>;
      const text = typeof word.word === "string" ? word.word.trim() : "";
      const start = Number(word.start);
      const end = Number(word.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;

      return {
        end: Math.max(start, end),
        start: Math.max(0, start),
        word: text,
      };
    })
    .filter((word): word is ScriptWord => Boolean(word))
    .sort((left, right) => left.start - right.start);
}

function scriptCueTime(cue: ScriptCue, fallbackDurationSeconds: number) {
  if (typeof cue.time === "number" && Number.isFinite(cue.time)) {
    return cue.time;
  }
  return fallbackDurationSeconds * cue.progress;
}

function scriptCueEffectiveTime(
  cue: ScriptCue,
  fallbackDurationSeconds: number,
  offsetMs: number,
) {
  const offsetSeconds = Number.isFinite(offsetMs) ? offsetMs / 1000 : 0;
  return Math.max(0, scriptCueTime(cue, fallbackDurationSeconds) + offsetSeconds);
}

function scriptCueNeedsTiming(cue: ScriptCue) {
  return cue.progress > scriptImmediateCueProgress && typeof cue.time !== "number";
}

function scriptCueImageUrls(cues: ScriptCue[]) {
  const urls = new Set<string>();
  cues.forEach((cue) => {
    const action = cue.action;
    if (action.type !== "gslide") return;
    const imageUrl = typeof action.imageUrl === "string" ? action.imageUrl : "";
    if (imageUrl) urls.add(imageUrl);
  });
  return [...urls];
}

function scriptCuesFromMessage(
  message: ChatMessage,
  fallbackValue?: unknown,
): ScriptCue[] {
  const metadataCues = scriptCuesFromValue(message.metadata?.scriptCues);
  if (metadataCues.length) return metadataCues;
  return scriptCuesFromValue(fallbackValue);
}

function cachedScriptAudioFromMessage(
  message: ChatMessage,
): MessageAudioPayload | null {
  const rawAudio = message.metadata?.scriptAudio;
  if (!rawAudio || typeof rawAudio !== "object" || Array.isArray(rawAudio)) {
    return null;
  }

  const audio = rawAudio as Record<string, unknown>;
  const audioUrl = typeof audio.audioUrl === "string" ? audio.audioUrl : "";
  const realtimeModel =
    typeof audio.realtimeModel === "string" ? audio.realtimeModel : "";
  const voice = typeof audio.voice === "string" ? audio.voice : "";
  if (!audioUrl || !realtimeModel || !voice) return null;
  const audioScriptCues = scriptCuesFromValue(audio.scriptCues);

  return {
    audioUrl,
    cached: Boolean(audio.cached),
    durationSeconds:
      typeof audio.durationSeconds === "number" &&
      Number.isFinite(audio.durationSeconds)
        ? audio.durationSeconds
        : null,
    messageId:
      typeof audio.messageId === "string" ? audio.messageId : message.id,
    realtimeModel: realtimeModel as RealtimeModelId,
    scriptCues: audioScriptCues.length
      ? audioScriptCues
      : scriptCuesFromMessage(message),
    scriptWords: scriptWordsFromValue(audio.scriptWords),
    timingModel: typeof audio.timingModel === "string" ? audio.timingModel : "",
    timingWarning:
      typeof audio.timingWarning === "string" ? audio.timingWarning : "",
    ttsModel: typeof audio.ttsModel === "string" ? audio.ttsModel : "",
    voice: voice as RealtimeVoiceId,
  };
}

function eventStepSummary(step: EventStepDraft, events: ExperienceEvent[]) {
  if (step.actionType === "set_context") {
    const key = stringConfigValue(step.config, "key", "key");
    const value = stringConfigValue(step.config, "value", "value");
    return `${key || "key"} = ${value || "value"}`;
  }
  if (step.actionType === "append_context_list") {
    const key = stringConfigValue(step.config, "key", "key");
    const value = stringConfigValue(step.config, "value", "value");
    return `${key || "key"} += ${value || "value"}`;
  }
  if (step.actionType === "get_ui_state") {
    const stateKey = stringConfigValue(step.config, "stateKey", "ui state");
    const contextKey = stringConfigValue(step.config, "contextKey", "context");
    return `${stateKey || "ui state"} -> ${contextKey || "context"}`;
  }
  if (step.actionType === "highlight_on") {
    return `highlight ${stringConfigValue(step.config, "selector", "target")}`;
  }
  if (step.actionType === "highlight_off") {
    return `clear ${stringConfigValue(step.config, "selector", "target")}`;
  }
  if (step.actionType === "interactive") {
    const interactiveId = stringConfigValue(
      step.config,
      "interactiveId",
      "app",
    );
    const appDefinition = getMainPanelAppDefinition(interactiveId);
    const mode = stringConfigValue(step.config, "mode");
    const viewLabel =
      appDefinition?.views.find((view) => view.id === mode)?.label ?? mode;
    const triggersEvent = stringConfigValue(step.config, "triggersEvent");
    const targetEvent = eventTitleForTrigger(events, triggersEvent);
    return [
      appDefinition?.label || interactiveId || "app",
      viewLabel ? `(${viewLabel})` : "",
      triggersEvent ? `on submit: ${targetEvent || triggersEvent}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (step.actionType === "interactive_update") {
    const interactiveId = stringConfigValue(
      step.config,
      "interactiveId",
      "app",
    );
    const appDefinition = getMainPanelAppDefinition(interactiveId);
    const mode = stringConfigValue(step.config, "mode", "mode");
    const viewLabel =
      appDefinition?.views.find((view) => view.id === mode)?.label ?? mode;
    const triggersEvent = stringConfigValue(step.config, "triggersEvent");
    const targetEvent = eventTitleForTrigger(events, triggersEvent);
    return [
      `Update ${appDefinition?.label || interactiveId || "app"}`,
      viewLabel ? `to ${viewLabel}` : "",
      triggersEvent ? `on submit: ${targetEvent || triggersEvent}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (step.actionType === "set_ui_trigger") {
    const selector = stringConfigValue(step.config, "selector", "target");
    const triggersEvent = stringConfigValue(step.config, "triggersEvent", "event");
    const targetEvent = eventTitleForTrigger(events, triggersEvent);
    return `${selector || "target"} -> ${targetEvent || "event"}`;
  }
  if (step.actionType === "goto_event") {
    const triggersEvent = stringConfigValue(step.config, "triggersEvent", "event");
    return eventTitleForTrigger(events, triggersEvent) || "Choose event";
  }
  if (step.actionType === "button_choice") {
    const label = stringConfigValue(step.config, "label", "Button");
    const triggersEvent = stringConfigValue(step.config, "triggersEvent", "event");
    const targetEvent = eventTitleForTrigger(events, triggersEvent);
    return `${label || "Button"} -> ${targetEvent || "event"}`;
  }

  return compactPreview(
    spokenScriptText(stringConfigValue(step.config, "text")),
    "Write what the agent says",
  );
}

function eventConditionSummary(condition: StepConditionDraft) {
  if (condition.type === "custom") {
    return conditionRecordSummary(condition.raw ?? {});
  }
  if (condition.type !== "context_equals") return "";

  const key = condition.key.trim() || "context";
  const value = condition.value.trim() || "expected";
  return `${key} == ${value}`;
}

function conditionValueSummary(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return compactRuntimeValue(value, "expected");
}

function conditionRecordSummary(condition: Record<string, unknown>): string {
  const type = typeof condition.type === "string" ? condition.type : "always";
  const key = typeof condition.key === "string" ? condition.key : "context";
  const value = conditionValueSummary(condition.value);

  if (!condition.type || type === "always") return "";
  if (type === "context_equals") return `${key} == ${value}`;
  if (type === "context_not_equals") return `${key} != ${value}`;
  if (type === "context_contains") return `${key} has ${value}`;
  if (type === "context_not_contains") return `${key} lacks ${value}`;
  if (type === "context_exists") return `${key} exists`;
  if (type === "context_missing") return `${key} missing`;

  if (type === "all" || type === "any") {
    const conditions = Array.isArray(condition.conditions)
      ? condition.conditions
      : [];
    const summaries: string[] = conditions
      .map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? conditionRecordSummary(item as Record<string, unknown>)
          : "",
      )
      .filter(Boolean);
    if (!summaries.length) return type;
    const joiner = type === "all" ? " and " : " or ";
    return summaries.join(joiner);
  }

  return compactRuntimeValue(condition, "custom");
}

function normalizedStepCondition(condition: StepConditionDraft) {
  if (condition.type === "custom") return condition.raw ?? {};
  if (condition.type !== "context_equals") return {};

  return {
    key: condition.key,
    type: "context_equals",
    value: condition.value,
  };
}

function mergeConditionDraft(
  current: StepConditionDraft,
  patch: Partial<StepConditionDraft>,
) {
  const nextCondition: StepConditionDraft = {
    ...current,
    ...patch,
  };

  if (patch.type === "always") {
    nextCondition.key = "";
    nextCondition.value = "";
    delete nextCondition.raw;
  }

  if (patch.type === "context_equals") {
    delete nextCondition.raw;
  }

  return nextCondition;
}

function comparableStepDraft(step: EventStepDraft) {
  return {
    actionType: step.actionType,
    condition: normalizedStepCondition(step.condition),
    config: step.config,
    enabled: step.enabled,
    label: step.label,
    sortOrder: step.sortOrder,
  };
}

function comparableStep(step: EventActionStep) {
  return comparableStepDraft(stepDraftFromStep(step));
}

function normalizedActionSequenceSteps(steps: EventStepDraft[]) {
  return [...steps]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((step, index) => ({
      actionType: step.actionType,
      condition: normalizedStepCondition(step.condition),
      config: step.config,
      enabled: step.enabled,
      id: step.id,
      label: step.label,
      sortOrder: index,
    }));
}

function normalizedChatToolParameters(tool: EventChatToolDraft) {
  const captures = tool.captures
    .map((capture) => ({
      description: capture.description.trim(),
      saveAs: capture.saveAs.trim(),
    }))
    .filter((capture) => capture.saveAs);
  const title = tool.title.trim();
  const metadata = title ? { [chatExitDisplayTitleKey]: title } : {};

  if (!captures.length) {
    return {
      additionalProperties: false,
      ...metadata,
      properties: {},
      required: [],
      type: "object",
    };
  }

  const captureSaveMap = Object.fromEntries(
    captures.map((capture) => [capture.saveAs, capture.saveAs]),
  );

  return {
    additionalProperties: false,
    [chatExitCaptureSaveMapKey]: captureSaveMap,
    ...metadata,
    properties: Object.fromEntries(
      captures.map((capture) => [
        capture.saveAs,
        {
          description:
            capture.description || `The value to save as ${capture.saveAs}.`,
          type: "string",
        },
      ]),
    ),
    required: captures.map((capture) => capture.saveAs),
    type: "object",
  };
}

function comparableChatToolDraft(tool: EventChatToolDraft) {
  const primaryCapture = tool.captures.find((capture) => capture.saveAs.trim());
  return {
    description: tool.description,
    enabled: tool.enabled,
    handlerActions: normalizedActionSequenceSteps(tool.handlerActions),
    name: tool.name,
    parameters: normalizedChatToolParameters(tool),
    saveArgument: primaryCapture?.saveAs.trim() ?? "",
    saveContextKey: primaryCapture?.saveAs.trim() ?? "",
    sortOrder: tool.sortOrder,
    triggersEvent: tool.triggersEvent,
  };
}

function comparableChatTool(tool: EventChatTool) {
  return comparableChatToolDraft(chatToolDraftFromTool(tool));
}

function comparableConversationCheckDraft(check: EventConversationCheckDraft) {
  return {
    enabled: check.enabled,
    handlerActions: normalizedActionSequenceSteps(check.handlerActions),
    instructions: check.instructions,
    resultContextKey: check.resultContextKey,
    sortOrder: check.sortOrder,
    title: check.title,
    triggersEvent: check.triggersEvent,
  };
}

function comparableConversationCheck(check: EventConversationCheck) {
  return comparableConversationCheckDraft(conversationCheckDraftFromCheck(check));
}

function comparableClassifierDraft(classifier: EventClassifierDraft) {
  return {
    condition: normalizedStepCondition(classifier.condition),
    enabled: classifier.enabled,
    model: classifier.model,
    name: classifier.name,
    prompt: classifier.prompt,
    schema: classifier.schema,
    sortOrder: classifier.sortOrder,
  };
}

function comparableClassifier(classifier: EventClassifier) {
  return comparableClassifierDraft(classifierDraftFromClassifier(classifier));
}

function comparableClassifierGroupDraft(group: EventClassifierGroupDraft) {
  return {
    condition: normalizedStepCondition(group.condition),
    enabled: group.enabled,
    handlerActions: normalizedActionSequenceSteps(group.handlerActions),
    instructions: group.instructions,
    resultContextKey: group.resultContextKey,
    sortOrder: group.sortOrder,
    title: group.title,
    triggersEvent: group.triggersEvent,
  };
}

function comparableClassifierGroup(group: EventClassifierGroup) {
  return comparableClassifierGroupDraft(classifierGroupDraftFromGroup(group));
}

function chatToolPayloadFromDraft(tool: EventChatToolDraft) {
  const primaryCapture = tool.captures.find((capture) => capture.saveAs.trim());
  return {
    description: tool.description,
    enabled: tool.enabled,
    handlerActions: normalizedActionSequenceSteps(tool.handlerActions),
    name: tool.name,
    parameters: normalizedChatToolParameters(tool),
    saveArgument: primaryCapture?.saveAs.trim() ?? "",
    saveContextKey: primaryCapture?.saveAs.trim() ?? "",
    sortOrder: tool.sortOrder,
    triggersEvent: tool.triggersEvent,
  };
}

function conversationCheckPayloadFromDraft(check: EventConversationCheckDraft) {
  return {
    enabled: check.enabled,
    handlerActions: normalizedActionSequenceSteps(check.handlerActions),
    instructions: check.instructions,
    resultContextKey: check.resultContextKey,
    sortOrder: check.sortOrder,
    title: check.title,
    triggersEvent: check.triggersEvent,
  };
}

function classifierGroupPayloadFromDraft(group: EventClassifierGroupDraft) {
  return {
    condition: normalizedStepCondition(group.condition),
    enabled: group.enabled,
    handlerActions: normalizedActionSequenceSteps(group.handlerActions),
    instructions: group.instructions,
    resultContextKey: group.resultContextKey,
    sortOrder: group.sortOrder,
    title: group.title,
    triggersEvent: group.triggersEvent,
  };
}

function classifierPayloadFromDraft(classifier: EventClassifierDraft) {
  return {
    condition: normalizedStepCondition(classifier.condition),
    enabled: classifier.enabled,
    model: classifier.model,
    name: classifier.name,
    prompt: classifier.prompt,
    schema: classifier.schema,
    sortOrder: classifier.sortOrder,
  };
}

function replaceEventStepInEvent(
  event: ExperienceEvent,
  nextStep: EventActionStep,
) {
  return {
    ...event,
    steps: event.steps
      .map((step) => (step.id === nextStep.id ? nextStep : step))
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function replaceEventToolInEvent(
  event: ExperienceEvent,
  nextTool: EventChatTool,
) {
  return {
    ...event,
    chatTools: event.chatTools
      .map((tool) => (tool.id === nextTool.id ? nextTool : tool))
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function replaceEventCheckInEvent(
  event: ExperienceEvent,
  nextCheck: EventConversationCheck,
) {
  return {
    ...event,
    conversationChecks: (event.conversationChecks ?? [])
      .map((check) => (check.id === nextCheck.id ? nextCheck : check))
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function replaceEventClassifierGroupInEvent(
  event: ExperienceEvent,
  nextGroup: EventClassifierGroup,
) {
  return {
    ...event,
    classifierGroups: (event.classifierGroups ?? [])
      .map((group) => (group.id === nextGroup.id ? nextGroup : group))
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function replaceEventClassifierInEvent(
  event: ExperienceEvent,
  groupId: string,
  nextClassifier: EventClassifier,
) {
  return {
    ...event,
    classifierGroups: (event.classifierGroups ?? []).map((group) => {
      if (group.id !== groupId) return group;

      return {
        ...group,
        classifiers: (group.classifiers ?? [])
          .map((classifier) =>
            classifier.id === nextClassifier.id ? nextClassifier : classifier,
          )
          .sort((left, right) => left.sortOrder - right.sortOrder),
      };
    }),
  };
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

function addExperienceEvent(
  experience: Experience,
  nextEvent: ExperienceEvent,
) {
  return {
    ...experience,
    events: sortedExperienceEvents([...experience.events, nextEvent]),
  };
}

function replaceExperienceEventStep(
  experience: Experience,
  eventId: string,
  nextStep: EventActionStep,
) {
  return {
    ...experience,
    events: experience.events.map((event) => {
      if (event.id !== eventId) return event;

      return replaceEventStepInEvent(event, nextStep);
    }),
  };
}

function replaceExperienceEventTool(
  experience: Experience,
  eventId: string,
  nextTool: EventChatTool,
) {
  return {
    ...experience,
    events: experience.events.map((event) => {
      if (event.id !== eventId) return event;

      return replaceEventToolInEvent(event, nextTool);
    }),
  };
}

function replaceExperienceEventCheck(
  experience: Experience,
  eventId: string,
  nextCheck: EventConversationCheck,
) {
  return {
    ...experience,
    events: experience.events.map((event) => {
      if (event.id !== eventId) return event;

      return replaceEventCheckInEvent(event, nextCheck);
    }),
  };
}

function replaceExperienceClassifierGroup(
  experience: Experience,
  eventId: string,
  nextGroup: EventClassifierGroup,
) {
  return {
    ...experience,
    events: experience.events.map((event) => {
      if (event.id !== eventId) return event;

      return replaceEventClassifierGroupInEvent(event, nextGroup);
    }),
  };
}

function replaceExperienceClassifier(
  experience: Experience,
  eventId: string,
  groupId: string,
  nextClassifier: EventClassifier,
) {
  return {
    ...experience,
    events: experience.events.map((event) => {
      if (event.id !== eventId) return event;

      return replaceEventClassifierInEvent(event, groupId, nextClassifier);
    }),
  };
}

function experienceRunPath(experienceId: string) {
  return `/experiences/${encodeURIComponent(experienceId)}/run`;
}

function experienceEditPath(experienceId: string) {
  return `/experiences/${encodeURIComponent(experienceId)}/edit`;
}

function routeExperience(pathname: string) {
  const match = pathname.match(/^\/experiences\/([^/]+)(?:\/(run|edit))?\/?$/);
  if (!match) return { experienceId: "", mode: "" };

  return {
    experienceId: decodeURIComponent(match[1]),
    mode: match[2] || "edit",
  };
}

function storedNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clamp(value, min, max);
}

function readPanelLayout() {
  if (typeof window === "undefined") return {};

  try {
    const rawValue = window.localStorage.getItem(panelLayoutStorageKey);
    if (!rawValue) return {};

    const value = JSON.parse(rawValue) as StoredPanelLayout;
    return {
      leftWidth: storedNumber(value.leftWidth, 260, 1180),
      lowerHeight: storedNumber(value.lowerHeight, minLowerPanelHeight, 900),
      workspaceWidth: storedNumber(
        value.workspaceWidth,
        320,
        maxWorkspaceWidth,
      ),
    };
  } catch {
    return {};
  }
}

function writePanelLayout(layout: StoredPanelLayout) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(panelLayoutStorageKey, JSON.stringify(layout));
  } catch {
    // Ignore storage failures; panel sizing should still work for this view.
  }
}

function readSlideSettings(): SlideSettings {
  if (typeof window === "undefined") return { deckUrl: "", slideRef: "1" };

  try {
    const rawValue = window.localStorage.getItem(slideSettingsStorageKey);
    if (!rawValue) return { deckUrl: "", slideRef: "1" };

    const value = JSON.parse(rawValue) as Partial<SlideSettings>;
    return {
      deckUrl: typeof value.deckUrl === "string" ? value.deckUrl : "",
      slideRef:
        typeof value.slideRef === "string" && value.slideRef.trim()
          ? value.slideRef
          : "1",
    };
  } catch {
    return { deckUrl: "", slideRef: "1" };
  }
}

function writeSlideSettings(settings: SlideSettings) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(slideSettingsStorageKey, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; slide display can still run from local state.
  }
}

function readSelectedExperienceId() {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(experienceSelectionStorageKey) ?? "";
  } catch {
    return "";
  }
}

function writeSelectedExperienceId(experienceId: string) {
  if (typeof window === "undefined") return;

  try {
    if (experienceId) {
      window.localStorage.setItem(experienceSelectionStorageKey, experienceId);
    } else {
      window.localStorage.removeItem(experienceSelectionStorageKey);
    }
  } catch {
    // Ignore storage failures; the backend still chooses a current experience.
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("X-Current-Path", getCurrentPath());

  if (method !== "GET" && method !== "HEAD") {
    headers.set("X-CSRFToken", getCookie("csrftoken"));
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers,
  });
  const data = (await response.json().catch(() => null)) as unknown;
  const responseObject =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  if (response.status === 401) {
    const loginUrl =
      typeof responseObject.loginUrl === "string"
        ? responseObject.loginUrl
        : "/accounts/login/";
    window.location.assign(loginUrl);
    throw new Error("Authentication required.");
  }

  if (!response.ok) {
    const detail =
      typeof responseObject.detail === "string" ? responseObject.detail : "";
    throw new Error(detail || "Request failed.");
  }

  return data as T;
}

function App() {
  const pathname = window.location.pathname;
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const experienceRoute = routeExperience(pathname);

  if (normalizedPath === "/" || normalizedPath === "/experiences") {
    return <ExperienceHome />;
  }

  if (experienceRoute.experienceId && experienceRoute.mode === "run") {
    return <PanelStudy initialExperienceId={experienceRoute.experienceId} />;
  }

  if (experienceRoute.experienceId) {
    return <ExperienceEditor experienceId={experienceRoute.experienceId} />;
  }

  if (normalizedPath === "/surfaces/tutoring/panels") {
    return <PanelStudy />;
  }

  return <ExperienceHome />;
}

function ExperienceHome() {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ExperienceForm>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [duplicatingExperienceId, setDuplicatingExperienceId] = useState("");
  const [exportingExperienceId, setExportingExperienceId] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const autosaveTimers = useRef<Record<string, number>>({});
  const autosaveVersions = useRef<Record<string, number>>({});
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  function draftFromExperience(experience: Experience): ExperienceForm {
    return {
      description: experience.description,
      title: experience.title,
    };
  }

  function draftsFromExperiences(nextExperiences: Experience[]) {
    return Object.fromEntries(
      nextExperiences.map((experience) => [
        experience.id,
        draftFromExperience(experience),
      ]),
    );
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadExperiences() {
      setStatus("loading");
      setError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const payload = await apiFetch<ExperiencesPayload>("/api/experiences/");
        const savedExperienceId = readSelectedExperienceId();
        const chosenExperience =
          payload.experiences.find(
            (experience) => experience.id === savedExperienceId,
          ) ??
          payload.experiences.find(
            (experience) => experience.id === payload.currentExperienceId,
          ) ??
          payload.experiences[0];

        if (!chosenExperience) {
          throw new Error("Could not load an experience.");
        }

        if (isCancelled) return;

        setUser(me.user);
        setExperiences(payload.experiences);
        setDrafts(draftsFromExperiences(payload.experiences));
        writeSelectedExperienceId(chosenExperience.id);
        setStatus("ready");
      } catch (loadError) {
        if (isCancelled) return;

        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load experiences.",
        );
      }
    }

    loadExperiences();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(autosaveTimers.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, []);

  function hasDraftChanges(experience: Experience, draft: ExperienceForm) {
    return (
      draft.title !== experience.title ||
      draft.description !== experience.description
    );
  }

  function clearAutosaveTimer(experienceId: string) {
    const timer = autosaveTimers.current[experienceId];
    if (timer) {
      window.clearTimeout(timer);
      delete autosaveTimers.current[experienceId];
    }
  }

  function nextAutosaveVersion(experienceId: string) {
    const version = (autosaveVersions.current[experienceId] ?? 0) + 1;
    autosaveVersions.current[experienceId] = version;
    return version;
  }

  async function persistExperienceDraft(
    experienceId: string,
    draft: ExperienceForm,
    version: number,
  ) {
    if (!draft.title.trim()) return true;
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experienceId}/`,
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );

      if (autosaveVersions.current[experienceId] !== version) return true;

      setExperiences((current) =>
        current.map((experience) =>
          experience.id === payload.experience.id ? payload.experience : experience,
        ),
      );
      setDrafts((current) => {
        const currentDraft = current[payload.experience.id];
        if (
          currentDraft &&
          (currentDraft.title !== draft.title ||
            currentDraft.description !== draft.description)
        ) {
          return current;
        }

        return {
          ...current,
          [payload.experience.id]: draftFromExperience(payload.experience),
        };
      });
      return true;
    } catch (saveError) {
      if (autosaveVersions.current[experienceId] === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save experience.",
        );
      }
      return false;
    }
  }

  function queueExperienceAutosave(experience: Experience, draft: ExperienceForm) {
    clearAutosaveTimer(experience.id);

    if (!draft.title.trim() || !hasDraftChanges(experience, draft)) return;

    const version = nextAutosaveVersion(experience.id);
    autosaveTimers.current[experience.id] = window.setTimeout(() => {
      delete autosaveTimers.current[experience.id];
      void persistExperienceDraft(experience.id, draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushExperienceAutosave(experience: Experience) {
    const draft = drafts[experience.id] ?? draftFromExperience(experience);
    clearAutosaveTimer(experience.id);

    if (!hasDraftChanges(experience, draft)) return true;

    const version = nextAutosaveVersion(experience.id);
    return persistExperienceDraft(experience.id, draft, version);
  }

  async function runExperience(experience: Experience) {
    const didSave = await flushExperienceAutosave(experience);
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

  async function editExperience(experience: Experience) {
    const didSave = await flushExperienceAutosave(experience);
    if (!didSave) return;

    writeSelectedExperienceId(experience.id);
    window.location.assign(experienceEditPath(experience.id));
  }

  async function duplicateExperience(experience: Experience) {
    const didSave = await flushExperienceAutosave(experience);
    if (!didSave) return;

    setDuplicatingExperienceId(experience.id);
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experience.id}/duplicate/`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setExperiences((current) => [payload.experience, ...current]);
      setDrafts((current) => ({
        ...current,
        [payload.experience.id]: draftFromExperience(payload.experience),
      }));
      writeSelectedExperienceId(payload.experience.id);
    } catch (duplicateError) {
      setError(
        duplicateError instanceof Error
          ? duplicateError.message
          : "Could not duplicate experience.",
      );
    } finally {
      setDuplicatingExperienceId("");
    }
  }

  async function exportExperience(experience: Experience) {
    const didSave = await flushExperienceAutosave(experience);
    if (!didSave) return;

    setExportingExperienceId(experience.id);
    setError("");

    try {
      const response = await fetch(`/api/experiences/${experience.id}/export/`, {
        credentials: "same-origin",
        headers: {
          "X-Current-Path": getCurrentPath(),
        },
      });
      if (response.status === 401) {
        window.location.assign("/accounts/login/");
        throw new Error("Authentication required.");
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        throw new Error(
          typeof payload?.detail === "string"
            ? payload.detail
            : "Could not export experience.",
        );
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${experience.slug || "experience"}.dlu-experience.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Could not export experience.",
      );
    } finally {
      setExportingExperienceId("");
    }
  }

  async function deleteExperience(experience: Experience) {
    const didConfirm = window.confirm(`Delete "${experience.title}"?`);
    if (!didConfirm) return;

    clearAutosaveTimer(experience.id);
    setError("");

    try {
      const payload = await apiFetch<ExperiencesPayload>(
        `/api/experiences/${experience.id}/`,
        {
          method: "DELETE",
        },
      );
      setExperiences(payload.experiences);
      setDrafts(draftsFromExperiences(payload.experiences));
      writeSelectedExperienceId(payload.currentExperienceId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete experience.",
      );
    }
  }

  function updateDraft(
    experience: Experience,
    draft: ExperienceForm,
    field: keyof ExperienceForm,
    value: string,
  ) {
    const nextDraft = {
      ...draft,
      [field]: value,
    };

    setDrafts((current) => ({
      ...current,
      [experience.id]: nextDraft,
    }));
    queueExperienceAutosave(experience, nextDraft);
  }

  async function createExperience() {
    setIsCreating(true);
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>("/api/experiences/", {
        method: "POST",
        body: JSON.stringify({
          description: "",
          title: "Untitled experience",
        }),
      });
      setExperiences((current) => [payload.experience, ...current]);
      setDrafts((current) => ({
        ...current,
        [payload.experience.id]: draftFromExperience(payload.experience),
      }));
      writeSelectedExperienceId(payload.experience.id);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create experience.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function importExperienceFile(file: File | null) {
    if (!file) return;

    setIsImporting(true);
    setError("");

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const payload = await apiFetch<{ experience: Experience }>(
        "/api/experiences/import/",
        {
          method: "POST",
          body: JSON.stringify(parsed),
        },
      );
      setExperiences((current) => [payload.experience, ...current]);
      setDrafts((current) => ({
        ...current,
        [payload.experience.id]: draftFromExperience(payload.experience),
      }));
      writeSelectedExperienceId(payload.experience.id);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import experience.",
      );
    } finally {
      setIsImporting(false);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
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

  return (
    <main
      className="panel-study experience-home-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <p className="study-kicker">dLU</p>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action secondary"
            disabled={isSigningOut}
            onClick={signOut}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="experience-home">
        <div className="experience-home-title">
          <h1>Experiences</h1>
          <div className="experience-home-actions">
            <input
              accept="application/json,.json,.dlu-experience.json"
              aria-label="Import experience file"
              className="visually-hidden-file-input"
              onChange={(event) =>
                void importExperienceFile(event.currentTarget.files?.[0] ?? null)
              }
              ref={importFileInputRef}
              type="file"
            />
            <button
              className="header-action secondary"
              disabled={isImporting}
              onClick={() => importFileInputRef.current?.click()}
              type="button"
            >
              {isImporting ? "Importing..." : "Import"}
            </button>
            <button
              className="header-action"
              disabled={isCreating}
              onClick={createExperience}
              type="button"
            >
              {isCreating ? "Creating..." : "New"}
            </button>
          </div>
        </div>

        {status === "loading" ? (
          <div className="experience-state">Loading experiences...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        <div className="experience-list">
          {experiences.map((experience) => {
            const draft = drafts[experience.id] ?? draftFromExperience(experience);

            return (
              <div
                className="experience-row"
                key={experience.id}
              >
                <button
                  aria-label={`Delete ${draft.title || "experience"}`}
                  className="experience-delete-button"
                  onClick={() => void deleteExperience(experience)}
                  title="Delete experience"
                  type="button"
                >
                  <TrashIcon />
                </button>
                <div className="experience-row-main">
                  <input
                    aria-label="Experience title"
                    className="experience-title-input"
                    onChange={(event) =>
                      updateDraft(
                        experience,
                        draft,
                        "title",
                        event.target.value,
                      )
                    }
                    type="text"
                    value={draft.title}
                  />
                  <input
                    aria-label="Experience description"
                    className="experience-description-input"
                    onChange={(event) =>
                      updateDraft(
                        experience,
                        draft,
                        "description",
                        event.target.value,
                      )
                    }
                    placeholder="---"
                    type="text"
                    value={draft.description}
                  />
                </div>
                <div className="experience-row-actions">
                  <button
                    className="header-action secondary"
                    disabled={duplicatingExperienceId === experience.id}
                    onClick={() => void duplicateExperience(experience)}
                    type="button"
                  >
                    {duplicatingExperienceId === experience.id
                      ? "Duplicating..."
                      : "Duplicate"}
                  </button>
                  <button
                    className="header-action secondary"
                    disabled={exportingExperienceId === experience.id}
                    onClick={() => void exportExperience(experience)}
                    type="button"
                  >
                    {exportingExperienceId === experience.id ? "Exporting..." : "Export"}
                  </button>
                  <button
                    className="header-action secondary"
                    onClick={() => void editExperience(experience)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="header-action"
                    onClick={() => void runExperience(experience)}
                    type="button"
                  >
                    Run
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function ExperienceEditor({ experienceId }: { experienceId: string }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [experienceForm, setExperienceForm] = useState<ExperienceForm>({
    description: "",
    title: "",
  });
  const [tutorForm, setTutorForm] = useState<TutorSettings>({
    assistantName: "dee-lou",
    avatarPath: "test-images/dLU-right.png",
    classificationModel: "gpt-5.4-mini",
    realtimeModel: "gpt-realtime-mini",
    scriptActionOffsetMs: 0,
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  });
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    chatInstructions: "",
    chatTools: [],
    classifierGroups: [],
    conversationChecks: [],
    description: "",
    steps: [],
    title: "Start",
  });
  const [eventSearch, setEventSearch] = useState("");
  const [draggingStepId, setDraggingStepId] = useState("");
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([]);
  const [eventRedoStack, setEventRedoStack] = useState<EventDraft[]>([]);
  const [eventUndoStack, setEventUndoStack] = useState<EventDraft[]>([]);
  const [isEventAddMenuOpen, setIsEventAddMenuOpen] = useState(false);
  const [isEventGraphOpen, setIsEventGraphOpen] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState("");
  const [isConversationAddMenuOpen, setIsConversationAddMenuOpen] =
    useState(false);
  const [conversationAddMenuToolId, setConversationAddMenuToolId] = useState("");
  const [conversationAddMenuCheckId, setConversationAddMenuCheckId] =
    useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [isSavingTutor, setIsSavingTutor] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [voiceSampleStatus, setVoiceSampleStatus] =
    useState<VoiceSampleStatus>("idle");
  const [scriptAudioItems, setScriptAudioItems] = useState<ScriptAudioItem[]>([]);
  const [scriptAudioStatus, setScriptAudioStatus] = useState<
    "idle" | "loading" | "generating"
  >("idle");
  const [scriptAudioError, setScriptAudioError] = useState("");
  const [playingScriptAudioId, setPlayingScriptAudioId] = useState("");
  const overviewAutosaveTimer = useRef<number | null>(null);
  const overviewAutosaveVersion = useRef(0);
  const tutorAutosaveTimer = useRef<number | null>(null);
  const tutorAutosaveVersion = useRef(0);
  const eventAutosaveTimer = useRef<number | null>(null);
  const eventAutosaveVersion = useRef(0);
  const eventAutosaveInFlight = useRef<Promise<boolean> | null>(null);
  const eventStepIdRemap = useRef<Map<string, string>>(new Map());
  const eventToolIdRemap = useRef<Map<string, string>>(new Map());
  const eventCheckIdRemap = useRef<Map<string, string>>(new Map());
  const eventGroupIdRemap = useRef<Map<string, string>>(new Map());
  const eventClassifierIdRemap = useRef<Map<string, string>>(new Map());
  const lastPersistedEvent = useRef<ExperienceEvent | null>(null);
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const scriptAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const overviewDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const eventAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationItemAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationCheckAddBlockRef = useRef<HTMLDivElement | null>(null);

  function isExpandedItem(id: string) {
    return expandedItemIds.includes(id);
  }

  function openExpandedItem(id: string) {
    setExpandedItemIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
  }

  function closeExpandedItems(ids: string[]) {
    setExpandedItemIds((current) =>
      current.filter((expandedId) => !ids.includes(expandedId)),
    );
  }

  function closeExpandedItem(id: string) {
    closeExpandedItems([id]);
  }

  function resetExpandedItems() {
    setExpandedItemIds([]);
  }

  function toggleExpandedItem(id: string) {
    setExpandedItemIds((current) =>
      current.includes(id)
        ? current.filter((expandedId) => expandedId !== id)
        : [...current, id],
    );
  }

  function toggleExpandedParent(parentId: string, childIds: string[] = []) {
    const expandedIds = [parentId, ...childIds];
    const isOpen = expandedIds.some((id) => isExpandedItem(id));
    if (isOpen) {
      closeExpandedItems(expandedIds);
      return;
    }
    openExpandedItem(parentId);
  }

  function clearEventUndoHistory() {
    setEventUndoStack([]);
    setEventRedoStack([]);
  }

  function cloneEventDraft(draft: EventDraft) {
    return JSON.parse(JSON.stringify(draft)) as EventDraft;
  }

  function eventDraftSignature(draft: EventDraft) {
    return JSON.stringify(draft);
  }

  function rememberEventDraftForUndo(draft = eventDraft) {
    const snapshot = cloneEventDraft(draft);
    const snapshotSignature = eventDraftSignature(snapshot);
    setEventUndoStack((current) => {
      if (current[0] && eventDraftSignature(current[0]) === snapshotSignature) {
        return current;
      }
      return [snapshot, ...current].slice(0, editorUndoLimit);
    });
    setEventRedoStack([]);
  }

  function stageEventDraft(nextDraft: EventDraft, recordHistory = true) {
    if (eventDraftSignature(nextDraft) === eventDraftSignature(eventDraft)) {
      return;
    }
    if (recordHistory) {
      rememberEventDraftForUndo();
    }
    const stagedDraft = cloneEventDraft(nextDraft);
    setEventDraft(stagedDraft);
    queueEventAutosave(stagedDraft);
  }

  function undoEventEdit() {
    const previousDraft = eventUndoStack[0];
    if (!previousDraft) return;

    setEventUndoStack((current) => current.slice(1));
    setEventRedoStack((current) =>
      [cloneEventDraft(eventDraft), ...current].slice(0, editorUndoLimit),
    );
    const nextDraft = cloneEventDraft(previousDraft);
    setEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
  }

  function redoEventEdit() {
    const nextDraft = eventRedoStack[0];
    if (!nextDraft) return;

    setEventRedoStack((current) => current.slice(1));
    setEventUndoStack((current) =>
      [cloneEventDraft(eventDraft), ...current].slice(0, editorUndoLimit),
    );
    const restoredDraft = cloneEventDraft(nextDraft);
    setEventDraft(restoredDraft);
    queueEventAutosave(restoredDraft);
  }

  function applyExperience(nextExperience: Experience) {
    const selectedEvent = getSelectedExperienceEvent(
      nextExperience,
      selectedEventId,
    );
    setExperience(nextExperience);
    setExperienceForm({
      description: nextExperience.description,
      title: nextExperience.title,
    });
    setTutorForm(nextExperience.tutor);
    setSelectedEventId(selectedEvent?.id ?? "");
    setEventDraft(eventDraftFromEvent(selectedEvent));
    clearEventUndoHistory();
  }

  async function loadScriptAudioItems(targetExperienceId = experience?.id ?? "") {
    if (!targetExperienceId) return;

    setScriptAudioStatus("loading");
    setScriptAudioError("");
    try {
      const payload = await apiFetch<ScriptAudioPayload>(
        `/api/experiences/${targetExperienceId}/script-audio/`,
      );
      setScriptAudioItems(payload.scripts);
    } catch (loadError) {
      setScriptAudioError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load scripted audio.",
      );
    } finally {
      setScriptAudioStatus("idle");
    }
  }

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

        setUser(me.user);
        applyExperience(nextExperience);
        writeSelectedExperienceId(nextExperience.id);
        void loadScriptAudioItems(nextExperience.id);
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
    };
  }, [experienceId]);

  useEffect(() => {
    return () => {
      if (overviewAutosaveTimer.current) {
        window.clearTimeout(overviewAutosaveTimer.current);
      }
      if (tutorAutosaveTimer.current) {
        window.clearTimeout(tutorAutosaveTimer.current);
      }
      if (eventAutosaveTimer.current) {
        window.clearTimeout(eventAutosaveTimer.current);
      }
      voiceSampleAudioRef.current?.pause();
      voiceSampleAudioRef.current = null;
      stopScriptAudioPreview(false);
    };
  }, []);

  useEffect(() => {
    resizeTextareaToContent(overviewDescriptionRef.current);
  }, [experienceForm.description]);

  useEffect(() => {
    function handleScriptAudioPreviewEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !scriptAudioPreviewRef.current) return;

      stopScriptAudioPreview();
      event.preventDefault();
    }

    document.addEventListener("keydown", handleScriptAudioPreviewEscape, true);
    return () =>
      document.removeEventListener("keydown", handleScriptAudioPreviewEscape, true);
  }, []);

  useEffect(() => {
    function handleEditorHistoryShortcut(event: KeyboardEvent) {
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (isTypingTarget || (!event.ctrlKey && !event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoEventEdit();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        undoEventEdit();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        redoEventEdit();
      }
    }

    document.addEventListener("keydown", handleEditorHistoryShortcut);
    return () =>
      document.removeEventListener("keydown", handleEditorHistoryShortcut);
  }, [eventDraft, eventRedoStack, eventUndoStack]);

  useEffect(() => {
    if (!isEventAddMenuOpen) return;

    function closeEventAddMenuOnPointerDown(event: MouseEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        eventAddBlockRef.current?.contains(target)
      ) {
        return;
      }

      setIsEventAddMenuOpen(false);
    }

    function closeEventAddMenuOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsEventAddMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeEventAddMenuOnPointerDown);
    document.addEventListener("keydown", closeEventAddMenuOnKeyDown);

    return () => {
      document.removeEventListener("mousedown", closeEventAddMenuOnPointerDown);
      document.removeEventListener("keydown", closeEventAddMenuOnKeyDown);
    };
  }, [isEventAddMenuOpen]);

  useEffect(() => {
    if (!isConversationAddMenuOpen) return;

    function closeConversationItemAddMenuOnPointerDown(event: MouseEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        conversationItemAddBlockRef.current?.contains(target)
      ) {
        return;
      }

      setIsConversationAddMenuOpen(false);
    }

    function closeConversationItemAddMenuOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsConversationAddMenuOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      closeConversationItemAddMenuOnPointerDown,
    );
    document.addEventListener("keydown", closeConversationItemAddMenuOnKeyDown);

    return () => {
      document.removeEventListener(
        "mousedown",
        closeConversationItemAddMenuOnPointerDown,
      );
      document.removeEventListener(
        "keydown",
        closeConversationItemAddMenuOnKeyDown,
      );
    };
  }, [isConversationAddMenuOpen]);

  useEffect(() => {
    if (!conversationAddMenuToolId) return;

    function closeConversationAddMenuOnPointerDown(event: MouseEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        conversationAddBlockRef.current?.contains(target)
      ) {
        return;
      }

      setConversationAddMenuToolId("");
    }

    function closeConversationAddMenuOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConversationAddMenuToolId("");
      }
    }

    document.addEventListener("mousedown", closeConversationAddMenuOnPointerDown);
    document.addEventListener("keydown", closeConversationAddMenuOnKeyDown);

    return () => {
      document.removeEventListener(
        "mousedown",
        closeConversationAddMenuOnPointerDown,
      );
      document.removeEventListener("keydown", closeConversationAddMenuOnKeyDown);
    };
  }, [conversationAddMenuToolId]);

  useEffect(() => {
    if (!conversationAddMenuCheckId) return;

    function closeConversationCheckAddMenuOnPointerDown(event: MouseEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        conversationCheckAddBlockRef.current?.contains(target)
      ) {
        return;
      }

      setConversationAddMenuCheckId("");
    }

    function closeConversationCheckAddMenuOnKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setConversationAddMenuCheckId("");
      }
    }

    document.addEventListener(
      "mousedown",
      closeConversationCheckAddMenuOnPointerDown,
    );
    document.addEventListener(
      "keydown",
      closeConversationCheckAddMenuOnKeyDown,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        closeConversationCheckAddMenuOnPointerDown,
      );
      document.removeEventListener(
        "keydown",
        closeConversationCheckAddMenuOnKeyDown,
      );
    };
  }, [conversationAddMenuCheckId]);

  function hasOverviewChanges(draft: ExperienceForm) {
    if (!experience) return false;

    return (
      draft.title !== experience.title ||
      draft.description !== experience.description
    );
  }

  function clearOverviewAutosaveTimer() {
    if (!overviewAutosaveTimer.current) return;
    window.clearTimeout(overviewAutosaveTimer.current);
    overviewAutosaveTimer.current = null;
  }

  function nextOverviewAutosaveVersion() {
    overviewAutosaveVersion.current += 1;
    return overviewAutosaveVersion.current;
  }

  async function persistOverviewDraft(draft: ExperienceForm, version: number) {
    if (!experience || !draft.title.trim()) return true;
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify(draft),
        },
      );

      if (overviewAutosaveVersion.current !== version) return true;

      setExperience(payload.experience);
      setExperienceForm((current) => {
        if (
          current.title !== draft.title ||
          current.description !== draft.description
        ) {
          return current;
        }

        return {
          description: payload.experience.description,
          title: payload.experience.title,
        };
      });
      return true;
    } catch (saveError) {
      if (overviewAutosaveVersion.current === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save experience.",
        );
      }
      return false;
    }
  }

  function queueOverviewAutosave(draft: ExperienceForm) {
    clearOverviewAutosaveTimer();

    if (!draft.title.trim() || !hasOverviewChanges(draft)) return;

    const version = nextOverviewAutosaveVersion();
    overviewAutosaveTimer.current = window.setTimeout(() => {
      overviewAutosaveTimer.current = null;
      void persistOverviewDraft(draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushOverviewAutosave() {
    clearOverviewAutosaveTimer();

    if (!hasOverviewChanges(experienceForm)) return true;

    const version = nextOverviewAutosaveVersion();
    return persistOverviewDraft(experienceForm, version);
  }

  function updateOverviewDraft(field: keyof ExperienceForm, value: string) {
    const nextDraft = {
      ...experienceForm,
      [field]: value,
    };

    setExperienceForm(nextDraft);
    queueOverviewAutosave(nextDraft);
  }

  function hasTutorChanges(draft: TutorSettings) {
    if (!experience) return false;

    return (
      draft.assistantName !== experience.tutor.assistantName ||
      draft.avatarPath !== experience.tutor.avatarPath ||
      draft.classificationModel !== experience.tutor.classificationModel ||
      draft.realtimeModel !== experience.tutor.realtimeModel ||
      draft.scriptActionOffsetMs !== experience.tutor.scriptActionOffsetMs ||
      draft.systemPrompt !== experience.tutor.systemPrompt ||
      draft.voice !== experience.tutor.voice ||
      draft.voiceInstructions !== experience.tutor.voiceInstructions
    );
  }

  function clearTutorAutosaveTimer() {
    if (!tutorAutosaveTimer.current) return;
    window.clearTimeout(tutorAutosaveTimer.current);
    tutorAutosaveTimer.current = null;
  }

  function nextTutorAutosaveVersion() {
    tutorAutosaveVersion.current += 1;
    return tutorAutosaveVersion.current;
  }

  async function persistTutorDraft(draft: TutorSettings, version: number) {
    if (!experience || !draft.assistantName.trim()) return true;
    setIsSavingTutor(true);
    setError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${experience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ tutor: draft }),
        },
      );

      if (tutorAutosaveVersion.current !== version) return true;

      setExperience(payload.experience);
      setTutorForm((current) => {
        if (
          current.assistantName !== draft.assistantName ||
          current.avatarPath !== draft.avatarPath ||
          current.classificationModel !== draft.classificationModel ||
          current.realtimeModel !== draft.realtimeModel ||
          current.scriptActionOffsetMs !== draft.scriptActionOffsetMs ||
          current.systemPrompt !== draft.systemPrompt ||
          current.voice !== draft.voice ||
          current.voiceInstructions !== draft.voiceInstructions
        ) {
          return current;
        }

        return payload.experience.tutor;
      });
      return true;
    } catch (saveError) {
      if (tutorAutosaveVersion.current === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save tutor settings.",
        );
      }
      return false;
    } finally {
      setIsSavingTutor(false);
    }
  }

  function queueTutorAutosave(draft: TutorSettings) {
    clearTutorAutosaveTimer();

    if (!draft.assistantName.trim() || !hasTutorChanges(draft)) return;

    const version = nextTutorAutosaveVersion();
    tutorAutosaveTimer.current = window.setTimeout(() => {
      tutorAutosaveTimer.current = null;
      void persistTutorDraft(draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushTutorAutosave() {
    clearTutorAutosaveTimer();

    if (!hasTutorChanges(tutorForm)) return true;

    const version = nextTutorAutosaveVersion();
    return persistTutorDraft(tutorForm, version);
  }

  function updateTutorDraft<K extends keyof TutorSettings>(
    field: K,
    value: TutorSettings[K],
  ) {
    const nextDraft = {
      ...tutorForm,
      [field]: value,
    };

    setTutorForm(nextDraft);
    queueTutorAutosave(nextDraft);
  }

  function updateTutorModelDraft(realtimeModel: RealtimeModelId) {
    const supportedVoice =
      isRealtimeVoiceSupported(realtimeModel, tutorForm.voice)
        ? tutorForm.voice
        : (realtimeVoiceOptionsForModel(realtimeModel)[0]?.id ?? tutorForm.voice);
    const nextDraft = {
      ...tutorForm,
      realtimeModel,
      voice: supportedVoice,
    };

    setTutorForm(nextDraft);
    queueTutorAutosave(nextDraft);
  }

  function clearEventAutosaveTimer() {
    if (!eventAutosaveTimer.current) return;
    window.clearTimeout(eventAutosaveTimer.current);
    eventAutosaveTimer.current = null;
  }

  function nextEventAutosaveVersion() {
    eventAutosaveVersion.current += 1;
    return eventAutosaveVersion.current;
  }

  async function runEventAutosave(draft: EventDraft, version: number) {
    const persistPromise = persistEventDraft(draft, version);
    eventAutosaveInFlight.current = persistPromise;
    const didSave = await persistPromise;
    if (eventAutosaveInFlight.current === persistPromise) {
      eventAutosaveInFlight.current = null;
    }
    return didSave;
  }

  function getSelectedEventParts() {
    const selectedEvent = getSelectedExperienceEvent(experience, selectedEventId);
    return { selectedEvent };
  }

  function getComparableSelectedEvent() {
    const { selectedEvent } = getSelectedEventParts();
    if (
      selectedEvent &&
      lastPersistedEvent.current?.id === selectedEvent.id
    ) {
      return lastPersistedEvent.current;
    }
    return selectedEvent;
  }

  function hasEventChanges(draft: EventDraft) {
    const selectedEvent = getComparableSelectedEvent();
    if (!selectedEvent) return false;

    if (
      draft.title !== selectedEvent.title ||
      draft.description !== selectedEvent.description ||
      draft.chatInstructions !== (selectedEvent.chatInstructions ?? "")
    ) {
      return true;
    }

    const currentSteps = sortedEventSteps(selectedEvent.steps);
    if (draft.steps.length !== currentSteps.length) return true;

    const hasStepChanges = draft.steps.some((draftStep) => {
      const currentStep = currentSteps.find((step) => step.id === draftStep.id);
      if (!currentStep) return true;

      return (
        JSON.stringify(comparableStepDraft(draftStep)) !==
        JSON.stringify(comparableStep(currentStep))
      );
    });
    if (hasStepChanges) return true;

    const currentTools = sortedEventChatTools(selectedEvent.chatTools);
    if (draft.chatTools.length !== currentTools.length) return true;

    const hasToolChanges = draft.chatTools.some((draftTool) => {
      const currentTool = currentTools.find((tool) => tool.id === draftTool.id);
      if (!currentTool) return true;

      return (
        JSON.stringify(comparableChatToolDraft(draftTool)) !==
        JSON.stringify(comparableChatTool(currentTool))
      );
    });
    if (hasToolChanges) return true;

    const currentChecks = sortedEventConversationChecks(
      selectedEvent.conversationChecks ?? [],
    );
    if (draft.conversationChecks.length !== currentChecks.length) return true;

    const hasCheckChanges = draft.conversationChecks.some((draftCheck) => {
      const currentCheck = currentChecks.find(
        (check) => check.id === draftCheck.id,
      );
      if (!currentCheck) return true;

      return (
        JSON.stringify(comparableConversationCheckDraft(draftCheck)) !==
        JSON.stringify(comparableConversationCheck(currentCheck))
      );
    });
    if (hasCheckChanges) return true;

    const currentGroups = sortedEventClassifierGroups(
      selectedEvent.classifierGroups ?? [],
    );
    if (draft.classifierGroups.length !== currentGroups.length) return true;

    return draft.classifierGroups.some((draftGroup) => {
      const currentGroup = currentGroups.find(
        (group) => group.id === draftGroup.id,
      );
      if (!currentGroup) return true;

      if (
        JSON.stringify(comparableClassifierGroupDraft(draftGroup)) !==
        JSON.stringify(comparableClassifierGroup(currentGroup))
      ) {
        return true;
      }

      const currentClassifiers = sortedEventClassifiers(
        currentGroup.classifiers ?? [],
      );
      if (draftGroup.classifiers.length !== currentClassifiers.length) {
        return true;
      }

      return draftGroup.classifiers.some((draftClassifier) => {
        const currentClassifier = currentClassifiers.find(
          (classifier) => classifier.id === draftClassifier.id,
        );
        if (!currentClassifier) return true;

        return (
          JSON.stringify(comparableClassifierDraft(draftClassifier)) !==
          JSON.stringify(comparableClassifier(currentClassifier))
        );
      });
    });
  }

  async function persistEventDraft(draft: EventDraft, version: number) {
    const { selectedEvent: selectedEventState } = getSelectedEventParts();
    const selectedEvent =
      selectedEventState &&
      lastPersistedEvent.current?.id === selectedEventState.id
        ? lastPersistedEvent.current
        : selectedEventState;
    if (!experience || !selectedEvent || !draft.title.trim()) {
      return true;
    }

    setError("");

    try {
      let persistedEvent = selectedEvent;
      const currentSteps = sortedEventSteps(selectedEvent.steps);
      const currentTools = sortedEventChatTools(selectedEvent.chatTools);
      const currentChecks = sortedEventConversationChecks(
        selectedEvent.conversationChecks ?? [],
      );
      const currentGroups = sortedEventClassifierGroups(
        selectedEvent.classifierGroups ?? [],
      );

      if (
        draft.title !== selectedEvent.title ||
        draft.description !== selectedEvent.description ||
        draft.chatInstructions !== (selectedEvent.chatInstructions ?? "")
      ) {
        const eventPayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              chatInstructions: draft.chatInstructions,
              description: draft.description,
              title: draft.title,
            }),
          },
        );
        persistedEvent = eventPayload.event;

        if (eventAutosaveVersion.current === version) {
          setExperience((current) =>
            current && current.id === experience.id
              ? replaceExperienceEvent(current, eventPayload.event)
              : current,
          );
        }
      }

      const createdStepIdByDraftId = new Map<string, string>();
      let latestStructuralEvent: ExperienceEvent | null = null;
      const currentStepIds = new Set(currentSteps.map((step) => step.id));
      const draftStepIds = new Set(draft.steps.map((step) => step.id));

      for (const draftStep of draft.steps) {
        if (currentStepIds.has(draftStep.id)) continue;

        const stepPayload = await apiFetch<{
          event: ExperienceEvent;
          step: EventActionStep;
        }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/`,
          {
            method: "POST",
            body: JSON.stringify({
              actionType: draftStep.actionType,
              condition: normalizedStepCondition(draftStep.condition),
              config: draftStep.config,
              enabled: draftStep.enabled,
              label: draftStep.label,
            }),
          },
        );
        createdStepIdByDraftId.set(draftStep.id, stepPayload.step.id);
        eventStepIdRemap.current.set(draftStep.id, stepPayload.step.id);
        latestStructuralEvent = stepPayload.event;
      }

      for (const currentStep of currentSteps) {
        if (draftStepIds.has(currentStep.id)) continue;

        const deletePayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/${currentStep.id}/`,
          {
            method: "DELETE",
          },
        );
        latestStructuralEvent = deletePayload.event;
      }

      if (latestStructuralEvent) {
        const desiredStepIds = draft.steps.map(
          (step) => createdStepIdByDraftId.get(step.id) ?? step.id,
        );
        const latestStepIds = sortedEventSteps(latestStructuralEvent.steps).map(
          (step) => step.id,
        );
        const hasSameStepSet =
          desiredStepIds.length === latestStepIds.length &&
          desiredStepIds.every((stepId) => latestStepIds.includes(stepId));
        const isSameOrder =
          hasSameStepSet &&
          desiredStepIds.every((stepId, index) => stepId === latestStepIds[index]);

        if (hasSameStepSet && !isSameOrder) {
          const reorderPayload = await apiFetch<{ event: ExperienceEvent }>(
            `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/reorder/`,
            {
              method: "POST",
              body: JSON.stringify({ stepIds: desiredStepIds }),
            },
          );
          latestStructuralEvent = reorderPayload.event;
        }

        if (eventAutosaveVersion.current === version) {
          const structuralEvent = latestStructuralEvent;
          persistedEvent = structuralEvent;
          setExperience((current) =>
            current && current.id === experience.id
              ? replaceExperienceEvent(current, structuralEvent)
              : current,
          );
          setEventDraft((current) =>
            JSON.stringify(current) === JSON.stringify(draft)
              ? eventDraftFromEvent(structuralEvent)
              : current,
          );
        }
      }

      let latestToolStructuralEvent: ExperienceEvent | null = null;
      const knownToolIds = new Set(currentTools.map((tool) => tool.id));
      const draftToolIds = new Set(draft.chatTools.map((tool) => tool.id));

      for (const draftTool of draft.chatTools) {
        if (knownToolIds.has(draftTool.id)) continue;

        const toolPayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/`,
          {
            method: "POST",
            body: JSON.stringify(chatToolPayloadFromDraft(draftTool)),
          },
        );
        const createdTool = sortedEventChatTools(toolPayload.event.chatTools).find(
          (tool) => !knownToolIds.has(tool.id),
        );
        if (createdTool) {
          eventToolIdRemap.current.set(draftTool.id, createdTool.id);
          knownToolIds.add(createdTool.id);
        }
        latestToolStructuralEvent = toolPayload.event;
      }

      for (const currentTool of currentTools) {
        if (draftToolIds.has(currentTool.id)) continue;

        const deletePayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/${currentTool.id}/`,
          {
            method: "DELETE",
          },
        );
        latestToolStructuralEvent = deletePayload.event;
      }

      if (latestToolStructuralEvent && eventAutosaveVersion.current === version) {
        persistedEvent = latestToolStructuralEvent;
        setExperience((current) =>
          current && current.id === experience.id
            ? replaceExperienceEvent(current, latestToolStructuralEvent)
            : current,
        );
        setEventDraft((current) =>
          JSON.stringify(current) === JSON.stringify(draft)
            ? eventDraftFromEvent(latestToolStructuralEvent)
            : current,
        );
      }

      let latestCheckStructuralEvent: ExperienceEvent | null = null;
      const knownCheckIds = new Set(currentChecks.map((check) => check.id));
      const draftCheckIds = new Set(draft.conversationChecks.map((check) => check.id));

      for (const draftCheck of draft.conversationChecks) {
        if (knownCheckIds.has(draftCheck.id)) continue;

        const checkPayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/`,
          {
            method: "POST",
            body: JSON.stringify(conversationCheckPayloadFromDraft(draftCheck)),
          },
        );
        const createdCheck = sortedEventConversationChecks(
          checkPayload.event.conversationChecks ?? [],
        ).find((check) => !knownCheckIds.has(check.id));
        if (createdCheck) {
          eventCheckIdRemap.current.set(draftCheck.id, createdCheck.id);
          knownCheckIds.add(createdCheck.id);
        }
        latestCheckStructuralEvent = checkPayload.event;
      }

      for (const currentCheck of currentChecks) {
        if (draftCheckIds.has(currentCheck.id)) continue;

        const deletePayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/${currentCheck.id}/`,
          {
            method: "DELETE",
          },
        );
        latestCheckStructuralEvent = deletePayload.event;
      }

      if (latestCheckStructuralEvent && eventAutosaveVersion.current === version) {
        persistedEvent = latestCheckStructuralEvent;
        setExperience((current) =>
          current && current.id === experience.id
            ? replaceExperienceEvent(current, latestCheckStructuralEvent)
            : current,
        );
        setEventDraft((current) =>
          JSON.stringify(current) === JSON.stringify(draft)
            ? eventDraftFromEvent(latestCheckStructuralEvent)
            : current,
        );
      }

      let latestGroupStructuralEvent: ExperienceEvent | null = null;
      const knownGroupIds = new Set(currentGroups.map((group) => group.id));
      const draftGroupIds = new Set(draft.classifierGroups.map((group) => group.id));

      for (const draftGroup of draft.classifierGroups) {
        if (knownGroupIds.has(draftGroup.id)) continue;

        const groupPayload = await apiFetch<{
          event: ExperienceEvent;
          group: EventClassifierGroup;
        }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/`,
          {
            method: "POST",
            body: JSON.stringify(classifierGroupPayloadFromDraft(draftGroup)),
          },
        );
        const createdGroupId = groupPayload.group.id;
        eventGroupIdRemap.current.set(draftGroup.id, createdGroupId);
        knownGroupIds.add(createdGroupId);
        latestGroupStructuralEvent = groupPayload.event;

        for (const draftClassifier of draftGroup.classifiers) {
          const classifierPayload = await apiFetch<{
            classifier: EventClassifier;
            event: ExperienceEvent;
          }>(
            `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${createdGroupId}/classifiers/`,
            {
              method: "POST",
              body: JSON.stringify(classifierPayloadFromDraft(draftClassifier)),
            },
          );
          eventClassifierIdRemap.current.set(
            `${draftGroup.id}:${draftClassifier.id}`,
            classifierPayload.classifier.id,
          );
          latestGroupStructuralEvent = classifierPayload.event;
        }
      }

      for (const currentGroup of currentGroups) {
        if (draftGroupIds.has(currentGroup.id)) continue;

        const deletePayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${currentGroup.id}/`,
          {
            method: "DELETE",
          },
        );
        latestGroupStructuralEvent = deletePayload.event;
      }

      for (const draftGroup of draft.classifierGroups) {
        const currentGroup = currentGroups.find((group) => group.id === draftGroup.id);
        if (!currentGroup) continue;

        const currentClassifiers = sortedEventClassifiers(
          currentGroup.classifiers ?? [],
        );
        const knownClassifierIds = new Set(
          currentClassifiers.map((classifier) => classifier.id),
        );
        const draftClassifierIds = new Set(
          draftGroup.classifiers.map((classifier) => classifier.id),
        );

        for (const draftClassifier of draftGroup.classifiers) {
          if (knownClassifierIds.has(draftClassifier.id)) continue;

          const classifierPayload = await apiFetch<{
            classifier: EventClassifier;
            event: ExperienceEvent;
          }>(
            `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${currentGroup.id}/classifiers/`,
            {
              method: "POST",
              body: JSON.stringify(classifierPayloadFromDraft(draftClassifier)),
            },
          );
          eventClassifierIdRemap.current.set(
            `${draftGroup.id}:${draftClassifier.id}`,
            classifierPayload.classifier.id,
          );
          knownClassifierIds.add(classifierPayload.classifier.id);
          latestGroupStructuralEvent = classifierPayload.event;
        }

        for (const currentClassifier of currentClassifiers) {
          if (draftClassifierIds.has(currentClassifier.id)) continue;

          const deletePayload = await apiFetch<{ event: ExperienceEvent }>(
            `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${currentGroup.id}/classifiers/${currentClassifier.id}/`,
            {
              method: "DELETE",
            },
          );
          latestGroupStructuralEvent = deletePayload.event;
        }
      }

      if (latestGroupStructuralEvent && eventAutosaveVersion.current === version) {
        persistedEvent = latestGroupStructuralEvent;
        setExperience((current) =>
          current && current.id === experience.id
            ? replaceExperienceEvent(current, latestGroupStructuralEvent)
            : current,
        );
        setEventDraft((current) =>
          JSON.stringify(current) === JSON.stringify(draft)
            ? eventDraftFromEvent(latestGroupStructuralEvent)
            : current,
        );
      }

      for (const draftStep of draft.steps) {
        const currentStep = currentSteps.find((step) => step.id === draftStep.id);
        if (!currentStep) continue;

        if (
          JSON.stringify(comparableStepDraft(draftStep)) ===
          JSON.stringify(comparableStep(currentStep))
        ) {
          continue;
        }

        const stepPayload = await apiFetch<{ step: EventActionStep }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/${draftStep.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              actionType: draftStep.actionType,
              condition: normalizedStepCondition(draftStep.condition),
              config: draftStep.config,
              enabled: draftStep.enabled,
              label: draftStep.label,
              sortOrder: draftStep.sortOrder,
            }),
          },
        );
        persistedEvent = replaceEventStepInEvent(persistedEvent, stepPayload.step);

        if (eventAutosaveVersion.current === version) {
          setExperience((current) =>
            current && current.id === experience.id
              ? replaceExperienceEventStep(
                  current,
                  selectedEvent.id,
                  stepPayload.step,
                )
              : current,
          );
        }
      }

      for (const draftTool of draft.chatTools) {
        const currentTool = currentTools.find((tool) => tool.id === draftTool.id);
        if (!currentTool) continue;

        if (
          JSON.stringify(comparableChatToolDraft(draftTool)) ===
          JSON.stringify(comparableChatTool(currentTool))
        ) {
          continue;
        }

        const toolPayload = await apiFetch<{ tool: EventChatTool }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/${draftTool.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify(chatToolPayloadFromDraft(draftTool)),
          },
        );
        persistedEvent = replaceEventToolInEvent(persistedEvent, toolPayload.tool);

        if (eventAutosaveVersion.current === version) {
          setExperience((current) =>
            current && current.id === experience.id
              ? replaceExperienceEventTool(
                  current,
                  selectedEvent.id,
                  toolPayload.tool,
                )
              : current,
          );
        }
      }

      for (const draftCheck of draft.conversationChecks) {
        const currentCheck = currentChecks.find(
          (check) => check.id === draftCheck.id,
        );
        if (!currentCheck) continue;

        if (
          JSON.stringify(comparableConversationCheckDraft(draftCheck)) ===
          JSON.stringify(comparableConversationCheck(currentCheck))
        ) {
          continue;
        }

        const checkPayload = await apiFetch<{ check: EventConversationCheck }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/${draftCheck.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify(conversationCheckPayloadFromDraft(draftCheck)),
          },
        );
        persistedEvent = replaceEventCheckInEvent(persistedEvent, checkPayload.check);

        if (eventAutosaveVersion.current === version) {
          setExperience((current) =>
            current && current.id === experience.id
              ? replaceExperienceEventCheck(
                  current,
                  selectedEvent.id,
                  checkPayload.check,
                )
              : current,
          );
        }
      }

      for (const draftGroup of draft.classifierGroups) {
        const currentGroup = currentGroups.find(
          (group) => group.id === draftGroup.id,
        );
        if (!currentGroup) continue;

        if (
          JSON.stringify(comparableClassifierGroupDraft(draftGroup)) !==
          JSON.stringify(comparableClassifierGroup(currentGroup))
        ) {
          const groupPayload = await apiFetch<{ group: EventClassifierGroup }>(
            `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${draftGroup.id}/`,
            {
              method: "PATCH",
              body: JSON.stringify(classifierGroupPayloadFromDraft(draftGroup)),
            },
          );
          persistedEvent = replaceEventClassifierGroupInEvent(
            persistedEvent,
            groupPayload.group,
          );

          if (eventAutosaveVersion.current === version) {
            setExperience((current) =>
              current && current.id === experience.id
                ? replaceExperienceClassifierGroup(
                    current,
                    selectedEvent.id,
                    groupPayload.group,
                  )
                : current,
            );
          }
        }

        const currentClassifiers = sortedEventClassifiers(
          currentGroup.classifiers ?? [],
        );
        for (const draftClassifier of draftGroup.classifiers) {
          const currentClassifier = currentClassifiers.find(
            (classifier) => classifier.id === draftClassifier.id,
          );
          if (!currentClassifier) continue;

          if (
            JSON.stringify(comparableClassifierDraft(draftClassifier)) ===
            JSON.stringify(comparableClassifier(currentClassifier))
          ) {
            continue;
          }

          const classifierPayload = await apiFetch<{
            classifier: EventClassifier;
          }>(
            `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${draftGroup.id}/classifiers/${draftClassifier.id}/`,
            {
              method: "PATCH",
              body: JSON.stringify(classifierPayloadFromDraft(draftClassifier)),
            },
          );
          persistedEvent = replaceEventClassifierInEvent(
            persistedEvent,
            draftGroup.id,
            classifierPayload.classifier,
          );

          if (eventAutosaveVersion.current === version) {
            setExperience((current) =>
              current && current.id === experience.id
                ? replaceExperienceClassifier(
                    current,
                    selectedEvent.id,
                    draftGroup.id,
                    classifierPayload.classifier,
                  )
                : current,
            );
          }
        }
      }

      if (eventAutosaveVersion.current === version) {
        lastPersistedEvent.current = persistedEvent;
        setExperience((current) =>
          current && current.id === experience.id
            ? replaceExperienceEvent(current, persistedEvent)
            : current,
        );
        setEventDraft((current) =>
          JSON.stringify(current) === JSON.stringify(draft)
            ? eventDraftFromEvent(persistedEvent)
            : current,
        );
      }

      return true;
    } catch (saveError) {
      if (eventAutosaveVersion.current === version) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save event.",
        );
      }
      return false;
    }
  }

  function queueEventAutosave(draft: EventDraft) {
    clearEventAutosaveTimer();

    if (!draft.title.trim() || !hasEventChanges(draft)) return;

    const version = nextEventAutosaveVersion();
    eventAutosaveTimer.current = window.setTimeout(() => {
      eventAutosaveTimer.current = null;
      void runEventAutosave(draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushEventAutosave() {
    clearEventAutosaveTimer();

    if (eventAutosaveInFlight.current) {
      const didSaveInFlight = await eventAutosaveInFlight.current;
      if (!didSaveInFlight) return false;
    }

    if (!hasEventChanges(eventDraft)) return true;

    const version = nextEventAutosaveVersion();
    return runEventAutosave(eventDraft, version);
  }

  function updateEventDraft(
    field: "chatInstructions" | "description" | "title",
    value: string,
  ) {
    const nextDraft = {
      ...eventDraft,
      [field]: value,
    };

    stageEventDraft(nextDraft);
  }

  function updateEventStepDraft(
    stepId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) {
    const nextDraft = {
      ...eventDraft,
      steps: eventDraft.steps.map((step) =>
        step.id === stepId ? updater(step) : step,
      ),
    };

    stageEventDraft(nextDraft);
  }

  function updateEventStepConfig(
    stepId: string,
    key: string,
    value: unknown,
  ) {
    updateEventStepDraft(stepId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventStepConfigPatch(
    stepId: string,
    patch: Record<string, unknown>,
  ) {
    updateEventStepDraft(stepId, (step) => ({
      ...step,
      config: {
        ...step.config,
        ...patch,
      },
    }));
  }

  function updateEventStepCondition(
    stepId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventStepDraft(stepId, (step) => {
      return {
        ...step,
        condition: mergeConditionDraft(step.condition, condition),
      };
    });
  }

  function updateEventChatToolDraft(
    toolId: string,
    updater: (tool: EventChatToolDraft) => EventChatToolDraft,
  ) {
    const nextDraft = {
      ...eventDraft,
      chatTools: eventDraft.chatTools.map((tool) =>
        tool.id === toolId ? updater(tool) : tool,
      ),
    };

    stageEventDraft(nextDraft);
  }

  function updateEventChatToolDraftField<K extends keyof EventChatToolDraft>(
    toolId: string,
    field: K,
    value: EventChatToolDraft[K],
  ) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      [field]: value,
    }));
  }

  function updateEventChatCaptureDraft(
    toolId: string,
    captureId: string,
    updater: (capture: EventChatCaptureDraft) => EventChatCaptureDraft,
  ) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      captures: tool.captures.map((capture) =>
        capture.id === captureId ? updater(capture) : capture,
      ),
    }));
  }

  function addEventChatCapture(toolId: string) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      captures: [
        ...tool.captures,
        {
          description: "",
          id: localMessageId("capture"),
          saveAs: "",
        },
      ],
    }));
  }

  function deleteEventChatCapture(toolId: string, captureId: string) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      captures: tool.captures.filter((capture) => capture.id !== captureId),
    }));
  }

  function updateEventChatToolActionDraft(
    toolId: string,
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      handlerActions: tool.handlerActions.map((step) =>
        step.id === actionId ? updater(step) : step,
      ),
    }));
  }

  function updateEventChatToolActionConfig(
    toolId: string,
    actionId: string,
    key: string,
    value: unknown,
  ) {
    updateEventChatToolActionDraft(toolId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventChatToolActionConfigPatch(
    toolId: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) {
    updateEventChatToolActionDraft(toolId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        ...patch,
      },
    }));
  }

  function updateEventChatToolActionCondition(
    toolId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventChatToolActionDraft(toolId, actionId, (step) => {
      return {
        ...step,
        condition: mergeConditionDraft(step.condition, condition),
      };
    });
  }

  function addEventChatToolAction(
    toolId: string,
    actionType: EventActionStep["actionType"],
  ) {
    const actionId = localMessageId("tool-action");
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      handlerActions: [
        ...tool.handlerActions,
        {
          actionType,
          condition: {
            key: "",
            type: "always",
            value: "",
          },
          config: defaultStepConfigForEvent(
            actionType,
            editorEvents,
            selectedEventId,
          ),
          enabled: true,
          id: actionId,
          label: defaultStepLabel(actionType),
          sortOrder: tool.handlerActions.length,
        },
      ],
    }));
    openExpandedItem(actionId);
    setConversationAddMenuToolId("");
  }

  function deleteEventChatToolAction(toolId: string, actionId: string) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      handlerActions: tool.handlerActions
        .filter((step) => step.id !== actionId)
        .map((step, index) => ({ ...step, sortOrder: index })),
    }));
  }

  function updateEventConversationCheckDraft(
    checkId: string,
    updater: (check: EventConversationCheckDraft) => EventConversationCheckDraft,
  ) {
    const nextDraft = {
      ...eventDraft,
      conversationChecks: eventDraft.conversationChecks.map((check) =>
        check.id === checkId ? updater(check) : check,
      ),
    };

    stageEventDraft(nextDraft);
  }

  function updateEventConversationCheckDraftField<
    K extends keyof EventConversationCheckDraft,
  >(
    checkId: string,
    field: K,
    value: EventConversationCheckDraft[K],
  ) {
    updateEventConversationCheckDraft(checkId, (check) => ({
      ...check,
      [field]: value,
    }));
  }

  function updateEventConversationCheckActionDraft(
    checkId: string,
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) {
    updateEventConversationCheckDraft(checkId, (check) => ({
      ...check,
      handlerActions: check.handlerActions.map((step) =>
        step.id === actionId ? updater(step) : step,
      ),
    }));
  }

  function updateEventConversationCheckActionConfig(
    checkId: string,
    actionId: string,
    key: string,
    value: unknown,
  ) {
    updateEventConversationCheckActionDraft(checkId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventConversationCheckActionConfigPatch(
    checkId: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) {
    updateEventConversationCheckActionDraft(checkId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        ...patch,
      },
    }));
  }

  function updateEventConversationCheckActionCondition(
    checkId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventConversationCheckActionDraft(checkId, actionId, (step) => {
      return {
        ...step,
        condition: mergeConditionDraft(step.condition, condition),
      };
    });
  }

  function addEventConversationCheckAction(
    checkId: string,
    actionType: EventActionStep["actionType"],
  ) {
    const actionId = localMessageId("check-action");
    updateEventConversationCheckDraft(checkId, (check) => ({
      ...check,
      handlerActions: [
        ...check.handlerActions,
        {
          actionType,
          condition: {
            key: "",
            type: "always",
            value: "",
          },
          config: defaultStepConfigForEvent(
            actionType,
            editorEvents,
            selectedEventId,
          ),
          enabled: true,
          id: actionId,
          label: defaultStepLabel(actionType),
          sortOrder: check.handlerActions.length,
        },
      ],
    }));
    openExpandedItem(actionId);
    setConversationAddMenuCheckId("");
  }

  function deleteEventConversationCheckAction(checkId: string, actionId: string) {
    updateEventConversationCheckDraft(checkId, (check) => ({
      ...check,
      handlerActions: check.handlerActions
        .filter((step) => step.id !== actionId)
        .map((step, index) => ({ ...step, sortOrder: index })),
    }));
  }

  function updateEventClassifierGroupDraft(
    groupId: string,
    updater: (group: EventClassifierGroupDraft) => EventClassifierGroupDraft,
  ) {
    const nextDraft = {
      ...eventDraft,
      classifierGroups: eventDraft.classifierGroups.map((group) =>
        group.id === groupId ? updater(group) : group,
      ),
    };

    stageEventDraft(nextDraft);
  }

  function updateEventClassifierGroupDraftField<
    K extends keyof EventClassifierGroupDraft,
  >(
    groupId: string,
    field: K,
    value: EventClassifierGroupDraft[K],
  ) {
    updateEventClassifierGroupDraft(groupId, (group) => ({
      ...group,
      [field]: value,
    }));
  }

  function updateEventClassifierDraft(
    groupId: string,
    classifierId: string,
    updater: (classifier: EventClassifierDraft) => EventClassifierDraft,
  ) {
    updateEventClassifierGroupDraft(groupId, (group) => ({
      ...group,
      classifiers: group.classifiers.map((classifier) =>
        classifier.id === classifierId ? updater(classifier) : classifier,
      ),
    }));
  }

  function updateEventClassifierDraftField<K extends keyof EventClassifierDraft>(
    groupId: string,
    classifierId: string,
    field: K,
    value: EventClassifierDraft[K],
  ) {
    updateEventClassifierDraft(groupId, classifierId, (classifier) => ({
      ...classifier,
      [field]: value,
    }));
  }

  function updateEventClassifierCondition(
    groupId: string,
    classifierId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventClassifierDraft(groupId, classifierId, (classifier) => ({
      ...classifier,
      condition: mergeConditionDraft(classifier.condition, condition),
    }));
  }

  function updateEventClassifierGroupActionDraft(
    groupId: string,
    actionId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) {
    updateEventClassifierGroupDraft(groupId, (group) => ({
      ...group,
      handlerActions: group.handlerActions.map((step) =>
        step.id === actionId ? updater(step) : step,
      ),
    }));
  }

  function updateEventClassifierGroupActionConfig(
    groupId: string,
    actionId: string,
    key: string,
    value: unknown,
  ) {
    updateEventClassifierGroupActionDraft(groupId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventClassifierGroupActionConfigPatch(
    groupId: string,
    actionId: string,
    patch: Record<string, unknown>,
  ) {
    updateEventClassifierGroupActionDraft(groupId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        ...patch,
      },
    }));
  }

  function updateEventClassifierGroupActionCondition(
    groupId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventClassifierGroupActionDraft(groupId, actionId, (step) => ({
      ...step,
      condition: mergeConditionDraft(step.condition, condition),
    }));
  }

  function addEventClassifierGroupAction(
    groupId: string,
    actionType: EventActionStep["actionType"],
  ) {
    const actionId = localMessageId("classifier-action");
    updateEventClassifierGroupDraft(groupId, (group) => ({
      ...group,
      handlerActions: [
        ...group.handlerActions,
        {
          actionType,
          condition: {
            key: "",
            type: "always",
            value: "",
          },
          config: defaultStepConfigForEvent(
            actionType,
            editorEvents,
            selectedEventId,
          ),
          enabled: true,
          id: actionId,
          label: defaultStepLabel(actionType),
          sortOrder: group.handlerActions.length,
        },
      ],
    }));
    openExpandedItem(actionId);
    setConversationAddMenuCheckId("");
  }

  function deleteEventClassifierGroupAction(groupId: string, actionId: string) {
    updateEventClassifierGroupDraft(groupId, (group) => ({
      ...group,
      handlerActions: group.handlerActions
        .filter((step) => step.id !== actionId)
        .map((step, index) => ({ ...step, sortOrder: index })),
    }));
  }

  function applyUpdatedEvent(nextEvent: ExperienceEvent, resetHistory = true) {
    if (!experience) return;

    lastPersistedEvent.current = nextEvent;
    const nextExperience = replaceExperienceEvent(experience, nextEvent);
    setExperience(nextExperience);
    setSelectedEventId(nextEvent.id);
    setEventDraft(eventDraftFromEvent(nextEvent));
    if (resetHistory) {
      clearEventUndoHistory();
    }
  }

  function persistedDraftForUndo(selectedEvent: ExperienceEvent) {
    const persistedEvent =
      lastPersistedEvent.current?.id === selectedEvent.id
        ? lastPersistedEvent.current
        : selectedEvent;
    return eventDraftFromEvent(persistedEvent);
  }

  async function selectEditorEvent(nextEventId: string) {
    if (!experience || nextEventId === selectedEventId) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    const nextEvent = getSelectedExperienceEvent(experience, nextEventId);
    setSelectedEventId(nextEvent?.id ?? "");
    setEventDraft(eventDraftFromEvent(nextEvent));
    clearEventUndoHistory();
    resetExpandedItems();
    setDraggingStepId("");
    setIsEventAddMenuOpen(false);
    setIsConversationAddMenuOpen(false);
    setConversationAddMenuToolId("");
    setConversationAddMenuCheckId("");
  }

  async function createEditorEvent() {
    if (!experience) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/`,
        {
          method: "POST",
          body: JSON.stringify({ description: "", title: "New event" }),
        },
      );

      setExperience((current) =>
        current && current.id === experience.id
          ? addExperienceEvent(current, payload.event)
          : current,
      );
      setSelectedEventId(payload.event.id);
      setEventDraft(eventDraftFromEvent(payload.event));
      clearEventUndoHistory();
      resetExpandedItems();
      setDraggingStepId("");
      setIsEventAddMenuOpen(false);
      setIsConversationAddMenuOpen(false);
      setConversationAddMenuToolId("");
      setConversationAddMenuCheckId("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create event.",
      );
    }
  }

  async function deleteEditorEvent() {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent || editorEvents.length <= 1) return;

    const didConfirm = window.confirm(
      `Delete event "${selectedEvent.title || selectedEvent.slug}"?`,
    );
    if (!didConfirm) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");
    setDeletingEventId(selectedEvent.id);

    try {
      const payload = await apiFetch<{ events: ExperienceEvent[] }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/`,
        {
          method: "DELETE",
        },
      );
      const nextEvents = sortedExperienceEvents(payload.events);
      const nextSelectedEvent =
        nextEvents.find((event) => event.isStart) ?? nextEvents[0] ?? null;

      setExperience({
        ...experience,
        events: nextEvents,
      });
      lastPersistedEvent.current = nextSelectedEvent;
      setSelectedEventId(nextSelectedEvent?.id ?? "");
      setEventDraft(eventDraftFromEvent(nextSelectedEvent));
      clearEventUndoHistory();
      resetExpandedItems();
      setDraggingStepId("");
      setIsEventAddMenuOpen(false);
      setIsConversationAddMenuOpen(false);
      setConversationAddMenuToolId("");
      setConversationAddMenuCheckId("");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete event.",
      );
    } finally {
      setDeletingEventId("");
    }
  }

  async function addEventStep(actionType: EventActionStep["actionType"]) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo();
      const existingStepIds = new Set(selectedEvent.steps.map((step) => step.id));
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/`,
        {
          method: "POST",
          body: JSON.stringify({
            actionType,
            config: defaultStepConfigForEvent(
              actionType,
              experience.events,
              selectedEvent.id,
            ),
            label: defaultStepLabel(actionType),
          }),
        },
      );
      applyUpdatedEvent(payload.event, false);
      const nextSortedSteps = sortedEventSteps(payload.event.steps);
      const newStep =
        nextSortedSteps.find((step) => !existingStepIds.has(step.id)) ??
        nextSortedSteps[nextSortedSteps.length - 1];
      if (newStep) {
        openExpandedItem(newStep.id);
      }
      setIsEventAddMenuOpen(false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not add action step.",
      );
    }
  }

  async function addEventChatTool() {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo();
      const existingNames = new Set(
        selectedEvent.chatTools.map((tool) => tool.name),
      );
      let toolName = "chat_exit";
      let suffix = 2;
      while (existingNames.has(toolName)) {
        toolName = `chat_exit_${suffix}`;
        suffix += 1;
      }

      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/`,
        {
          method: "POST",
          body: JSON.stringify(
            {
              ...defaultChatToolPayload(experience.events, selectedEvent.id),
              name: toolName,
            },
          ),
        },
      );
      applyUpdatedEvent(payload.event, false);
      const nextTool = sortedEventChatTools(payload.event.chatTools).find(
        (tool) => !selectedEvent.chatTools.some((current) => current.id === tool.id),
      );
      if (nextTool) {
        openExpandedItem(nextTool.id);
      }
      setIsConversationAddMenuOpen(false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not add FC route.",
      );
    }
  }

  async function addEventConversationCheck() {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo();
      const existingCheckIds = new Set(
        (selectedEvent.conversationChecks ?? []).map((check) => check.id),
      );
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/`,
        {
          method: "POST",
          body: JSON.stringify(
            defaultConversationCheckPayload(experience.events, selectedEvent.id),
          ),
        },
      );
      applyUpdatedEvent(payload.event, false);
      const nextCheck = sortedEventConversationChecks(
        payload.event.conversationChecks ?? [],
      ).find((check) => !existingCheckIds.has(check.id));
      if (nextCheck) {
        openExpandedItem(nextCheck.id);
      }
      setIsConversationAddMenuOpen(false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not add conversation check.",
      );
    }
  }

  async function addEventClassifierGroup() {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo();
      const existingGroupIds = new Set(
        (selectedEvent.classifierGroups ?? []).map((group) => group.id),
      );
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/`,
        {
          method: "POST",
          body: JSON.stringify(
            defaultClassifierGroupPayload(experience.events, selectedEvent.id),
          ),
        },
      );
      applyUpdatedEvent(payload.event, false);
      const nextGroup = sortedEventClassifierGroups(
        payload.event.classifierGroups ?? [],
      ).find((group) => !existingGroupIds.has(group.id));
      if (nextGroup) {
        openExpandedItem(nextGroup.id);
      }
      setIsConversationAddMenuOpen(false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not add classifier group.",
      );
    }
  }

  async function addEventClassifier(groupId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo();
      const resolvedGroupId = eventGroupIdRemap.current.get(groupId) ?? groupId;
      const group = selectedEvent.classifierGroups.find(
        (candidate) =>
          candidate.id === groupId || candidate.id === resolvedGroupId,
      );
      const existingNames = new Set(
        (group?.classifiers ?? []).map((classifier) => classifier.name),
      );
      let name = "classifier";
      let suffix = 2;
      while (existingNames.has(name)) {
        name = `classifier_${suffix}`;
        suffix += 1;
      }
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${resolvedGroupId}/classifiers/`,
        {
          method: "POST",
          body: JSON.stringify({
            condition: {},
            enabled: true,
            model: "",
            name,
            prompt: "Return mentioned=true when the latest user message matches.",
            schema: {},
          }),
        },
      );
      applyUpdatedEvent(payload.event, false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not add classifier.",
      );
    }
  }

  async function deleteEventChatTool(toolId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo(persistedDraftForUndo(selectedEvent));
      const resolvedToolId = eventToolIdRemap.current.get(toolId) ?? toolId;
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/${resolvedToolId}/`,
        {
          method: "DELETE",
        },
      );
      eventToolIdRemap.current.delete(toolId);
      eventToolIdRemap.current.delete(resolvedToolId);
      applyUpdatedEvent(payload.event, false);
      closeExpandedItem(toolId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete FC route.",
      );
    }
  }

  async function deleteEventConversationCheck(checkId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo(persistedDraftForUndo(selectedEvent));
      const resolvedCheckId = eventCheckIdRemap.current.get(checkId) ?? checkId;
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/${resolvedCheckId}/`,
        {
          method: "DELETE",
        },
      );
      eventCheckIdRemap.current.delete(checkId);
      eventCheckIdRemap.current.delete(resolvedCheckId);
      applyUpdatedEvent(payload.event, false);
      closeExpandedItem(checkId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete conversation check.",
      );
    }
  }

  async function deleteEventClassifierGroup(groupId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo(persistedDraftForUndo(selectedEvent));
      const resolvedGroupId = eventGroupIdRemap.current.get(groupId) ?? groupId;
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${resolvedGroupId}/`,
        {
          method: "DELETE",
        },
      );
      eventGroupIdRemap.current.delete(groupId);
      eventGroupIdRemap.current.delete(resolvedGroupId);
      applyUpdatedEvent(payload.event, false);
      closeExpandedItem(groupId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete classifier group.",
      );
    }
  }

  async function deleteEventClassifier(groupId: string, classifierId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo(persistedDraftForUndo(selectedEvent));
      const resolvedGroupId = eventGroupIdRemap.current.get(groupId) ?? groupId;
      const classifierKey = `${groupId}:${classifierId}`;
      const resolvedClassifierId =
        eventClassifierIdRemap.current.get(classifierKey) ?? classifierId;
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${resolvedGroupId}/classifiers/${resolvedClassifierId}/`,
        {
          method: "DELETE",
        },
      );
      eventClassifierIdRemap.current.delete(classifierKey);
      eventClassifierIdRemap.current.delete(`${resolvedGroupId}:${resolvedClassifierId}`);
      applyUpdatedEvent(payload.event, false);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete classifier.",
      );
    }
  }

  async function deleteEventStep(stepId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent || eventDraft.steps.length <= 1) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      rememberEventDraftForUndo(persistedDraftForUndo(selectedEvent));
      const resolvedStepId = eventStepIdRemap.current.get(stepId) ?? stepId;
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/${resolvedStepId}/`,
        {
          method: "DELETE",
        },
      );
      eventStepIdRemap.current.delete(stepId);
      eventStepIdRemap.current.delete(resolvedStepId);
      applyUpdatedEvent(payload.event, false);
      closeExpandedItem(stepId);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete action step.",
      );
    }
  }

  async function reorderEventStep(stepId: string, targetStepId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const currentIndex = eventDraft.steps.findIndex((step) => step.id === stepId);
    const targetIndex = eventDraft.steps.findIndex(
      (step) => step.id === targetStepId,
    );
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      return;
    }

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    const reorderedSteps = [...eventDraft.steps];
    const [movedStep] = reorderedSteps.splice(currentIndex, 1);
    reorderedSteps.splice(targetIndex, 0, movedStep);
    const nextSteps = reorderedSteps.map((step, index) => ({
      ...step,
      sortOrder: index,
    }));

    rememberEventDraftForUndo();
    clearEventAutosaveTimer();
    setEventDraft({
      ...eventDraft,
      steps: nextSteps,
    });
    setError("");

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/reorder/`,
        {
          method: "POST",
          body: JSON.stringify({
            stepIds: nextSteps.map((step) => step.id),
          }),
        },
      );
      applyUpdatedEvent(payload.event, false);
    } catch (moveError) {
      setError(
        moveError instanceof Error ? moveError.message : "Could not reorder steps.",
      );
      setEventDraft(eventDraftFromEvent(selectedEvent));
    }
  }

  function dragEventStep(
    event: DragEvent<HTMLElement>,
    stepId: string,
  ) {
    setDraggingStepId(stepId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", stepId);
  }

  function dragOverEventStep(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  async function dropEventStep(
    event: DragEvent<HTMLElement>,
    targetStepId: string,
  ) {
    event.preventDefault();
    const sourceStepId =
      event.dataTransfer.getData("text/plain") || draggingStepId;
    setDraggingStepId("");
    if (!sourceStepId || sourceStepId === targetStepId) return;
    await reorderEventStep(sourceStepId, targetStepId);
  }

  async function flushEditorAutosave() {
    const didSaveOverview = await flushOverviewAutosave();
    if (!didSaveOverview) return false;

    const didSaveTutor = await flushTutorAutosave();
    if (!didSaveTutor) return false;

    return flushEventAutosave();
  }

  async function saveTutorSettings() {
    await flushTutorAutosave();
  }

  async function playVoiceSample() {
    if (!experience) return;

    if (voiceSampleStatus !== "idle") {
      voiceSampleAudioRef.current?.pause();
      voiceSampleAudioRef.current = null;
      setVoiceSampleStatus("idle");
      return;
    }

    const sampleTutor = tutorForm;
    setVoiceSampleStatus("loading");
    setError("");

    try {
      voiceSampleAudioRef.current?.pause();
      voiceSampleAudioRef.current = null;

      const payload = await apiFetch<VoiceSamplePayload>(
        `/api/experiences/${experience.id}/voice-sample/`,
        {
          method: "POST",
          body: JSON.stringify({
            model: sampleTutor.realtimeModel,
            tutor: sampleTutor,
            voice: sampleTutor.voice,
          }),
        },
      );

      const audio = new Audio(payload.audioUrl);
      voiceSampleAudioRef.current = audio;
      setVoiceSampleStatus("playing");
      audio.onended = () => {
        if (voiceSampleAudioRef.current === audio) {
          voiceSampleAudioRef.current = null;
          setVoiceSampleStatus("idle");
        }
      };
      audio.onerror = () => {
        if (voiceSampleAudioRef.current === audio) {
          voiceSampleAudioRef.current = null;
          setVoiceSampleStatus("idle");
          setError("Could not play the cached voice sample.");
        }
      };
      await audio.play();
    } catch (sampleError) {
      const message =
        sampleError instanceof Error ? sampleError.message : "Could not play voice sample.";
      setError(message);
      voiceSampleAudioRef.current = null;
      setVoiceSampleStatus("idle");
    }
  }

  async function generateScriptAudio(scriptId = "", force = false) {
    if (!experience) return;

    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    setScriptAudioStatus("generating");
    setScriptAudioError("");
    try {
      const payload = await apiFetch<ScriptAudioPayload>(
        `/api/experiences/${experience.id}/script-audio/`,
        {
          method: "POST",
          body: JSON.stringify({
            force,
            scriptId,
          }),
        },
      );
      setScriptAudioItems(payload.scripts);
      if (payload.errors?.length) {
        setScriptAudioError(payload.errors.join(" "));
      }
    } catch (generateError) {
      setScriptAudioError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate scripted audio.",
      );
    } finally {
      setScriptAudioStatus("idle");
    }
  }

  function stopScriptAudioPreview(resetState = true) {
    scriptAudioPreviewRef.current?.pause();
    scriptAudioPreviewRef.current = null;
    if (resetState) {
      setPlayingScriptAudioId("");
    }
  }

  function playScriptAudioPreview(item: ScriptAudioItem) {
    if (!item.audioUrl) return;

    stopScriptAudioPreview();
    const audio = new Audio(item.audioUrl);
    scriptAudioPreviewRef.current = audio;
    setPlayingScriptAudioId(item.id);
    audio.onended = () => {
      if (scriptAudioPreviewRef.current === audio) {
        scriptAudioPreviewRef.current = null;
        setPlayingScriptAudioId("");
      }
    };
    audio.onerror = () => {
      if (scriptAudioPreviewRef.current === audio) {
        scriptAudioPreviewRef.current = null;
        setPlayingScriptAudioId("");
        setScriptAudioError("Could not play cached scripted audio.");
      }
    };
    void audio.play().catch(() => {
      if (scriptAudioPreviewRef.current === audio) {
        scriptAudioPreviewRef.current = null;
        setPlayingScriptAudioId("");
        setScriptAudioError("Could not play cached scripted audio.");
      }
    });
  }

  async function runExperience() {
    if (!experience) return;

    const didSave = await flushEditorAutosave();
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

  async function returnToExperiences() {
    const didSave = await flushEditorAutosave();
    if (!didSave) return;

    window.location.assign("/");
  }

  async function signOut() {
    await flushEditorAutosave();
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

  const editorEvents = experience
    ? sortedExperienceEvents(experience.events)
    : [];
  const selectedEvent = getSelectedExperienceEvent(experience, selectedEventId);
  const normalizedEventSearch = eventSearch.trim().toLowerCase();
  const visibleEditorEvents = normalizedEventSearch
    ? editorEvents.filter((event) =>
        [
          event.title,
          event.description,
          event.slug,
        ].some((value) => value.toLowerCase().includes(normalizedEventSearch)),
      )
    : editorEvents;
  const selectedEventRoutes = eventDraft.steps
    .filter((step) =>
      ["set_ui_trigger", "goto_event", "button_choice"].includes(step.actionType),
    )
    .map((step) => {
      const triggersEvent = stringConfigValue(step.config, "triggersEvent");
      return {
        id: step.id,
        label: eventActionLabel(step.actionType),
        target: eventTitleForTrigger(editorEvents, triggersEvent) || "Choose event",
      };
    })
    .concat(
      eventDraft.chatTools.map((tool) => ({
        id: tool.id,
        label: "FC route",
        target: eventTitleForTrigger(editorEvents, tool.triggersEvent) || "Choose event",
      })),
    )
    .concat(
      eventDraft.conversationChecks.map((check) => ({
        id: check.id,
        label: "Check",
        target:
          eventTitleForTrigger(editorEvents, check.triggersEvent) ||
          "Choose event",
      })),
    )
    .concat(
      eventDraft.classifierGroups.map((group) => ({
        id: group.id,
        label: "Classifiers",
        target:
          eventTitleForTrigger(editorEvents, group.triggersEvent) ||
          "No direct route",
      })),
    );

  function renderActionStepDetail(
    step: EventStepDraft,
    updateConfig: (key: string, value: unknown) => void,
    updateCondition: (condition: Partial<StepConditionDraft>) => void,
    className = "event-step-detail",
    updateConfigPatch?: (patch: Record<string, unknown>) => void,
  ) {
    const triggerEventSlug = stringConfigValue(step.config, "triggersEvent");
    const hasTriggerEventOption = editorEvents.some(
      (event) => event.slug === triggerEventSlug,
    );

    return (
      <div className={className}>
        <div className="event-condition-editor">
          {step.condition.type === "context_equals" ? (
            <>
              <span className="event-detail-label">IF</span>
              <input
                aria-label="Condition context key"
                onChange={(event) => updateCondition({ key: event.target.value })}
                placeholder="entry_ready"
                type="text"
                value={step.condition.key}
              />
              <span className="event-inline-operator">=</span>
              <input
                aria-label="Condition context value"
                onChange={(event) => updateCondition({ value: event.target.value })}
                placeholder="expected"
                type="text"
                value={step.condition.value}
              />
              <button
                className="event-text-button"
                onClick={() => updateCondition({ type: "always" })}
                type="button"
              >
                Clear
              </button>
            </>
          ) : step.condition.type === "custom" ? (
            <>
              <span className="event-detail-label">IF</span>
              <span className="event-custom-condition">
                {compactRuntimeValue(step.condition.raw, "custom condition")}
              </span>
              <button
                className="event-text-button"
                onClick={() => updateCondition({ type: "always" })}
                type="button"
              >
                Clear
              </button>
            </>
          ) : (
            <button
              className="event-add-condition-button"
              onClick={() => updateCondition({ type: "context_equals" })}
              type="button"
            >
              Add IF condition
            </button>
          )}
        </div>

        {step.actionType === "script" ? (
          <ScriptActionEditor
            deckUrl={stringConfigValue(step.config, "deckUrl")}
            events={editorEvents}
            onDeckUrlChange={(value) => updateConfig("deckUrl", value)}
            onTextChange={(value) => updateConfig("text", value)}
            text={stringConfigValue(step.config, "text")}
          />
        ) : null}

        {step.actionType === "set_context" ? (
          <div className="event-context-line">
            <span className="event-detail-label">SET</span>
            <input
              aria-label="Context key"
              onChange={(event) => updateConfig("key", event.target.value)}
              placeholder="entry_ready"
              type="text"
              value={stringConfigValue(step.config, "key")}
            />
            <span className="event-inline-operator">=</span>
              <input
                aria-label="Context value"
                onChange={(event) => updateConfig("value", event.target.value)}
                placeholder="yes"
                type="text"
                value={stringConfigValue(step.config, "value")}
              />
          </div>
        ) : null}

        {step.actionType === "append_context_list" ? (
          <div className="event-context-line">
            <span className="event-detail-label">APPEND</span>
            <input
              aria-label="Context list key"
              onChange={(event) => updateConfig("key", event.target.value)}
              placeholder="fruits_mentioned"
              type="text"
              value={stringConfigValue(step.config, "key")}
            />
            <span className="event-inline-operator">+=</span>
              <input
                aria-label="Context list value"
                onChange={(event) => updateConfig("value", event.target.value)}
                placeholder="banana"
                type="text"
                value={stringConfigValue(step.config, "value")}
              />
          </div>
        ) : null}

        {step.actionType === "get_ui_state" ? (
          <div className="event-context-line">
            <span className="event-detail-label">READ</span>
            <input
              aria-label="UI state key"
              onChange={(event) => updateConfig("stateKey", event.target.value)}
              placeholder="notesVisible"
              type="text"
              value={stringConfigValue(step.config, "stateKey")}
            />
            <span className="event-inline-operator">{"->"}</span>
            <input
              aria-label="Context key"
              onChange={(event) => updateConfig("contextKey", event.target.value)}
              placeholder="notes_visible"
              type="text"
              value={stringConfigValue(step.config, "contextKey")}
            />
          </div>
        ) : null}

        {step.actionType === "highlight_on" ? (
          <div className="event-context-line">
            <span className="event-detail-label">TARGET</span>
            <input
              aria-label="Highlight selector"
              onChange={(event) => updateConfig("selector", event.target.value)}
              placeholder=".runtime-notes-toggle"
              type="text"
              value={stringConfigValue(step.config, "selector")}
            />
            <span className="event-detail-label">COLOR</span>
            <input
              aria-label="Highlight color"
              onChange={(event) => updateConfig("color", event.target.value)}
              placeholder="rgba(59, 130, 246, 0.6)"
              type="text"
              value={stringConfigValue(step.config, "color")}
            />
          </div>
        ) : null}

        {step.actionType === "highlight_off" ? (
          <div className="event-context-line single-value">
            <span className="event-detail-label">CLEAR</span>
            <input
              aria-label="Highlight selector"
              onChange={(event) => updateConfig("selector", event.target.value)}
              placeholder=".runtime-notes-toggle"
              type="text"
              value={stringConfigValue(step.config, "selector")}
            />
          </div>
        ) : null}

        {step.actionType === "interactive" ? (
          <>
            <div className="event-context-line interactive-action-line">
              <MainPanelAppFields
                appId={stringConfigValue(step.config, "interactiveId")}
                appConfig={recordFromUnknown(step.config.config)}
                onConfigChange={updateConfig}
                onConfigPatch={updateConfigPatch}
                view={stringConfigValue(step.config, "mode")}
              />
            </div>
            <div className="event-context-line single-value">
              <span className="event-detail-label">ON SUBMIT</span>
              <select
                aria-label="Main-panel app completion event"
                onChange={(event) =>
                  updateConfig("triggersEvent", event.target.value)
                }
                value={triggerEventSlug}
              >
                <option value="">Stay in this event</option>
                {triggerEventSlug && !hasTriggerEventOption ? (
                  <option value={triggerEventSlug}>{triggerEventSlug}</option>
                ) : null}
                {editorEvents.map((event) => (
                  <option key={event.id} value={event.slug}>
                    {event.title || event.slug}
                    {event.isStart ? " (start)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {step.actionType === "interactive_update" ? (
          <>
            <div className="event-context-line interactive-action-line">
              <MainPanelAppFields
                appId={stringConfigValue(step.config, "interactiveId")}
                appConfig={recordFromUnknown(step.config.config)}
                onConfigChange={updateConfig}
                onConfigPatch={updateConfigPatch}
                view={stringConfigValue(step.config, "mode")}
              />
            </div>
            <div className="event-context-line single-value">
              <span className="event-detail-label">ON SUBMIT</span>
              <select
                aria-label="Updated main-panel app completion event"
                onChange={(event) =>
                  updateConfig("triggersEvent", event.target.value)
                }
                value={triggerEventSlug}
              >
                <option value="">Keep current target</option>
                {triggerEventSlug && !hasTriggerEventOption ? (
                  <option value={triggerEventSlug}>{triggerEventSlug}</option>
                ) : null}
                {editorEvents.map((event) => (
                  <option key={event.id} value={event.slug}>
                    {event.title || event.slug}
                    {event.isStart ? " (start)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {step.actionType === "set_ui_trigger" ? (
          <div className="event-context-line">
            <span className="event-detail-label">WHEN</span>
            <input
              aria-label="Trigger selector"
              onChange={(event) => updateConfig("selector", event.target.value)}
              placeholder=".runtime-notes-toggle"
              type="text"
              value={stringConfigValue(step.config, "selector")}
            />
            <span className="event-inline-operator">{"->"}</span>
            <select
              aria-label="Triggered event"
              onChange={(event) => updateConfig("triggersEvent", event.target.value)}
              value={triggerEventSlug}
            >
              <option value="">Choose event</option>
              {triggerEventSlug && !hasTriggerEventOption ? (
                <option value={triggerEventSlug}>{triggerEventSlug}</option>
              ) : null}
              {editorEvents.map((event) => (
                <option key={event.id} value={event.slug}>
                  {event.title || event.slug}
                  {event.isStart ? " (start)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {step.actionType === "goto_event" ? (
          <div className="event-context-line single-value">
            <span className="event-detail-label">GO</span>
            <select
              aria-label="Target event"
              onChange={(event) => updateConfig("triggersEvent", event.target.value)}
              value={triggerEventSlug}
            >
              <option value="">Choose event</option>
              {triggerEventSlug && !hasTriggerEventOption ? (
                <option value={triggerEventSlug}>{triggerEventSlug}</option>
              ) : null}
              {editorEvents.map((event) => (
                <option key={event.id} value={event.slug}>
                  {event.title || event.slug}
                  {event.isStart ? " (start)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {step.actionType === "button_choice" ? (
          <div className="event-context-line">
            <span className="event-detail-label">BUTTON</span>
            <input
              aria-label="Button label"
              onChange={(event) => updateConfig("label", event.target.value)}
              placeholder="Continue"
              type="text"
              value={stringConfigValue(step.config, "label")}
            />
            <span className="event-inline-operator">{"->"}</span>
            <select
              aria-label="Button target event"
              onChange={(event) => updateConfig("triggersEvent", event.target.value)}
              value={triggerEventSlug}
            >
              <option value="">Choose event</option>
              {triggerEventSlug && !hasTriggerEventOption ? (
                <option value={triggerEventSlug}>{triggerEventSlug}</option>
              ) : null}
              {editorEvents.map((event) => (
                <option key={event.id} value={event.slug}>
                  {event.title || event.slug}
                  {event.isStart ? " (start)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main
      className="panel-study experience-editor-page"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
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
          {experience ? <p className="study-kicker">{experienceForm.title}</p> : null}
        </div>
        <div className="study-actions">
          {user ? <span className="study-user">{user.displayName}</span> : null}
          <button
            className="header-action"
            disabled={!experience}
            onClick={runExperience}
            type="button"
          >
            Run
          </button>
          <button
            className="header-action secondary"
            disabled={isSigningOut}
            onClick={signOut}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="experience-editor">
        {status === "loading" ? (
          <div className="experience-state">Loading experience...</div>
        ) : null}
        {status === "error" ? (
          <div className="experience-state error">{error}</div>
        ) : null}

        {experience ? (
          <>
            <section className="editor-section">
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
                  onInput={(event) =>
                    resizeTextareaToContent(event.currentTarget)
                  }
                  placeholder="---"
                  ref={overviewDescriptionRef}
                  rows={1}
                  value={experienceForm.description}
                />
              </div>
            </section>

            <section className="editor-section tutor-editor-section">
              <TutorControls
                avatarUrl={publicAsset(tutorForm.avatarPath)}
                error={error}
                isSaving={isSavingTutor}
                onAvatarPathChange={(avatarPath) =>
                  updateTutorDraft("avatarPath", avatarPath)
                }
                onClassificationModelChange={(classificationModel) =>
                  updateTutorDraft("classificationModel", classificationModel)
                }
                onModelChange={updateTutorModelDraft}
                onNameChange={(assistantName) =>
                  updateTutorDraft("assistantName", assistantName)
                }
                onPlaySample={playVoiceSample}
                onSave={saveTutorSettings}
                onScriptActionOffsetChange={(scriptActionOffsetMs) =>
                  updateTutorDraft("scriptActionOffsetMs", scriptActionOffsetMs)
                }
                onVoiceChange={(voice) => updateTutorDraft("voice", voice)}
                onVoiceInstructionsChange={(voiceInstructions) =>
                  updateTutorDraft("voiceInstructions", voiceInstructions)
                }
                realtimeStatus="idle"
                sampleStatus={voiceSampleStatus}
                showSaveAction={false}
                tutor={tutorForm}
              />
            </section>

            <section className="editor-section script-audio-section">
              <ScriptAudioPanel
                error={scriptAudioError}
                isBusy={scriptAudioStatus === "loading" || scriptAudioStatus === "generating"}
                items={scriptAudioItems}
                onGenerateAll={() => void generateScriptAudio()}
                onGenerateOne={(scriptId) => void generateScriptAudio(scriptId)}
                onPlay={playScriptAudioPreview}
                onRegenerateAll={() => void generateScriptAudio("", true)}
                onRegenerateOne={(scriptId) => void generateScriptAudio(scriptId, true)}
                onStop={stopScriptAudioPreview}
                playingId={playingScriptAudioId}
                status={scriptAudioStatus}
              />
            </section>

            <section className="editor-section event-editor-section">
              <div className="event-authoring-grid">
                <aside className="event-outline" aria-label="Events">
                  <div className="event-outline-tools">
                    <input
                      aria-label="Find event"
                      className="event-search-input"
                      onChange={(event) => setEventSearch(event.target.value)}
                      placeholder="Find event"
                      type="search"
                      value={eventSearch}
                    />
                    <button
                      aria-pressed={isEventGraphOpen}
                      className="event-create-button secondary"
                      onClick={() => setIsEventGraphOpen((current) => !current)}
                      type="button"
                    >
                      Graph
                    </button>
                    <button
                      className="event-create-button"
                      onClick={() => void createEditorEvent()}
                      type="button"
                    >
                      <PlusIcon />
                      Event
                    </button>
                  </div>

                  <div className="event-outline-list">
                    {visibleEditorEvents.map((event) => {
                      const stats = eventTransitionStats(editorEvents, event);
                      const description =
                        event.description.trim() || event.slug || "---";

                      return (
                        <button
                          className={`event-outline-row${
                            event.id === selectedEvent?.id ? " is-selected" : ""
                          }`}
                          key={event.id}
                          onClick={() => void selectEditorEvent(event.id)}
                          type="button"
                        >
                          <span className="event-outline-copy">
                            <span className="event-outline-title">
                              {event.title || "Untitled event"}
                            </span>
                            <span className="event-outline-description">
                              {description}
                            </span>
                          </span>
                          <span className="event-outline-meta">
                            {event.isStart ? (
                              <span className="event-outline-badge">Start</span>
                            ) : null}
                            {stats.outgoingCount ? (
                              <span className="event-outline-count">
                                {stats.outgoingCount} out
                              </span>
                            ) : null}
                            {stats.incomingCount ? (
                              <span className="event-outline-count">
                                {stats.incomingCount} in
                              </span>
                            ) : null}
                            {stats.isUnlinked ? (
                              <span className="event-outline-warning">
                                Unlinked
                              </span>
                            ) : null}
                            {stats.unresolvedCount ? (
                              <span className="event-outline-warning">
                                Missing
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                    {!visibleEditorEvents.length ? (
                      <div className="event-outline-empty">No events</div>
                    ) : null}
                  </div>
                  {isEventGraphOpen ? (
                    <EventGraphView
                      events={editorEvents}
                      onSelectEvent={(eventId) => void selectEditorEvent(eventId)}
                      selectedEventId={selectedEvent?.id ?? ""}
                    />
                  ) : null}
                </aside>

                <div className="event-workspace">
                  <div className="event-document-header">
                    <div className="event-title-stack">
                      <div className="event-title-line">
                        <input
                          aria-label="Event title"
                          className="event-title-text"
                          onChange={(event) =>
                            updateEventDraft("title", event.target.value)
                          }
                          style={inlineFieldWidthStyle(
                            eventDraft.title,
                            "Start",
                            6,
                            32,
                          )}
                          type="text"
                          value={eventDraft.title}
                        />
                        <input
                          aria-label="Event description"
                          className="event-description-text"
                          onChange={(event) =>
                            updateEventDraft("description", event.target.value)
                          }
                          placeholder="---"
                          style={inlineFieldWidthStyle(
                            eventDraft.description,
                            "---",
                            4,
                            54,
                          )}
                          type="text"
                          value={eventDraft.description}
                        />
                      </div>
                    </div>
                    <div className="event-history-tools">
                      <button
                        aria-label="Undo event edit or reordered action"
                        className="event-icon-button"
                        disabled={!eventUndoStack.length}
                        onClick={undoEventEdit}
                        title={
                          eventUndoStack.length
                            ? `Undo event edit (${eventUndoStack.length} available)`
                            : "Nothing to undo"
                        }
                        type="button"
                      >
                        <UndoIcon />
                      </button>
                      <button
                        aria-label="Redo event edit or reordered action"
                        className="event-icon-button"
                        disabled={!eventRedoStack.length}
                        onClick={redoEventEdit}
                        title={
                          eventRedoStack.length
                            ? `Redo event edit (${eventRedoStack.length} available)`
                            : "Nothing to redo"
                        }
                        type="button"
                      >
                        <RedoIcon />
                      </button>
                      <button
                        aria-label="Delete selected event"
                        className="event-icon-button danger"
                        disabled={
                          !selectedEvent ||
                          editorEvents.length <= 1 ||
                          deletingEventId === selectedEvent.id
                        }
                        onClick={() => void deleteEditorEvent()}
                        title={
                          editorEvents.length <= 1
                            ? "An experience needs at least one event"
                            : "Delete selected event"
                        }
                        type="button"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

              {selectedEventRoutes.length ? (
                <div className="event-route-strip" aria-label="Event routes">
                  <span>Routes</span>
                  {selectedEventRoutes.map((route) => (
                    <button
                      className="event-route-chip"
                      key={route.id}
                      onClick={() => openExpandedItem(route.id)}
                      type="button"
                    >
                      <strong>{route.label}</strong>
                      <span>{route.target}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="event-context-line single-value event-chat-instructions-line">
                <span className="event-detail-label">CHAT INSTRUCTIONS</span>
                <input
                  aria-label="Event chat instructions"
                  onChange={(event) =>
                    updateEventDraft("chatInstructions", event.target.value)
                  }
                  placeholder="Optional context-aware instructions for chat in this event."
                  type="text"
                  value={eventDraft.chatInstructions}
                />
              </div>

              <div className="event-sequence-header">
                <span>On entry</span>
              </div>

              <div className="event-step-list">
                {eventDraft.steps.map((step, index) => {
                  const conditionText = eventConditionSummary(step.condition);
                  const isExpanded = isExpandedItem(step.id);
                  const toneClass = eventActionToneClass(step.actionType);
                  const triggerEventSlug = stringConfigValue(
                    step.config,
                    "triggersEvent",
                  );
                  const hasTriggerEventOption = editorEvents.some(
                    (event) => event.slug === triggerEventSlug,
                  );

                  return (
                    <article
                      className={[
                        "event-step",
                        `tone-${toneClass}`,
                        draggingStepId === step.id ? "is-dragging" : "",
                        isExpanded ? "is-expanded" : "",
                        !step.enabled ? "is-disabled" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={step.id}
                      onDragOver={dragOverEventStep}
                      onDrop={(event) => void dropEventStep(event, step.id)}
                    >
                      <div className="event-step-main">
                        <span
                          aria-label={`Drag step ${index + 1}`}
                          className="event-drag-handle"
                          draggable
                          onDragEnd={() => setDraggingStepId("")}
                          onDragStart={(event) =>
                            dragEventStep(event, step.id)
                          }
                          title="Drag to reorder"
                        >
                          <GripIcon />
                        </span>

                        <button
                          aria-expanded={isExpanded}
                          className="event-step-summary"
                          onClick={() => toggleExpandedItem(step.id)}
                          type="button"
                        >
                          <span className="event-step-kind">
                            {eventActionLabel(step.actionType)}
                          </span>
                          <span className="event-step-copy">
                            {eventStepSummary(step, editorEvents)}
                          </span>
                        </button>

                        <div className="event-step-tools">
                          <button
                            className={`event-if-chip${
                              conditionText ? "" : " is-empty"
                            }`}
                            onClick={() => openExpandedItem(step.id)}
                            title={
                              conditionText
                                ? `Condition: ${conditionText}`
                                : "Set condition"
                            }
                            type="button"
                          >
                            IF{conditionText ? ` ${conditionText}` : ""}
                          </button>
                          <button
                            aria-label={
                              step.enabled ? "Disable step" : "Enable step"
                            }
                            className={`event-enable-button${
                              step.enabled ? "" : " is-off"
                            }`}
                            onClick={() =>
                              updateEventStepDraft(
                                step.id,
                                (currentStep) => ({
                                  ...currentStep,
                                  enabled: !currentStep.enabled,
                                }),
                              )
                            }
                            title={step.enabled ? "Enabled" : "Disabled"}
                            type="button"
                          >
                            <span />
                          </button>
                          <button
                            aria-label="Delete step"
                            className="event-icon-button danger"
                            disabled={eventDraft.steps.length <= 1}
                            onClick={() => void deleteEventStep(step.id)}
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="event-step-detail">
                          <div className="event-condition-editor">
                            {step.condition.type === "context_equals" ? (
                              <>
                                <span className="event-detail-label">IF</span>
                                <input
                                  aria-label="Condition context key"
                                  onChange={(event) =>
                                    updateEventStepCondition(step.id, {
                                      key: event.target.value,
                                    })
                                  }
                                  placeholder="entry_ready"
                                  type="text"
                                  value={step.condition.key}
                                />
                                <span className="event-inline-operator">=</span>
                                <input
                                  aria-label="Condition context value"
                                  onChange={(event) =>
                                    updateEventStepCondition(step.id, {
                                      value: event.target.value,
                                    })
                                  }
                                  placeholder="expected"
                                  type="text"
                                  value={step.condition.value}
                                />
                                <button
                                  className="event-text-button"
                                  onClick={() =>
                                    updateEventStepCondition(step.id, {
                                      type: "always",
                                    })
                                  }
                                  type="button"
                                >
                                  Clear
                                </button>
                              </>
                            ) : step.condition.type === "custom" ? (
                              <>
                                <span className="event-detail-label">IF</span>
                                <span className="event-custom-condition">
                                  {compactRuntimeValue(
                                    step.condition.raw,
                                    "custom condition",
                                  )}
                                </span>
                                <button
                                  className="event-text-button"
                                  onClick={() =>
                                    updateEventStepCondition(step.id, {
                                      type: "always",
                                    })
                                  }
                                  type="button"
                                >
                                  Clear
                                </button>
                              </>
                            ) : (
                              <button
                                className="event-add-condition-button"
                                onClick={() =>
                                  updateEventStepCondition(step.id, {
                                    type: "context_equals",
                                  })
                                }
                                type="button"
                              >
                                Add IF condition
                              </button>
                            )}
                          </div>

                          {step.actionType === "script" ? (
                            <ScriptActionEditor
                              deckUrl={stringConfigValue(step.config, "deckUrl")}
                              events={editorEvents}
                              onDeckUrlChange={(value) =>
                                updateEventStepConfig(step.id, "deckUrl", value)
                              }
                              onTextChange={(value) =>
                                updateEventStepConfig(step.id, "text", value)
                              }
                              text={stringConfigValue(step.config, "text")}
                            />
                          ) : null}

                          {step.actionType === "set_context" ? (
                            <div className="event-context-line">
                              <span className="event-detail-label">SET</span>
                              <input
                                aria-label="Context key"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "key",
                                    event.target.value,
                                  )
                                }
                                placeholder="entry_ready"
                                type="text"
                                value={stringConfigValue(step.config, "key")}
                              />
                              <span className="event-inline-operator">=</span>
                              <input
                                aria-label="Context value"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "value",
                                    event.target.value,
                                  )
                                }
                                placeholder="yes"
                                type="text"
                                value={stringConfigValue(step.config, "value")}
                              />
                            </div>
                          ) : null}

                          {step.actionType === "append_context_list" ? (
                            <div className="event-context-line">
                              <span className="event-detail-label">APPEND</span>
                              <input
                                aria-label="Context list key"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "key",
                                    event.target.value,
                                  )
                                }
                                placeholder="fruits_mentioned"
                                type="text"
                                value={stringConfigValue(step.config, "key")}
                              />
                              <span className="event-inline-operator">+=</span>
                              <input
                                aria-label="Context list value"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "value",
                                    event.target.value,
                                  )
                                }
                                placeholder="banana"
                                type="text"
                                value={stringConfigValue(step.config, "value")}
                              />
                            </div>
                          ) : null}

                          {step.actionType === "get_ui_state" ? (
                            <div className="event-context-line">
                              <span className="event-detail-label">READ</span>
                              <input
                                aria-label="UI state key"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "stateKey",
                                    event.target.value,
                                  )
                                }
                                placeholder="notesVisible"
                                type="text"
                                value={stringConfigValue(step.config, "stateKey")}
                              />
                              <span className="event-inline-operator">{"->"}</span>
                              <input
                                aria-label="Context key"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "contextKey",
                                    event.target.value,
                                  )
                                }
                                placeholder="notes_visible"
                                type="text"
                                value={stringConfigValue(step.config, "contextKey")}
                              />
                            </div>
                          ) : null}

                          {step.actionType === "highlight_on" ? (
                            <div className="event-context-line">
                              <span className="event-detail-label">TARGET</span>
                              <input
                                aria-label="Highlight selector"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "selector",
                                    event.target.value,
                                  )
                                }
                                placeholder=".runtime-notes-toggle"
                                type="text"
                                value={stringConfigValue(step.config, "selector")}
                              />
                              <span className="event-detail-label">COLOR</span>
                              <input
                                aria-label="Highlight color"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "color",
                                    event.target.value,
                                  )
                                }
                                placeholder="rgba(59, 130, 246, 0.6)"
                                type="text"
                                value={stringConfigValue(step.config, "color")}
                              />
                            </div>
                          ) : null}

                          {step.actionType === "highlight_off" ? (
                            <div className="event-context-line single-value">
                              <span className="event-detail-label">CLEAR</span>
                              <input
                                aria-label="Highlight selector"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "selector",
                                    event.target.value,
                                  )
                                }
                                placeholder=".runtime-notes-toggle"
                                type="text"
                                value={stringConfigValue(step.config, "selector")}
                              />
                            </div>
                          ) : null}

                          {step.actionType === "interactive" ? (
                            <>
                              <div className="event-context-line interactive-action-line">
                                <MainPanelAppFields
                                  appId={stringConfigValue(
                                    step.config,
                                    "interactiveId",
                                  )}
                                  appConfig={recordFromUnknown(step.config.config)}
                                  onConfigChange={(key, value) =>
                                    updateEventStepConfig(step.id, key, value)
                                  }
                                  onConfigPatch={(patch) =>
                                    updateEventStepConfigPatch(step.id, patch)
                                  }
                                  view={stringConfigValue(step.config, "mode")}
                                />
                              </div>
                              <div className="event-context-line single-value">
                                <span className="event-detail-label">
                                  ON SUBMIT
                                </span>
                                <select
                                  aria-label="Main-panel app completion event"
                                  onChange={(event) =>
                                    updateEventStepConfig(
                                      step.id,
                                      "triggersEvent",
                                      event.target.value,
                                    )
                                  }
                                  value={triggerEventSlug}
                                >
                                  <option value="">Stay in this event</option>
                                  {triggerEventSlug && !hasTriggerEventOption ? (
                                    <option value={triggerEventSlug}>
                                      {triggerEventSlug}
                                    </option>
                                  ) : null}
                                  {editorEvents.map((event) => (
                                    <option key={event.id} value={event.slug}>
                                      {event.title || event.slug}
                                      {event.isStart ? " (start)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </>
                          ) : null}

                          {step.actionType === "interactive_update" ? (
                            <>
                              <div className="event-context-line interactive-action-line">
                                <MainPanelAppFields
                                  appId={stringConfigValue(
                                    step.config,
                                    "interactiveId",
                                  )}
                                  appConfig={recordFromUnknown(step.config.config)}
                                  onConfigChange={(key, value) =>
                                    updateEventStepConfig(step.id, key, value)
                                  }
                                  onConfigPatch={(patch) =>
                                    updateEventStepConfigPatch(step.id, patch)
                                  }
                                  view={stringConfigValue(step.config, "mode")}
                                />
                              </div>
                              <div className="event-context-line single-value">
                                <span className="event-detail-label">
                                  ON SUBMIT
                                </span>
                                <select
                                  aria-label="Updated main-panel app completion event"
                                  onChange={(event) =>
                                    updateEventStepConfig(
                                      step.id,
                                      "triggersEvent",
                                      event.target.value,
                                    )
                                  }
                                  value={triggerEventSlug}
                                >
                                  <option value="">Keep current target</option>
                                  {triggerEventSlug && !hasTriggerEventOption ? (
                                    <option value={triggerEventSlug}>
                                      {triggerEventSlug}
                                    </option>
                                  ) : null}
                                  {editorEvents.map((event) => (
                                    <option key={event.id} value={event.slug}>
                                      {event.title || event.slug}
                                      {event.isStart ? " (start)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </>
                          ) : null}

                          {step.actionType === "set_ui_trigger" ? (
                            <div className="event-context-line">
                              <span className="event-detail-label">WHEN</span>
                              <input
                                aria-label="Trigger selector"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "selector",
                                    event.target.value,
                                  )
                                }
                                placeholder=".runtime-notes-toggle"
                                type="text"
                                value={stringConfigValue(step.config, "selector")}
                              />
                              <span className="event-inline-operator">{"->"}</span>
                              <select
                                aria-label="Triggered event"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "triggersEvent",
                                    event.target.value,
                                  )
                                }
                                value={triggerEventSlug}
                              >
                                <option value="">Choose event</option>
                                {triggerEventSlug && !hasTriggerEventOption ? (
                                  <option value={triggerEventSlug}>
                                    {triggerEventSlug}
                                  </option>
                                ) : null}
                                {editorEvents.map((event) => (
                                  <option key={event.id} value={event.slug}>
                                    {event.title || event.slug}
                                    {event.isStart ? " (start)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          {step.actionType === "goto_event" ? (
                            <div className="event-context-line single-value">
                              <span className="event-detail-label">GO</span>
                              <select
                                aria-label="Target event"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "triggersEvent",
                                    event.target.value,
                                  )
                                }
                                value={triggerEventSlug}
                              >
                                <option value="">Choose event</option>
                                {triggerEventSlug && !hasTriggerEventOption ? (
                                  <option value={triggerEventSlug}>
                                    {triggerEventSlug}
                                  </option>
                                ) : null}
                                {editorEvents.map((event) => (
                                  <option key={event.id} value={event.slug}>
                                    {event.title || event.slug}
                                    {event.isStart ? " (start)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          {step.actionType === "button_choice" ? (
                            <div className="event-context-line">
                              <span className="event-detail-label">BUTTON</span>
                              <input
                                aria-label="Button label"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "label",
                                    event.target.value,
                                  )
                                }
                                placeholder="Continue"
                                type="text"
                                value={stringConfigValue(step.config, "label")}
                              />
                              <span className="event-inline-operator">{"->"}</span>
                              <select
                                aria-label="Button target event"
                                onChange={(event) =>
                                  updateEventStepConfig(
                                    step.id,
                                    "triggersEvent",
                                    event.target.value,
                                  )
                                }
                                value={triggerEventSlug}
                              >
                                <option value="">Choose event</option>
                                {triggerEventSlug && !hasTriggerEventOption ? (
                                  <option value={triggerEventSlug}>
                                    {triggerEventSlug}
                                  </option>
                                ) : null}
                                {editorEvents.map((event) => (
                                  <option key={event.id} value={event.slug}>
                                    {event.title || event.slug}
                                    {event.isStart ? " (start)" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="event-add-block" ref={eventAddBlockRef}>
                <button
                  aria-expanded={isEventAddMenuOpen}
                  className="event-add-button"
                  onClick={() => setIsEventAddMenuOpen((current) => !current)}
                  type="button"
                >
                  <PlusIcon />
                  Add action
                </button>
                {isEventAddMenuOpen ? (
                  <div className="event-add-menu">
                    {eventActionOptions.map((option) => (
                      <button
                        className={`event-add-option tone-${eventActionToneClass(
                          option.id,
                        )}`}
                        key={option.id}
                        onClick={() => void addEventStep(option.id)}
                        type="button"
                      >
                        <span>{option.label}</span>
                        <small>{eventActionDescription(option.id)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="event-sequence-header chat-exits-header">
                <span>Conversation</span>
              </div>

              <div className="event-step-list chat-exit-list">
                {eventDraft.chatTools.map((tool) => {
                  const isHandlerActionExpanded = tool.handlerActions.some(
                    (step) => isExpandedItem(step.id),
                  );
                  const isExpanded =
                    isExpandedItem(tool.id) || isHandlerActionExpanded;
                  const targetEventSlug = tool.triggersEvent;
                  const hasTriggerEventOption = editorEvents.some(
                    (event) => event.slug === targetEventSlug,
                  );

                  return (
                    <article
                      className={[
                        "event-step",
                        "chat-exit-step",
                        "tone-flow",
                        isExpanded ? "is-expanded" : "",
                        !tool.enabled ? "is-disabled" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={tool.id}
                    >
                      <div className="event-step-main">
                        <span className="event-drag-handle is-static">
                          <GripIcon />
                        </span>

                        <div className="event-step-summary chat-exit-summary">
                          <button
                            aria-expanded={isExpanded}
                            className="event-step-kind chat-exit-expand-button"
                            onClick={() =>
                              toggleExpandedParent(
                                tool.id,
                                tool.handlerActions.map((step) => step.id),
                              )
                            }
                            type="button"
                          >
                            FC route
                          </button>
                          <input
                            aria-label="FC route title"
                            className="chat-exit-title-input"
                            onChange={(event) =>
                              updateEventChatToolDraftField(
                                tool.id,
                                "title",
                                event.target.value,
                              )
                            }
                            placeholder="Title"
                            style={inlineFieldWidthStyle(
                              tool.title,
                              "Title",
                              5,
                              34,
                            )}
                            type="text"
                            value={tool.title}
                          />
                        </div>

                        <div className="event-step-tools">
                          <button
                            aria-label={
                              tool.enabled ? "Disable FC route" : "Enable FC route"
                            }
                            className={`event-enable-button${
                              tool.enabled ? "" : " is-off"
                            }`}
                            onClick={() =>
                              updateEventChatToolDraft(tool.id, (currentTool) => ({
                                ...currentTool,
                                enabled: !currentTool.enabled,
                              }))
                            }
                            title={tool.enabled ? "Enabled" : "Disabled"}
                            type="button"
                          >
                            <span />
                          </button>
                          <button
                            aria-label="Delete FC route"
                            className="event-icon-button danger"
                            onClick={() => void deleteEventChatTool(tool.id)}
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="event-step-detail chat-exit-detail">
                          <div className="event-context-line chat-exit-core-line">
                            <span className="event-detail-label">DESTINATION</span>
                            <select
                              aria-label="FC route destination event"
                              onChange={(event) =>
                                updateEventChatToolDraftField(
                                  tool.id,
                                  "triggersEvent",
                                  event.target.value,
                                )
                              }
                              value={targetEventSlug}
                            >
                              <option value="">Choose event</option>
                              {targetEventSlug && !hasTriggerEventOption ? (
                                <option value={targetEventSlug}>
                                  {targetEventSlug}
                                </option>
                              ) : null}
                              {editorEvents.map((event) => (
                                <option key={event.id} value={event.slug}>
                                  {event.title || event.slug}
                                  {event.isStart ? " (start)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="event-context-line single-value">
                            <span className="event-detail-label">
                              FUNCTION CALL DESCRIPTION
                            </span>
                            <input
                              aria-label="Function call trigger conditions"
                              onChange={(event) =>
                                updateEventChatToolDraftField(
                                  tool.id,
                                  "description",
                                  event.target.value,
                                )
                              }
                              placeholder="Describe the conditions that should trigger this FC route."
                              type="text"
                              value={tool.description}
                            />
                          </div>
                          <div className="chat-exit-capture-block">
                            <div className="chat-exit-capture-header">
                              <button
                                className="event-add-button compact"
                                onClick={() => addEventChatCapture(tool.id)}
                                type="button"
                              >
                                <PlusIcon />
                                Argument
                              </button>
                            </div>
                            {tool.captures.map((capture) => (
                              <div
                                className="event-context-line chat-exit-capture-line"
                                key={capture.id}
                              >
                                <span className="event-detail-label">SAVE AS</span>
                                <input
                                  aria-label="Save argument as context key"
                                  onChange={(event) =>
                                    updateEventChatCaptureDraft(
                                      tool.id,
                                      capture.id,
                                      (currentCapture) => ({
                                        ...currentCapture,
                                        saveAs: event.target.value,
                                      }),
                                    )
                                  }
                                  placeholder="delivery_estimate"
                                  type="text"
                                  value={capture.saveAs}
                                />
                                <span className="event-detail-label">
                                  ARGUMENT DESCRIPTION
                                </span>
                                <input
                                  aria-label="Argument description"
                                  onChange={(event) =>
                                    updateEventChatCaptureDraft(
                                      tool.id,
                                      capture.id,
                                      (currentCapture) => ({
                                        ...currentCapture,
                                        description: event.target.value,
                                      }),
                                    )
                                  }
                                  placeholder="The learner's delivery-time estimate."
                                  type="text"
                                  value={capture.description}
                                />
                                <button
                                  aria-label="Delete argument"
                                  className="event-icon-button danger"
                                  onClick={() =>
                                    deleteEventChatCapture(tool.id, capture.id)
                                  }
                                  type="button"
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            ))}
                            {!tool.captures.length ? (
                              <div className="chat-exit-empty">---</div>
                            ) : null}
                          </div>

                          <div className="chat-tool-actions-block">
                            <div
                              className="event-add-block chat-tool-action-add"
                              ref={
                                conversationAddMenuToolId === tool.id
                                  ? conversationAddBlockRef
                                  : null
                              }
                            >
                              <button
                                aria-expanded={conversationAddMenuToolId === tool.id}
                                className="event-add-button compact"
                                onClick={() =>
                                  setConversationAddMenuToolId((current) =>
                                    current === tool.id ? "" : tool.id,
                                  )
                                }
                                type="button"
                              >
                                <PlusIcon />
                                Action
                              </button>
                              {conversationAddMenuToolId === tool.id ? (
                                <div className="event-add-menu chat-tool-add-menu">
                                  {eventActionOptions.map((option) => (
                                    <button
                                      className={`event-add-option tone-${eventActionToneClass(
                                        option.id,
                                      )}`}
                                      key={option.id}
                                      onClick={() =>
                                        addEventChatToolAction(tool.id, option.id)
                                      }
                                      type="button"
                                    >
                                      <span>{option.label}</span>
                                      <small>{eventActionDescription(option.id)}</small>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            {tool.handlerActions.length ? (
                              <div className="event-step-list chat-tool-action-list">
                                {tool.handlerActions.map((step) => {
                                  const conditionText = eventConditionSummary(
                                    step.condition,
                                  );
                                  const isActionExpanded =
                                    isExpandedItem(step.id);
                                  const toneClass = eventActionToneClass(
                                    step.actionType,
                                  );

                                  return (
                                    <article
                                      className={[
                                        "event-step",
                                        "chat-tool-action-step",
                                        `tone-${toneClass}`,
                                        isActionExpanded ? "is-expanded" : "",
                                        !step.enabled ? "is-disabled" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      key={step.id}
                                    >
                                      <div className="event-step-main">
                                        <span className="event-drag-handle is-static">
                                          <GripIcon />
                                        </span>

                                        <button
                                          aria-expanded={isActionExpanded}
                                          className="event-step-summary"
                                          onClick={() =>
                                            toggleExpandedItem(step.id)
                                          }
                                          type="button"
                                        >
                                          <span className="event-step-kind">
                                            {eventActionLabel(step.actionType)}
                                          </span>
                                          <span className="event-step-copy">
                                            {eventStepSummary(step, editorEvents)}
                                          </span>
                                        </button>

                                        <div className="event-step-tools">
                                          <button
                                            className={`event-if-chip${
                                              conditionText ? "" : " is-empty"
                                            }`}
                                            onClick={() => openExpandedItem(step.id)}
                                            title={
                                              conditionText
                                                ? `Condition: ${conditionText}`
                                                : "Set condition"
                                            }
                                            type="button"
                                          >
                                            IF
                                            {conditionText ? ` ${conditionText}` : ""}
                                          </button>
                                          <button
                                            aria-label={
                                              step.enabled
                                                ? "Disable action"
                                                : "Enable action"
                                            }
                                            className={`event-enable-button${
                                              step.enabled ? "" : " is-off"
                                            }`}
                                            onClick={() =>
                                              updateEventChatToolActionDraft(
                                                tool.id,
                                                step.id,
                                                (currentStep) => ({
                                                  ...currentStep,
                                                  enabled: !currentStep.enabled,
                                                }),
                                              )
                                            }
                                            title={
                                              step.enabled ? "Enabled" : "Disabled"
                                            }
                                            type="button"
                                          >
                                            <span />
                                          </button>
                                          <button
                                            aria-label="Delete action"
                                            className="event-icon-button danger"
                                            onClick={() => {
                                              deleteEventChatToolAction(
                                                tool.id,
                                                step.id,
                                              );
                                              if (isExpandedItem(step.id)) {
                                                closeExpandedItem(step.id);
                                                openExpandedItem(tool.id);
                                              }
                                            }}
                                            type="button"
                                          >
                                            <TrashIcon />
                                          </button>
                                        </div>
                                      </div>

                                      {isActionExpanded
                                        ? renderActionStepDetail(
                                            step,
                                            (key, value) =>
                                              updateEventChatToolActionConfig(
                                                tool.id,
                                                step.id,
                                                key,
                                                value,
                                              ),
                                            (condition) =>
                                              updateEventChatToolActionCondition(
                                                tool.id,
                                                step.id,
                                                condition,
                                              ),
                                            "event-step-detail chat-tool-action-detail",
                                            (patch) =>
                                              updateEventChatToolActionConfigPatch(
                                                tool.id,
                                                step.id,
                                                patch,
                                              ),
                                          )
                                        : null}
                                    </article>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {eventDraft.conversationChecks.map((check) => {
                  const isHandlerActionExpanded = check.handlerActions.some(
                    (step) => isExpandedItem(step.id),
                  );
                  const isExpanded =
                    isExpandedItem(check.id) || isHandlerActionExpanded;
                  const targetEventSlug = check.triggersEvent;
                  const hasTriggerEventOption = editorEvents.some(
                    (event) => event.slug === targetEventSlug,
                  );

                  return (
                    <article
                      className={[
                        "event-step",
                        "chat-exit-step",
                        "conversation-check-step",
                        "tone-state",
                        isExpanded ? "is-expanded" : "",
                        !check.enabled ? "is-disabled" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={check.id}
                    >
                      <div className="event-step-main">
                        <span className="event-drag-handle is-static">
                          <GripIcon />
                        </span>

                        <div className="event-step-summary chat-exit-summary">
                          <button
                            aria-expanded={isExpanded}
                            className="event-step-kind chat-exit-expand-button"
                            onClick={() =>
                              toggleExpandedParent(
                                check.id,
                                check.handlerActions.map((step) => step.id),
                              )
                            }
                            type="button"
                          >
                            Check
                          </button>
                          <input
                            aria-label="Conversation check title"
                            className="chat-exit-title-input"
                            onChange={(event) =>
                              updateEventConversationCheckDraftField(
                                check.id,
                                "title",
                                event.target.value,
                              )
                            }
                            placeholder="Title"
                            style={inlineFieldWidthStyle(
                              check.title,
                              "Title",
                              5,
                              34,
                            )}
                            type="text"
                            value={check.title}
                          />
                        </div>

                        <div className="event-step-tools">
                          <button
                            aria-label={
                              check.enabled
                                ? "Disable conversation check"
                                : "Enable conversation check"
                            }
                            className={`event-enable-button${
                              check.enabled ? "" : " is-off"
                            }`}
                            onClick={() =>
                              updateEventConversationCheckDraft(
                                check.id,
                                (currentCheck) => ({
                                  ...currentCheck,
                                  enabled: !currentCheck.enabled,
                                }),
                              )
                            }
                            title={check.enabled ? "Enabled" : "Disabled"}
                            type="button"
                          >
                            <span />
                          </button>
                          <button
                            aria-label="Delete conversation check"
                            className="event-icon-button danger"
                            onClick={() =>
                              void deleteEventConversationCheck(check.id)
                            }
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="event-step-detail chat-exit-detail">
                          <div className="event-context-line conversation-check-core-line">
                            <span className="event-detail-label">SAVE AS</span>
                            <input
                              aria-label="Conversation check result context key"
                              onChange={(event) =>
                                updateEventConversationCheckDraftField(
                                  check.id,
                                  "resultContextKey",
                                  event.target.value,
                                )
                              }
                              placeholder="student_confused"
                              type="text"
                              value={check.resultContextKey}
                            />
                            <span className="event-detail-label">DESTINATION</span>
                            <select
                              aria-label="Conversation check destination event"
                              onChange={(event) =>
                                updateEventConversationCheckDraftField(
                                  check.id,
                                  "triggersEvent",
                                  event.target.value,
                                )
                              }
                              value={targetEventSlug}
                            >
                              <option value="">Choose event</option>
                              {targetEventSlug && !hasTriggerEventOption ? (
                                <option value={targetEventSlug}>
                                  {targetEventSlug}
                                </option>
                              ) : null}
                              {editorEvents.map((event) => (
                                <option key={event.id} value={event.slug}>
                                  {event.title || event.slug}
                                  {event.isStart ? " (start)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="event-context-line single-value">
                            <span className="event-detail-label">
                              CHECK INSTRUCTIONS
                            </span>
                            <input
                              aria-label="Conversation check instructions"
                              onChange={(event) =>
                                updateEventConversationCheckDraftField(
                                  check.id,
                                  "instructions",
                                  event.target.value,
                                )
                              }
                              placeholder="Describe exactly when this check should return true."
                              type="text"
                              value={check.instructions}
                            />
                          </div>

                          <div className="chat-tool-actions-block">
                            <div
                              className="event-add-block chat-tool-action-add"
                              ref={
                                conversationAddMenuCheckId === check.id
                                  ? conversationCheckAddBlockRef
                                  : null
                              }
                            >
                              <button
                                aria-expanded={
                                  conversationAddMenuCheckId === check.id
                                }
                                className="event-add-button compact"
                                onClick={() =>
                                  setConversationAddMenuCheckId((current) =>
                                    current === check.id ? "" : check.id,
                                  )
                                }
                                type="button"
                              >
                                <PlusIcon />
                                Action
                              </button>
                              {conversationAddMenuCheckId === check.id ? (
                                <div className="event-add-menu chat-tool-add-menu">
                                  {eventActionOptions.map((option) => (
                                    <button
                                      className={`event-add-option tone-${eventActionToneClass(
                                        option.id,
                                      )}`}
                                      key={option.id}
                                      onClick={() =>
                                        addEventConversationCheckAction(
                                          check.id,
                                          option.id,
                                        )
                                      }
                                      type="button"
                                    >
                                      <span>{option.label}</span>
                                      <small>{eventActionDescription(option.id)}</small>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            {check.handlerActions.length ? (
                              <div className="event-step-list chat-tool-action-list">
                                {check.handlerActions.map((step) => {
                                  const conditionText = eventConditionSummary(
                                    step.condition,
                                  );
                                  const isActionExpanded =
                                    isExpandedItem(step.id);
                                  const toneClass = eventActionToneClass(
                                    step.actionType,
                                  );

                                  return (
                                    <article
                                      className={[
                                        "event-step",
                                        "chat-tool-action-step",
                                        `tone-${toneClass}`,
                                        isActionExpanded ? "is-expanded" : "",
                                        !step.enabled ? "is-disabled" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      key={step.id}
                                    >
                                      <div className="event-step-main">
                                        <span className="event-drag-handle is-static">
                                          <GripIcon />
                                        </span>

                                        <button
                                          aria-expanded={isActionExpanded}
                                          className="event-step-summary"
                                          onClick={() =>
                                            toggleExpandedItem(step.id)
                                          }
                                          type="button"
                                        >
                                          <span className="event-step-kind">
                                            {eventActionLabel(step.actionType)}
                                          </span>
                                          <span className="event-step-copy">
                                            {eventStepSummary(step, editorEvents)}
                                          </span>
                                        </button>

                                        <div className="event-step-tools">
                                          <button
                                            className={`event-if-chip${
                                              conditionText ? "" : " is-empty"
                                            }`}
                                            onClick={() => openExpandedItem(step.id)}
                                            title={
                                              conditionText
                                                ? `Condition: ${conditionText}`
                                                : "Set condition"
                                            }
                                            type="button"
                                          >
                                            IF
                                            {conditionText ? ` ${conditionText}` : ""}
                                          </button>
                                          <button
                                            aria-label={
                                              step.enabled
                                                ? "Disable action"
                                                : "Enable action"
                                            }
                                            className={`event-enable-button${
                                              step.enabled ? "" : " is-off"
                                            }`}
                                            onClick={() =>
                                              updateEventConversationCheckActionDraft(
                                                check.id,
                                                step.id,
                                                (currentStep) => ({
                                                  ...currentStep,
                                                  enabled: !currentStep.enabled,
                                                }),
                                              )
                                            }
                                            title={
                                              step.enabled ? "Enabled" : "Disabled"
                                            }
                                            type="button"
                                          >
                                            <span />
                                          </button>
                                          <button
                                            aria-label="Delete action"
                                            className="event-icon-button danger"
                                            onClick={() => {
                                              deleteEventConversationCheckAction(
                                                check.id,
                                                step.id,
                                              );
                                              if (isExpandedItem(step.id)) {
                                                closeExpandedItem(step.id);
                                                openExpandedItem(check.id);
                                              }
                                            }}
                                            type="button"
                                          >
                                            <TrashIcon />
                                          </button>
                                        </div>
                                      </div>

                                      {isActionExpanded
                                        ? renderActionStepDetail(
                                            step,
                                            (key, value) =>
                                              updateEventConversationCheckActionConfig(
                                                check.id,
                                                step.id,
                                                key,
                                                value,
                                              ),
                                            (condition) =>
                                              updateEventConversationCheckActionCondition(
                                                check.id,
                                                step.id,
                                                condition,
                                              ),
                                            "event-step-detail chat-tool-action-detail",
                                            (patch) =>
                                              updateEventConversationCheckActionConfigPatch(
                                                check.id,
                                                step.id,
                                                patch,
                                              ),
                                          )
                                        : null}
                                    </article>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {eventDraft.classifierGroups.map((group) => {
                  const isHandlerActionExpanded = group.handlerActions.some(
                    (step) => isExpandedItem(step.id),
                  );
                  const isExpanded =
                    isExpandedItem(group.id) || isHandlerActionExpanded;
                  const targetEventSlug = group.triggersEvent;
                  const hasTriggerEventOption = editorEvents.some(
                    (event) => event.slug === targetEventSlug,
                  );
                  const groupMenuId = `classifier-group:${group.id}`;

                  return (
                    <article
                      className={[
                        "event-step",
                        "chat-exit-step",
                        "tone-state",
                        isExpanded ? "is-expanded" : "",
                        !group.enabled ? "is-disabled" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={group.id}
                    >
                      <div className="event-step-main">
                        <span className="event-drag-handle is-static">
                          <GripIcon />
                        </span>

                        <div className="event-step-summary chat-exit-summary">
                          <button
                            aria-expanded={isExpanded}
                            className="event-step-kind chat-exit-expand-button"
                            onClick={() =>
                              toggleExpandedParent(
                                group.id,
                                group.handlerActions.map((step) => step.id),
                              )
                            }
                            type="button"
                          >
                            Classifiers
                          </button>
                          <input
                            aria-label="Classifier group title"
                            className="chat-exit-title-input"
                            onChange={(event) =>
                              updateEventClassifierGroupDraftField(
                                group.id,
                                "title",
                                event.target.value,
                              )
                            }
                            placeholder="Title"
                            style={inlineFieldWidthStyle(
                              group.title,
                              "Title",
                              5,
                              34,
                            )}
                            type="text"
                            value={group.title}
                          />
                        </div>

                        <div className="event-step-tools">
                          <button
                            aria-label={
                              group.enabled
                                ? "Disable classifier group"
                                : "Enable classifier group"
                            }
                            className={`event-enable-button${
                              group.enabled ? "" : " is-off"
                            }`}
                            onClick={() =>
                              updateEventClassifierGroupDraft(
                                group.id,
                                (currentGroup) => ({
                                  ...currentGroup,
                                  enabled: !currentGroup.enabled,
                                }),
                              )
                            }
                            title={group.enabled ? "Enabled" : "Disabled"}
                            type="button"
                          >
                            <span />
                          </button>
                          <button
                            aria-label="Delete classifier group"
                            className="event-icon-button danger"
                            onClick={() =>
                              void deleteEventClassifierGroup(group.id)
                            }
                            type="button"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="event-step-detail chat-exit-detail">
                          <div className="event-context-line conversation-check-core-line">
                            <span className="event-detail-label">SAVE AS</span>
                            <input
                              aria-label="Classifier group result context key"
                              onChange={(event) =>
                                updateEventClassifierGroupDraftField(
                                  group.id,
                                  "resultContextKey",
                                  event.target.value,
                                )
                              }
                              placeholder="_classifier_results"
                              type="text"
                              value={group.resultContextKey}
                            />
                            <span className="event-detail-label">DESTINATION</span>
                            <select
                              aria-label="Classifier group destination event"
                              onChange={(event) =>
                                updateEventClassifierGroupDraftField(
                                  group.id,
                                  "triggersEvent",
                                  event.target.value,
                                )
                              }
                              value={targetEventSlug}
                            >
                              <option value="">None</option>
                              {targetEventSlug && !hasTriggerEventOption ? (
                                <option value={targetEventSlug}>
                                  {targetEventSlug}
                                </option>
                              ) : null}
                              {editorEvents.map((event) => (
                                <option key={event.id} value={event.slug}>
                                  {event.title || event.slug}
                                  {event.isStart ? " (start)" : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="event-context-line single-value">
                            <span className="event-detail-label">
                              GROUP INSTRUCTIONS
                            </span>
                            <input
                              aria-label="Classifier group instructions"
                              onChange={(event) =>
                                updateEventClassifierGroupDraftField(
                                  group.id,
                                  "instructions",
                                  event.target.value,
                                )
                              }
                              placeholder="Shared instructions for this classifier pass."
                              type="text"
                              value={group.instructions}
                            />
                          </div>

                          <div className="chat-exit-capture-block">
                            <div className="chat-exit-capture-header">
                              <span className="conversation-block-label">
                                Classifiers
                              </span>
                              <button
                                className="event-add-button compact"
                                onClick={() => void addEventClassifier(group.id)}
                                type="button"
                              >
                                <PlusIcon />
                                Classifier
                              </button>
                            </div>
                            {group.classifiers.map((classifier) => (
                              <div
                                className="event-context-line chat-exit-capture-line classifier-line"
                                key={classifier.id}
                              >
                                <span className="event-detail-label">NAME</span>
                                <input
                                  aria-label="Classifier name"
                                  onChange={(event) =>
                                    updateEventClassifierDraftField(
                                      group.id,
                                      classifier.id,
                                      "name",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="banana"
                                  type="text"
                                  value={classifier.name}
                                />
                                <span className="event-detail-label">PROMPT</span>
                                <input
                                  aria-label="Classifier prompt"
                                  onChange={(event) =>
                                    updateEventClassifierDraftField(
                                      group.id,
                                      classifier.id,
                                      "prompt",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="Return mentioned=true when..."
                                  type="text"
                                  value={classifier.prompt}
                                />
                                <span
                                  className={`event-if-chip classifier-if-chip${
                                    eventConditionSummary(classifier.condition)
                                      ? ""
                                      : " is-empty"
                                  }`}
                                  title="Classifier run condition"
                                >
                                  RUN IF
                                  {eventConditionSummary(classifier.condition)
                                    ? ` ${eventConditionSummary(classifier.condition)}`
                                    : " always"}
                                </span>
                                <button
                                  aria-label={
                                    classifier.enabled
                                      ? "Disable classifier"
                                      : "Enable classifier"
                                  }
                                  className={`event-enable-button${
                                    classifier.enabled ? "" : " is-off"
                                  }`}
                                  onClick={() =>
                                    updateEventClassifierDraft(
                                      group.id,
                                      classifier.id,
                                      (currentClassifier) => ({
                                        ...currentClassifier,
                                        enabled: !currentClassifier.enabled,
                                      }),
                                    )
                                  }
                                  title={classifier.enabled ? "Enabled" : "Disabled"}
                                  type="button"
                                >
                                  <span />
                                </button>
                                <button
                                  aria-label="Delete classifier"
                                  className="event-icon-button danger"
                                  onClick={() =>
                                    void deleteEventClassifier(
                                      group.id,
                                      classifier.id,
                                    )
                                  }
                                  type="button"
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            ))}
                            {!group.classifiers.length ? (
                              <div className="chat-exit-empty">---</div>
                            ) : null}
                          </div>

                          <div className="chat-tool-actions-block">
                            <div className="conversation-block-label">
                              Handler actions
                            </div>
                            <div
                              className="event-add-block chat-tool-action-add"
                              ref={
                                conversationAddMenuCheckId === groupMenuId
                                  ? conversationCheckAddBlockRef
                                  : null
                              }
                            >
                              <button
                                aria-expanded={
                                  conversationAddMenuCheckId === groupMenuId
                                }
                                className="event-add-button compact"
                                onClick={() =>
                                  setConversationAddMenuCheckId((current) =>
                                    current === groupMenuId ? "" : groupMenuId,
                                  )
                                }
                                type="button"
                              >
                                <PlusIcon />
                                Action
                              </button>
                              {conversationAddMenuCheckId === groupMenuId ? (
                                <div className="event-add-menu chat-tool-add-menu">
                                  {eventActionOptions.map((option) => (
                                    <button
                                      className={`event-add-option tone-${eventActionToneClass(
                                        option.id,
                                      )}`}
                                      key={option.id}
                                      onClick={() =>
                                        addEventClassifierGroupAction(
                                          group.id,
                                          option.id,
                                        )
                                      }
                                      type="button"
                                    >
                                      <span>{option.label}</span>
                                      <small>{eventActionDescription(option.id)}</small>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            {group.handlerActions.length ? (
                              <div className="event-step-list chat-tool-action-list">
                                {group.handlerActions.map((step) => {
                                  const conditionText = eventConditionSummary(
                                    step.condition,
                                  );
                                  const isActionExpanded =
                                    isExpandedItem(step.id);
                                  const toneClass = eventActionToneClass(
                                    step.actionType,
                                  );

                                  return (
                                    <article
                                      className={[
                                        "event-step",
                                        "chat-tool-action-step",
                                        `tone-${toneClass}`,
                                        isActionExpanded ? "is-expanded" : "",
                                        !step.enabled ? "is-disabled" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      key={step.id}
                                    >
                                      <div className="event-step-main">
                                        <span className="event-drag-handle is-static">
                                          <GripIcon />
                                        </span>

                                        <button
                                          aria-expanded={isActionExpanded}
                                          className="event-step-summary"
                                          onClick={() =>
                                            toggleExpandedItem(step.id)
                                          }
                                          type="button"
                                        >
                                          <span className="event-step-kind">
                                            {eventActionLabel(step.actionType)}
                                          </span>
                                          <span className="event-step-copy">
                                            {eventStepSummary(step, editorEvents)}
                                          </span>
                                        </button>

                                        <div className="event-step-tools">
                                          <button
                                            className={`event-if-chip${
                                              conditionText ? "" : " is-empty"
                                            }`}
                                            onClick={() => openExpandedItem(step.id)}
                                            title={
                                              conditionText
                                                ? `Condition: ${conditionText}`
                                                : "Set condition"
                                            }
                                            type="button"
                                          >
                                            IF
                                            {conditionText ? ` ${conditionText}` : ""}
                                          </button>
                                          <button
                                            aria-label={
                                              step.enabled
                                                ? "Disable action"
                                                : "Enable action"
                                            }
                                            className={`event-enable-button${
                                              step.enabled ? "" : " is-off"
                                            }`}
                                            onClick={() =>
                                              updateEventClassifierGroupActionDraft(
                                                group.id,
                                                step.id,
                                                (currentStep) => ({
                                                  ...currentStep,
                                                  enabled: !currentStep.enabled,
                                                }),
                                              )
                                            }
                                            title={
                                              step.enabled ? "Enabled" : "Disabled"
                                            }
                                            type="button"
                                          >
                                            <span />
                                          </button>
                                          <button
                                            aria-label="Delete action"
                                            className="event-icon-button danger"
                                            onClick={() => {
                                              deleteEventClassifierGroupAction(
                                                group.id,
                                                step.id,
                                              );
                                              if (isExpandedItem(step.id)) {
                                                closeExpandedItem(step.id);
                                                openExpandedItem(group.id);
                                              }
                                            }}
                                            type="button"
                                          >
                                            <TrashIcon />
                                          </button>
                                        </div>
                                      </div>

                                      {isActionExpanded
                                        ? renderActionStepDetail(
                                            step,
                                            (key, value) =>
                                              updateEventClassifierGroupActionConfig(
                                                group.id,
                                                step.id,
                                                key,
                                                value,
                                              ),
                                            (condition) =>
                                              updateEventClassifierGroupActionCondition(
                                                group.id,
                                                step.id,
                                                condition,
                                              ),
                                            "event-step-detail chat-tool-action-detail",
                                            (patch) =>
                                              updateEventClassifierGroupActionConfigPatch(
                                                group.id,
                                                step.id,
                                                patch,
                                              ),
                                          )
                                        : null}
                                    </article>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {!eventDraft.chatTools.length &&
                !eventDraft.conversationChecks.length &&
                !eventDraft.classifierGroups.length ? (
                  <div className="chat-exit-empty">---</div>
                ) : null}
              </div>

              <div
                className="event-add-block conversation-add-block"
                ref={conversationItemAddBlockRef}
              >
                <button
                  aria-expanded={isConversationAddMenuOpen}
                  className="event-add-button"
                  onClick={() =>
                    setIsConversationAddMenuOpen((current) => !current)
                  }
                  type="button"
                >
                  <PlusIcon />
                  Add conversation item
                </button>
                {isConversationAddMenuOpen ? (
                  <div className="event-add-menu">
                    <button
                      className="event-add-option tone-flow"
                      onClick={() => void addEventChatTool()}
                      type="button"
                    >
                      <span>FC route</span>
                      <small>Function call that can capture, act, and route</small>
                    </button>
                    <button
                      className="event-add-option tone-state"
                      onClick={() => void addEventConversationCheck()}
                      type="button"
                    >
                      <span>Check</span>
                      <small>Classifier that can save, act, and route</small>
                    </button>
                    <button
                      className="event-add-option tone-state"
                      onClick={() => void addEventClassifierGroup()}
                      type="button"
                    >
                      <span>Classifier group</span>
                      <small>Concurrent function-call style classifiers</small>
                    </button>
                  </div>
                ) : null}
              </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

function PanelStudy({ initialExperienceId = "" }: { initialExperienceId?: string }) {
  const drawerResizerWidth = 12;
  const shellRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const initialPanelLayout = useRef(readPanelLayout());
  const initialSlideSettings = useRef(readSlideSettings());
  const startedSessionIds = useRef(new Set<string>());
  const hasManualToolWidth = useRef(
    typeof initialPanelLayout.current.leftWidth === "number",
  );
  const latestToolWidth = useRef(initialPanelLayout.current.leftWidth ?? 330);
  const latestWorkspaceWidth = useRef(
    initialPanelLayout.current.workspaceWidth ?? standardWorkspaceWidth,
  );
  const realtimeConnectionRef = useRef<DluRealtimeConnection | null>(null);
  const activeSessionIdRef = useRef("");
  const playedScriptMessageIdsRef = useRef(new Set<string>());
  const scriptAudioRef = useRef<HTMLAudioElement | null>(null);
  const scriptAudioQueueRef = useRef(Promise.resolve());
  const scriptAudioSkipRef = useRef<(() => void) | null>(null);
  const scriptTextSkipRef = useRef<(() => void) | null>(null);
  const interactiveSaveTimerRef = useRef<number | null>(null);
  const interactiveSaveVersionRef = useRef(0);
  const suppressSlideControlResetRef = useRef(false);
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(
    initialPanelLayout.current.workspaceWidth ?? standardWorkspaceWidth,
  );
  const [leftWidth, setLeftWidth] = useState(
    initialPanelLayout.current.leftWidth ?? 330,
  );
  const [lowerHeight, setLowerHeight] = useState(
    initialPanelLayout.current.lowerHeight ?? defaultLowerPanelHeight,
  );
  const [user, setUser] = useState<ApiUser | null>(null);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [selectedExperienceId, setSelectedExperienceId] = useState("");
  const [experienceForm, setExperienceForm] = useState<ExperienceForm>({
    description: "",
    title: "",
  });
  const [tutorForm, setTutorForm] = useState<TutorSettings>({
    assistantName: "dee-lou",
    avatarPath: "test-images/dLU-right.png",
    classificationModel: "gpt-5.4-mini",
    realtimeModel: "gpt-realtime-mini",
    scriptActionOffsetMs: 0,
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  });
  const [session, setSession] = useState<TutoringSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] =
    useState<RealtimeModelId>("gpt-realtime-mini");
  const [selectedVoice, setSelectedVoice] = useState<RealtimeVoiceId>("ash");
  const [slideDeckUrl, setSlideDeckUrl] = useState(
    initialSlideSettings.current.deckUrl,
  );
  const [slideRef, setSlideRef] = useState(
    initialSlideSettings.current.slideRef,
  );
  const [resolvedSlide, setResolvedSlide] = useState<ResolvedSlide | null>(null);
  const [slideStatus, setSlideStatus] = useState<SlideStatus>("empty");
  const [slideError, setSlideError] = useState("");
  const [runtimeInteractive, setRuntimeInteractive] =
    useState<RuntimeInteractive | null>(null);
  const [runtimeInteractiveState, setRuntimeInteractiveState] = useState<
    Record<string, unknown>
  >({});
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const [chatStatus, setChatStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [chatError, setChatError] = useState("");
  const [experienceError, setExperienceError] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCreatingExperience, setIsCreatingExperience] = useState(false);
  const [isSavingExperience, setIsSavingExperience] = useState(false);
  const [isSavingTutor, setIsSavingTutor] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isScriptAudioPlaying, setIsScriptAudioPlaying] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [turnAnchorMessageId, setTurnAnchorMessageId] = useState<string | null>(
    null,
  );
  const [notesVisible, setNotesVisible] = useState(false);
  const [runtimeChatEnabled, setRuntimeChatEnabled] = useState(true);
  const [runtimeHighlights, setRuntimeHighlights] = useState<
    Record<string, RuntimeHighlight>
  >({});
  const [runtimeButtons, setRuntimeButtons] = useState<RuntimeButton[]>([]);
  const [runtimeTriggers, setRuntimeTriggers] = useState<RuntimeUiTrigger[]>([]);
  const [runtimeActionLog, setRuntimeActionLog] = useState<
    RuntimeActionLogEntry[]
  >([]);
  const shellStyle = {
    "--left-width": `${leftWidth}px`,
    "--workspace-width": `${workspaceWidth}px`,
  } as CSSProperties;
  const selectedExperience =
    experiences.find((experience) => experience.id === selectedExperienceId) ?? null;
  const currentRuntimeEventId =
    typeof session?.runtimeState?.currentEventId === "string"
      ? session.runtimeState.currentEventId
      : "";
  const currentRuntimeEventSlug =
    typeof session?.runtimeState?.currentEventSlug === "string"
      ? session.runtimeState.currentEventSlug
      : "";
  const currentRuntimeEvent =
    selectedExperience?.events.find(
      (event) =>
        event.id === currentRuntimeEventId ||
        event.slug === currentRuntimeEventSlug,
    ) ?? null;

  function currentRuntimeUiState(
    overrides: Partial<RuntimeUiState> = {},
  ): RuntimeUiState {
    return {
      interactive: runtimeInteractiveState,
      notesVisible,
      ...overrides,
    };
  }

  function clearInteractiveSaveTimer() {
    if (interactiveSaveTimerRef.current !== null) {
      window.clearTimeout(interactiveSaveTimerRef.current);
      interactiveSaveTimerRef.current = null;
    }
  }

  async function persistRuntimeInteractiveState(
    interactiveId: string,
    nextState: Record<string, unknown>,
    context: Record<string, unknown> = {},
    actions: Array<Record<string, unknown>> = [],
  ) {
    if (!session || !interactiveId) return false;

    const version = interactiveSaveVersionRef.current + 1;
    interactiveSaveVersionRef.current = version;

    try {
      const payload = await apiFetch<InteractiveRuntimePayload>(
        `/api/sessions/${session.id}/interactive/`,
        {
          method: "POST",
          body: JSON.stringify({
            actions,
            context,
            interactiveId,
            state: nextState,
          }),
        },
      );

      if (interactiveSaveVersionRef.current !== version) return;

      setSession(payload.session);
      setMessages(payload.messages);
      applyRuntimeActions(payload.actions);
      return true;
    } catch (error) {
      if (interactiveSaveVersionRef.current !== version) return false;

      setChatStatus("error");
      setChatError(
        error instanceof Error
          ? error.message
          : "Could not save the main-panel app state.",
      );
      return false;
    }
  }

  function queueRuntimeInteractiveSave(nextState: Record<string, unknown>) {
    if (!runtimeInteractive) return;

    const interactiveId = runtimeInteractive.interactiveId;
    clearInteractiveSaveTimer();
    interactiveSaveTimerRef.current = window.setTimeout(() => {
      interactiveSaveTimerRef.current = null;
      void persistRuntimeInteractiveState(interactiveId, nextState);
    }, 350);
  }

  function changeRuntimeInteractiveState(nextState: Record<string, unknown>) {
    setRuntimeInteractiveState(nextState);
    queueRuntimeInteractiveSave(nextState);
  }

  async function saveRuntimeInteractiveContext(
    values: Record<string, unknown>,
    state = runtimeInteractiveState,
  ) {
    if (!runtimeInteractive) return;
    clearInteractiveSaveTimer();
    await persistRuntimeInteractiveState(
      runtimeInteractive.interactiveId,
      state,
      values,
    );
  }

  function emitRuntimeInteractiveActions(
    actions: Array<Record<string, unknown>>,
    state = runtimeInteractiveState,
  ) {
    if (!runtimeInteractive || !actions.length) return;
    clearInteractiveSaveTimer();
    void persistRuntimeInteractiveState(
      runtimeInteractive.interactiveId,
      state,
      {},
      actions,
    );
  }

  function applyRuntimeActions(actions: Array<Record<string, unknown>>) {
    if (!actions.length) return;

    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setRuntimeActionLog((current) => [
      ...actions.map((action) => ({
        detail: runtimeActionText(action),
        id: localMessageId("runtime-action"),
        time: now,
        type: typeof action.type === "string" ? action.type : "action",
      })),
      ...current,
    ].slice(0, 48));

    for (const action of actions) {
      if (action.type === "gslide") {
        const slide = runtimeSlideFromRecord(action);
        if (!slide) continue;

        setResolvedSlide({
          cached: slide.cached,
          imageUrl: slide.imageUrl,
          pageId: slide.pageId,
          presentationId: slide.presentationId,
          slideRef: slide.slideRef,
        });
        suppressSlideControlResetRef.current = true;
        setSlideDeckUrl(slide.deckUrl);
        setSlideError("");
        setSlideRef(slide.slideRef);
        setSlideStatus("ready");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }

      if (action.type === "slide_error") {
        setResolvedSlide(null);
        setSlideError(
          typeof action.detail === "string"
            ? action.detail
            : "Could not load that slide.",
        );
        setSlideStatus("error");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }

      if (action.type === "interactive") {
        const interactive = runtimeInteractiveFromRecord(action);
        if (!interactive) continue;

        setRuntimeInteractive(interactive);
        setRuntimeInteractiveState(
          recordFromUnknown(action.state ?? interactive.config.initialState),
        );
        setResolvedSlide(null);
        setSlideError("");
        setSlideStatus("empty");
      }

      if (action.type === "interactive_state") {
        const state = recordFromUnknown(action.state);
        setRuntimeInteractiveState(state);
      }

      if (action.type === "interactive_error") {
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
        setResolvedSlide(null);
        setSlideError(
          typeof action.detail === "string"
            ? action.detail
            : "Main-panel app is not registered.",
        );
        setSlideStatus("error");
      }

      if (action.type === "interactive_update") {
        const update = runtimeInteractiveFromRecord(action);
        if (!update) continue;

        setRuntimeInteractive((current) => {
          const base = current?.interactiveId === update.interactiveId ? current : update;
          return {
            ...base,
            config: {
              ...base.config,
              ...update.config,
            },
            mode: update.mode || base.mode,
            prompt: update.prompt || base.prompt,
            title: update.title || base.title,
            triggersEvent: update.triggersEvent || base.triggersEvent,
          };
        });
        if (Object.prototype.hasOwnProperty.call(action, "state")) {
          setRuntimeInteractiveState(recordFromUnknown(action.state));
        }
      }

      if (action.type === "interactive_clear") {
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }

      if (action.type === "chat_availability") {
        setRuntimeChatEnabled(action.enabled !== false);
      }
    }

    setRuntimeButtons((current) => {
      let next = [...current];
      for (const action of actions) {
        if (action.type !== "button_choice") continue;
        const label =
          typeof action.label === "string" ? action.label.trim() : "";
        const triggersEvent =
          typeof action.triggersEvent === "string"
            ? action.triggersEvent.trim()
            : "";
        if (!label || !triggersEvent) continue;

        const stepId = typeof action.stepId === "string" ? action.stepId : "";
        next = next.filter((button) => button.stepId !== stepId);
        next.push({
          eventId: typeof action.eventId === "string" ? action.eventId : "",
          label,
          stepId,
          triggersEvent,
        });
      }
      return next;
    });

    setRuntimeHighlights((current) => {
      const next = { ...current };
      for (const action of actions) {
        const type = action.type;
        const selector =
          typeof action.selector === "string" ? action.selector.trim() : "";
        if (!selector) continue;

        if (type === "highlight_on") {
          next[selector] = {
            color:
              typeof action.color === "string"
                ? action.color
                : "rgba(59, 130, 246, 0.6)",
            selector,
          };
        }
        if (type === "highlight_off") {
          delete next[selector];
        }
      }
      return next;
    });

    setRuntimeTriggers((current) => {
      let next = [...current];
      for (const action of actions) {
        if (action.type !== "set_ui_trigger") continue;
        const selector =
          typeof action.selector === "string" ? action.selector.trim() : "";
        const triggersEvent =
          typeof action.triggersEvent === "string"
            ? action.triggersEvent.trim()
            : "";
        if (!selector || !triggersEvent) continue;

        next = next.filter(
          (trigger) =>
            trigger.selector !== selector ||
            trigger.triggersEvent !== triggersEvent,
        );
        next.push({
          eventId: typeof action.eventId === "string" ? action.eventId : "",
          selector,
          stepId: typeof action.stepId === "string" ? action.stepId : "",
          triggersEvent,
        });
      }
      return next;
    });
  }

  function applySessionRuntimeEffects(activeSession: TutoringSession | null) {
    const uiRuntime =
      activeSession?.runtimeState &&
      typeof activeSession.runtimeState.uiRuntime === "object" &&
      activeSession.runtimeState.uiRuntime !== null
        ? (activeSession.runtimeState.uiRuntime as Record<string, unknown>)
        : {};
    const highlightsValue = uiRuntime.highlights;
    const buttonsValue = uiRuntime.buttons;
    const interactiveValue = uiRuntime.interactive;
    const interactiveStateValue = uiRuntime.interactiveState;
    const slideValue = uiRuntime.slide;
    const slideErrorValue = uiRuntime.slideError;
    const triggersValue = uiRuntime.triggers;
    const chatEnabledValue = uiRuntime.chatEnabled;
    const nextHighlights: Record<string, RuntimeHighlight> = {};
    const nextButtons: RuntimeButton[] = [];

    if (
      highlightsValue &&
      typeof highlightsValue === "object" &&
      !Array.isArray(highlightsValue)
    ) {
      for (const [selector, value] of Object.entries(
        highlightsValue as Record<string, unknown>,
      )) {
        if (!selector || !value || typeof value !== "object") continue;
        const color =
          "color" in value && typeof value.color === "string"
            ? value.color
            : "rgba(59, 130, 246, 0.6)";
        nextHighlights[selector] = { color, selector };
      }
    }

    if (Array.isArray(buttonsValue)) {
      buttonsValue.forEach((value) => {
        if (!value || typeof value !== "object") return;
        const button = value as Record<string, unknown>;
        const label = typeof button.label === "string" ? button.label : "";
        const triggersEvent =
          typeof button.triggersEvent === "string" ? button.triggersEvent : "";
        if (!label || !triggersEvent) return;
        nextButtons.push({
          eventId: typeof button.eventId === "string" ? button.eventId : "",
          label,
          stepId: typeof button.stepId === "string" ? button.stepId : "",
          triggersEvent,
        });
      });
    }

    const nextTriggers: RuntimeUiTrigger[] = [];
    if (Array.isArray(triggersValue)) {
      triggersValue.forEach((value) => {
        if (!value || typeof value !== "object") return;
        const trigger = value as Record<string, unknown>;
        const selector =
          typeof trigger.selector === "string" ? trigger.selector : "";
        const triggersEvent =
          typeof trigger.triggersEvent === "string"
            ? trigger.triggersEvent
            : "";
        if (!selector || !triggersEvent) return;
        nextTriggers.push({
          eventId: typeof trigger.eventId === "string" ? trigger.eventId : "",
          selector,
          stepId: typeof trigger.stepId === "string" ? trigger.stepId : "",
          triggersEvent,
        });
      });
    }

    setRuntimeButtons(nextButtons);
    setRuntimeChatEnabled(
      typeof chatEnabledValue === "boolean" ? chatEnabledValue : true,
    );
    setRuntimeHighlights(nextHighlights);
    setRuntimeTriggers(nextTriggers);

    const nextInteractive = runtimeInteractiveFromRecord(interactiveValue);
    if (nextInteractive) {
      setRuntimeInteractive(nextInteractive);
      setRuntimeInteractiveState(
        recordFromUnknown(interactiveStateValue ?? nextInteractive.config.initialState),
      );
      setResolvedSlide(null);
      setSlideError("");
      setSlideStatus("empty");
      return;
    }

    const hasRuntimeSlideState =
      Object.prototype.hasOwnProperty.call(uiRuntime, "slide") ||
      Object.prototype.hasOwnProperty.call(uiRuntime, "slideError");

    if (hasRuntimeSlideState) {
      const nextSlide = runtimeSlideFromRecord(slideValue);
      const nextSlideError =
        typeof slideErrorValue === "string" ? slideErrorValue : "";
      if (nextSlide) {
        setResolvedSlide({
          cached: nextSlide.cached,
          imageUrl: nextSlide.imageUrl,
          pageId: nextSlide.pageId,
          presentationId: nextSlide.presentationId,
          slideRef: nextSlide.slideRef,
        });
        suppressSlideControlResetRef.current = true;
        setSlideDeckUrl(nextSlide.deckUrl);
        setSlideError("");
        setSlideRef(nextSlide.slideRef);
        setSlideStatus("ready");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      } else if (nextSlideError) {
        setResolvedSlide(null);
        setSlideError(nextSlideError);
        setSlideStatus("error");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      } else {
        setResolvedSlide(null);
        setSlideError("");
        setSlideStatus("empty");
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(uiRuntime, "interactive")) {
        setRuntimeInteractive(null);
        setRuntimeInteractiveState({});
      }
    }
  }

  function getWorkspaceWidthRange() {
    const shell = shellRef.current;
    const shellWidth = shell?.getBoundingClientRect().width ?? maxWorkspaceWidth;
    const maxWidth = Math.max(
      320,
      Math.min(maxWorkspaceWidth, shellWidth - 32),
    );
    const minWidth = Math.min(minWorkspaceWidth, maxWidth);

    return { maxWidth, minWidth };
  }

  function getLowerHeightRange() {
    const right = rightRef.current;
    const rightHeight = right?.getBoundingClientRect().height ?? 0;
    const maxHeight = Math.max(
      minLowerPanelHeight,
      rightHeight - rowDividerHeight - minMainPanelHeight,
    );

    return { maxHeight, minHeight: minLowerPanelHeight };
  }

  function isDrawerAttached(width: number) {
    const shell = shellRef.current;
    if (!shell) return false;

    const shellBounds = shell.getBoundingClientRect();
    const workspaceWidth =
      Number.parseFloat(
        getComputedStyle(shell).getPropertyValue("--workspace-width"),
      ) || 1180;
    const closedLeftSpace = Math.max(0, (shellBounds.width - workspaceWidth) / 2);

    return width + drawerResizerWidth >= closedLeftSpace - 0.5;
  }

  function updateDrawerAttachment(width = latestToolWidth.current) {
    const shell = shellRef.current;
    if (!shell) return;

    shell.classList.toggle(
      "drawer-attached",
      isLeftOpen && isDrawerAttached(width),
    );
  }

  function setDefaultToolWidth() {
    if (hasManualToolWidth.current) return;

    const shell = shellRef.current;
    const right = rightRef.current;
    if (!shell || !right) return;

    const shellBounds = shell.getBoundingClientRect();
    const rightBounds = right.getBoundingClientRect();
    const maxWidth = Math.max(280, Math.min(1180, shellBounds.width - 80));
    const minWidth = Math.min(280, maxWidth);
    const gutterWidth = rightBounds.left - shellBounds.left;
    const nextWidth = Math.round(
      clamp(gutterWidth - drawerResizerWidth, minWidth, maxWidth),
    );

    latestToolWidth.current = nextWidth;
    setLeftWidth(nextWidth);
  }

  function applySelectedExperience(experience: Experience) {
    setSelectedExperienceId(experience.id);
    setExperienceForm({
      description: experience.description,
      title: experience.title,
    });
    setTutorForm(experience.tutor);
    setSelectedModel(experience.tutor.realtimeModel);
    setSelectedVoice(experience.tutor.voice);
  }

  async function loadCurrentSessionForExperience(experienceId: string) {
    const payload = await apiFetch<SessionPayload>(
      `/api/sessions/current/?experienceId=${encodeURIComponent(experienceId)}`,
    );
    setSession(payload.session);
    setMessages(payload.messages);
    setTurnAnchorMessageId(null);
    setChatStatus("ready");
  }

  useEffect(() => {
    setDefaultToolWidth();
    window.addEventListener("resize", setDefaultToolWidth);
    return () => window.removeEventListener("resize", setDefaultToolWidth);
  }, [workspaceWidth]);

  useEffect(() => {
    writePanelLayout({ leftWidth, lowerHeight, workspaceWidth });
  }, [leftWidth, lowerHeight, workspaceWidth]);

  useEffect(() => {
    writeSlideSettings({
      deckUrl: slideDeckUrl,
      slideRef,
    });
  }, [slideDeckUrl, slideRef]);

  useEffect(() => {
    writeSelectedExperienceId(selectedExperienceId);
  }, [selectedExperienceId]);

  useEffect(() => {
    clearInteractiveSaveTimer();
    setNotesVisible(false);
    setRuntimeActionLog([]);
    setResolvedSlide(null);
    setSlideError("");
    setSlideStatus("empty");
  }, [session?.id]);

  useEffect(() => {
    applySessionRuntimeEffects(session);
  }, [session?.runtimeState]);

  useEffect(() => {
    const highlightedElements: HTMLElement[] = [];

    for (const highlight of Object.values(runtimeHighlights)) {
      let targets: NodeListOf<Element>;
      try {
        targets = document.querySelectorAll(highlight.selector);
      } catch {
        continue;
      }

      targets.forEach((target) => {
        if (!(target instanceof HTMLElement)) return;
        target.classList.add("runtime-highlight");
        target.style.setProperty("--runtime-highlight-color", highlight.color);
        highlightedElements.push(target);
      });
    }

    return () => {
      highlightedElements.forEach((target) => {
        target.classList.remove("runtime-highlight");
        target.style.removeProperty("--runtime-highlight-color");
      });
    };
  }, [runtimeHighlights]);

  useEffect(() => {
    if (suppressSlideControlResetRef.current) {
      suppressSlideControlResetRef.current = false;
      return;
    }

    setResolvedSlide(null);
    setSlideError("");
    setSlideStatus("empty");
  }, [slideDeckUrl, slideRef]);

  useEffect(() => {
    let isCancelled = false;

    async function loadWorkspace() {
      setChatStatus("loading");
      setChatError("");
      setExperienceError("");

      try {
        const me = await apiFetch<{ user: ApiUser }>("/api/auth/me/");
        const experiencePayload = await apiFetch<ExperiencesPayload>(
          "/api/experiences/",
        );

        const savedExperienceId = readSelectedExperienceId();
        const chosenExperience =
          experiencePayload.experiences.find(
            (experience) => experience.id === initialExperienceId,
          ) ??
          experiencePayload.experiences.find(
            (experience) => experience.id === savedExperienceId,
          ) ??
          experiencePayload.experiences.find(
            (experience) =>
              experience.id === experiencePayload.currentExperienceId,
          ) ??
          experiencePayload.experiences[0];

        if (!chosenExperience) {
          throw new Error("Could not load an experience.");
        }

        const payload = await apiFetch<SessionPayload>(
          `/api/sessions/current/?experienceId=${encodeURIComponent(
            chosenExperience.id,
          )}`,
        );

        if (isCancelled) return;

        setUser(me.user);
        setExperiences(experiencePayload.experiences);
        applySelectedExperience(chosenExperience);
        setSession(payload.session);
        setMessages(payload.messages);
        setTurnAnchorMessageId(null);
        setChatStatus("ready");
      } catch (error) {
        if (isCancelled) return;

        setChatStatus("error");
        const detail =
          error instanceof Error ? error.message : "Could not load session.";
        setChatError(detail);
        setExperienceError(detail);
      }
    }

    loadWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [initialExperienceId]);

  useEffect(() => {
    return () => {
      clearInteractiveSaveTimer();
      realtimeConnectionRef.current?.close();
      scriptTextSkipRef.current?.();
      scriptAudioSkipRef.current?.();
      scriptAudioRef.current?.pause();
      scriptAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    function skipCurrentScriptMessage(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!scriptTextSkipRef.current && !scriptAudioSkipRef.current) return;

      event.preventDefault();
      scriptTextSkipRef.current?.();
      scriptAudioSkipRef.current?.();
    }

    window.addEventListener("keydown", skipCurrentScriptMessage);
    return () => window.removeEventListener("keydown", skipCurrentScriptMessage);
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = session?.id ?? "";
  }, [session?.id]);

  useEffect(() => {
    realtimeConnectionRef.current?.close();
    realtimeConnectionRef.current = null;
    setRealtimeStatus("idle");
  }, [currentRuntimeEventId, selectedModel, selectedVoice, session?.id]);

  useEffect(() => {
    scriptAudioQueueRef.current = Promise.resolve();
    playedScriptMessageIdsRef.current.clear();
    setIsScriptAudioPlaying(false);
    scriptTextSkipRef.current?.();
    scriptAudioSkipRef.current?.();
    scriptAudioRef.current?.pause();
    scriptAudioRef.current = null;
  }, [selectedModel, selectedVoice, session?.id]);

  useEffect(() => {
    if (!session || chatStatus !== "ready") return;
    const activeSession = session;
    if (startedSessionIds.current.has(activeSession.id)) return;

    startedSessionIds.current.add(activeSession.id);
    let isCancelled = false;

    async function runStartEventForSession() {
      try {
        const payload = await apiFetch<StartEventPayload>(
          `/api/sessions/${activeSession.id}/start-event/`,
          {
            method: "POST",
            body: JSON.stringify({ uiState: currentRuntimeUiState() }),
          },
        );

        if (isCancelled) return;

        setSession(payload.session);
        setMessages(payload.messages);
        applyRuntimeActions(payload.actions);
        if (payload.ranMessages?.[0]) {
          setTurnAnchorMessageId(payload.ranMessages[0].id);
        }
        queueScriptMessages(payload.session, payload.ranMessages);
      } catch (error) {
        if (isCancelled) return;

        startedSessionIds.current.delete(activeSession.id);
        setChatStatus("error");
        setChatError(
          error instanceof Error
            ? error.message
            : "Could not run the start event.",
        );
      }
    }

    void runStartEventForSession();

    return () => {
      isCancelled = true;
    };
  }, [chatStatus, session]);

  useEffect(() => {
    function handleResize() {
      updateDrawerAttachment();
      const { maxWidth, minWidth } = getWorkspaceWidthRange();
      setWorkspaceWidth((current) => clamp(current, minWidth, maxWidth));
      const { maxHeight, minHeight } = getLowerHeightRange();
      setLowerHeight((current) => clamp(current, minHeight, maxHeight));
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isLeftOpen, leftWidth, workspaceWidth]);

  async function runSessionEventBySlug(
    eventSlug: string,
    uiState: RuntimeUiState,
    triggerSelector = "",
    options: { clearButtons?: boolean } = {},
  ) {
    if (!session) return;

    try {
      const payload = await apiFetch<StartEventPayload>(
        `/api/sessions/${session.id}/events/run/`,
        {
          method: "POST",
          body: JSON.stringify({
            clearButtons: Boolean(options.clearButtons),
            eventSlug,
            triggerSelector,
            uiState,
          }),
        },
      );

      setSession(payload.session);
      setMessages(payload.messages);
      applyRuntimeActions(payload.actions);
      if (payload.ranMessages?.[0]) {
        setTurnAnchorMessageId(payload.ranMessages[0].id);
      }
      queueScriptMessages(payload.session, payload.ranMessages);
    } catch (error) {
      setChatStatus("error");
      setChatError(
        error instanceof Error ? error.message : "Could not run triggered event.",
      );
    }
  }

  function triggerRuntimeUiEvent(selector: string, uiState: RuntimeUiState) {
    const matchingTriggers = runtimeTriggers.filter(
      (trigger) => trigger.selector === selector,
    );
    if (!matchingTriggers.length) return;

    setRuntimeTriggers((current) =>
      current.filter((trigger) => trigger.selector !== selector),
    );
    matchingTriggers.forEach((trigger) => {
      void runSessionEventBySlug(trigger.triggersEvent, uiState, selector);
    });
  }

  function runRuntimeButton(button: RuntimeButton) {
    setRuntimeButtons([]);
    void runSessionEventBySlug(button.triggersEvent, currentRuntimeUiState(), "", {
      clearButtons: true,
    });
  }

  async function completeRuntimeInteractive(
    nextState = runtimeInteractiveState,
    context: Record<string, unknown> = {},
  ) {
    if (!runtimeInteractive) return;

    clearInteractiveSaveTimer();
    setRuntimeInteractiveState(nextState);
    const saved = await persistRuntimeInteractiveState(
      runtimeInteractive.interactiveId,
      nextState,
      context,
    );
    if (!saved) return;

    if (!runtimeInteractive.triggersEvent) return;

    void runSessionEventBySlug(
      runtimeInteractive.triggersEvent,
      currentRuntimeUiState({ interactive: nextState }),
    );
  }

  function runRuntimeInteractiveEvent(
    eventSlug: string,
    state = runtimeInteractiveState,
  ) {
    if (!eventSlug) return;
    void runSessionEventBySlug(
      eventSlug,
      currentRuntimeUiState({ interactive: state }),
    );
  }

  function toggleRuntimeNotes() {
    const nextNotesVisible = !notesVisible;
    const nextUiState = currentRuntimeUiState({
      notesVisible: nextNotesVisible,
    });

    setNotesVisible(nextNotesVisible);
    triggerRuntimeUiEvent(".runtime-notes-toggle", nextUiState);
  }

  function dragLeftDivider(event: PointerEvent<HTMLDivElement>) {
    const shell = shellRef.current;
    if (!shell) return;

    const shellElement: HTMLDivElement = shell;
    const bounds = shellElement.getBoundingClientRect();
    const maxWidth = Math.max(260, Math.min(1180, bounds.width - 80));
    const minWidth = Math.min(260, maxWidth);
    let animationFrame = 0;
    hasManualToolWidth.current = true;
    shellElement.classList.add("is-resizing-tools");

    function applyWidth(width: number) {
      latestToolWidth.current = Math.round(width);

      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        shellElement.style.setProperty("--left-width", `${latestToolWidth.current}px`);
        shellElement.classList.toggle(
          "drawer-attached",
          isDrawerAttached(latestToolWidth.current),
        );
        animationFrame = 0;
      });
    }

    function onMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = moveEvent.clientX - bounds.left;
      applyWidth(clamp(nextWidth, minWidth, maxWidth));
    }

    function onUp() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        shellElement.style.setProperty("--left-width", `${latestToolWidth.current}px`);
        updateDrawerAttachment();
      }

      shellElement.classList.remove("is-resizing-tools");
      setLeftWidth(latestToolWidth.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    event.preventDefault();
  }

  function dragLowerDivider(event: PointerEvent<HTMLDivElement>) {
    const right = rightRef.current;
    if (!right) return;

    const bounds = right.getBoundingClientRect();
    const { maxHeight, minHeight } = getLowerHeightRange();

    function onMove(moveEvent: globalThis.PointerEvent) {
      const nextHeight = bounds.bottom - moveEvent.clientY;
      setLowerHeight(clamp(nextHeight, minHeight, maxHeight));
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    event.preventDefault();
  }

  function dragWorkspaceDivider(event: PointerEvent<HTMLDivElement>) {
    const shell = shellRef.current;
    if (!shell) return;

    const shellElement: HTMLDivElement = shell;
    const { maxWidth, minWidth } = getWorkspaceWidthRange();
    const startX = event.clientX;
    const startWidth =
      Number.parseFloat(
        getComputedStyle(shellElement).getPropertyValue("--workspace-width"),
      ) || workspaceWidth;
    let animationFrame = 0;
    latestWorkspaceWidth.current = startWidth;
    shellElement.classList.add("is-resizing-workspace");

    function applyWidth(width: number) {
      latestWorkspaceWidth.current = Math.round(width);

      if (animationFrame) return;

      animationFrame = window.requestAnimationFrame(() => {
        shellElement.style.setProperty(
          "--workspace-width",
          `${latestWorkspaceWidth.current}px`,
        );
        updateDrawerAttachment();
        animationFrame = 0;
      });
    }

    function onMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = startWidth + (moveEvent.clientX - startX) * 2;
      applyWidth(clamp(nextWidth, minWidth, maxWidth));
    }

    function onUp() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        shellElement.style.setProperty(
          "--workspace-width",
          `${latestWorkspaceWidth.current}px`,
        );
      }

      shellElement.classList.remove("is-resizing-workspace");
      setWorkspaceWidth(latestWorkspaceWidth.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    event.preventDefault();
  }

  async function resolveCurrentSlide(forceRefresh = false) {
    if (!slideDeckUrl.trim()) {
      setResolvedSlide(null);
      setSlideError("");
      setSlideStatus("empty");
      return;
    }

    setSlideStatus("loading");
    setSlideError("");

    try {
      const payload = await apiFetch<ResolvedSlide>("/api/slides/resolve/", {
        method: "POST",
        body: JSON.stringify({
          deckUrl: slideDeckUrl,
          forceRefresh,
          slideRef,
        }),
      });
      setResolvedSlide({
        ...payload,
        imageUrl: `${payload.imageUrl}?v=${Date.now()}`,
      });
      setSlideStatus("ready");
    } catch (error) {
      setSlideStatus("error");
      setSlideError(
        error instanceof Error ? error.message : "Could not load that slide.",
      );
    }
  }

  function loadSampleSlideDeck() {
    setSlideDeckUrl(sampleSlideDeckUrl);
    setSlideRef("1");
  }

  function clearSlides() {
    setSlideDeckUrl("");
    setSlideRef("1");
    setResolvedSlide(null);
    setSlideError("");
    setSlideStatus("empty");
  }

  function isScriptAudioMessage(message: ChatMessage) {
    const source =
      typeof message.metadata?.source === "string"
        ? message.metadata.source
        : "";
    return (
      message.role === "assistant" &&
      message.content.trim().length > 0 &&
      scriptAudioSources.has(source)
    );
  }

  function waitForAudioMetadata(audio: HTMLAudioElement) {
    if (audio.readyState >= 1) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        audio.removeEventListener("loadedmetadata", handleReady);
        audio.removeEventListener("canplay", handleReady);
      };
      const handleReady = () => {
        cleanup();
        resolve();
      };
      const timeoutId = window.setTimeout(handleReady, 700);

      audio.addEventListener("loadedmetadata", handleReady, { once: true });
      audio.addEventListener("canplay", handleReady, { once: true });
      audio.load();
    });
  }

  function preloadScriptCueAssets(cues: ScriptCue[]) {
    const urls = scriptCueImageUrls(cues);
    if (!urls.length) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let remaining = urls.length;
      let isDone = false;
      let timeoutId = 0;

      const finishOne = () => {
        remaining -= 1;
        if (remaining <= 0 && !isDone) {
          isDone = true;
          window.clearTimeout(timeoutId);
          resolve();
        }
      };
      timeoutId = window.setTimeout(() => {
        if (isDone) return;
        isDone = true;
        resolve();
      }, 1800);

      urls.forEach((url) => {
        const image = new Image();
        image.onload = finishOne;
        image.onerror = finishOne;
        image.src = url;
      });
    });
  }

  function streamScriptMessageText(
    message: ChatMessage,
    durationMs: number,
    audio?: HTMLAudioElement,
    words: ScriptWord[] = [],
  ) {
    const fullText = message.content;
    if (!fullText.trim()) return Promise.resolve();
    const revealPoints =
      audio && words.length ? scriptWordRevealPoints(fullText, words) : [];

    setMessages((current) =>
      current.map((currentMessage) =>
        currentMessage.id === message.id
          ? {
              ...currentMessage,
              content: "",
              metadata: {
                ...currentMessage.metadata,
                scriptHidden: false,
                streaming: true,
              },
            }
          : currentMessage,
      ),
    );

    return new Promise<void>((resolve) => {
      let timeoutId = 0;
      let frameId = 0;
      let isDone = false;
      const startedAt = performance.now();

      const finish = () => {
        if (isDone) return;
        isDone = true;
        window.clearTimeout(timeoutId);
        window.cancelAnimationFrame(frameId);
        if (scriptTextSkipRef.current === finish) {
          scriptTextSkipRef.current = null;
        }
        setMessages((current) =>
          current.map((currentMessage) =>
            currentMessage.id === message.id
              ? {
                  ...currentMessage,
                  content: fullText,
                  metadata: {
                    ...currentMessage.metadata,
                    scriptHidden: false,
                    streaming: false,
                  },
                }
              : currentMessage,
          ),
        );
        resolve();
      };

      const tick = () => {
        if (isDone) return;

        let progress = 0;
        let nextIndex = 0;

        if (audio && revealPoints.length) {
          nextIndex = scriptStreamIndexAtAudioTime(revealPoints, audio.currentTime);
          progress = nextIndex >= fullText.length || audio.ended ? 1 : 0;
        } else {
          const elapsed = performance.now() - startedAt;
          progress = Math.min(1, elapsed / durationMs);
          nextIndex = scriptStreamIndexAt(fullText, progress);
        }

        setMessages((current) =>
          current.map((currentMessage) =>
            currentMessage.id === message.id
              ? {
                  ...currentMessage,
                  content: fullText.slice(0, nextIndex),
                  metadata: {
                    ...currentMessage.metadata,
                    scriptHidden: false,
                    streaming: true,
                  },
                }
              : currentMessage,
          ),
        );

        if (progress >= 1) {
          finish();
          return;
        }

        if (audio && revealPoints.length) {
          frameId = window.requestAnimationFrame(tick);
        } else {
          timeoutId = window.setTimeout(tick, 40);
        }
      };

      scriptTextSkipRef.current = finish;
      tick();
    });
  }

  function playPreparedScriptAudio(
    audio: HTMLAudioElement,
    cues: ScriptCue[] = [],
    fallbackDurationSeconds = 0,
    offsetMs = 0,
  ) {
    return new Promise<void>((resolve, reject) => {
      scriptAudioRef.current = audio;
      let isDone = false;
      let cueIndex = 0;
      let timingFrame = 0;

      const currentAudioDuration = () =>
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : fallbackDurationSeconds;
      const cueList = [...cues].sort(
        (left, right) =>
          scriptCueEffectiveTime(left, currentAudioDuration(), offsetMs) -
          scriptCueEffectiveTime(right, currentAudioDuration(), offsetMs),
      );

      const runDueCues = (currentTime: number, runAll = false) => {
        const audioDuration = currentAudioDuration();
        while (cueIndex < cueList.length) {
          const cue = cueList[cueIndex];
          const cueTime = scriptCueEffectiveTime(cue, audioDuration, offsetMs);
          if (!runAll && currentTime + 0.015 < cueTime) break;

          cueIndex += 1;
          applyRuntimeActions([cue.action]);
        }
      };

      const tickCues = () => {
        if (isDone) return;
        runDueCues(audio.currentTime);
        timingFrame = window.requestAnimationFrame(tickCues);
      };

      const cleanup = () => {
        window.cancelAnimationFrame(timingFrame);
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        if (scriptAudioSkipRef.current === handleSkip) {
          scriptAudioSkipRef.current = null;
        }
        if (scriptAudioRef.current === audio) {
          scriptAudioRef.current = null;
        }
      };
      const handleEnded = () => {
        if (isDone) return;
        isDone = true;
        runDueCues(currentAudioDuration(), true);
        cleanup();
        resolve();
      };
      const handleError = () => {
        if (isDone) return;
        isDone = true;
        cleanup();
        reject(new Error("Could not play the scripted audio recording."));
      };
      const handleSkip = () => {
        if (isDone) return;
        isDone = true;
        audio.pause();
        runDueCues(currentAudioDuration(), true);
        cleanup();
        resolve();
      };
      const handlePlay = () => {
        window.cancelAnimationFrame(timingFrame);
        runDueCues(audio.currentTime);
        timingFrame = window.requestAnimationFrame(tickCues);
      };
      const handleTimeUpdate = () => {
        runDueCues(audio.currentTime);
      };

      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("error", handleError);
      audio.addEventListener("play", handlePlay);
      audio.addEventListener("timeupdate", handleTimeUpdate);
      scriptAudioSkipRef.current = handleSkip;
      void audio.play().catch((error: unknown) => {
        isDone = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("Audio playback was blocked."));
      });
    });
  }

  async function playScriptMessage(
    message: ChatMessage,
    audioUrl: string,
    cueValue?: unknown,
    durationSeconds?: number | null,
    wordValue?: unknown,
  ) {
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    const durationMs = scriptStreamDurationMs(
      message.content,
      durationSeconds ?? undefined,
    );
    const fallbackDurationSeconds = durationMs / 1000;

    const allCues = scriptCuesFromMessage(message, cueValue);
    const words = scriptWordsFromValue(wordValue);
    const scriptActionOffsetMs = tutorForm.scriptActionOffsetMs;
    await Promise.all([
      waitForAudioMetadata(audio),
      preloadScriptCueAssets(allCues),
    ]);

    const cues = allCues.filter(
      (cue) =>
        !(
          scriptActionOffsetMs <= 0 &&
          cue.progress <= scriptImmediateCueProgress
        ),
    );
    await Promise.all([
      streamScriptMessageText(message, durationMs, audio, words),
      playPreparedScriptAudio(
        audio,
        cues,
        fallbackDurationSeconds,
        scriptActionOffsetMs,
      ),
    ]);
  }

  function revealScriptMessageText(message: ChatMessage) {
    setMessages((current) =>
      current.map((currentMessage) =>
        currentMessage.id === message.id
          ? {
              ...currentMessage,
              content: message.content,
              metadata: {
                ...currentMessage.metadata,
                scriptHidden: false,
                streaming: false,
              },
            }
          : currentMessage,
      ),
    );
  }

  async function playScriptMessages(
    activeSession: TutoringSession,
    candidateMessages: ChatMessage[],
  ) {
    const scriptMessages = candidateMessages.filter(isScriptAudioMessage);
    if (!scriptMessages.length) return;

    for (const message of scriptMessages) {
      if (activeSessionIdRef.current !== activeSession.id) break;
      if (playedScriptMessageIdsRef.current.has(message.id)) continue;
      playedScriptMessageIdsRef.current.add(message.id);

      try {
        let payload = cachedScriptAudioFromMessage(message);
        const messageCues = scriptCuesFromMessage(message);
        const needsAlignedTiming =
          !payload?.scriptWords?.length ||
          (messageCues.some(scriptCueNeedsTiming) &&
            !payload.scriptCues?.every(
              (cue) =>
                cue.progress <= scriptImmediateCueProgress ||
                typeof cue.time === "number",
            ));
        if (
          !payload ||
          payload.realtimeModel !== selectedModel ||
          payload.voice !== selectedVoice ||
          needsAlignedTiming
        ) {
          payload = await apiFetch<MessageAudioPayload>(
            `/api/sessions/${activeSession.id}/messages/${message.id}/audio/`,
            {
              method: "POST",
              body: JSON.stringify({
                model: selectedModel,
                voice: selectedVoice,
              }),
            },
          );
        }
        if (payload.timingWarning) {
          setChatError(payload.timingWarning);
        }
        await playScriptMessage(
          message,
          payload.audioUrl,
          payload.scriptCues,
          payload.durationSeconds,
          payload.scriptWords,
        );
      } catch (error) {
        scriptTextSkipRef.current?.();
        revealScriptMessageText(message);
        const detail =
          error instanceof Error
            ? error.message
            : "Could not play the scripted audio recording.";
        setRealtimeStatus("audio-blocked");
        setChatError(detail);
        break;
      }
    }
  }

  function queueScriptMessages(
    activeSession: TutoringSession,
    candidateMessages: ChatMessage[] | undefined,
  ) {
    const scriptMessages = candidateMessages?.filter(isScriptAudioMessage) ?? [];
    if (!scriptMessages.length) return;

    const scriptMessageIds = new Set(scriptMessages.map((message) => message.id));
    const immediateActions = scriptMessages.flatMap((message) =>
      scriptCuesFromMessage(message)
        .filter(
          (cue) =>
            tutorForm.scriptActionOffsetMs <= 0 &&
            cue.progress <= scriptImmediateCueProgress,
        )
        .map((cue) => cue.action),
    );
    applyRuntimeActions(immediateActions);

    setMessages((current) =>
      current.map((message) =>
        scriptMessageIds.has(message.id)
          ? {
              ...message,
              content: "",
              metadata: {
                ...message.metadata,
                scriptHidden: true,
                streaming: false,
              },
            }
          : message,
      ),
    );

    scriptAudioQueueRef.current = scriptAudioQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setIsScriptAudioPlaying(true);
        try {
          await playScriptMessages(activeSession, scriptMessages);
        } finally {
          setIsScriptAudioPlaying(false);
        }
      });
  }

  async function selectExperience(experienceId: string) {
    const nextExperience =
      experiences.find((experience) => experience.id === experienceId) ?? null;
    if (!nextExperience || experienceId === selectedExperienceId) return;

    setChatStatus("loading");
    setChatError("");
    setExperienceError("");
    realtimeConnectionRef.current?.close();
    realtimeConnectionRef.current = null;

    try {
      applySelectedExperience(nextExperience);
      if (routeExperience(window.location.pathname).mode === "run") {
        window.history.replaceState(
          null,
          "",
          experienceRunPath(nextExperience.id),
        );
      }
      await loadCurrentSessionForExperience(nextExperience.id);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Could not switch experience.";
      setChatStatus("error");
      setChatError(detail);
      setExperienceError(detail);
    }
  }

  async function createExperience() {
    setIsCreatingExperience(true);
    setExperienceError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>("/api/experiences/", {
        method: "POST",
        body: JSON.stringify({
          description: "",
          title: "Untitled experience",
        }),
      });
      setExperiences((current) => [payload.experience, ...current]);
      applySelectedExperience(payload.experience);
      if (routeExperience(window.location.pathname).mode === "run") {
        window.history.replaceState(
          null,
          "",
          experienceRunPath(payload.experience.id),
        );
      }
      await loadCurrentSessionForExperience(payload.experience.id);
    } catch (error) {
      setExperienceError(
        error instanceof Error ? error.message : "Could not create experience.",
      );
    } finally {
      setIsCreatingExperience(false);
    }
  }

  async function saveExperienceDetails() {
    if (!selectedExperience) return;

    setIsSavingExperience(true);
    setExperienceError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${selectedExperience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify(experienceForm),
        },
      );
      setExperiences((current) =>
        current.map((experience) =>
          experience.id === payload.experience.id ? payload.experience : experience,
        ),
      );
      applySelectedExperience(payload.experience);
    } catch (error) {
      setExperienceError(
        error instanceof Error ? error.message : "Could not save experience.",
      );
    } finally {
      setIsSavingExperience(false);
    }
  }

  async function saveTutorSettings() {
    if (!selectedExperience) return;

    setIsSavingTutor(true);
    setExperienceError("");

    try {
      const payload = await apiFetch<{ experience: Experience }>(
        `/api/experiences/${selectedExperience.id}/`,
        {
          method: "PATCH",
          body: JSON.stringify({ tutor: tutorForm }),
        },
      );
      setExperiences((current) =>
        current.map((experience) =>
          experience.id === payload.experience.id ? payload.experience : experience,
        ),
      );
      applySelectedExperience(payload.experience);
      realtimeConnectionRef.current?.close();
      realtimeConnectionRef.current = null;
    } catch (error) {
      setExperienceError(
        error instanceof Error ? error.message : "Could not save tutor settings.",
      );
    } finally {
      setIsSavingTutor(false);
    }
  }

  async function createNewSession() {
    setIsCreatingSession(true);
    setChatError("");

    try {
      const payload = await apiFetch<SessionPayload>("/api/sessions/", {
        method: "POST",
        body: JSON.stringify({ experienceId: selectedExperienceId }),
      });
      setSession(payload.session);
      setMessages(payload.messages);
      setTurnAnchorMessageId(null);
      setRuntimeActionLog([]);
      setChatStatus("ready");
    } catch (error) {
      setChatStatus("error");
      setChatError(
        error instanceof Error ? error.message : "Could not create session.",
      );
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function getRealtimeConnection(
    activeSession: TutoringSession,
    excludeMessageId?: string,
  ) {
    const currentConnection = realtimeConnectionRef.current;
    if (
      currentConnection?.matches(
        activeSession.id,
        selectedModel,
        selectedVoice,
      )
    ) {
      return currentConnection;
    }

    currentConnection?.close();
    realtimeConnectionRef.current = null;

    const connection = await DluRealtimeConnection.connect(
      {
        fetchClientSecret: ({ sessionId, model, voice }) =>
          apiFetch<unknown>("/api/realtime/client-secret/", {
            method: "POST",
            body: JSON.stringify({ excludeMessageId, sessionId, model, voice }),
          }),
        model: selectedModel,
        sessionId: activeSession.id,
        voice: selectedVoice,
      },
      {
        onError: (message) => {
          setChatError(message);
          setChatStatus("error");
        },
        onStatusChange: setRealtimeStatus,
      },
    );

    realtimeConnectionRef.current = connection;
    return connection;
  }

  async function runChatToolCall(
    activeSession: TutoringSession,
    toolCall: RealtimeToolCall,
  ) {
    realtimeConnectionRef.current?.close();
    realtimeConnectionRef.current = null;

    const payload = await apiFetch<StartEventPayload>(
      `/api/sessions/${activeSession.id}/chat-tool/`,
      {
        method: "POST",
        body: JSON.stringify({
          arguments: toolCall.arguments,
          toolCallId: toolCall.callId,
          toolName: toolCall.name,
          uiState: currentRuntimeUiState(),
        }),
      },
    );

    setSession(payload.session);
    setMessages(payload.messages);
    applyRuntimeActions(payload.actions);
    if (payload.ranMessages?.[0]) {
      setTurnAnchorMessageId(payload.ranMessages[0].id);
    }
    queueScriptMessages(payload.session, payload.ranMessages);
  }

  async function runConversationChecks(activeSession: TutoringSession) {
    const payload = await apiFetch<ConversationCheckPayload>(
      `/api/sessions/${activeSession.id}/conversation-checks/run/`,
      {
        method: "POST",
        body: JSON.stringify({
          uiState: currentRuntimeUiState(),
        }),
      },
    );

    setSession(payload.session);
    setMessages(payload.messages);
    applyRuntimeActions(payload.actions);

    if (payload.handled) {
      realtimeConnectionRef.current?.close();
      realtimeConnectionRef.current = null;
      if (payload.ranMessages?.[0]) {
        setTurnAnchorMessageId(payload.ranMessages[0].id);
      }
      queueScriptMessages(payload.session, payload.ranMessages);
    }

    return {
      handled: payload.handled,
      session: payload.session,
    };
  }

  async function saveSessionMessage(
    activeSession: TutoringSession,
    content: string,
    role: ChatMessage["role"] = "user",
    metadata: Record<string, unknown> = {},
  ) {
    return apiFetch<{
      session: TutoringSession;
      message: ChatMessage;
    }>(`/api/sessions/${activeSession.id}/messages/`, {
      method: "POST",
      body: JSON.stringify({ content, metadata, role }),
    });
  }

  async function sendChatMessage(content: string) {
    if (!session || isSendingMessage) return;

    setIsSendingMessage(true);
    setChatError("");

    let pendingAssistantId = "";

    try {
      const payload = await saveSessionMessage(session, content);
      let activeSession = payload.session;
      setSession(activeSession);
      setMessages((current) => sortMessages([...current, payload.message]));
      setTurnAnchorMessageId(payload.message.id);
      setChatStatus("ready");

      const checkResult = await runConversationChecks(activeSession);
      activeSession = checkResult.session;
      if (checkResult.handled) {
        return;
      }

      const assistantMessageId = localMessageId("assistant");
      pendingAssistantId = assistantMessageId;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        sequence: payload.message.sequence + 0.5,
        createdAt: new Date().toISOString(),
        metadata: {
          model: selectedModel,
          source: "openai-realtime",
          streaming: true,
          voice: selectedVoice,
        },
      };

      setMessages((current) =>
        sortMessages([...current, assistantMessage]),
      );

      const connection = await getRealtimeConnection(
        activeSession,
        payload.message.id,
      );
      const turnResult = await connection.sendUserText(content, (delta) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: `${message.content}${delta}`,
                }
              : message,
          ),
        );
      });

      const finalContent = turnResult.text.trim();
      if (!finalContent && !turnResult.toolCall) {
        const diagnosticsVersion = "realtime-diagnostics-2026-05-30-b";
        const eventSummaries = Array.isArray(turnResult.eventSummaries)
          ? turnResult.eventSummaries
          : [];
        const recentEvents =
          eventSummaries.slice(-12).join(" | ") || "no client events captured";
        console.warn(
          "Realtime turn ended without transcript or tool call.",
          {
            diagnosticsVersion,
            eventSummaries,
            turnResult,
          },
        );
        throw new Error(
          `dLU responded with audio but no text transcript. Diagnostics ${diagnosticsVersion}: ${recentEvents}`,
        );
      }

      let nextActiveSession = activeSession;
      if (finalContent) {
        const assistantPayload = await saveSessionMessage(
          activeSession,
          finalContent,
          "assistant",
          {
            model: selectedModel,
            source: "openai-realtime",
            voice: selectedVoice,
          },
        );
        nextActiveSession = assistantPayload.session;
        setSession(assistantPayload.session);
        setMessages((current) =>
          sortMessages(
            current.map((message) =>
              message.id === assistantMessageId
                ? assistantPayload.message
                : message,
            ),
          ),
        );
      } else {
        setMessages((current) =>
          current.filter((message) => message.id !== assistantMessageId),
        );
      }

      if (turnResult.toolCall) {
        await runChatToolCall(nextActiveSession, turnResult.toolCall);
      }
    } catch (error) {
      realtimeConnectionRef.current?.close("error");
      realtimeConnectionRef.current = null;
      const detail =
        error instanceof Error ? error.message : "Could not get a dLU response.";
      setChatStatus("error");
      setChatError(detail);
      if (pendingAssistantId) {
        setMessages((current) =>
          current.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  role: message.content ? "assistant" : "error",
                  content: message.content || detail,
                  metadata: {
                    ...message.metadata,
                    error: detail,
                    streaming: false,
                  },
                }
              : message,
          ),
        );
      }
      throw error;
    } finally {
      setIsSendingMessage(false);
    }
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

  return (
    <main
      className="panel-study"
      data-color-theme="glass-dl"
      data-font-theme="manrope"
    >
      <header className="study-header">
        <p className="study-kicker">
          {selectedExperience?.title || "Tutoring workspace"}
        </p>
        <div className="study-actions">
          <button
            className="header-action secondary"
            disabled={!selectedExperience}
            onClick={() => {
              if (selectedExperience) {
                window.location.assign(experienceEditPath(selectedExperience.id));
              }
            }}
            type="button"
          >
            Edit
          </button>
          <button
            className="header-action secondary"
            onClick={() => window.location.assign("/")}
            type="button"
          >
            Experiences
          </button>
        </div>
      </header>

      <section
        className={[
          "workspace-shell",
          isLeftOpen ? "drawer-open" : "drawer-closed",
          isInspectorOpen ? "inspector-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={shellRef}
        style={shellStyle}
      >
        <button
          aria-label={isLeftOpen ? "Hide left panels" : "Show left panels"}
          aria-pressed={isLeftOpen}
          className="left-panel-toggle"
          onClick={() => setIsLeftOpen((current) => !current)}
          type="button"
        >
          <span className="toggle-panel-icon" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>

        <aside
          aria-hidden={!isLeftOpen}
          className="left-tools-drawer"
          aria-label="Panel stack"
        >
          <div className="left-stack-scroll">
            {leftPanels.map((panel) => (
              <PanelWindow
                ariaLabel={panel.label}
                density={panel.density}
                key={panel.label}
              >
                <LeftPanelContent
                  experience={{
                    chatStatus,
                    error: experienceError,
                    experienceForm,
                    experiences,
                    isCreatingSession,
                    isCreatingExperience,
                    isSavingExperience,
                    isSigningOut,
                    onCreateExperience: createExperience,
                    onCreateNewSession: createNewSession,
                    onExperienceFormChange: setExperienceForm,
                    onSaveExperience: saveExperienceDetails,
                    onSelectExperience: selectExperience,
                    onSignOut: signOut,
                    selectedExperienceId,
                    user,
                  }}
                  kind={panel.kind}
                  runtime={{
                    notesVisible,
                    onToggleNotes: toggleRuntimeNotes,
                  }}
                  slides={{
                    deckUrl: slideDeckUrl,
                    error: slideError,
                    onClear: clearSlides,
                    onDeckUrlChange: setSlideDeckUrl,
                    onRefreshSlide: () => resolveCurrentSlide(true),
                    onResolveSlide: () => resolveCurrentSlide(false),
                    onSampleDeck: loadSampleSlideDeck,
                    onSlideRefChange: setSlideRef,
                    resolvedSlide,
                    slideRef,
                    status: slideStatus,
                  }}
                  tutor={{
                    avatarUrl: publicAsset(tutorForm.avatarPath),
                    error: experienceError,
                    isSaving: isSavingTutor,
                    onAvatarPathChange: (avatarPath) =>
                      setTutorForm((current) => ({
                        ...current,
                        avatarPath,
                      })),
                    onClassificationModelChange: (classificationModel) =>
                      setTutorForm((current) => ({
                        ...current,
                        classificationModel,
                      })),
                    onModelChange: (model) => {
                      const nextVoice = isRealtimeVoiceSupported(
                        model,
                        selectedVoice,
                      )
                        ? selectedVoice
                        : (realtimeVoiceOptionsForModel(model)[0]?.id ??
                          selectedVoice);
                      setTutorForm((current) => ({
                        ...current,
                        realtimeModel: model,
                        voice: nextVoice,
                      }));
                      setSelectedModel(model);
                      setSelectedVoice(nextVoice);
                    },
                    onNameChange: (assistantName) =>
                      setTutorForm((current) => ({
                        ...current,
                        assistantName,
                      })),
                    onSave: saveTutorSettings,
                    onScriptActionOffsetChange: (scriptActionOffsetMs) =>
                      setTutorForm((current) => ({
                        ...current,
                        scriptActionOffsetMs,
                      })),
                    onVoiceChange: (voice) => {
                      setTutorForm((current) => ({
                        ...current,
                        voice,
                      }));
                      setSelectedVoice(voice);
                    },
                    onVoiceInstructionsChange: (voiceInstructions) =>
                      setTutorForm((current) => ({
                        ...current,
                        voiceInstructions,
                      })),
                    realtimeStatus,
                    tutor: tutorForm,
                  }}
                />
              </PanelWindow>
            ))}
          </div>
        </aside>

        <div
          aria-label="Resize tools"
          className="vertical-resizer drawer-resizer"
          onPointerDown={dragLeftDivider}
          role="separator"
        />

        <section className="panel-stage">
          <div
            aria-label="Resize workspace width"
            className="vertical-resizer workspace-width-resizer"
            onPointerDown={dragWorkspaceDivider}
            role="separator"
          />

          <section
            className="right-region"
            ref={rightRef}
            style={{ "--lower-height": `${lowerHeight}px` } as CSSProperties}
          >
            <PanelWindow ariaLabel="Panel five" density="main">
              <MainPanelContent
                context={session?.runtimeContext ?? {}}
                emitInteractiveActions={emitRuntimeInteractiveActions}
                error={slideError}
                interactive={runtimeInteractive}
                interactiveState={runtimeInteractiveState}
                onInteractiveComplete={completeRuntimeInteractive}
                onInteractiveEvent={runRuntimeInteractiveEvent}
                onInteractiveSaveContext={saveRuntimeInteractiveContext}
                onInteractiveStateChange={changeRuntimeInteractiveState}
                slide={resolvedSlide}
                status={slideStatus}
              />
            </PanelWindow>
            <div
              aria-label="Resize rows"
              className="horizontal-resizer"
              onPointerDown={dragLowerDivider}
              role="separator"
            />
            <PanelWindow ariaLabel="Panel six" density="lower">
              <ChatPanelContent
                assistantName={tutorForm.assistantName}
                avatarPath={tutorForm.avatarPath}
                error={chatError}
                isChatEnabled={runtimeChatEnabled}
                isSending={isSendingMessage}
                isTurnLocked={
                  isSendingMessage ||
                  isScriptAudioPlaying ||
                  realtimeStatus === "streaming"
                }
                messages={messages}
                onChooseRuntimeButton={runRuntimeButton}
                onSendMessage={sendChatMessage}
                realtimeStatus={realtimeStatus}
                runtimeButtons={runtimeButtons}
                session={session}
                status={chatStatus}
                turnAnchorMessageId={turnAnchorMessageId}
                user={user}
              />
            </PanelWindow>
          </section>
        </section>

        <button
          aria-label={
            isInspectorOpen ? "Hide runtime inspector" : "Show runtime inspector"
          }
          aria-pressed={isInspectorOpen}
          className="runtime-inspector-toggle"
          onClick={() => setIsInspectorOpen((current) => !current)}
          title={isInspectorOpen ? "Hide runtime inspector" : "Show runtime inspector"}
          type="button"
        >
          <InspectorIcon />
        </button>

        <aside
          aria-hidden={!isInspectorOpen}
          aria-label="Runtime inspector"
          className="runtime-inspector-drawer"
        >
          <RuntimeInspectorPanel
            actionLog={runtimeActionLog}
            buttons={runtimeButtons}
            chatEnabled={runtimeChatEnabled}
            currentEvent={currentRuntimeEvent}
            currentEventSlug={currentRuntimeEventSlug}
            experience={selectedExperience}
            highlights={runtimeHighlights}
            interactive={runtimeInteractive}
            interactiveState={runtimeInteractiveState}
            messages={messages}
            runtimeDebug={recordFromUnknown(session?.runtimeState?.runtimeDebug)}
            runtimeContext={session?.runtimeContext ?? {}}
            session={session}
            slide={resolvedSlide}
            slideError={slideError}
            triggers={runtimeTriggers}
          />
        </aside>
      </section>
    </main>
  );
}

function RuntimeInspectorPanel({
  actionLog,
  buttons,
  chatEnabled,
  currentEvent,
  currentEventSlug,
  experience,
  highlights,
  interactive,
  interactiveState,
  messages,
  runtimeDebug,
  runtimeContext,
  session,
  slide,
  slideError,
  triggers,
}: {
  actionLog: RuntimeActionLogEntry[];
  buttons: RuntimeButton[];
  chatEnabled: boolean;
  currentEvent: ExperienceEvent | null;
  currentEventSlug: string;
  experience: Experience | null;
  highlights: Record<string, RuntimeHighlight>;
  interactive: RuntimeInteractive | null;
  interactiveState: Record<string, unknown>;
  messages: ChatMessage[];
  runtimeDebug: Record<string, unknown>;
  runtimeContext: Record<string, unknown>;
  session: TutoringSession | null;
  slide: ResolvedSlide | null;
  slideError: string;
  triggers: RuntimeUiTrigger[];
}) {
  const contextEntries = Object.entries(runtimeContext).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const interactiveStateEntries = Object.entries(interactiveState);
  const highlightEntries = Object.values(highlights);
  const serverActionEntries = runtimeDebugEntries(runtimeDebug.recentActions).slice(
    0,
    18,
  );
  const transitionEntries = runtimeDebugEntries(runtimeDebug.transitions).slice(
    0,
    12,
  );
  const scriptedMessages = messages.filter((message) => {
    const source =
      typeof message.metadata?.source === "string"
        ? message.metadata.source
        : "";
    return (
      message.role === "assistant" &&
      message.content.trim().length > 0 &&
      scriptAudioSources.has(source)
    );
  });
  const cachedAudioMessages = scriptedMessages
    .map(cachedScriptAudioFromMessage)
    .filter(Boolean);
  const timedAudioMessages = cachedAudioMessages.filter(
    (audio) => (audio?.scriptWords?.length ?? 0) > 0,
  );
  const currentEventLabel =
    currentEvent?.title || currentEventSlug || (session ? "Start" : "---");
  const events = experience?.events ?? [];
  const eventStats =
    currentEvent && events.length ? eventTransitionStats(events, currentEvent) : null;
  const outgoingLinks = currentEvent
    ? eventOutgoingLinks(currentEvent).slice(0, 8)
    : [];
  const enabledStepCount =
    currentEvent?.steps.filter((step) => step.enabled).length ?? 0;
  const enabledToolCount =
    currentEvent?.chatTools.filter((tool) => tool.enabled).length ?? 0;
  const enabledCheckCount =
    currentEvent?.conversationChecks.filter((check) => check.enabled).length ?? 0;
  const enabledClassifierGroupCount =
    currentEvent?.classifierGroups.filter((group) => group.enabled).length ?? 0;
  const enabledClassifierCount =
    currentEvent?.classifierGroups.reduce(
      (total, group) =>
        total +
        group.classifiers.filter(
          (classifier) => group.enabled && classifier.enabled,
        ).length,
      0,
    ) ?? 0;
  const runtimeDebugUpdatedAt =
    typeof runtimeDebug.updatedAt === "string" ? runtimeDebug.updatedAt : "";

  return (
    <div className="runtime-inspector-scroll">
      <div className="runtime-inspector-panel">
        <header className="runtime-inspector-header">
          <span>Runtime</span>
          <strong>{currentEventLabel}</strong>
        </header>

        <div className="runtime-inspector-section">
          <div className="runtime-inspector-kv">
            <span>Session</span>
            <strong>{session?.id.slice(0, 8) || "---"}</strong>
          </div>
          <div className="runtime-inspector-kv">
            <span>Event slug</span>
            <strong>{currentEvent?.slug || currentEventSlug || "---"}</strong>
          </div>
          <div className="runtime-inspector-kv">
            <span>Chat</span>
            <strong>{chatEnabled ? "on" : "off"}</strong>
          </div>
          <div className="runtime-inspector-kv">
            <span>Trace</span>
            <strong>{runtimeTraceTime(runtimeDebugUpdatedAt)}</strong>
          </div>
        </div>

        <section className="runtime-inspector-section">
          <h2>Current event</h2>
          {currentEvent ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>On entry</span>
                <code>
                  {enabledStepCount}/{currentEvent.steps.length}
                </code>
              </div>
              <div className="runtime-inspector-row">
                <span>Conversation</span>
                <code>
                  {enabledToolCount} FC / {enabledCheckCount} checks /{" "}
                  {enabledClassifierCount} classifiers
                </code>
              </div>
              <div className="runtime-inspector-row">
                <span>Classifier groups</span>
                <code>
                  {enabledClassifierGroupCount}/{currentEvent.classifierGroups.length}
                </code>
              </div>
              {eventStats ? (
                <div className="runtime-inspector-row">
                  <span>Routing</span>
                  <code>
                    {eventStats.incomingCount} in / {eventStats.outgoingCount} out
                    {eventStats.unresolvedCount
                      ? ` / ${eventStats.unresolvedCount} missing`
                      : ""}
                  </code>
                </div>
              ) : null}
              {outgoingLinks.map((link, index) => (
                <div
                  className="runtime-inspector-row runtime-inspector-link-row"
                  key={`${link.kind}-${link.slug}-${index}`}
                >
                  <span>{link.kind}</span>
                  <code>
                    {eventTitleForTrigger(events, link.slug) || link.slug}
                    {link.condition ? ` if ${link.condition}` : ""}
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Context</h2>
          {contextEntries.length ? (
            <div className="runtime-inspector-list">
              {contextEntries.map(([key, value]) => (
                <div className="runtime-inspector-row" key={key}>
                  <span>{key}</span>
                  <code
                    className="runtime-inspector-value"
                    title={fullRuntimeValue(value)}
                  >
                    <span>{compactRuntimeValue(value)}</span>
                    <small>{runtimeValueTypeLabel(value)}</small>
                  </code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Main panel</h2>
          {interactive ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>App</span>
                <code>{interactive.interactiveId}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>View</span>
                <code>{interactive.mode || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Target</span>
                <code>{interactive.triggersEvent || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Title</span>
                <code>{interactive.title || "---"}</code>
              </div>
              {interactiveStateEntries.map(([key, value]) => (
                <div className="runtime-inspector-row" key={key}>
                  <span>{key}</span>
                  <code>{compactRuntimeValue(value)}</code>
                </div>
              ))}
            </div>
          ) : slide ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>Slide</span>
                <code>{slide.slideRef || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Page</span>
                <code>{slide.pageId || "---"}</code>
              </div>
              <div className="runtime-inspector-row">
                <span>Cache</span>
                <code>{slide.cached ? "hit" : "miss"}</code>
              </div>
            </div>
          ) : slideError ? (
            <div className="runtime-inspector-list">
              <div className="runtime-inspector-row">
                <span>Slide error</span>
                <code>{slideError}</code>
              </div>
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Pending triggers</h2>
          <div className="runtime-inspector-list">
            {triggers.map((trigger) => (
              <div
                className="runtime-inspector-row"
                key={`${trigger.selector}-${trigger.triggersEvent}`}
              >
                <span>{trigger.selector}</span>
                <code>{trigger.triggersEvent}</code>
              </div>
            ))}
            {buttons.map((button) => (
              <div
                className="runtime-inspector-row"
                key={`${button.stepId}-${button.triggersEvent}`}
              >
                <span>button: {button.label}</span>
                <code>{button.triggersEvent}</code>
              </div>
            ))}
          </div>
          {!triggers.length && !buttons.length ? (
            <p className="runtime-inspector-empty">---</p>
          ) : null}
        </section>

        <section className="runtime-inspector-section">
          <h2>Highlights</h2>
          <div className="runtime-inspector-list">
            {highlightEntries.map((highlight) => (
              <div
                className="runtime-inspector-row"
                key={highlight.selector}
              >
                <span>{highlight.selector}</span>
                <code>highlight</code>
              </div>
            ))}
          </div>
          {!highlightEntries.length ? (
            <p className="runtime-inspector-empty">---</p>
          ) : null}
        </section>

        <section className="runtime-inspector-section">
          <h2>Audio cache</h2>
          <div className="runtime-inspector-list">
            <div className="runtime-inspector-row">
              <span>Scripted lines</span>
              <code>{scriptedMessages.length}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Cached audio</span>
              <code>{cachedAudioMessages.length}</code>
            </div>
            <div className="runtime-inspector-row">
              <span>Word timing</span>
              <code>{timedAudioMessages.length}</code>
            </div>
          </div>
        </section>

        <section className="runtime-inspector-section">
          <h2>Transitions</h2>
          {transitionEntries.length ? (
            <div className="runtime-action-log">
              {transitionEntries.map((entry, index) => (
                (() => {
                  const detailsText = runtimeTraceDetailsText(entry.details);
                  return (
                    <div
                      className="runtime-action-row"
                      key={`${entry.at}-${entry.type}-${index}`}
                    >
                      <span>{runtimeTraceTime(entry.at)}</span>
                      <strong>{entry.type}</strong>
                      <p>{entry.summary}</p>
                      {detailsText ? (
                        <code className="runtime-action-detail">{detailsText}</code>
                      ) : null}
                    </div>
                  );
                })()
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Server actions</h2>
          {serverActionEntries.length ? (
            <div className="runtime-action-log">
              {serverActionEntries.map((entry, index) => (
                (() => {
                  const detailsText = runtimeTraceDetailsText(entry.details);
                  return (
                    <div
                      className="runtime-action-row"
                      key={`${entry.at}-${entry.type}-${index}`}
                    >
                      <span>{runtimeTraceTime(entry.at)}</span>
                      <strong>{entry.type}</strong>
                      <p>{entry.summary}</p>
                      {detailsText ? (
                        <code className="runtime-action-detail">{detailsText}</code>
                      ) : null}
                    </div>
                  );
                })()
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Client actions</h2>
          {actionLog.length ? (
            <div className="runtime-action-log">
              {actionLog.map((entry) => (
                <div className="runtime-action-row" key={entry.id}>
                  <span>{entry.time}</span>
                  <strong>{entry.type}</strong>
                  <p>{entry.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>
      </div>
    </div>
  );
}

type PanelWindowProps = {
  density: "compact" | "tall" | "tutor" | "main" | "lower";
  ariaLabel: string;
  children: ReactNode;
  style?: CSSProperties;
};

function PanelWindow({ ariaLabel, children, density, style }: PanelWindowProps) {
  return (
    <article aria-label={ariaLabel} className={`panel-window panel-${density}`} style={style}>
      <div className="panel-body">{children}</div>
    </article>
  );
}

function ScriptActionEditor({
  deckUrl,
  events,
  onDeckUrlChange,
  onTextChange,
  text,
}: {
  deckUrl: string;
  events: ExperienceEvent[];
  onDeckUrlChange: (value: string) => void;
  onTextChange: (value: string) => void;
  text: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const markers = parseScriptMarkerInstances(text);

  useEffect(() => {
    resizeTextareaToContent(textareaRef.current);
  }, [text]);

  function insertMarker(marker: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const tail = after && !/^\s/.test(after) ? " " : "";
    const inserted = `${lead}${marker}${tail}`;
    const nextText = `${before}${inserted}${after}`;
    const nextCursor = before.length + inserted.length;

    onTextChange(nextText);

    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextareaToContent(nextTextarea);
    });
  }

  function focusMarker(marker: ScriptMarkerInstance) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(marker.start, marker.end);
  }

  function removeMarker(marker: ScriptMarkerInstance) {
    const before = text.slice(0, marker.start);
    const after = text.slice(marker.end);
    const nextText =
      /[ \t]$/.test(before) && /^[ \t]/.test(after)
        ? `${before.replace(/[ \t]+$/, " ")}${after.replace(/^[ \t]+/, "")}`
        : `${before}${after}`;
    const nextCursor = Math.min(before.length, nextText.length);

    onTextChange(nextText);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextareaToContent(textarea);
    });
  }

  function replaceMarker(marker: ScriptMarkerInstance, nextMarker: string) {
    const nextText = `${text.slice(0, marker.start)}${nextMarker}${text.slice(
      marker.end,
    )}`;
    const nextCursor = marker.start + nextMarker.length;

    onTextChange(nextText);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      resizeTextareaToContent(textarea);
    });
  }

  function updateMarkerArg(
    marker: ScriptMarkerInstance,
    argIndex: number,
    value: string,
  ) {
    const args = [...marker.argList];
    while (args.length <= argIndex) args.push("");
    args[argIndex] = value;
    replaceMarker(marker, buildScriptMarker(marker.type, args));
  }

  function renderMarkerControls(marker: ScriptMarkerInstance) {
    if (marker.type === "gslide" || marker.type === "slide") {
      return (
        <div className="script-marker-controls">
          <span className="event-detail-label">SLIDE</span>
          <input
            aria-label="Timed slide number"
            onChange={(event) => updateMarkerArg(marker, 0, event.target.value)}
            placeholder="1"
            type="text"
            value={marker.argList[0] ?? ""}
          />
        </div>
      );
    }

    if (marker.type === "interactive" || marker.type === "interactive_update") {
      const appId = marker.argList[0] || defaultMainPanelApp.id;
      const appDefinition =
        getMainPanelAppDefinition(appId) ?? defaultMainPanelApp;
      const view = marker.argList[1] || appDefinition.defaultView;
      const destination = marker.argList[2] ?? "";
      const hasCurrentView = appDefinition.views.some((item) => item.id === view);
      const hasDestinationOption = events.some(
        (event) => event.slug === destination,
      );

      return (
        <div className="script-marker-controls interactive-marker-controls">
          <span className="event-detail-label">APP</span>
          <select
            aria-label="Timed main-panel app"
            onChange={(event) => {
              const nextApp =
                getMainPanelAppDefinition(event.target.value) ??
                defaultMainPanelApp;
              replaceMarker(
                marker,
                buildScriptMarker(marker.type, [
                  nextApp.id,
                  nextApp.defaultView,
                  marker.argList[2] ?? "",
                ]),
              );
            }}
            value={appDefinition.id}
          >
            {mainPanelAppDefinitions.map((app) => (
              <option key={app.id} value={app.id}>
                {app.label}
              </option>
            ))}
          </select>
          <span className="event-detail-label">VIEW</span>
          <select
            aria-label="Timed main-panel app view"
            onChange={(event) => updateMarkerArg(marker, 1, event.target.value)}
            value={hasCurrentView ? view : ""}
          >
            {!hasCurrentView && view ? <option value="">{view}</option> : null}
            {appDefinition.views.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <span className="event-detail-label">DESTINATION</span>
          <select
            aria-label="Timed main-panel app destination event"
            onChange={(event) => updateMarkerArg(marker, 2, event.target.value)}
            value={destination}
          >
            <option value="">No destination</option>
            {destination && !hasDestinationOption ? (
              <option value={destination}>{destination}</option>
            ) : null}
            {events.map((event) => (
              <option key={event.id} value={event.slug}>
                {event.title || event.slug}
                {event.isStart ? " (start)" : ""}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (marker.type === "highlight_on" || marker.type === "highlight") {
      return (
        <div className="script-marker-controls highlight-marker-controls">
          <span className="event-detail-label">SELECTOR</span>
          <input
            aria-label="Timed highlight selector"
            onChange={(event) => updateMarkerArg(marker, 0, event.target.value)}
            placeholder=".selector"
            type="text"
            value={marker.argList[0] ?? ""}
          />
          <span className="event-detail-label">COLOR</span>
          <input
            aria-label="Timed highlight color"
            onChange={(event) => updateMarkerArg(marker, 1, event.target.value)}
            placeholder="rgba(59, 130, 246, 0.6)"
            type="text"
            value={marker.argList[1] ?? ""}
          />
        </div>
      );
    }

    if (marker.type === "highlight_off") {
      return (
        <div className="script-marker-controls">
          <span className="event-detail-label">SELECTOR</span>
          <input
            aria-label="Timed clear-highlight selector"
            onChange={(event) => updateMarkerArg(marker, 0, event.target.value)}
            placeholder=".selector"
            type="text"
            value={marker.argList[0] ?? ""}
          />
        </div>
      );
    }

    if (marker.type === "pause") {
      return (
        <div className="script-marker-controls">
          <span className="event-detail-label">MS</span>
          <input
            aria-label="Timed pause milliseconds"
            inputMode="numeric"
            onChange={(event) => updateMarkerArg(marker, 0, event.target.value)}
            placeholder="500"
            type="text"
            value={marker.argList[0] ?? ""}
          />
        </div>
      );
    }

    return null;
  }

  return (
    <div className="script-action-editor">
      <div className="script-marker-bar" aria-label="Insert timed script action">
        {scriptMarkerOptions.map((option) => (
          <button
            className="event-text-button"
            key={option.marker}
            onClick={() => insertMarker(option.marker)}
            title={option.title}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Speech text"
        className="event-script-textarea"
        onChange={(event) => onTextChange(event.target.value)}
        onInput={(event) => resizeTextareaToContent(event.currentTarget)}
        placeholder="What the agent says... [gslide: 1]"
        ref={textareaRef}
        value={text}
      />
      {markers.length ? (
        <div className="script-marker-outline" aria-label="Timed script actions">
          <span className="event-detail-label">TIMED ACTIONS</span>
          <div className="script-marker-list">
            {markers.map((marker, index) => (
              <div className="script-marker-item" key={marker.id}>
                <div className="script-marker-main">
                  <button
                    className="script-marker-jump"
                    onClick={() => focusMarker(marker)}
                    title="Select this marker in the script text."
                    type="button"
                  >
                    <span>{index + 1}</span>
                    <strong>{marker.label}</strong>
                    <small>
                      {marker.wordIndex > 0 ? `after ${marker.wordIndex} words` : "start"}
                    </small>
                    {marker.detail ? <code>{marker.detail}</code> : null}
                  </button>
                  {renderMarkerControls(marker)}
                </div>
                <button
                  aria-label={`Remove ${marker.label} marker`}
                  className="event-icon-button danger"
                  onClick={() => removeMarker(marker)}
                  title="Remove this timed action marker."
                  type="button"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="event-context-line single-value script-deck-line">
        <span className="event-detail-label">DECK</span>
        <input
          aria-label="Script Google Slides deck URL"
          onChange={(event) => onDeckUrlChange(event.target.value)}
          placeholder="Google Slides URL"
          type="text"
          value={deckUrl}
        />
      </div>
    </div>
  );
}

type LeftPanelKind = (typeof leftPanels)[number]["kind"];

type ExperienceControlsProps = {
  chatStatus: "loading" | "ready" | "error";
  error: string;
  experienceForm: ExperienceForm;
  experiences: Experience[];
  isCreatingExperience: boolean;
  isCreatingSession: boolean;
  isSavingExperience: boolean;
  isSigningOut: boolean;
  onCreateExperience: () => Promise<void>;
  onCreateNewSession: () => Promise<void>;
  onExperienceFormChange: Dispatch<SetStateAction<ExperienceForm>>;
  onSaveExperience: () => Promise<void>;
  onSelectExperience: (experienceId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  selectedExperienceId: string;
  user: ApiUser | null;
};

type TutorControlsProps = {
  avatarUrl: string;
  error: string;
  isSaving: boolean;
  onAvatarPathChange: (avatarPath: string) => void;
  onClassificationModelChange: (model: ClassificationModelId) => void;
  onModelChange: (model: RealtimeModelId) => void;
  onNameChange: (assistantName: string) => void;
  onPlaySample?: () => Promise<void> | void;
  onSave: () => Promise<void>;
  onScriptActionOffsetChange: (offsetMs: number) => void;
  onVoiceChange: (voice: RealtimeVoiceId) => void;
  onVoiceInstructionsChange: (voiceInstructions: string) => void;
  realtimeStatus: RealtimeStatus;
  sampleStatus?: VoiceSampleStatus;
  showSaveAction?: boolean;
  tutor: TutorSettings;
};

type SlideControlsProps = {
  deckUrl: string;
  error: string;
  onClear: () => void;
  onDeckUrlChange: (url: string) => void;
  onRefreshSlide: () => void;
  onResolveSlide: () => void;
  onSampleDeck: () => void;
  onSlideRefChange: (slideRef: string) => void;
  resolvedSlide: ResolvedSlide | null;
  slideRef: string;
  status: SlideStatus;
};

function LeftPanelContent({
  experience,
  kind,
  runtime,
  slides,
  tutor,
}: {
  experience: ExperienceControlsProps;
  kind: LeftPanelKind;
  runtime: {
    notesVisible: boolean;
    onToggleNotes: () => void;
  };
  slides: SlideControlsProps;
  tutor: TutorControlsProps;
}) {
  if (kind === "experience") {
    return (
      <RuntimePlaceholderPanel
        kicker={experience.chatStatus === "ready" ? "Running" : "Workspace"}
        title="Experience context"
        tags={["Session", "Learner", "State"]}
      >
        <p>
          This panel will hold run-specific context: current event, learner
          state, and lightweight controls that belong to the live experience.
        </p>
        <p className="muted-copy">
          Authoring settings now live in the experience editor.
        </p>
        <button
          aria-pressed={runtime.notesVisible}
          className="runtime-inline-button runtime-notes-toggle"
          onClick={runtime.onToggleNotes}
          type="button"
        >
          {runtime.notesVisible ? "Notes open" : "Open notes"}
        </button>
      </RuntimePlaceholderPanel>
    );
  }

  if (kind === "tutor") {
    return (
      <RuntimePlaceholderPanel
        kicker={tutor.tutor.assistantName || "dee-lou"}
        title="Tutor runtime"
        tags={[tutor.tutor.realtimeModel, tutor.tutor.voice, tutor.realtimeStatus]}
      >
        <p>
          Runtime-only tutor signals can live here later: speaking state,
          current instructions, tool calls, or transcript diagnostics.
        </p>
      </RuntimePlaceholderPanel>
    );
  }

  if (kind === "slides") {
    return (
      <RuntimePlaceholderPanel
        kicker={slides.status === "ready" ? "Slide ready" : "Materials"}
        title="Learning surface"
        tags={["Slides", "Notebook", "Artifacts"]}
      >
        <p>
          This will become a compact readout for whatever the experience is
          controlling in the main panel.
        </p>
      </RuntimePlaceholderPanel>
    );
  }

  if (kind === "checks") {
    return (
      <RuntimePlaceholderPanel
        kicker={experience.user?.displayName || "Learner"}
        title="Signals"
        tags={["Progress", "Checks", "Notes"]}
      >
        <ul className="check-list">
          <li>
            <span>Current event</span>
            <strong>entry</strong>
          </li>
          <li>
            <span>Runtime context</span>
            <strong>pending</strong>
          </li>
          <li>
            <span>Next action</span>
            <strong>observe</strong>
          </li>
        </ul>
      </RuntimePlaceholderPanel>
    );
  }

  return (
    <div className="text-stack">
      <div className="tag-row">
        <span>Objective</span>
        <span>Constraint</span>
      </div>
      <p>
        The student has a partly correct first move. The interface should make
        supporting context easy to scan without competing with the main work area.
      </p>
      <p className="muted-copy">
        Preferred response shape: short question, one target, no full solution yet.
      </p>
    </div>
  );
}

function RuntimePlaceholderPanel({
  children,
  kicker,
  tags,
  title,
}: {
  children: ReactNode;
  kicker: string;
  tags: string[];
  title: string;
}) {
  return (
    <div className="text-stack runtime-placeholder">
      <div className="runtime-placeholder-header">
        <span>{kicker}</span>
        <strong>{title}</strong>
      </div>
      <div className="tag-row">
        {tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

function formatScriptAudioDuration(durationSeconds: number | null) {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return "";
  if (durationSeconds < 60) return `${durationSeconds.toFixed(1)}s`;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.round(durationSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function scriptAudioMetadataText(item: ScriptAudioItem) {
  const pieces = [
    formatScriptAudioDuration(item.durationSeconds),
    item.wordCount ? `${item.wordCount} words` : "",
    item.voice ? item.voice : "",
  ].filter(Boolean);
  return pieces.length ? pieces.join(" / ") : "---";
}

function ScriptAudioPanel({
  error,
  isBusy,
  items,
  onGenerateAll,
  onGenerateOne,
  onPlay,
  onRegenerateAll,
  onRegenerateOne,
  onStop,
  playingId,
  status,
}: {
  error: string;
  isBusy: boolean;
  items: ScriptAudioItem[];
  onGenerateAll: () => void;
  onGenerateOne: (scriptId: string) => void;
  onPlay: (item: ScriptAudioItem) => void;
  onRegenerateAll: () => void;
  onRegenerateOne: (scriptId: string) => void;
  onStop: () => void;
  playingId: string;
  status: "idle" | "loading" | "generating";
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const readyCount = items.filter((item) => item.cached && item.wordsCached).length;
  const audioCount = items.filter((item) => item.cached).length;
  const dynamicCount = items.filter((item) => !item.canGenerate).length;
  const timingCount = items.filter((item) => item.wordsCached).length;
  const statusLabel =
    status === "generating"
      ? "Generating"
      : status === "loading"
        ? "Loading"
        : `${items.length} scripts`;

  return (
    <div className="script-audio-panel">
      <div className="script-audio-header">
        <div>
          <span>Script audio</span>
          <strong>{statusLabel}</strong>
        </div>
        <div className="script-audio-actions">
          <button
            className="header-action"
            disabled={isBusy || !items.some((item) => item.canGenerate)}
            onClick={onGenerateAll}
            title="Generate audio and word timing for scripts that are missing either artifact."
            type="button"
          >
            Generate missing
          </button>
          <button
            className="header-action secondary"
            disabled={isBusy || !items.some((item) => item.canGenerate)}
            onClick={onRegenerateAll}
            title="Regenerate every static script's audio and word timing from the current tutor settings."
            type="button"
          >
            Regenerate
          </button>
          <button
            aria-expanded={isExpanded}
            className="header-action secondary"
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? "Hide scripts" : "Show scripts"}
          </button>
        </div>
      </div>

      <div className="script-audio-summary">
        <span>{readyCount}/{items.length} ready</span>
        <span>{audioCount}/{items.length} audio</span>
        <span title="Word timing drives authored-script subtitle reveal; it is not shown as Whisper's rewritten text.">
          {timingCount}/{items.length} timed subtitles
        </span>
        {dynamicCount ? (
          <span title="Dynamic scripts contain template variables and are skipped by pregeneration for now.">
            {dynamicCount} dynamic
          </span>
        ) : null}
        {playingId ? <span>playing</span> : null}
      </div>

      {isExpanded ? (
        <div className="script-audio-list">
          {items.map((item) => {
            const isPlaying = playingId === item.id;
            const preview = item.preview || "---";
            return (
              <div
                className={[
                  "script-audio-row",
                  isPlaying ? "is-playing" : "",
                  item.canGenerate ? "" : "is-dynamic",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
              >
                <span className="script-audio-source" title={item.source}>
                  {item.source}
                </span>
                <span className="script-audio-preview" title={item.script || preview}>
                  {preview}
                </span>
                <span className="script-audio-meta">
                  {scriptAudioMetadataText(item)}
                </span>
                <span
                  className={`script-audio-pill ${item.cached ? "ready" : ""}`}
                  title={
                    item.cached
                      ? `Audio artifact cached (${item.cacheKey})`
                      : item.canGenerate
                        ? "Audio artifact has not been generated yet."
                        : item.generationReason ||
                          "This script cannot be pregenerated."
                  }
                >
                  {item.cached ? "audio" : item.canGenerate ? "missing" : "dynamic"}
                </span>
                <span
                  className={`script-audio-pill ${item.wordsCached ? "ready" : ""}`}
                  title="Word timing drives authored-script subtitle reveal; it is not shown as Whisper's rewritten text."
                >
                  {item.wordsCached ? "timing" : "no timing"}
                </span>
                <button
                  aria-label={
                    isPlaying ? "Stop script audio preview" : "Play script audio preview"
                  }
                  className="event-icon-button"
                  disabled={!item.audioUrl}
                  onClick={() => (isPlaying ? onStop() : onPlay(item))}
                  title={
                    isPlaying
                      ? "Stop cached audio preview."
                      : "Play cached audio. Press Escape to stop."
                  }
                  type="button"
                >
                  {isPlaying ? <StopIcon /> : <PlayIcon />}
                </button>
                <button
                  aria-label={
                    item.cached
                      ? "Regenerate script audio and timing"
                      : "Generate script audio and timing"
                  }
                  className="event-icon-button"
                  disabled={isBusy || !item.canGenerate}
                  onClick={() =>
                    item.cached ? onRegenerateOne(item.id) : onGenerateOne(item.id)
                  }
                  title={
                    item.cached
                      ? "Regenerate this script's audio and timing"
                      : item.canGenerate
                        ? "Generate this script's audio and timing"
                        : item.generationReason ||
                          "Dynamic scripts cannot be pregenerated yet."
                  }
                  type="button"
                >
                  <RefreshIcon />
                </button>
              </div>
            );
          })}
          {!items.length ? <div className="script-audio-empty">---</div> : null}
        </div>
      ) : null}
      {error ? <p className="control-error">{error}</p> : null}
    </div>
  );
}

function EventGraphView({
  events,
  onSelectEvent,
  selectedEventId,
}: {
  events: ExperienceEvent[];
  onSelectEvent: (eventId: string) => void;
  selectedEventId: string;
}) {
  const sortedEvents = sortedExperienceEvents(events);
  const indexBySlug = new Map<string, number>();
  sortedEvents.forEach((event, index) => {
    indexBySlug.set(event.slug, index);
    indexBySlug.set(event.id, index);
  });
  const statsByEventId = new Map(
    sortedEvents.map((event) => [event.id, eventTransitionStats(events, event)]),
  );
  const orphanCount = sortedEvents.filter(
    (event) => statsByEventId.get(event.id)?.isUnlinked,
  ).length;
  const unresolvedRouteCount = sortedEvents.reduce(
    (total, event) => total + (statsByEventId.get(event.id)?.unresolvedCount ?? 0),
    0,
  );
  const routeCount = sortedEvents.reduce(
    (total, event) => total + (statsByEventId.get(event.id)?.outgoingCount ?? 0),
    0,
  );
  const conditionalRouteCount = sortedEvents.reduce(
    (total, event) =>
      total + eventOutgoingLinks(event).filter((link) => link.condition).length,
    0,
  );
  const selectedEvent =
    sortedEvents.find((event) => event.id === selectedEventId) ?? sortedEvents[0];
  const rowHeight = 44;
  const height = Math.max(74, sortedEvents.length * rowHeight + 28);
  const links = sortedEvents.flatMap((event, sourceIndex) =>
    eventOutgoingSlugs(event)
      .map((slug) => ({
        slug,
        sourceIndex,
        targetIndex: indexBySlug.get(slug) ?? -1,
      }))
      .filter((link) => link.targetIndex >= 0),
  );
  const selectedOutgoingLinks = selectedEvent
    ? eventOutgoingLinks(selectedEvent)
    : [];
  const incomingLinks = selectedEvent
    ? sortedEvents.flatMap((event) =>
        eventOutgoingLinks(event)
          .filter(
            (link) =>
              link.slug === selectedEvent.slug || link.slug === selectedEvent.id,
          )
          .map((link) => ({
            ...link,
            sourceEventId: event.id,
            sourceEvent: event.title || event.slug,
          })),
      )
    : [];
  const unresolvedLinks = selectedOutgoingLinks.filter(
    (link) =>
      !sortedEvents.some(
        (event) => event.slug === link.slug || event.id === link.slug,
      ),
  );

  return (
    <div className="event-graph-view" aria-label="Event graph">
      <svg
        aria-hidden="true"
        className="event-graph-lines"
        viewBox={`0 0 260 ${height}`}
      >
        {links.map((link, index) => {
          const startY = 24 + link.sourceIndex * rowHeight;
          const endY = 24 + link.targetIndex * rowHeight;
          const midX = link.sourceIndex < link.targetIndex ? 206 : 224;
          return (
            <path
              d={`M 102 ${startY} C ${midX} ${startY}, ${midX} ${endY}, 138 ${endY}`}
              key={`${link.sourceIndex}-${link.targetIndex}-${link.slug}-${index}`}
            />
          );
        })}
      </svg>
      <div className="event-graph-summary">
        <span>{sortedEvents.length} events</span>
        <span>{routeCount} routes</span>
        <span>{conditionalRouteCount} conditional</span>
        {orphanCount ? <strong>{orphanCount} orphaned</strong> : <span>0 orphaned</span>}
        {unresolvedRouteCount ? (
          <strong>{unresolvedRouteCount} unresolved</strong>
        ) : (
          <span>0 unresolved</span>
        )}
      </div>
      <div className="event-graph-nodes">
        {sortedEvents.map((event) => {
          const stats =
            statsByEventId.get(event.id) ?? eventTransitionStats(events, event);
          return (
            <button
              className={[
                "event-graph-node",
                event.id === selectedEventId ? "is-selected" : "",
                stats.isUnlinked ? "is-unlinked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={event.id}
              onClick={() => onSelectEvent(event.id)}
              type="button"
            >
              <span>{event.title || event.slug}</span>
              <small>
                {event.isStart ? "start" : `${stats.incomingCount} in`} /{" "}
                {stats.outgoingCount} out
                {stats.unresolvedCount ? ` / ${stats.unresolvedCount} unresolved` : ""}
              </small>
            </button>
          );
        })}
      </div>
      {selectedEvent ? (
        <div className="event-graph-details">
          <div className="event-graph-details-header">
            <strong>{selectedEvent.title || selectedEvent.slug}</strong>
            <span>
              {incomingLinks.length} in / {selectedOutgoingLinks.length} out
            </span>
          </div>
          <EventGraphLinkList
            empty="No outgoing routes"
            events={sortedEvents}
            links={selectedOutgoingLinks}
            onSelectEvent={onSelectEvent}
            title="Outgoing"
          />
          <EventGraphIncomingList
            empty={selectedEvent.isStart ? "Start event" : "No incoming routes"}
            links={incomingLinks}
            onSelectEvent={onSelectEvent}
            title="Incoming"
          />
          {unresolvedLinks.length ? (
            <EventGraphLinkList
              empty=""
              events={sortedEvents}
              links={unresolvedLinks}
              onSelectEvent={onSelectEvent}
              title="Unresolved"
              unresolved
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EventGraphLinkList({
  empty,
  events,
  links,
  onSelectEvent,
  title,
  unresolved = false,
}: {
  empty: string;
  events: ExperienceEvent[];
  links: EventOutgoingLink[];
  onSelectEvent: (eventId: string) => void;
  title: string;
  unresolved?: boolean;
}) {
  return (
    <div className="event-graph-link-group">
      <span>{title}</span>
      {links.length ? (
        links.map((link, index) => {
          const target = events.find(
            (event) => event.slug === link.slug || event.id === link.slug,
          );
          const className = [
            "event-graph-link-row",
            unresolved || !target ? "is-unresolved" : "",
            target ? "is-clickable" : "",
          ]
            .filter(Boolean)
            .join(" ");

          if (!target) {
            return (
              <div className={className} key={`${link.slug}-${link.source}-${index}`}>
                <strong>{link.slug || "Missing event"}</strong>
                <small>
                  {link.kind} / {link.source}
                  {link.condition ? ` / if ${link.condition}` : ""}
                </small>
              </div>
            );
          }

          return (
            <button
              className={className}
              key={`${link.slug}-${link.source}-${index}`}
              onClick={() => onSelectEvent(target.id)}
              type="button"
            >
              <strong>{target.title || target.slug}</strong>
              <small>
                {link.kind} / {link.source}
                {link.condition ? ` / if ${link.condition}` : ""}
              </small>
            </button>
          );
        })
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

function EventGraphIncomingList({
  empty,
  links,
  onSelectEvent,
  title,
}: {
  empty: string;
  links: Array<EventOutgoingLink & { sourceEvent: string; sourceEventId: string }>;
  onSelectEvent: (eventId: string) => void;
  title: string;
}) {
  return (
    <div className="event-graph-link-group">
      <span>{title}</span>
      {links.length ? (
        links.map((link, index) => (
          <button
            className="event-graph-link-row is-clickable"
            key={`${link.sourceEvent}-${link.slug}-${link.source}-${index}`}
            onClick={() => onSelectEvent(link.sourceEventId)}
            type="button"
          >
            <strong>{link.sourceEvent}</strong>
            <small>
              {link.kind} / {link.source}
              {link.condition ? ` / if ${link.condition}` : ""}
            </small>
          </button>
        ))
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

function ExperienceControls({
  chatStatus,
  error,
  experienceForm,
  experiences,
  isCreatingExperience,
  isCreatingSession,
  isSavingExperience,
  isSigningOut,
  onCreateExperience,
  onCreateNewSession,
  onExperienceFormChange,
  onSaveExperience,
  onSelectExperience,
  onSignOut,
  selectedExperienceId,
  user,
}: ExperienceControlsProps) {
  const isLoading = chatStatus === "loading";
  const statusLabel =
    chatStatus === "loading"
      ? "Loading"
      : chatStatus === "error"
        ? "Error"
        : "Ready";

  return (
    <form
      className="experience-controls"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSavingExperience) onSaveExperience();
      }}
    >
      <div className="runtime-control-header">
        <span>Experience</span>
        <strong className={`slide-status ${chatStatus}`}>
          {statusLabel}
        </strong>
      </div>

      <label className="control-field">
        <span>Choose</span>
        <select
          disabled={isLoading || experiences.length === 0}
          onChange={(event) => onSelectExperience(event.target.value)}
          value={selectedExperienceId}
        >
          {experiences.map((experience) => (
            <option key={experience.id} value={experience.id}>
              {experience.title}
            </option>
          ))}
        </select>
      </label>

      <label className="control-field">
        <span>Name</span>
        <input
          disabled={isLoading}
          onChange={(event) =>
            onExperienceFormChange((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          placeholder="Experience name"
          type="text"
          value={experienceForm.title}
        />
      </label>

      <label className="control-field">
        <span>Description</span>
        <textarea
          className="experience-description"
          disabled={isLoading}
          onChange={(event) =>
            onExperienceFormChange((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          placeholder="What this experience is for..."
          value={experienceForm.description}
        />
      </label>

      <div className="control-actions">
        <button
          className="header-action"
          disabled={isLoading || isSavingExperience || !experienceForm.title.trim()}
          type="submit"
        >
          {isSavingExperience ? "Saving..." : "Save"}
        </button>
        <button
          className="header-action secondary"
          disabled={isCreatingExperience}
          onClick={onCreateExperience}
          type="button"
        >
          {isCreatingExperience ? "Creating..." : "New"}
        </button>
      </div>

      <div className="control-actions">
        <button
          className="header-action secondary"
          disabled={isLoading || isCreatingSession}
          onClick={onCreateNewSession}
          type="button"
        >
          {isCreatingSession ? "Creating..." : "New chat"}
        </button>
        <button
          className="header-action secondary"
          disabled={isSigningOut}
          onClick={onSignOut}
          type="button"
        >
          Sign out
        </button>
      </div>

      {user ? <p className="control-user">{user.displayName}</p> : null}
      {error ? <p className="control-error">{error}</p> : null}
    </form>
  );
}

function TutorControls({
  avatarUrl,
  error,
  isSaving,
  onAvatarPathChange,
  onClassificationModelChange,
  onModelChange,
  onNameChange,
  onPlaySample,
  onSave,
  onScriptActionOffsetChange,
  onVoiceChange,
  onVoiceInstructionsChange,
  realtimeStatus,
  sampleStatus = "idle",
  showSaveAction = true,
  tutor,
}: TutorControlsProps) {
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const avatarChoices = tutorAvatarOptions.some(
    (option) => option.path === tutor.avatarPath,
  )
    ? tutorAvatarOptions
    : [{ label: "Current image", path: tutor.avatarPath }, ...tutorAvatarOptions];
  const classificationChoices = classificationModelOptions.some(
    (option) => option.id === tutor.classificationModel,
  )
    ? classificationModelOptions
    : [
        {
          id: tutor.classificationModel,
          label: tutor.classificationModel,
        },
        ...classificationModelOptions,
      ];
  const voiceOptions = realtimeVoiceOptionsForModel(tutor.realtimeModel);
  const sampleActionLabel =
    sampleStatus === "playing"
      ? "Stop voice sample"
      : sampleStatus === "loading"
        ? "Loading voice sample"
        : "Play voice sample";
  const actionOffsetHelp =
    "Shifts every timed action inside scripted speech. Negative values fire actions earlier; positive values fire them later.";
  const closeAvatarPickerOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (!nextFocus || !event.currentTarget.contains(nextFocus)) {
      setIsAvatarPickerOpen(false);
    }
  };

  return (
    <form
      className="tutor-controls"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isSaving) onSave();
      }}
    >
      <div className="tutor-compact-grid">
        <div
          className="tutor-avatar-row"
          onBlur={closeAvatarPickerOnBlur}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsAvatarPickerOpen(false);
            }
          }}
        >
          <button
            aria-expanded={isAvatarPickerOpen}
            aria-label="Change tutor image"
            className="tutor-avatar-button"
            onClick={() => setIsAvatarPickerOpen((isOpen) => !isOpen)}
            title="Change tutor image"
            type="button"
          >
            <img alt="" className="tutor-avatar-preview" src={avatarUrl} />
          </button>

          {isAvatarPickerOpen ? (
            <div aria-label="Tutor image choices" className="tutor-avatar-popover">
              {avatarChoices.map((option) => {
                const isSelected = option.path === tutor.avatarPath;

                return (
                  <button
                    aria-label={`Use ${option.label}`}
                    aria-pressed={isSelected}
                    className={`tutor-avatar-option${isSelected ? " selected" : ""}`}
                    key={option.path}
                    onClick={() => {
                      onAvatarPathChange(option.path);
                      setIsAvatarPickerOpen(false);
                    }}
                    title={option.label}
                    type="button"
                  >
                    <img alt="" src={publicAsset(option.path)} />
                  </button>
                );
              })}
            </div>
          ) : null}

          {onPlaySample ? (
            <button
              aria-label={sampleActionLabel}
              className="header-action secondary tutor-sample-button"
              disabled={sampleStatus === "loading"}
              onClick={() => void onPlaySample()}
              title={sampleActionLabel}
              type="button"
            >
              <PlayIcon />
            </button>
          ) : null}
        </div>

        <label className="control-field">
          <span>Name</span>
          <input
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="dee-lou"
            type="text"
            value={tutor.assistantName}
          />
        </label>

        <label className="control-field">
          <span>Chat model</span>
          <select
            onChange={(event) =>
              onModelChange(event.target.value as RealtimeModelId)
            }
            value={tutor.realtimeModel}
          >
            {realtimeModelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field">
          <span>Voice</span>
          <select
            onChange={(event) =>
              onVoiceChange(event.target.value as RealtimeVoiceId)
            }
            value={tutor.voice}
          >
            {voiceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="tutor-prompt-grid">
          <label className="control-field">
            <span>Voice and personality</span>
            <textarea
              className="prompt-textarea compact"
              onChange={(event) => onVoiceInstructionsChange(event.target.value)}
              placeholder="How the agent should sound..."
              rows={1}
              value={tutor.voiceInstructions}
            />
          </label>
        </div>

        <label className="control-field">
          <span>Classification model</span>
          <select
            onChange={(event) =>
              onClassificationModelChange(
                event.target.value as ClassificationModelId,
              )
            }
            value={tutor.classificationModel}
          >
            {classificationChoices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="control-field offset-field" title={actionOffsetHelp}>
          <span title={actionOffsetHelp}>Action offset</span>
          <input
            aria-label="Script action timing offset in milliseconds"
            max={3000}
            min={-3000}
            onChange={(event) => {
              const nextOffset = Number.parseInt(event.target.value, 10);
              onScriptActionOffsetChange(
                Number.isFinite(nextOffset) ? nextOffset : 0,
              );
            }}
            step={10}
            title={actionOffsetHelp}
            type="number"
            value={tutor.scriptActionOffsetMs}
          />
        </label>
      </div>

      {showSaveAction ? (
        <div className="control-actions single-action">
          <button className="header-action" disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : "Save tutor"}
          </button>
        </div>
      ) : null}

      {error ? <p className="control-error">{error}</p> : null}
    </form>
  );
}

function SlideControls({
  deckUrl,
  error,
  onClear,
  onDeckUrlChange,
  onRefreshSlide,
  onResolveSlide,
  onSampleDeck,
  onSlideRefChange,
  resolvedSlide,
  slideRef,
  status,
}: SlideControlsProps) {
  const canLoad = Boolean(deckUrl.trim()) && status !== "loading";
  const statusLabel =
    status === "loading"
      ? "Loading"
      : status === "error"
        ? "Error"
        : resolvedSlide
          ? "Ready"
          : "Empty";

  return (
    <form
      className="slide-controls"
      onSubmit={(event) => {
        event.preventDefault();
        if (canLoad) onResolveSlide();
      }}
    >
      <div className="runtime-control-header">
        <span>Slides</span>
        <strong className={`slide-status ${status}`}>
          {statusLabel}
        </strong>
      </div>

      <label className="control-field">
        <span>Deck URL</span>
        <input
          onChange={(event) => onDeckUrlChange(event.target.value)}
          placeholder="Paste Google Slides URL..."
          type="url"
          value={deckUrl}
        />
      </label>

      <label className="control-field">
        <span>Slide</span>
        <input
          inputMode="text"
          onChange={(event) => onSlideRefChange(event.target.value)}
          placeholder="1 or page id"
          type="text"
          value={slideRef}
        />
      </label>

      <div className="control-actions slide-actions">
        <button className="header-action" disabled={!canLoad} type="submit">
          {status === "loading" ? "Loading..." : "Load"}
        </button>
        <button
          className="header-action secondary"
          disabled={!canLoad}
          onClick={onRefreshSlide}
          type="button"
        >
          Refresh
        </button>
      </div>

      <div className="control-actions slide-actions">
        <button className="header-action secondary" onClick={onSampleDeck} type="button">
          Sample
        </button>
        <button
          className="header-action secondary"
          disabled={!deckUrl && slideRef === "1" && !resolvedSlide}
          onClick={onClear}
          type="button"
        >
          Clear
        </button>
      </div>

      {resolvedSlide ? (
        <p className="slide-control-note">
          Slide {resolvedSlide.slideRef} / {resolvedSlide.pageId}
        </p>
      ) : null}
      {error ? <p className="control-error">{error}</p> : null}
    </form>
  );
}

function MainPanelAppFields({
  appId,
  appConfig,
  onConfigChange,
  onConfigPatch,
  view,
}: {
  appConfig: Record<string, unknown>;
  appId: string;
  onConfigChange: (key: string, value: unknown) => void;
  onConfigPatch?: (patch: Record<string, unknown>) => void;
  view: string;
}) {
  const appDefinition =
    getMainPanelAppDefinition(appId) ?? defaultMainPanelApp;
  const hasCurrentApp = mainPanelAppDefinitions.some((app) => app.id === appId);
  const currentView = view || appDefinition.defaultView;
  const hasCurrentView = appDefinition.views.some(
    (candidate) => candidate.id === currentView,
  );
  const configFields = appDefinition.configFields ?? [];

  function changeAppConfigField(
    field: MainPanelAppConfigField,
    rawValue: string,
  ) {
    const nextValue =
      field.type === "number" && rawValue.trim()
        ? Number(rawValue)
        : rawValue;
    onConfigChange("config", {
      ...appConfig,
      [field.id]: Number.isNaN(nextValue) ? rawValue : nextValue,
    });
  }

  return (
    <>
      <span className="event-detail-label">APP</span>
      <select
        aria-label="Main-panel app"
        onChange={(event) => {
          const nextApp = getMainPanelAppDefinition(event.target.value);
          if (nextApp && onConfigPatch) {
            onConfigPatch({
              config: cloneMainPanelAppConfig(nextApp),
              interactiveId: nextApp.id,
              mode: nextApp.defaultView,
            });
            return;
          }
          onConfigChange("interactiveId", nextApp?.id ?? event.target.value);
          if (nextApp) {
            onConfigChange("config", cloneMainPanelAppConfig(nextApp));
            if (!nextApp.views.some((item) => item.id === currentView)) {
              onConfigChange("mode", nextApp.defaultView);
            }
          }
        }}
        value={hasCurrentApp ? appId : ""}
      >
        {!hasCurrentApp ? (
          <option value="">{appId || "Choose app"}</option>
        ) : null}
        {mainPanelAppDefinitions.map((app) => (
          <option key={app.id} value={app.id}>
            {app.label}
          </option>
        ))}
      </select>
      <span className="event-detail-label">VIEW</span>
      <select
        aria-label="Main-panel app view"
        onChange={(event) => onConfigChange("mode", event.target.value)}
        value={hasCurrentView ? currentView : ""}
      >
        {!hasCurrentView && currentView ? (
          <option value="">{currentView}</option>
        ) : null}
        {appDefinition.views.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {configFields.map((field) => {
        const fallback = field.defaultValue ?? "";
        const rawValue = appConfig[field.id];
        const value =
          typeof rawValue === "number" || typeof rawValue === "string"
            ? String(rawValue)
            : String(fallback);

        return (
          <Fragment key={field.id}>
            <span className="event-detail-label">{field.label}</span>
            <input
              aria-label={`${appDefinition.label} ${field.label.toLowerCase()}`}
              inputMode={field.inputMode}
              onChange={(event) =>
                changeAppConfigField(field, event.target.value)
              }
              placeholder={field.placeholder}
              type={field.type ?? "text"}
              value={value}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function MainPanelContent({
  context,
  emitInteractiveActions,
  error,
  interactive,
  interactiveState,
  onInteractiveComplete,
  onInteractiveEvent,
  onInteractiveSaveContext,
  onInteractiveStateChange,
  slide,
  status,
}: {
  context: Record<string, unknown>;
  emitInteractiveActions: (actions: Array<Record<string, unknown>>) => void;
  error: string;
  interactive: RuntimeInteractive | null;
  interactiveState: Record<string, unknown>;
  onInteractiveComplete: (
    state?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => void;
  onInteractiveEvent: (eventSlug: string, state?: Record<string, unknown>) => void;
  onInteractiveSaveContext: (
    values: Record<string, unknown>,
    state?: Record<string, unknown>,
  ) => Promise<void>;
  onInteractiveStateChange: (state: Record<string, unknown>) => void;
  slide: ResolvedSlide | null;
  status: SlideStatus;
}) {
  if (interactive) {
    return (
      <InteractiveWorkspace
        context={context}
        emitActions={emitInteractiveActions}
        interactive={interactive}
        onComplete={onInteractiveComplete}
        onRunEvent={onInteractiveEvent}
        onSaveContext={onInteractiveSaveContext}
        onStateChange={onInteractiveStateChange}
        state={interactiveState}
      />
    );
  }

  if (slide) {
    return (
      <div className="slide-workspace">
        <div className="slide-image-stage">
          <img
            alt={`Google slide ${slide.slideRef}`}
            className="google-slide-image"
            src={slide.imageUrl}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="slide-workspace empty error">
        <div className="slide-empty-state">
          <span>Slide unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label={status === "loading" ? "Loading slide" : "Empty slide panel"}
      className="slide-workspace empty"
    />
  );
}

function InteractiveWorkspace({
  context,
  emitActions,
  interactive,
  onComplete,
  onRunEvent,
  onSaveContext,
  onStateChange,
  state,
}: {
  context: Record<string, unknown>;
  emitActions: (
    actions: Array<Record<string, unknown>>,
    state?: Record<string, unknown>,
  ) => void;
  interactive: RuntimeInteractive;
  onComplete: (
    state?: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) => void;
  onRunEvent: (eventSlug: string, state?: Record<string, unknown>) => void;
  onSaveContext: (
    values: Record<string, unknown>,
    state?: Record<string, unknown>,
  ) => Promise<void>;
  onStateChange: (state: Record<string, unknown>) => void;
  state: Record<string, unknown>;
}) {
  const appDefinition = getMainPanelAppDefinition(interactive.interactiveId);
  const host: MainPanelAppHost = {
    context,
    emitActions,
    runEvent: onRunEvent,
    saveContext: (values) => onSaveContext(values, state),
    setState: onStateChange,
    submit: onComplete,
  };

  if (appDefinition) {
    const AppComponent = appDefinition.Component;
    return (
      <AppComponent
        host={host}
        interactive={interactive}
        state={state}
      />
    );
  }

  return (
    <div className="interactive-workspace">
      <div className="interactive-shell unavailable-interactive">
        <div className="interactive-header">
          <span>{interactive.interactiveId || "app"}</span>
          <strong>App unavailable</strong>
        </div>
        <p>This main-panel app is not registered in the app code.</p>
      </div>
    </div>
  );
}

type ChatPanelContentProps = {
  assistantName: string;
  avatarPath: string;
  error: string;
  isChatEnabled: boolean;
  isSending: boolean;
  isTurnLocked: boolean;
  messages: ChatMessage[];
  onChooseRuntimeButton: (button: RuntimeButton) => void;
  onSendMessage: (content: string) => Promise<void>;
  realtimeStatus: RealtimeStatus;
  runtimeButtons: RuntimeButton[];
  session: TutoringSession | null;
  status: "loading" | "ready" | "error";
  turnAnchorMessageId: string | null;
  user: ApiUser | null;
};

function ChatPanelContent({
  assistantName,
  avatarPath,
  error,
  isChatEnabled,
  isSending,
  isTurnLocked,
  messages,
  onChooseRuntimeButton,
  onSendMessage,
  realtimeStatus,
  runtimeButtons,
  session,
  status,
  turnAnchorMessageId,
  user,
}: ChatPanelContentProps) {
  const [draft, setDraft] = useState("");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const assistantDisplayName = assistantName.trim() || "dee-lou";
  const assistantAvatarPath = avatarPath.trim() || "test-images/dLU-right.png";

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;

    const animationFrame = window.requestAnimationFrame(() => {
      if (turnAnchorMessageId) {
        const target = messageRefs.current.get(turnAnchorMessageId);
        if (target) {
          messageList.scrollTo({
            behavior: "smooth",
            top: Math.max(0, target.offsetTop - 2),
          });
        }
        return;
      }

      messageList.scrollTo({
        top: messageList.scrollHeight,
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [messages.length, turnAnchorMessageId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextMessage = draft.trim();
    if (
      !nextMessage ||
      !session ||
      isSending ||
      isTurnLocked ||
      !isChatEnabled ||
      status === "loading"
    ) {
      return;
    }

    setDraft("");

    try {
      await onSendMessage(nextMessage);
    } catch {
      // Keep the draft available when saving fails.
      setDraft(nextMessage);
    }
  }

  const isInputDisabled =
    !session || status === "loading" || isTurnLocked || !isChatEnabled;
  const isSendDisabled = isInputDisabled || !draft.trim();
  const inputPlaceholder = !isChatEnabled
    ? "Chat is paused"
    : isTurnLocked
      ? `${assistantDisplayName} is responding...`
      : `Message ${assistantDisplayName}...`;
  const sendButtonLabel =
    !isChatEnabled
      ? "Chat paused"
      : realtimeStatus === "streaming" || isSending || isTurnLocked
      ? "dLU is responding"
      : "Send message";

  return (
    <div className="chat-stage">
      <div className="chat-thread">
        <div
          className={`chat-message-list ${turnAnchorMessageId ? "turn-anchored" : ""}`}
          aria-live="polite"
          ref={messageListRef}
        >
          {status === "loading" ? (
            <div className="chat-status">Loading session...</div>
          ) : null}
          {status === "error" ? (
            <div className="chat-status error">{error}</div>
          ) : null}
          {messages.map((message) => {
            if (message.metadata?.scriptHidden) return null;

            const tone = message.role === "user" ? "student" : "tutor";
            const author =
              message.role === "user"
                ? user?.displayName || "You"
                : message.role === "assistant"
                  ? assistantDisplayName
                  : "System";
            const body =
              message.content ||
              (message.metadata?.streaming ? "..." : "");

            return (
              <div
                className={`chat-message ${tone}`}
                key={message.id}
                ref={(element) => {
                  if (element) {
                    messageRefs.current.set(message.id, element);
                  } else {
                    messageRefs.current.delete(message.id);
                  }
                }}
              >
                <span>{author}</span>
                <p>{body}</p>
              </div>
            );
          })}
        </div>

        {runtimeButtons.length ? (
          <div className="runtime-choice-row" aria-label="Runtime choices">
            {runtimeButtons.map((button) => (
              <button
                className="runtime-choice-button"
                key={button.stepId || `${button.label}-${button.triggersEvent}`}
                onClick={() => onChooseRuntimeButton(button)}
                type="button"
              >
                {button.label}
              </button>
            ))}
          </div>
        ) : null}

        <form className="composer-row" onSubmit={sendMessage}>
          <input
            aria-label={`Message ${assistantDisplayName}`}
            disabled={isInputDisabled}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={inputPlaceholder}
            type="text"
            value={draft}
          />
          <button
            aria-label={sendButtonLabel}
            disabled={isSendDisabled}
            title={sendButtonLabel}
            type="submit"
          >
            <SendIcon />
          </button>
        </form>
      </div>

      <img
        alt={assistantDisplayName}
        className="chat-dlu-figure"
        src={publicAsset(assistantAvatarPath)}
      />
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d="M21 3 10.6 13.4M21 3l-6.7 18-3.7-7.6L3 9.7 21 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function InspectorIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      viewBox="0 0 24 24"
      width="15"
    >
      <path
        d="M4 6h16M4 12h10M4 18h16M18 10v4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="13"
      viewBox="0 0 24 24"
      width="13"
    >
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="12"
      viewBox="0 0 24 24"
      width="12"
    >
      <path d="M7 7h10v10H7V7Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path
        d="M20 12a8 8 0 0 1-13.7 5.7M4 12a8 8 0 0 1 13.7-5.7M18 3v4h-4M6 21v-4h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path
        d="M9 7 4 12l5 5M5 12h9a5 5 0 0 1 0 10h-1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path
        d="m15 7 5 5-5 5M19 12h-9a5 5 0 0 0 0 10h1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M9 6.5A1.5 1.5 0 1 1 6 6.5 1.5 1.5 0 0 1 9 6.5Zm9 0A1.5 1.5 0 1 1 15 6.5a1.5 1.5 0 0 1 3 0ZM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 17.5A1.5 1.5 0 1 1 6 17.5a1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      viewBox="0 0 24 24"
      width="15"
    >
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function getPythonTokenKind(token: string, source: string, index: number) {
  if (token.startsWith("#")) return "comment";
  if (token.startsWith('"') || token.startsWith("'")) return "string";
  if (/^\d/.test(token)) return "number";
  if (pythonKeywords.has(token)) return "keyword";
  if (pythonBuiltins.has(token)) return "builtin";
  if (/^[A-Za-z_]\w*$/.test(token) && source[index + token.length] === "(") {
    return "function";
  }
  return "operator";
}

function highlightPython(code: string) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of code.matchAll(pythonTokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > cursor) {
      nodes.push(code.slice(cursor, index));
    }

    nodes.push(
      <span
        className={`syntax-token syntax-${getPythonTokenKind(token, code, index)}`}
        key={tokenIndex}
      >
        {token}
      </span>,
    );
    cursor = index + token.length;
    tokenIndex += 1;
  }

  if (cursor < code.length) {
    nodes.push(code.slice(cursor));
  }

  return nodes;
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="code-block" data-language="python">
      <code>{highlightPython(code)}</code>
    </pre>
  );
}

export default App;
