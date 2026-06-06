import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";

import { apiFetch } from "../api";
import type {
  EventActionStep,
  EventChatTool,
  EventClassifier,
  EventClassifierGroup,
  EventConversationCheck,
  EventDraft,
  Experience,
  ExperienceEvent,
} from "../types";
import {
  chatToolPayloadFromDraft,
  comparableChatTool,
  comparableChatToolDraft,
  comparableClassifier,
  comparableClassifierDraft,
  comparableClassifierGroup,
  comparableClassifierGroupDraft,
  comparableConversationCheck,
  comparableConversationCheckDraft,
  comparableConversationChoice,
  comparableConversationChoiceDraft,
  comparableStep,
  comparableStepDraft,
  conversationCheckPayloadFromDraft,
  conversationChoicePayloadFromDraft,
  eventDraftFromEvent,
  eventDraftHasChanges,
  classifierGroupPayloadFromDraft,
  classifierPayloadFromDraft,
  normalizedStepCondition,
  replaceEventCheckInEvent,
  replaceEventClassifierGroupInEvent,
  replaceEventClassifierInEvent,
  replaceEventStepInEvent,
  replaceEventToolInEvent,
  replaceExperienceClassifier,
  replaceExperienceClassifierGroup,
  replaceExperienceEvent,
  replaceExperienceEventCheck,
  replaceExperienceEventStep,
  replaceExperienceEventTool,
  sortedEventChatTools,
  sortedEventClassifiers,
  sortedEventClassifierGroups,
  sortedEventConversationChecks,
  sortedEventConversationChoices,
  sortedEventSteps,
} from "./eventEditorUtils";

type IdRemapRef = MutableRefObject<Map<string, string>>;

type UseEventAutosavePersistenceParams = {
  eventCheckIdRemap: IdRemapRef;
  eventClassifierIdRemap: IdRemapRef;
  eventGroupIdRemap: IdRemapRef;
  eventStepIdRemap: IdRemapRef;
  eventToolIdRemap: IdRemapRef;
  experience: Experience | null;
  getComparableSelectedEvent: () => ExperienceEvent | null;
  loadScriptAudioItems: (
    targetExperienceId?: string,
    showLoading?: boolean,
  ) => Promise<unknown>;
  setError: Dispatch<SetStateAction<string>>;
  setEventDraft: Dispatch<SetStateAction<EventDraft>>;
  setExperience: Dispatch<SetStateAction<Experience | null>>;
  setLastPersistedEvent: (event: ExperienceEvent | null) => void;
};

export function useEventAutosavePersistence({
  eventCheckIdRemap,
  eventClassifierIdRemap,
  eventGroupIdRemap,
  eventStepIdRemap,
  eventToolIdRemap,
  experience,
  getComparableSelectedEvent,
  loadScriptAudioItems,
  setError,
  setEventDraft,
  setExperience,
  setLastPersistedEvent,
}: UseEventAutosavePersistenceParams) {
  function hasEventChanges(draft: EventDraft) {
    return eventDraftHasChanges(draft, getComparableSelectedEvent());
  }

  async function persistEventDraft(
    draft: EventDraft,
    version: number,
    isCurrentVersion: (version: number) => boolean,
  ) {
    const selectedEvent = getComparableSelectedEvent();
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
      const currentChoices = sortedEventConversationChoices(
        selectedEvent.conversationChoices ?? [],
      );
      const hasChoiceChanges =
        draft.conversationChoices.length !== currentChoices.length ||
        draft.conversationChoices.some((draftChoice) => {
          const currentChoice = currentChoices.find(
            (choice) => choice.id === draftChoice.id,
          );
          if (!currentChoice) return true;
          return (
            JSON.stringify(comparableConversationChoiceDraft(draftChoice)) !==
            JSON.stringify(comparableConversationChoice(currentChoice))
          );
        });

      if (
        draft.title !== selectedEvent.title ||
        draft.description !== selectedEvent.description ||
        draft.chatInstructions !== (selectedEvent.chatInstructions ?? "") ||
        hasChoiceChanges
      ) {
        const eventPayload = await apiFetch<{ event: ExperienceEvent }>(
          `/api/experiences/${experience.id}/events/${selectedEvent.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              chatInstructions: draft.chatInstructions,
              conversationChoices: draft.conversationChoices.map(
                conversationChoicePayloadFromDraft,
              ),
              description: draft.description,
              title: draft.title,
            }),
          },
        );
        persistedEvent = eventPayload.event;

        if (isCurrentVersion(version)) {
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

        if (isCurrentVersion(version)) {
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

      if (latestToolStructuralEvent && isCurrentVersion(version)) {
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

      if (latestCheckStructuralEvent && isCurrentVersion(version)) {
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

      if (latestGroupStructuralEvent && isCurrentVersion(version)) {
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

        if (isCurrentVersion(version)) {
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

        if (isCurrentVersion(version)) {
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

        if (isCurrentVersion(version)) {
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

          if (isCurrentVersion(version)) {
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

          if (isCurrentVersion(version)) {
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

      if (isCurrentVersion(version)) {
        setLastPersistedEvent(persistedEvent);
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
        void loadScriptAudioItems(experience.id, false);
      }

      return true;
    } catch (saveError) {
      if (isCurrentVersion(version)) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save event.",
        );
      }
      return false;
    }
  }

  return {
    hasEventChanges,
    persistEventDraft,
  };
}
