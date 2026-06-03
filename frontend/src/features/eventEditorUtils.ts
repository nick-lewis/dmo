import type { CSSProperties } from "react";
import { getMainPanelAppDefinition } from "../mainPanelApps";
import { normalizePythonNotebookState } from "../PythonNotebookPanel";
import { spokenScriptText } from "../scriptMarkers";
import {
  compactPreview,
  conditionRecordSummary,
  stringConfigValue,
} from "../runtimeUtils";
import { eventTitleForTrigger } from "../eventGraph";
import type {
  ActionSequenceStep,
  EventActionStep,
  EventChatCaptureDraft,
  EventChatTool,
  EventChatToolDraft,
  EventClassifier,
  EventClassifierDraft,
  EventClassifierGroup,
  EventClassifierGroupDraft,
  EventConversationCheck,
  EventConversationCheckDraft,
  EventConversationChoice,
  EventConversationChoiceDraft,
  EventDraft,
  Experience,
  ExperienceEvent,
  EventStepDraft,
  StepConditionDraft,
} from "../types";
export const experienceAutosaveDelayMs = 700;
export const editorUndoLimit = 80;
export const conversationItemDragMimeType = "application/x-dlu-conversation-item";
export const handlerActionDragMimeType = "application/x-dlu-handler-action";
export const chatExitCaptureSaveMapKey = "x-dluCaptureSaves";
export const chatExitDisplayTitleKey = "x-dluDisplayTitle";

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}


export function localMessageId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function inlineFieldWidthStyle(
  value: string,
  fallback: string,
  minCh: number,
  maxCh: number,
): CSSProperties {
  const length = (value.trim() || fallback).length + 1;
  return { width: `${clamp(length, minCh, maxCh)}ch` };
}

export function getStartEvent(experience: Experience | null) {
  if (!experience) return null;
  return (
    experience.events.find((event) => event.isStart) ??
    experience.events[0] ??
    null
  );
}

