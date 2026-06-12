import { defaultGlowColor, glowTargets } from "./glowTargets";
import { cloneMainPanelAppConfig, defaultMainPanelApp } from "./mainPanelApps";
import { defaultPythonNotebookState } from "./PythonNotebookPanel";
import { sidePanelMetadataDefinitions } from "./sidePanelMetadata";
import type { EventActionStep, ExperienceEvent } from "./types";

function sortedExperienceEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export const eventActionOptions = [
  { id: "script", label: "Script" },
  { id: "set_context", label: "Set context" },
  { id: "append_context_list", label: "Append context" },
  { id: "get_ui_state", label: "Read UI" },
  { id: "highlight_on", label: "Highlight" },
  { id: "highlight_off", label: "Clear highlight" },
  { id: "interactive", label: "Main panel app" },
  { id: "interactive_update", label: "Update app" },
  { id: "interactive_clear", label: "Clear app" },
  { id: "python_notebook", label: "Notebook" },
  { id: "chat_availability", label: "Chat" },
  { id: "set_ui_trigger", label: "UI trigger" },
  { id: "side_panel", label: "Side panel" },
  { id: "roadmap_complete", label: "Roadmap complete" },
  { id: "goto_event", label: "Go to event" },
  { id: "button_choice", label: "Button choice" },
] as const;

export function defaultStepConfig(actionType: EventActionStep["actionType"]) {
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
      color: defaultGlowColor,
      selector: glowTargets()[0]?.selector ?? ".glow-chat-input",
    };
  }
  if (actionType === "highlight_off") {
    return { selector: glowTargets()[0]?.selector ?? ".glow-chat-input" };
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
  if (actionType === "interactive_clear") {
    return {};
  }
  if (actionType === "python_notebook") {
    return { notebook: defaultPythonNotebookState() };
  }
  if (actionType === "chat_availability") {
    return { enabled: false };
  }
  if (actionType === "side_panel") {
    return {
      mode: "open",
      panelId: sidePanelMetadataDefinitions[0]?.id ?? "roadmap",
    };
  }
  if (actionType === "roadmap_complete") {
    return { nodeId: "predict" };
  }
  if (actionType === "set_ui_trigger") {
    return {
      selector: glowTargets()[0]?.selector ?? ".glow-chat-input",
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

export function defaultStepConfigForEvent(
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

export function defaultStepLabel(actionType: EventActionStep["actionType"]) {
  if (actionType === "set_context") return "Set entry_ready";
  if (actionType === "append_context_list") return "Append context";
  if (actionType === "get_ui_state") return "Read UI state";
  if (actionType === "highlight_on") return "Highlight UI";
  if (actionType === "highlight_off") return "Clear highlight";
  if (actionType === "interactive") return "Show main-panel app";
  if (actionType === "interactive_update") return "Update app";
  if (actionType === "interactive_clear") return "Clear main-panel app";
  if (actionType === "python_notebook") return "Load Python notebook";
  if (actionType === "chat_availability") return "Set chat availability";
  if (actionType === "side_panel") return "Show side panel";
  if (actionType === "roadmap_complete") return "Complete roadmap step";
  if (actionType === "set_ui_trigger") return "Wait for UI";
  if (actionType === "goto_event") return "Go to event";
  if (actionType === "button_choice") return "Show choice";
  return "Script";
}

export function defaultChatToolPayload(events: ExperienceEvent[], currentEventId: string) {
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

export function defaultConversationCheckPayload(
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

export function defaultClassifierGroupPayload(
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

export function eventActionLabel(actionType: EventActionStep["actionType"]) {
  return (
    eventActionOptions.find((option) => option.id === actionType)?.label ??
    "Action"
  );
}

export function eventActionDescription(actionType: EventActionStep["actionType"]) {
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
  if (actionType === "interactive_clear") {
    return "Clear the current main-panel app";
  }
  if (actionType === "python_notebook") {
    return "Load starter cells into the Python notebook panel";
  }
  if (actionType === "chat_availability") {
    return "Enable or block learner typing";
  }
  if (actionType === "side_panel") {
    return "Show, make available, or hide a side panel option";
  }
  if (actionType === "roadmap_complete") {
    return "Mark a roadmap challenge complete and unlock what follows";
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

  return "Script spoken text and timed actions";
}

export function eventActionToneClass(actionType: EventActionStep["actionType"]) {
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
    actionType === "interactive_update" ||
    actionType === "interactive_clear" ||
    actionType === "python_notebook" ||
    actionType === "chat_availability" ||
    actionType === "side_panel" ||
    actionType === "roadmap_complete"
  ) {
    return "ui";
  }
  return "speech";
}
