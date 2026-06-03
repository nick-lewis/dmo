import {
  defaultStepConfigForEvent,
  defaultStepLabel,
} from "../actionRegistry";
import type {
  DropPosition,
  EventActionStep,
  EventChatCaptureDraft,
  EventChatToolDraft,
  EventClassifierDraft,
  EventClassifierGroupDraft,
  EventConversationCheckDraft,
  EventConversationChoiceDraft,
  EventDraft,
  EventStepDraft,
  ExperienceEvent,
  StepConditionDraft,
} from "../types";
import {
  clamp,
  localMessageId,
  mergeConditionDraft,
} from "./eventEditorUtils";

type UseEventDraftMutationsParams = {
  closeExpandedItem: (itemId: string) => void;
  editorEvents: ExperienceEvent[];
  eventDraft: EventDraft;
  openExpandedItem: (itemId: string) => void;
  selectedEventId: string;
  setConversationAddMenuCheckId: (checkId: string) => void;
  setConversationAddMenuToolId: (toolId: string) => void;
  setIsConversationAddMenuOpen: (isOpen: boolean) => void;
  stageEventDraft: (nextDraft: EventDraft) => void;
};

export function useEventDraftMutations({
  closeExpandedItem,
  editorEvents,
  eventDraft,
  openExpandedItem,
  selectedEventId,
  setConversationAddMenuCheckId,
  setConversationAddMenuToolId,
  setIsConversationAddMenuOpen,
  stageEventDraft,
}: UseEventDraftMutationsParams) {
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

  function reorderDraftActionSequence(
    steps: EventStepDraft[],
    actionId: string,
    targetActionId: string,
    position: DropPosition = "before",
  ) {
    const currentIndex = steps.findIndex((step) => step.id === actionId);
    const targetIndex = steps.findIndex((step) => step.id === targetActionId);
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      return steps;
    }

    const reorderedSteps = [...steps];
    const [movedStep] = reorderedSteps.splice(currentIndex, 1);
    const rawInsertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    const insertIndex = clamp(
      rawInsertIndex > currentIndex ? rawInsertIndex - 1 : rawInsertIndex,
      0,
      reorderedSteps.length,
    );
    reorderedSteps.splice(insertIndex, 0, movedStep);
    if (reorderedSteps.every((step, index) => step.id === steps[index]?.id)) {
      return steps;
    }
    return reorderedSteps.map((step, index) => ({
      ...step,
      sortOrder: index,
    }));
  }

  function reorderDraftOrderedItems<T extends { id: string; sortOrder: number }>(
    items: T[],
    itemId: string,
    targetItemId: string,
    position: DropPosition = "before",
  ) {
    const currentIndex = items.findIndex((item) => item.id === itemId);
    const targetIndex = items.findIndex((item) => item.id === targetItemId);
    if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
      return items;
    }

    const reorderedItems = [...items];
    const [movedItem] = reorderedItems.splice(currentIndex, 1);
    const rawInsertIndex = position === "after" ? targetIndex + 1 : targetIndex;
    const insertIndex = clamp(
      rawInsertIndex > currentIndex ? rawInsertIndex - 1 : rawInsertIndex,
      0,
      reorderedItems.length,
    );
    reorderedItems.splice(insertIndex, 0, movedItem);
    if (reorderedItems.every((item, index) => item.id === items[index]?.id)) {
      return items;
    }
    return reorderedItems.map((item, index) => ({
      ...item,
      sortOrder: index,
    }));
  }

  function reorderEventChatTool(
    toolId: string,
    targetToolId: string,
    position: DropPosition = "before",
  ) {
    stageEventDraft({
      ...eventDraft,
      chatTools: reorderDraftOrderedItems(
        eventDraft.chatTools,
        toolId,
        targetToolId,
        position,
      ),
    });
  }

  function reorderEventConversationCheck(
    checkId: string,
    targetCheckId: string,
    position: DropPosition = "before",
  ) {
    stageEventDraft({
      ...eventDraft,
      conversationChecks: reorderDraftOrderedItems(
        eventDraft.conversationChecks,
        checkId,
        targetCheckId,
        position,
      ),
    });
  }

  function reorderEventClassifierGroup(
    groupId: string,
    targetGroupId: string,
    position: DropPosition = "before",
  ) {
    stageEventDraft({
      ...eventDraft,
      classifierGroups: reorderDraftOrderedItems(
        eventDraft.classifierGroups,
        groupId,
        targetGroupId,
        position,
      ),
    });
  }

  function updateEventConversationChoiceDraft(
    choiceId: string,
    updater: (choice: EventConversationChoiceDraft) => EventConversationChoiceDraft,
  ) {
    const nextDraft = {
      ...eventDraft,
      conversationChoices: eventDraft.conversationChoices.map((choice) =>
        choice.id === choiceId ? updater(choice) : choice,
      ),
    };

    stageEventDraft(nextDraft);
  }

  function updateEventConversationChoiceDraftField<
    K extends keyof EventConversationChoiceDraft,
  >(
    choiceId: string,
    field: K,
    value: EventConversationChoiceDraft[K],
  ) {
    updateEventConversationChoiceDraft(choiceId, (choice) => ({
      ...choice,
      [field]: value,
    }));
  }

  function reorderEventConversationChoice(
    choiceId: string,
    targetChoiceId: string,
    position: DropPosition = "before",
  ) {
    stageEventDraft({
      ...eventDraft,
      conversationChoices: reorderDraftOrderedItems(
        eventDraft.conversationChoices,
        choiceId,
        targetChoiceId,
        position,
      ),
    });
  }

  function addEventConversationChoice() {
    const choiceId = localMessageId("conversation-choice");
    const destination = editorEvents.find((event) => event.id !== selectedEventId);
    const nextChoice: EventConversationChoiceDraft = {
      enabled: true,
      iconPath: "",
      id: choiceId,
      label: "Continue",
      sortOrder: eventDraft.conversationChoices.length,
      triggersEvent: destination?.slug ?? "",
    };

    stageEventDraft({
      ...eventDraft,
      conversationChoices: [...eventDraft.conversationChoices, nextChoice],
    });
    openExpandedItem(choiceId);
    setIsConversationAddMenuOpen(false);
  }

  function deleteEventConversationChoice(choiceId: string) {
    stageEventDraft({
      ...eventDraft,
      conversationChoices: eventDraft.conversationChoices
        .filter((choice) => choice.id !== choiceId)
        .map((choice, index) => ({ ...choice, sortOrder: index })),
    });
    closeExpandedItem(choiceId);
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

  function reorderEventChatToolAction(
    toolId: string,
    actionId: string,
    targetActionId: string,
    position: DropPosition = "before",
  ) {
    updateEventChatToolDraft(toolId, (tool) => ({
      ...tool,
      handlerActions: reorderDraftActionSequence(
        tool.handlerActions,
        actionId,
        targetActionId,
        position,
      ),
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

  function reorderEventConversationCheckAction(
    checkId: string,
    actionId: string,
    targetActionId: string,
    position: DropPosition = "before",
  ) {
    updateEventConversationCheckDraft(checkId, (check) => ({
      ...check,
      handlerActions: reorderDraftActionSequence(
        check.handlerActions,
        actionId,
        targetActionId,
        position,
      ),
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

  function reorderEventClassifierGroupAction(
    groupId: string,
    actionId: string,
    targetActionId: string,
    position: DropPosition = "before",
  ) {
    updateEventClassifierGroupDraft(groupId, (group) => ({
      ...group,
      handlerActions: reorderDraftActionSequence(
        group.handlerActions,
        actionId,
        targetActionId,
        position,
      ),
    }));
  }

  return {
    addEventChatCapture,
    addEventChatToolAction,
    addEventClassifierGroupAction,
    addEventConversationCheckAction,
    addEventConversationChoice,
    deleteEventChatCapture,
    deleteEventChatToolAction,
    deleteEventClassifierGroupAction,
    deleteEventConversationCheckAction,
    deleteEventConversationChoice,
    reorderDraftActionSequence,
    reorderEventChatTool,
    reorderEventChatToolAction,
    reorderEventClassifierGroup,
    reorderEventClassifierGroupAction,
    reorderEventConversationCheck,
    reorderEventConversationCheckAction,
    reorderEventConversationChoice,
    updateEventChatCaptureDraft,
    updateEventChatToolActionConfig,
    updateEventChatToolActionConfigPatch,
    updateEventChatToolActionCondition,
    updateEventChatToolActionDraft,
    updateEventChatToolDraft,
    updateEventChatToolDraftField,
    updateEventClassifierDraft,
    updateEventClassifierDraftField,
    updateEventClassifierGroupActionConfig,
    updateEventClassifierGroupActionConfigPatch,
    updateEventClassifierGroupActionCondition,
    updateEventClassifierGroupActionDraft,
    updateEventClassifierGroupDraft,
    updateEventClassifierGroupDraftField,
    updateEventConversationCheckActionConfig,
    updateEventConversationCheckActionConfigPatch,
    updateEventConversationCheckActionCondition,
    updateEventConversationCheckActionDraft,
    updateEventConversationCheckDraft,
    updateEventConversationCheckDraftField,
    updateEventConversationChoiceDraft,
    updateEventConversationChoiceDraftField,
    updateEventDraft,
    updateEventStepConfig,
    updateEventStepConfigPatch,
    updateEventStepCondition,
    updateEventStepDraft,
  };
}