export function sortedExperienceEvents(events: ExperienceEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function getSelectedExperienceEvent(
  experience: Experience | null,
  eventId: string,
) {
  if (!experience) return null;

  return (
    experience.events.find((event) => event.id === eventId) ??
    getStartEvent(experience)
  );
}

export function sortedEventSteps(steps: EventActionStep[]) {
  return [...steps].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function sortedActionSequenceSteps(steps: ActionSequenceStep[] = []) {
  return [...steps].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function sortedEventChatTools(tools: EventChatTool[]) {
  return [...tools].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function sortedEventConversationChecks(checks: EventConversationCheck[]) {
  return [...checks].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function sortedEventClassifierGroups(groups: EventClassifierGroup[]) {
  return [...groups].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function sortedEventConversationChoices(choices: EventConversationChoice[] = []) {
  return [...choices].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

export function sortedEventClassifiers(classifiers: EventClassifier[]) {
  return [...classifiers].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function conditionDraftFromStep(step: ActionSequenceStep): StepConditionDraft {
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

export function conditionDraftFromRecord(
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

export function stepDraftFromStep(step: ActionSequenceStep): EventStepDraft {
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

export function toolCaptureDraftsFromTool(tool: EventChatTool): EventChatCaptureDraft[] {
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

export function chatToolDisplayTitle(tool: EventChatTool) {
  const rawTitle = tool.parameters[chatExitDisplayTitleKey];
  return typeof rawTitle === "string" ? rawTitle : "";
}

export function chatToolDraftFromTool(tool: EventChatTool): EventChatToolDraft {
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

export function conversationCheckDraftFromCheck(
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

export function classifierDraftFromClassifier(
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

export function classifierGroupDraftFromGroup(
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

export function conversationChoiceDraftFromChoice(
  choice: EventConversationChoice,
): EventConversationChoiceDraft {
  return {
    enabled: choice.enabled,
    iconPath: choice.iconPath ?? "",
    id: choice.id,
    label: choice.label,
    sortOrder: choice.sortOrder,
    triggersEvent: choice.triggersEvent,
  };
}

export function eventDraftFromEvent(event: ExperienceEvent | null): EventDraft {
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
    conversationChoices: event
      ? sortedEventConversationChoices(event.conversationChoices ?? []).map(
          conversationChoiceDraftFromChoice,
        )
      : [],
    description: event?.description ?? "",
    steps: event ? sortedEventSteps(event.steps).map(stepDraftFromStep) : [],
    title: event?.title ?? "Start",
  };
}

export function eventStepSummary(step: EventStepDraft, events: ExperienceEvent[]) {
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
  if (step.actionType === "interactive_clear") {
    return "Clear main-panel app";
  }
  if (step.actionType === "python_notebook") {
    const notebook = normalizePythonNotebookState(step.config.notebook);
    return `Load Python notebook (${notebook.cells.length} cells)`;
  }
  if (step.actionType === "chat_availability") {
    return step.config.enabled === false ? "Chat off" : "Chat on";
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
    "Write script text",
  );
}

export function eventConditionSummary(condition: StepConditionDraft) {
  if (condition.type === "custom") {
    return conditionRecordSummary(condition.raw ?? {});
  }
  if (condition.type !== "context_equals") return "";

  const key = condition.key.trim() || "context";
  const value = condition.value.trim() || "expected";
  return `${key} == ${value}`;
}

export function normalizedStepCondition(condition: StepConditionDraft) {
  if (condition.type === "custom") return condition.raw ?? {};
  if (condition.type !== "context_equals") return {};

  return {
    key: condition.key,
    type: "context_equals",
    value: condition.value,
  };
}

export function mergeConditionDraft(
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

export function comparableStepDraft(step: EventStepDraft) {
  return {
    actionType: step.actionType,
    condition: normalizedStepCondition(step.condition),
    config: step.config,
    enabled: step.enabled,
    label: step.label,
    sortOrder: step.sortOrder,
  };
}

export function comparableStep(step: EventActionStep) {
  return comparableStepDraft(stepDraftFromStep(step));
}

export function normalizedActionSequenceSteps(steps: EventStepDraft[]) {
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

export function normalizedChatToolParameters(tool: EventChatToolDraft) {
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

export function comparableChatToolDraft(tool: EventChatToolDraft) {
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

export function comparableChatTool(tool: EventChatTool) {
  return comparableChatToolDraft(chatToolDraftFromTool(tool));
}

export function comparableConversationCheckDraft(check: EventConversationCheckDraft) {
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

export function comparableConversationCheck(check: EventConversationCheck) {
  return comparableConversationCheckDraft(conversationCheckDraftFromCheck(check));
}

export function comparableClassifierDraft(classifier: EventClassifierDraft) {
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

export function comparableClassifier(classifier: EventClassifier) {
  return comparableClassifierDraft(classifierDraftFromClassifier(classifier));
}

export function comparableClassifierGroupDraft(group: EventClassifierGroupDraft) {
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

export function comparableClassifierGroup(group: EventClassifierGroup) {
  return comparableClassifierGroupDraft(classifierGroupDraftFromGroup(group));
}

export function comparableConversationChoiceDraft(choice: EventConversationChoiceDraft) {
  return {
    enabled: choice.enabled,
    iconPath: choice.iconPath,
    label: choice.label,
    sortOrder: choice.sortOrder,
    triggersEvent: choice.triggersEvent,
  };
}

export function comparableConversationChoice(choice: EventConversationChoice) {
  return comparableConversationChoiceDraft(conversationChoiceDraftFromChoice(choice));
}

export function eventDraftHasChanges(
  draft: EventDraft,
  selectedEvent: ExperienceEvent | null,
) {
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

  const hasGroupChanges = draft.classifierGroups.some((draftGroup) => {
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
  if (hasGroupChanges) return true;

  const currentChoices = sortedEventConversationChoices(
    selectedEvent.conversationChoices ?? [],
  );
  if (draft.conversationChoices.length !== currentChoices.length) return true;

  return draft.conversationChoices.some((draftChoice) => {
    const currentChoice = currentChoices.find(
      (choice) => choice.id === draftChoice.id,
    );
    if (!currentChoice) return true;

    return (
      JSON.stringify(comparableConversationChoiceDraft(draftChoice)) !==
      JSON.stringify(comparableConversationChoice(currentChoice))
    );
  });
}

export function conversationChoicePayloadFromDraft(choice: EventConversationChoiceDraft) {
  return {
    enabled: choice.enabled,
    iconPath: choice.iconPath,
    id: choice.id,
    label: choice.label,
    sortOrder: choice.sortOrder,
    triggersEvent: choice.triggersEvent,
  };
}

export function chatToolPayloadFromDraft(tool: EventChatToolDraft) {
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

export function conversationCheckPayloadFromDraft(check: EventConversationCheckDraft) {
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

export function classifierGroupPayloadFromDraft(group: EventClassifierGroupDraft) {
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

export function classifierPayloadFromDraft(classifier: EventClassifierDraft) {
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

export function replaceEventStepInEvent(
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

export function replaceEventToolInEvent(
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

export function replaceEventCheckInEvent(
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

export function replaceEventClassifierGroupInEvent(
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

export function replaceEventClassifierInEvent(
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

export function replaceExperienceEvent(
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

export function addExperienceEvent(
  experience: Experience,
  nextEvent: ExperienceEvent,
) {
  return {
    ...experience,
    events: sortedExperienceEvents([...experience.events, nextEvent]),
  };
}

export function replaceExperienceEventStep(
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

export function replaceExperienceEventTool(
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

export function replaceExperienceEventCheck(
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

export function replaceExperienceClassifierGroup(
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

export function replaceExperienceClassifier(
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
