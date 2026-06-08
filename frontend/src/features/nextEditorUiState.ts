import type { EventActionStep, ExperienceEvent } from "../types";
import type { PythonDslScriptAction } from "./PythonDslEditor";

export type ScriptDetailTab = "audio" | "display" | "script" | "fine-tuning";

export type ActiveScriptAction = PythonDslScriptAction & {
  eventId: string;
};

export type PersistedNextEditorUiState = {
  activeScriptAction?: {
    actionIndex?: number;
    eventId?: string;
    lineNumber?: number;
    source?: string;
  } | null;
  scriptDetailTab?: ScriptDetailTab;
  selectedEventId?: string;
};

const nextEditorUiStoragePrefix = "dlu.next-editor-ui.v1";

function nextEditorUiStorageKey(experienceId: string) {
  return `${nextEditorUiStoragePrefix}:${experienceId}`;
}

export function readStoredNextEditorUiState(
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

export function readLocationNextEditorUiState(): PersistedNextEditorUiState {
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

export function writeStoredNextEditorUiState(
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

export function writeLocationNextEditorUiState(
  state: PersistedNextEditorUiState,
) {
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

export function sortedEventSteps(steps: EventActionStep[]) {
  return [...steps].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function sortedScriptSteps(event: ExperienceEvent) {
  return sortedEventSteps(event.steps).filter(
    (step) => step.actionType === "script",
  );
}

export function selectedEventIdFromStored(
  storedState: PersistedNextEditorUiState,
  events: ExperienceEvent[],
) {
  return storedState.selectedEventId &&
    events.some((event) => event.id === storedState.selectedEventId)
    ? storedState.selectedEventId
    : "";
}

export function activeScriptActionFromStored(
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

export function scriptDetailTabFromStored(
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
