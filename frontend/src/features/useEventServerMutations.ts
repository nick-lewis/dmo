import type {
  Dispatch,
  SetStateAction,
} from "react";

import { apiFetch } from "../api";
import {
  defaultChatToolPayload,
  defaultClassifierGroupPayload,
  defaultConversationCheckPayload,
  defaultStepConfigForEvent,
  defaultStepLabel,
} from "../actionRegistry";
import type {
  DropPosition,
  EventActionStep,
  EventDraft,
  EventStepDraft,
  EventStructuralHistoryItem,
  Experience,
  ExperienceEvent,
} from "../types";
import {
  addExperienceEvent,
  eventDraftFromEvent,
  getSelectedExperienceEvent,
  replaceExperienceEvent,
  sortedEventChatTools,
  sortedEventClassifierGroups,
  sortedEventConversationChecks,
  sortedEventSteps,
  sortedExperienceEvents,
} from "./eventEditorUtils";

type UseEventServerMutationsParams = {
  clearActionDragState: () => void;
  clearEventAutosaveTimer: () => void;
  clearEventUndoHistory: () => void;
  closeExpandedItem: (itemId: string) => void;
  editorEvents: ExperienceEvent[];
  eventDraft: EventDraft;
  experience: Experience | null;
  flushEventAutosave: () => Promise<boolean>;
  forgetCheckId: (checkId: string) => string;
  forgetClassifierId: (
    groupId: string,
    classifierId: string,
  ) => { resolvedClassifierId: string; resolvedGroupId: string };
  forgetGroupId: (groupId: string) => string;
  forgetStepId: (stepId: string) => string;
  forgetToolId: (toolId: string) => string;
  getSelectedEventParts: () => { selectedEvent: ExperienceEvent | null };
  loadScriptAudioItems: (
    targetExperienceId?: string,
    showLoading?: boolean,
  ) => Promise<unknown>;
  normalizedEventSearch: string;
  openExpandedItem: (itemId: string) => void;
  persistedDraftForUndo: (selectedEvent: ExperienceEvent) => EventDraft;
  pushEventStructuralUndo: (item: EventStructuralHistoryItem) => void;
  rememberEventDraftForUndo: (draft?: EventDraft) => void;
  reorderDraftActionSequence: (
    steps: EventStepDraft[],
    actionId: string,
    targetActionId: string,
    position?: DropPosition,
  ) => EventStepDraft[];
  resetExpandedItems: () => void;
  resetStructuralEditorState: (nextEvent: ExperienceEvent | null) => void;
  resolveCheckId: (checkId: string) => string;
  resolveClassifierId: (
    groupId: string,
    classifierId: string,
  ) => { resolvedClassifierId: string; resolvedGroupId: string };
  resolveGroupId: (groupId: string) => string;
  resolveStepId: (stepId: string) => string;
  resolveToolId: (toolId: string) => string;
  selectedEventId: string;
  setConversationAddMenuCheckId: (checkId: string) => void;
  setConversationAddMenuToolId: (toolId: string) => void;
  setDeletingEventId: Dispatch<SetStateAction<string>>;
  setDraggingEventId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setEventDraft: Dispatch<SetStateAction<EventDraft>>;
  setExperience: Dispatch<SetStateAction<Experience | null>>;
  setIsConversationAddMenuOpen: (isOpen: boolean) => void;
  setIsEventAddMenuOpen: (isOpen: boolean) => void;
  setLastPersistedEvent: (event: ExperienceEvent | null) => void;
  setSelectedEventId: Dispatch<SetStateAction<string>>;
};

