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
] as const;

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
    | "set_ui_trigger";
  label: string;
  config: Record<string, unknown>;
  condition: Record<string, unknown>;
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

type StartEventDraft = {
  title: string;
  description: string;
  steps: EventStepDraft[];
};

type StartEventPayload = SessionPayload & {
  actions: Array<Record<string, unknown>>;
  event: ExperienceEvent;
  ran: boolean;
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

function sortedEventSteps(steps: EventActionStep[]) {
  return [...steps].sort(
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

function conditionDraftFromStep(step: EventActionStep): StepConditionDraft {
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

function stepDraftFromStep(step: EventActionStep): EventStepDraft {
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

function startEventDraftFromExperience(
  experience: Experience | null,
): StartEventDraft {
  const startEvent = getStartEvent(experience);

  return {
    description: startEvent?.description ?? "",
    steps: startEvent ? sortedEventSteps(startEvent.steps).map(stepDraftFromStep) : [],
    title: startEvent?.title ?? "Start",
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
      triggersEvent: "notes-opened",
    };
  }

  return { text: "" };
}

function defaultStepLabel(actionType: EventActionStep["actionType"]) {
  if (actionType === "set_context") return "Set entry_ready";
  if (actionType === "get_ui_state") return "Read UI state";
  if (actionType === "highlight_on") return "Highlight UI";
  if (actionType === "highlight_off") return "Clear highlight";
  if (actionType === "set_ui_trigger") return "Wait for UI";
  return "Say";
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

  return "Have the agent speak in the chat";
}

function eventActionToneClass(actionType: EventActionStep["actionType"]) {
  if (actionType === "set_context" || actionType === "get_ui_state") {
    return "state";
  }
  if (actionType === "set_ui_trigger") return "flow";
  if (actionType === "highlight_on" || actionType === "highlight_off") return "ui";
  return "speech";
}

function compactPreview(value: string, fallback: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return fallback;
  return compact.length > 112 ? `${compact.slice(0, 109)}...` : compact;
}

function eventStepSummary(step: EventStepDraft) {
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
    return `${selector || "target"} -> ${triggersEvent || "event"}`;
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

function replaceExperienceEvent(
  experience: Experience,
  nextEvent: ExperienceEvent,
) {
  return {
    ...experience,
    events: experience.events
      .map((event) => (event.id === nextEvent.id ? nextEvent : event))
      .sort((left, right) => left.sortOrder - right.sortOrder),
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
  const [startEventDraft, setStartEventDraft] = useState<StartEventDraft>({
    description: "",
    steps: [],
    title: "Start",
  });
  const [draggingStepId, setDraggingStepId] = useState("");
  const [expandedStepId, setExpandedStepId] = useState("");
  const [isEventAddMenuOpen, setIsEventAddMenuOpen] = useState(false);
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

  function applyExperience(nextExperience: Experience) {
    setExperience(nextExperience);
    setExperienceForm({
      description: nextExperience.description,
      title: nextExperience.title,
    });
    setTutorForm(nextExperience.tutor);
    setStartEventDraft(startEventDraftFromExperience(nextExperience));
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

  function getStartEventParts() {
    const startEvent = getStartEvent(experience);
    return { startEvent };
  }

  function hasStartEventChanges(draft: StartEventDraft) {
    const { startEvent } = getStartEventParts();
    if (!startEvent) return false;

    if (
      draft.title !== startEvent.title ||
      draft.description !== startEvent.description
    ) {
      return true;
    }

    const currentSteps = sortedEventSteps(startEvent.steps);
    if (draft.steps.length !== currentSteps.length) return true;

    return draft.steps.some((draftStep) => {
      const currentStep = currentSteps.find((step) => step.id === draftStep.id);
      if (!currentStep) return true;

      return (
        JSON.stringify(comparableStepDraft(draftStep)) !==
        JSON.stringify(comparableStep(currentStep))
      );
    });
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

  async function persistStartEventDraft(draft: StartEventDraft, version: number) {
    const { startEvent } = getStartEventParts();
    if (!experience || !startEvent || !draft.title.trim()) {
      return true;
    }

    setError("");

    try {
      const currentSteps = sortedEventSteps(startEvent.steps);

      if (
        draft.title !== startEvent.title ||
        draft.description !== startEvent.description
      ) {
        const eventPayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${startEvent.id}/`,
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
          `/api/experiences/${experience.id}/events/${startEvent.id}/steps/${draftStep.id}/`,
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
                  startEvent.id,
                  stepPayload.step,
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
            : "Could not save start event.",
        );
      }
      return false;
    }
  }

  function queueEventAutosave(draft: StartEventDraft) {
    clearEventAutosaveTimer();

    if (!draft.title.trim() || !hasStartEventChanges(draft)) return;

    const version = nextEventAutosaveVersion();
    eventAutosaveTimer.current = window.setTimeout(() => {
      eventAutosaveTimer.current = null;
      void persistStartEventDraft(draft, version);
    }, experienceAutosaveDelayMs);
  }

  async function flushEventAutosave() {
    clearEventAutosaveTimer();

    if (!hasStartEventChanges(startEventDraft)) return true;

    const version = nextEventAutosaveVersion();
    return persistStartEventDraft(startEventDraft, version);
  }

  function updateStartEventDraft(
    field: "description" | "title",
    value: string,
  ) {
    const nextDraft = {
      ...startEventDraft,
      [field]: value,
    };

    setStartEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
  }

  function updateStartEventStepDraft(
    stepId: string,
    updater: (step: EventStepDraft) => EventStepDraft,
  ) {
    const nextDraft = {
      ...startEventDraft,
      steps: startEventDraft.steps.map((step) =>
        step.id === stepId ? updater(step) : step,
      ),
    };

    setStartEventDraft(nextDraft);
    queueEventAutosave(nextDraft);
  }

  function updateStartEventStepConfig(
    stepId: string,
    key: string,
    value: string,
  ) {
    updateStartEventStepDraft(stepId, (step) => ({
      ...step,
      config: {
        ...step.config,
        [key]: value,
      },
    }));
  }

  function updateStartEventStepCondition(
    stepId: string,
    condition: Partial<StepConditionDraft>,
  ) {
    updateStartEventStepDraft(stepId, (step) => {
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

  function updateStartEventStepAction(
    stepId: string,
    actionType: EventActionStep["actionType"],
  ) {
    updateStartEventStepDraft(stepId, (step) => ({
      ...step,
      actionType,
      config:
        step.actionType === actionType ? step.config : defaultStepConfig(actionType),
      label: step.label || defaultStepLabel(actionType),
    }));
  }

  function applyUpdatedStartEvent(nextEvent: ExperienceEvent) {
    if (!experience) return;

    const nextExperience = replaceExperienceEvent(experience, nextEvent);
    setExperience(nextExperience);
    setStartEventDraft(startEventDraftFromExperience(nextExperience));
  }

  async function addStartEventStep(actionType: EventActionStep["actionType"]) {
    const { startEvent } = getStartEventParts();
    if (!experience || !startEvent) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      const existingStepIds = new Set(startEvent.steps.map((step) => step.id));
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${startEvent.id}/steps/`,
        {
          method: "POST",
          body: JSON.stringify({
            actionType,
            config: defaultStepConfig(actionType),
            label: defaultStepLabel(actionType),
          }),
        },
      );
      applyUpdatedStartEvent(payload.event);
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

  async function deleteStartEventStep(stepId: string) {
    const { startEvent } = getStartEventParts();
    if (!experience || !startEvent || startEventDraft.steps.length <= 1) return;

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    setError("");

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${startEvent.id}/steps/${stepId}/`,
        {
          method: "DELETE",
        },
      );
      applyUpdatedStartEvent(payload.event);
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

  async function reorderStartEventStep(stepId: string, targetStepId: string) {
    const { startEvent } = getStartEventParts();
    if (!experience || !startEvent) return;

    const currentIndex = startEventDraft.steps.findIndex((step) => step.id === stepId);
    const targetIndex = startEventDraft.steps.findIndex(
      (step) => step.id === targetStepId,
    );
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      return;
    }

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    const reorderedSteps = [...startEventDraft.steps];
    const [movedStep] = reorderedSteps.splice(currentIndex, 1);
    reorderedSteps.splice(targetIndex, 0, movedStep);
    const nextSteps = reorderedSteps.map((step, index) => ({
      ...step,
      sortOrder: index,
    }));

    setStartEventDraft({
      ...startEventDraft,
      steps: nextSteps,
    });
    setError("");

    try {
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${startEvent.id}/steps/reorder/`,
        {
          method: "POST",
          body: JSON.stringify({
            stepIds: nextSteps.map((step) => step.id),
          }),
        },
      );
      applyUpdatedStartEvent(payload.event);
    } catch (moveError) {
      setError(
        moveError instanceof Error ? moveError.message : "Could not reorder steps.",
      );
      setStartEventDraft(startEventDraftFromExperience(experience));
    }
  }

  function dragStartEventStep(
    event: DragEvent<HTMLElement>,
    stepId: string,
  ) {
    setDraggingStepId(stepId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", stepId);
  }

  function dragOverStartEventStep(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  async function dropStartEventStep(
    event: DragEvent<HTMLElement>,
    targetStepId: string,
  ) {
    event.preventDefault();
    const sourceStepId =
      event.dataTransfer.getData("text/plain") || draggingStepId;
    setDraggingStepId("");
    if (!sourceStepId || sourceStepId === targetStepId) return;
    await reorderStartEventStep(sourceStepId, targetStepId);
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
              <div className="event-document-header">
                <div className="event-title-stack">
                  <div className="event-title-line">
                    <input
                      aria-label="Event title"
                      className="event-title-text"
                      onChange={(event) =>
                        updateStartEventDraft("title", event.target.value)
                      }
                      style={inlineFieldWidthStyle(
                        startEventDraft.title,
                        "Start",
                        6,
                        32,
                      )}
                      type="text"
                      value={startEventDraft.title}
                    />
                    <input
                      aria-label="Event description"
                      className="event-description-text"
                      onChange={(event) =>
                        updateStartEventDraft("description", event.target.value)
                      }
                      placeholder="---"
                      style={inlineFieldWidthStyle(
                        startEventDraft.description,
                        "---",
                        4,
                        54,
                      )}
                      type="text"
                      value={startEventDraft.description}
                    />
                  </div>
                </div>
              </div>

              <div className="event-sequence-header">
                <span>On entry</span>
              </div>

              <div className="event-step-list">
                {startEventDraft.steps.map((step, index) => {
                  const conditionText = eventConditionSummary(step.condition);
                  const isExpanded = expandedStepId === step.id;
                  const toneClass = eventActionToneClass(step.actionType);

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
                      onDragOver={dragOverStartEventStep}
                      onDrop={(event) => void dropStartEventStep(event, step.id)}
                    >
                      <div className="event-step-main">
                        <span
                          aria-label={`Drag step ${index + 1}`}
                          className="event-drag-handle"
                          draggable
                          onDragEnd={() => setDraggingStepId("")}
                          onDragStart={(event) =>
                            dragStartEventStep(event, step.id)
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
                            {eventStepSummary(step)}
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
                              updateStartEventStepDraft(
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
                            disabled={startEventDraft.steps.length <= 1}
                            onClick={() => void deleteStartEventStep(step.id)}
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
                                    updateStartEventStepCondition(step.id, {
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
                                    updateStartEventStepCondition(step.id, {
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
                                    updateStartEventStepCondition(step.id, {
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
                                  updateStartEventStepCondition(step.id, {
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
                                updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                                  updateStartEventStepConfig(
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
                              <input
                                aria-label="Triggered event"
                                onChange={(event) =>
                                  updateStartEventStepConfig(
                                    step.id,
                                    "triggersEvent",
                                    event.target.value,
                                  )
                                }
                                placeholder="notes-opened"
                                type="text"
                                value={stringConfigValue(step.config, "triggersEvent")}
                              />
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
                        onClick={() => void addStartEventStep(option.id)}
                        type="button"
                      >
                        <span>{option.label}</span>
                        <small>{eventActionDescription(option.id)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
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
  const [isLeftOpen, setIsLeftOpen] = useState(true);
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
  const [runtimeTriggers, setRuntimeTriggers] = useState<RuntimeUiTrigger[]>([]);
  const shellStyle = {
    "--left-width": `${leftWidth}px`,
    "--workspace-width": `${workspaceWidth}px`,
  } as CSSProperties;
  const selectedExperience =
    experiences.find((experience) => experience.id === selectedExperienceId) ?? null;

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
    const triggersValue = uiRuntime.triggers;
    const nextHighlights: Record<string, RuntimeHighlight> = {};

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
    };
  }, []);

  useEffect(() => {
    realtimeConnectionRef.current?.close();
    realtimeConnectionRef.current = null;
    setRealtimeStatus("idle");
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
  ) {
    if (!session) return;

    try {
      const payload = await apiFetch<StartEventPayload>(
        `/api/sessions/${session.id}/events/run/`,
        {
          method: "POST",
          body: JSON.stringify({
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
      const activeSession = payload.session;
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

      setSession(activeSession);
      setMessages((current) =>
        sortMessages([...current, payload.message, assistantMessage]),
      );
      setTurnAnchorMessageId(payload.message.id);
      setChatStatus("ready");

      const connection = await getRealtimeConnection(
        activeSession,
        payload.message.id,
      );
      const assistantContent = await connection.sendUserText(content, (delta) => {
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

      const finalContent = assistantContent.trim();
      if (!finalContent) {
        throw new Error("dLU responded with audio but no text transcript.");
      }

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
        className={`workspace-shell ${isLeftOpen ? "drawer-open" : "drawer-closed"}`}
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
                error={chatError}
                isSending={isSendingMessage}
                messages={messages}
                onSendMessage={sendChatMessage}
                realtimeStatus={realtimeStatus}
                session={session}
                status={chatStatus}
                turnAnchorMessageId={turnAnchorMessageId}
                user={user}
                assistantName={tutorForm.assistantName}
                avatarPath={tutorForm.avatarPath}
              />
            </PanelWindow>
          </section>
        </section>
      </section>
    </main>
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
  onSendMessage: (content: string) => Promise<void>;
  realtimeStatus: RealtimeStatus;
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
  onSendMessage,
  realtimeStatus,
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
