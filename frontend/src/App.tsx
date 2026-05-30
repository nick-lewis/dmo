import {
  type CSSProperties,
  type DragEvent,
  type Dispatch,
  type FocusEvent,
  type FormEvent,
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
  realtimeModelOptions,
  realtimeVoiceOptions,
} from "./realtime";

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
const sampleSlideDeckUrl =
  "https://docs.google.com/presentation/d/1laLiG097c6sTnRqTEMYSclNNgGPRqkvTVM_6BSUuj3k/";
const tutorAvatarOptions = [
  { label: "dLU right", path: "test-images/dLU-right.png" },
  { label: "dLU left", path: "test-images/dLU-left.png" },
] as const;
const eventActionOptions = [
  { id: "script", label: "Say" },
  { id: "set_context", label: "Set context" },
  { id: "get_ui_state", label: "Read UI" },
  { id: "highlight_on", label: "Highlight" },
  { id: "highlight_off", label: "Clear highlight" },
  { id: "set_ui_trigger", label: "UI trigger" },
  { id: "goto_event", label: "Go to event" },
  { id: "button_choice", label: "Button choice" },
] as const;
const chatExitCaptureSaveMapKey = "x-dluCaptureSaves";
const chatExitDisplayTitleKey = "x-dluDisplayTitle";
const scriptAudioSources = new Set([
  "event-action",
  "conversation-tool-action",
  "conversation-check-action",
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
  realtimeModel: RealtimeModelId;
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
    | "get_ui_state"
    | "highlight_on"
    | "highlight_off"
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

type ExperienceEvent = {
  id: string;
  experienceId: string;
  title: string;
  slug: string;
  description: string;
  isStart: boolean;
  sortOrder: number;
  steps: EventActionStep[];
  chatTools: EventChatTool[];
  conversationChecks: EventConversationCheck[];
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
  type: "always" | "context_equals";
  key: string;
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

type EventDraft = {
  title: string;
  description: string;
  steps: EventStepDraft[];
  chatTools: EventChatToolDraft[];
  conversationChecks: EventConversationCheckDraft[];
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
  handled: boolean;
  ran: boolean;
  ranEvents?: ExperienceEvent[];
  ranMessages?: ChatMessage[];
};

type RuntimeUiState = {
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
  messageId: string;
  realtimeModel: RealtimeModelId;
  ttsModel: string;
  voice: RealtimeVoiceId;
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

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((left, right) => left.sequence - right.sequence);
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

function stringConfigValue(
  config: Record<string, unknown>,
  key: string,
  fallback = "",
) {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
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

  return {
    key: "",
    type: "always",
    value: "",
  };
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

function eventDraftFromEvent(event: ExperienceEvent | null): EventDraft {
  return {
    chatTools: event
      ? sortedEventChatTools(event.chatTools).map(chatToolDraftFromTool)
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
  if (actionType === "set_context") {
    return { key: "entry_ready", value: "yes" };
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
    actionType !== "button_choice"
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
  if (actionType === "get_ui_state") return "Read UI state";
  if (actionType === "highlight_on") return "Highlight UI";
  if (actionType === "highlight_off") return "Clear highlight";
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
  if (actionType === "get_ui_state") {
    return "Copy current interface state into context";
  }
  if (actionType === "highlight_on") {
    return "Visually mark an interface target";
  }
  if (actionType === "highlight_off") {
    return "Remove a highlight from an interface target";
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
  if (actionType === "set_context" || actionType === "get_ui_state") {
    return "state";
  }
  if (
    actionType === "set_ui_trigger" ||
    actionType === "goto_event" ||
    actionType === "button_choice"
  ) {
    return "flow";
  }
  if (actionType === "highlight_on" || actionType === "highlight_off") return "ui";
  return "speech";
}

function eventTitleForTrigger(events: ExperienceEvent[], eventSlug: string) {
  const target = events.find(
    (event) => event.slug === eventSlug || event.id === eventSlug,
  );
  return target?.title ?? eventSlug;
}

function actionSequenceOutgoingSlugs(steps: ActionSequenceStep[] = []) {
  const slugs = new Set<string>();
  for (const step of steps) {
    if (
      step.actionType !== "set_ui_trigger" &&
      step.actionType !== "goto_event" &&
      step.actionType !== "button_choice"
    ) {
      continue;
    }
    const triggersEvent = stringConfigValue(step.config, "triggersEvent").trim();
    if (triggersEvent) slugs.add(triggersEvent);
  }
  return [...slugs];
}

function eventOutgoingSlugs(event: ExperienceEvent) {
  const slugs = new Set<string>();
  for (const step of event.steps) {
    if (
      step.actionType !== "set_ui_trigger" &&
      step.actionType !== "goto_event" &&
      step.actionType !== "button_choice"
    ) {
      continue;
    }
    const triggersEvent = stringConfigValue(step.config, "triggersEvent").trim();
    if (triggersEvent) slugs.add(triggersEvent);
  }
  for (const tool of event.chatTools) {
    const triggersEvent = tool.triggersEvent.trim();
    if (triggersEvent) slugs.add(triggersEvent);
    for (const handlerSlug of actionSequenceOutgoingSlugs(tool.handlerActions)) {
      slugs.add(handlerSlug);
    }
  }
  for (const check of event.conversationChecks ?? []) {
    const triggersEvent = check.triggersEvent.trim();
    if (triggersEvent) slugs.add(triggersEvent);
    for (const handlerSlug of actionSequenceOutgoingSlugs(check.handlerActions)) {
      slugs.add(handlerSlug);
    }
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

function runtimeActionText(action: Record<string, unknown>) {
  const type = typeof action.type === "string" ? action.type : "action";
  if (type === "conversation_check_result") {
    const result = action.result ? "matched" : "missed";
    const reason = compactRuntimeValue(action.reason, "");
    return reason ? `${result}: ${reason}` : result;
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
  if (type === "get_ui_state") {
    return `${compactRuntimeValue(action.stateKey, "ui")} -> ${compactRuntimeValue(
      action.contextKey,
      "context",
    )}`;
  }
  if (type === "chat_message") {
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
  if (type === "transition_missing") {
    return `missing ${compactRuntimeValue(action.triggersEvent, "event")}`;
  }
  if (type === "event_skipped") {
    return compactRuntimeValue(action.reason, "skipped");
  }

  return compactRuntimeValue(action, type);
}

function eventStepSummary(step: EventStepDraft, events: ExperienceEvent[]) {
  if (step.actionType === "set_context") {
    const key = stringConfigValue(step.config, "key", "key");
    const value = stringConfigValue(step.config, "value", "value");
    return `${key || "key"} = ${value || "value"}`;
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
    stringConfigValue(step.config, "text"),
    "Write what the agent says",
  );
}

function eventConditionSummary(condition: StepConditionDraft) {
  if (condition.type !== "context_equals") return "";

  const key = condition.key.trim() || "context";
  const value = condition.value.trim() || "value";
  return `${key} == ${value}`;
}

function normalizedStepCondition(condition: StepConditionDraft) {
  if (condition.type !== "context_equals") return {};

  return {
    key: condition.key,
    type: "context_equals",
    value: condition.value,
  };
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

      return {
        ...event,
        steps: event.steps
          .map((step) => (step.id === nextStep.id ? nextStep : step))
          .sort((left, right) => left.sortOrder - right.sortOrder),
      };
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

      return {
        ...event,
        chatTools: event.chatTools
          .map((tool) => (tool.id === nextTool.id ? nextTool : tool))
          .sort((left, right) => left.sortOrder - right.sortOrder),
      };
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

      return {
        ...event,
        conversationChecks: (event.conversationChecks ?? [])
          .map((check) => (check.id === nextCheck.id ? nextCheck : check))
          .sort((left, right) => left.sortOrder - right.sortOrder),
      };
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
  const [isSigningOut, setIsSigningOut] = useState(false);
  const autosaveTimers = useRef<Record<string, number>>({});
  const autosaveVersions = useRef<Record<string, number>>({});

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
          <button
            className="header-action"
            disabled={isCreating}
            onClick={createExperience}
            type="button"
          >
            {isCreating ? "Creating..." : "New"}
          </button>
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
    realtimeModel: "gpt-realtime-mini",
    systemPrompt: "",
    voice: "ash",
    voiceInstructions: "",
  });
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    chatTools: [],
    conversationChecks: [],
    description: "",
    steps: [],
    title: "Start",
  });
  const [eventSearch, setEventSearch] = useState("");
  const [draggingStepId, setDraggingStepId] = useState("");
  const [expandedStepId, setExpandedStepId] = useState("");
  const [isEventAddMenuOpen, setIsEventAddMenuOpen] = useState(false);
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
  const overviewAutosaveTimer = useRef<number | null>(null);
  const overviewAutosaveVersion = useRef(0);
  const tutorAutosaveTimer = useRef<number | null>(null);
  const tutorAutosaveVersion = useRef(0);
  const eventAutosaveTimer = useRef<number | null>(null);
  const eventAutosaveVersion = useRef(0);
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const overviewDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const eventAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationItemAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationAddBlockRef = useRef<HTMLDivElement | null>(null);
  const conversationCheckAddBlockRef = useRef<HTMLDivElement | null>(null);

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
    };
  }, []);

  useEffect(() => {
    resizeTextareaToContent(overviewDescriptionRef.current);
  }, [experienceForm.description]);

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
      draft.realtimeModel !== experience.tutor.realtimeModel ||
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
          current.realtimeModel !== draft.realtimeModel ||
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

  function clearEventAutosaveTimer() {
    if (!eventAutosaveTimer.current) return;
    window.clearTimeout(eventAutosaveTimer.current);
    eventAutosaveTimer.current = null;
  }

  function nextEventAutosaveVersion() {
    eventAutosaveVersion.current += 1;
    return eventAutosaveVersion.current;
  }

  function getSelectedEventParts() {
    const selectedEvent = getSelectedExperienceEvent(experience, selectedEventId);
    return { selectedEvent };
  }

  function hasEventChanges(draft: EventDraft) {
    const { selectedEvent } = getSelectedEventParts();
    if (!selectedEvent) return false;

    if (
      draft.title !== selectedEvent.title ||
      draft.description !== selectedEvent.description
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

    return draft.conversationChecks.some((draftCheck) => {
      const currentCheck = currentChecks.find(
        (check) => check.id === draftCheck.id,
      );
      if (!currentCheck) return true;

      return (
        JSON.stringify(comparableConversationCheckDraft(draftCheck)) !==
        JSON.stringify(comparableConversationCheck(currentCheck))
      );
    });
  }

  async function persistEventDraft(draft: EventDraft, version: number) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent || !draft.title.trim()) {
      return true;
    }

    setError("");

    try {
      const currentSteps = sortedEventSteps(selectedEvent.steps);
      const currentTools = sortedEventChatTools(selectedEvent.chatTools);
      const currentChecks = sortedEventConversationChecks(
        selectedEvent.conversationChecks ?? [],
      );

      if (
        draft.title !== selectedEvent.title ||
        draft.description !== selectedEvent.description
      ) {
        const eventPayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              description: draft.description,
              title: draft.title,
            }),
          },
        );

        if (eventAutosaveVersion.current === version) {
          setExperience((current) =>
            current && current.id === experience.id
              ? replaceExperienceEvent(current, eventPayload.event)
              : current,
          );
        }
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
        const primaryCapture = draftTool.captures.find((capture) =>
          capture.saveAs.trim(),
        );

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
            body: JSON.stringify({
              description: draftTool.description,
              enabled: draftTool.enabled,
              handlerActions: normalizedActionSequenceSteps(
                draftTool.handlerActions,
              ),
              name: draftTool.name,
              parameters: normalizedChatToolParameters(draftTool),
              saveArgument: primaryCapture?.saveAs.trim() ?? "",
              saveContextKey: primaryCapture?.saveAs.trim() ?? "",
              sortOrder: draftTool.sortOrder,
              triggersEvent: draftTool.triggersEvent,
            }),
          },
        );

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
            body: JSON.stringify({
              enabled: draftCheck.enabled,
              handlerActions: normalizedActionSequenceSteps(
                draftCheck.handlerActions,
              ),
              instructions: draftCheck.instructions,
              resultContextKey: draftCheck.resultContextKey,
              sortOrder: draftCheck.sortOrder,
              title: draftCheck.title,
              triggersEvent: draftCheck.triggersEvent,
            }),
          },
        );

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
      void persistEventDraft(draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushEventAutosave() {
    clearEventAutosaveTimer();

    if (!hasEventChanges(eventDraft)) return true;

    const version = nextEventAutosaveVersion();
    return persistEventDraft(eventDraft, version);
  }

  function updateEventDraft(
    field: "description" | "title",
    value: string,
  ) {
    const nextDraft = {
      ...eventDraft,
      [field]: value,
    };

    setEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
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

    setEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
  }

  function updateEventStepConfig(
    stepId: string,
    key: string,
    value: string,
  ) {
    updateEventStepDraft(stepId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventStepCondition(
    stepId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventStepDraft(stepId, (step) => {
      const nextCondition = {
        ...step.condition,
        ...condition,
      };

      if (condition.type === "always") {
        nextCondition.key = "";
        nextCondition.value = "";
      }

      return {
        ...step,
        condition: nextCondition,
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

    setEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
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
    value: string,
  ) {
    updateEventChatToolActionDraft(toolId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventChatToolActionCondition(
    toolId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventChatToolActionDraft(toolId, actionId, (step) => {
      const nextCondition = {
        ...step.condition,
        ...condition,
      };

      if (condition.type === "always") {
        nextCondition.key = "";
        nextCondition.value = "";
      }

      return {
        ...step,
        condition: nextCondition,
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
    setExpandedStepId(actionId);
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

    setEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
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
    value: string,
  ) {
    updateEventConversationCheckActionDraft(checkId, actionId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateEventConversationCheckActionCondition(
    checkId: string,
    actionId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateEventConversationCheckActionDraft(checkId, actionId, (step) => {
      const nextCondition = {
        ...step.condition,
        ...condition,
      };

      if (condition.type === "always") {
        nextCondition.key = "";
        nextCondition.value = "";
      }

      return {
        ...step,
        condition: nextCondition,
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
    setExpandedStepId(actionId);
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

  function applyUpdatedEvent(nextEvent: ExperienceEvent) {
    if (!experience) return;

    const nextExperience = replaceExperienceEvent(experience, nextEvent);
    setExperience(nextExperience);
    setSelectedEventId(nextEvent.id);
    setEventDraft(eventDraftFromEvent(nextEvent));
  }

  async function selectEditorEvent(nextEventId: string) {
    if (!experience || nextEventId === selectedEventId) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    const nextEvent = getSelectedExperienceEvent(experience, nextEventId);
    setSelectedEventId(nextEvent?.id ?? "");
    setEventDraft(eventDraftFromEvent(nextEvent));
    setExpandedStepId("");
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
      setExpandedStepId("");
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

  async function addEventStep(actionType: EventActionStep["actionType"]) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
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
      applyUpdatedEvent(payload.event);
      const nextSortedSteps = sortedEventSteps(payload.event.steps);
      const newStep =
        nextSortedSteps.find((step) => !existingStepIds.has(step.id)) ??
        nextSortedSteps[nextSortedSteps.length - 1];
      if (newStep) {
        setExpandedStepId(newStep.id);
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
      applyUpdatedEvent(payload.event);
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
      applyUpdatedEvent(payload.event);
      const nextCheck = sortedEventConversationChecks(
        payload.event.conversationChecks ?? [],
      ).find((check) => !existingCheckIds.has(check.id));
      if (nextCheck) {
        setExpandedStepId(nextCheck.id);
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

  async function deleteEventChatTool(toolId: string) {
    const { selectedEvent } = getSelectedEventParts();
    if (!experience || !selectedEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/${toolId}/`,
        {
          method: "DELETE",
        },
      );
      applyUpdatedEvent(payload.event);
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
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/${checkId}/`,
        {
          method: "DELETE",
        },
      );
      applyUpdatedEvent(payload.event);
      if (expandedStepId === checkId) {
        setExpandedStepId("");
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete conversation check.",
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
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/${stepId}/`,
        {
          method: "DELETE",
        },
      );
      applyUpdatedEvent(payload.event);
      if (expandedStepId === stepId) {
        setExpandedStepId("");
      }
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
      applyUpdatedEvent(payload.event);
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
    );

  function renderActionStepDetail(
    step: EventStepDraft,
    updateConfig: (key: string, value: string) => void,
    updateCondition: (condition: Partial<StepConditionDraft>) => void,
    className = "event-step-detail",
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
                placeholder="yes"
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
          <textarea
            aria-label="Speech text"
            className="event-script-textarea"
            onChange={(event) => updateConfig("text", event.target.value)}
            placeholder="What the agent says..."
            value={stringConfigValue(step.config, "text")}
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
                onModelChange={(realtimeModel) =>
                  updateTutorDraft("realtimeModel", realtimeModel)
                }
                onNameChange={(assistantName) =>
                  updateTutorDraft("assistantName", assistantName)
                }
                onPlaySample={playVoiceSample}
                onSave={saveTutorSettings}
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
              </div>

              {selectedEventRoutes.length ? (
                <div className="event-route-strip" aria-label="Event routes">
                  <span>Routes</span>
                  {selectedEventRoutes.map((route) => (
                    <button
                      className="event-route-chip"
                      key={route.id}
                      onClick={() => setExpandedStepId(route.id)}
                      type="button"
                    >
                      <strong>{route.label}</strong>
                      <span>{route.target}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="event-sequence-header">
                <span>On entry</span>
              </div>

              <div className="event-step-list">
                {eventDraft.steps.map((step, index) => {
                  const conditionText = eventConditionSummary(step.condition);
                  const isExpanded = expandedStepId === step.id;
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
                          onClick={() =>
                            setExpandedStepId(isExpanded ? "" : step.id)
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
                            onClick={() => setExpandedStepId(step.id)}
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
                                  placeholder="yes"
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
                            <textarea
                              aria-label="Speech text"
                              className="event-script-textarea"
                              onChange={(event) =>
                                updateEventStepConfig(
                                  step.id,
                                  "text",
                                  event.target.value,
                                )
                              }
                              placeholder="What the agent says..."
                              value={stringConfigValue(step.config, "text")}
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
                    (step) => step.id === expandedStepId,
                  );
                  const isExpanded =
                    expandedStepId === tool.id || isHandlerActionExpanded;
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
                              setExpandedStepId(isExpanded ? "" : tool.id)
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
                                    expandedStepId === step.id;
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
                                            setExpandedStepId(
                                              isActionExpanded ? tool.id : step.id,
                                            )
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
                                            onClick={() => setExpandedStepId(step.id)}
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
                                              if (expandedStepId === step.id) {
                                                setExpandedStepId(tool.id);
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
                    (step) => step.id === expandedStepId,
                  );
                  const isExpanded =
                    expandedStepId === check.id || isHandlerActionExpanded;
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
                              setExpandedStepId(isExpanded ? "" : check.id)
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
                                    expandedStepId === step.id;
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
                                            setExpandedStepId(
                                              isActionExpanded ? check.id : step.id,
                                            )
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
                                            onClick={() => setExpandedStepId(step.id)}
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
                                              if (expandedStepId === step.id) {
                                                setExpandedStepId(check.id);
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
                !eventDraft.conversationChecks.length ? (
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
    realtimeModel: "gpt-realtime-mini",
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
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [turnAnchorMessageId, setTurnAnchorMessageId] = useState<string | null>(
    null,
  );
  const [notesVisible, setNotesVisible] = useState(false);
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
      notesVisible,
      ...overrides,
    };
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
    const triggersValue = uiRuntime.triggers;
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
    setRuntimeHighlights(nextHighlights);
    setRuntimeTriggers(nextTriggers);
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
    setNotesVisible(false);
    setRuntimeActionLog([]);
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
      realtimeConnectionRef.current?.close();
      scriptAudioRef.current?.pause();
      scriptAudioRef.current = null;
    };
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

  function playAudioUrl(audioUrl: string) {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(audioUrl);
      scriptAudioRef.current = audio;
      audio.preload = "auto";

      const cleanup = () => {
        audio.removeEventListener("ended", handleEnded);
        audio.removeEventListener("error", handleError);
        if (scriptAudioRef.current === audio) {
          scriptAudioRef.current = null;
        }
      };
      const handleEnded = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Could not play the scripted audio recording."));
      };

      audio.addEventListener("ended", handleEnded);
      audio.addEventListener("error", handleError);
      void audio.play().catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("Audio playback was blocked."));
      });
    });
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
        const payload = await apiFetch<MessageAudioPayload>(
          `/api/sessions/${activeSession.id}/messages/${message.id}/audio/`,
          {
            method: "POST",
            body: JSON.stringify({
              model: selectedModel,
              voice: selectedVoice,
            }),
          },
        );
        await playAudioUrl(payload.audioUrl);
      } catch (error) {
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

    scriptAudioQueueRef.current = scriptAudioQueueRef.current
      .catch(() => undefined)
      .then(() => playScriptMessages(activeSession, scriptMessages));
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
                    onModelChange: (model) => {
                      setTutorForm((current) => ({
                        ...current,
                        realtimeModel: model,
                      }));
                      setSelectedModel(model);
                    },
                    onNameChange: (assistantName) =>
                      setTutorForm((current) => ({
                        ...current,
                        assistantName,
                      })),
                    onSave: saveTutorSettings,
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
                error={slideError}
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
                isSending={isSendingMessage}
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
            currentEvent={currentRuntimeEvent}
            currentEventSlug={currentRuntimeEventSlug}
            highlights={runtimeHighlights}
            runtimeContext={session?.runtimeContext ?? {}}
            session={session}
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
  currentEvent,
  currentEventSlug,
  highlights,
  runtimeContext,
  session,
  triggers,
}: {
  actionLog: RuntimeActionLogEntry[];
  buttons: RuntimeButton[];
  currentEvent: ExperienceEvent | null;
  currentEventSlug: string;
  highlights: Record<string, RuntimeHighlight>;
  runtimeContext: Record<string, unknown>;
  session: TutoringSession | null;
  triggers: RuntimeUiTrigger[];
}) {
  const contextEntries = Object.entries(runtimeContext);
  const highlightEntries = Object.values(highlights);
  const currentEventLabel =
    currentEvent?.title || currentEventSlug || (session ? "Start" : "---");

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
        </div>

        <section className="runtime-inspector-section">
          <h2>Context</h2>
          {contextEntries.length ? (
            <div className="runtime-inspector-list">
              {contextEntries.map(([key, value]) => (
                <div className="runtime-inspector-row" key={key}>
                  <span>{key}</span>
                  <code>{compactRuntimeValue(value)}</code>
                </div>
              ))}
            </div>
          ) : (
            <p className="runtime-inspector-empty">---</p>
          )}
        </section>

        <section className="runtime-inspector-section">
          <h2>Waiting</h2>
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
                <span>{button.label}</span>
                <code>{button.triggersEvent}</code>
              </div>
            ))}
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
          {!triggers.length && !buttons.length && !highlightEntries.length ? (
            <p className="runtime-inspector-empty">---</p>
          ) : null}
        </section>

        <section className="runtime-inspector-section">
          <h2>Recent actions</h2>
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
  onModelChange: (model: RealtimeModelId) => void;
  onNameChange: (assistantName: string) => void;
  onPlaySample?: () => Promise<void> | void;
  onSave: () => Promise<void>;
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
  onModelChange,
  onNameChange,
  onPlaySample,
  onSave,
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
  const sampleActionLabel =
    sampleStatus === "playing"
      ? "Stop voice sample"
      : sampleStatus === "loading"
        ? "Loading voice sample"
        : "Play voice sample";
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
          <span>Model</span>
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
            {realtimeVoiceOptions.map((option) => (
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

function MainPanelContent({
  error,
  slide,
  status,
}: {
  error: string;
  slide: ResolvedSlide | null;
  status: SlideStatus;
}) {
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

  const emptyLabel =
    status === "loading" ? "Loading slide" : error ? "Slide unavailable" : "Slides";

  return (
    <div className="slide-workspace empty">
      <div className="slide-empty-state">
        <span>{emptyLabel}</span>
      </div>
    </div>
  );
}

type ChatPanelContentProps = {
  assistantName: string;
  avatarPath: string;
  error: string;
  isSending: boolean;
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
  isSending,
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
    if (!nextMessage || !session || isSending || status === "loading") return;

    setDraft("");

    try {
      await onSendMessage(nextMessage);
    } catch {
      // Keep the draft available when saving fails.
      setDraft(nextMessage);
    }
  }

  const isInputDisabled = !session || status === "loading";
  const isSendDisabled = isInputDisabled || isSending || !draft.trim();
  const sendButtonLabel =
    realtimeStatus === "streaming" || isSending
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
            placeholder={`Message ${assistantDisplayName}...`}
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