export function useEventServerMutations({
  clearActionDragState,
  clearEventAutosaveTimer,
  clearEventUndoHistory,
  closeExpandedItem,
  editorEvents,
  eventDraft,
  experience,
  flushEventAutosave,
  forgetCheckId,
  forgetClassifierId,
  forgetGroupId,
  forgetStepId,
  forgetToolId,
  getSelectedEventParts,
  loadScriptAudioItems,
  normalizedEventSearch,
  openExpandedItem,
  persistedDraftForUndo,
  pushEventStructuralUndo,
  rememberEventDraftForUndo,
  reorderDraftActionSequence,
  resetExpandedItems,
  resetStructuralEditorState,
  resolveCheckId,
  resolveClassifierId,
  resolveGroupId,
  resolveStepId,
  resolveToolId,
  selectedEventId,
  setConversationAddMenuCheckId,
  setConversationAddMenuToolId,
  setDeletingEventId,
  setDraggingEventId,
  setError,
  setEventDraft,
  setExperience,
  setIsConversationAddMenuOpen,
  setIsEventAddMenuOpen,
  setLastPersistedEvent,
  setSelectedEventId,
}: UseEventServerMutationsParams) {
  function applyUpdatedEvent(nextEvent: ExperienceEvent, resetHistory = true) {
    if (!experience) return;

    setLastPersistedEvent(nextEvent);
    const nextExperience = replaceExperienceEvent(experience, nextEvent);
    setExperience(nextExperience);
    setSelectedEventId(nextEvent.id);
    setEventDraft(eventDraftFromEvent(nextEvent));
    if (resetHistory) {
      clearEventUndoHistory();
    }
  }

  function rememberPersistedEventForUndo(selectedEvent: ExperienceEvent) {
    rememberEventDraftForUndo(persistedDraftForUndo(selectedEvent));
  }

  async function selectEditorEvent(nextEventId: string) {
    if (!experience) return false;
    if (nextEventId === selectedEventId) return true;

    const didSave = await flushEventAutosave();
    if (!didSave) return false;

    const nextEvent = getSelectedExperienceEvent(experience, nextEventId);
    setSelectedEventId(nextEvent?.id ?? "");
    setEventDraft(eventDraftFromEvent(nextEvent));
    clearEventUndoHistory();
    resetExpandedItems();
    setDraggingEventId("");
    clearActionDragState();
    setIsEventAddMenuOpen(false);
    setIsConversationAddMenuOpen(false);
    setConversationAddMenuToolId("");
    setConversationAddMenuCheckId("");
    return true;
  }

  async function openEditorRouteSource(eventId: string, itemId?: string) {
    const didSelect = await selectEditorEvent(eventId);
    if (!didSelect) return;
    if (itemId) {
      openExpandedItem(itemId);
    }
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
      pushEventStructuralUndo({ event: payload.event, type: "delete" });
      clearEventUndoHistory();
      resetExpandedItems();
      clearActionDragState();
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
      resetStructuralEditorState(nextSelectedEvent);
      pushEventStructuralUndo({ event: selectedEvent, type: "restore" });
      void loadScriptAudioItems(experience.id, false);
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

  async function reorderEditorEvent(eventId: string, targetEventId: string) {
    if (!experience || eventId === targetEventId || normalizedEventSearch) return;

    const currentIndex = editorEvents.findIndex((event) => event.id === eventId);
    const targetIndex = editorEvents.findIndex(
      (event) => event.id === targetEventId,
    );
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      return;
    }

    const didSave = await flushEventAutosave();
    if (!didSave) return;

    const previousOrder = editorEvents.map((event) => event.id);
    const reorderedEvents = [...editorEvents];
    const [movedEvent] = reorderedEvents.splice(currentIndex, 1);
    reorderedEvents.splice(targetIndex, 0, movedEvent);
    const nextOrder = reorderedEvents.map((event) => event.id);

    setError("");
    setDraggingEventId("");

    try {
      const payload = await apiFetch<{ events: ExperienceEvent[] }>(
        `/api/experiences/${experience.id}/events/reorder/`,
        {
          method: "POST",
          body: JSON.stringify({ eventIds: nextOrder }),
        },
      );
      const nextEvents = sortedExperienceEvents(payload.events);
      const nextSelectedEvent =
        nextEvents.find((event) => event.id === selectedEventId) ??
        nextEvents[0] ??
        null;

      setExperience({
        ...experience,
        events: nextEvents,
      });
      setLastPersistedEvent(nextSelectedEvent);
      setSelectedEventId(nextSelectedEvent?.id ?? "");
      setEventDraft(eventDraftFromEvent(nextSelectedEvent));
      clearEventUndoHistory();
      pushEventStructuralUndo({
        eventIdOrder: previousOrder,
        selectedEventId,
        type: "reorder_events",
      });
    } catch (reorderError) {
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : "Could not reorder events.",
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
      rememberPersistedEventForUndo(selectedEvent);
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
      rememberPersistedEventForUndo(selectedEvent);
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
      rememberPersistedEventForUndo(selectedEvent);
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
      rememberPersistedEventForUndo(selectedEvent);
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
      rememberPersistedEventForUndo(selectedEvent);
      const resolvedGroupId = resolveGroupId(groupId);
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
      const resolvedToolId = resolveToolId(toolId);
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/chat-tools/${resolvedToolId}/`,
        {
          method: "DELETE",
        },
      );
      forgetToolId(toolId);
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
      const resolvedCheckId = resolveCheckId(checkId);
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/conversation-checks/${resolvedCheckId}/`,
        {
          method: "DELETE",
        },
      );
      forgetCheckId(checkId);
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
      const resolvedGroupId = resolveGroupId(groupId);
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${resolvedGroupId}/`,
        {
          method: "DELETE",
        },
      );
      forgetGroupId(groupId);
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
      const { resolvedClassifierId, resolvedGroupId } = resolveClassifierId(
        groupId,
        classifierId,
      );
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/classifier-groups/${resolvedGroupId}/classifiers/${resolvedClassifierId}/`,
        {
          method: "DELETE",
        },
      );
      forgetClassifierId(groupId, classifierId);
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
      const resolvedStepId = resolveStepId(stepId);
      const payload = await apiFetch<{ event: ExperienceEvent }>(
        `/api/experiences/${experience.id}/events/${selectedEvent.id}/steps/${resolvedStepId}/`,
        {
          method: "DELETE",
        },
      );
      forgetStepId(stepId);
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

  async function reorderEventStep(
    stepId: string,
    targetStepId: string,
    position: DropPosition = "before",
  ) {
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

    const nextSteps = reorderDraftActionSequence(
      eventDraft.steps,
      stepId,
      targetStepId,
      position,
    );
    if (nextSteps === eventDraft.steps) return;

    rememberPersistedEventForUndo(selectedEvent);
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

  return {
    addEventChatTool,
    addEventClassifier,
    addEventClassifierGroup,
    addEventConversationCheck,
    addEventStep,
    createEditorEvent,
    deleteEditorEvent,
    deleteEventChatTool,
    deleteEventClassifier,
    deleteEventClassifierGroup,
    deleteEventConversationCheck,
    deleteEventStep,
    openEditorRouteSource,
    reorderEditorEvent,
    reorderEventStep,
    selectEditorEvent,
  };
}
