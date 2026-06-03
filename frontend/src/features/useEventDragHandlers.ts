import type {
  Dispatch,
  DragEvent,
  SetStateAction,
} from "react";
import type {
  ConversationItemDropTarget,
  DraggingConversationItem,
  DraggingHandlerAction,
  DropPosition,
  EventStepDropTarget,
  HandlerActionDropTarget,
} from "../types";
import {
  conversationItemDragMimeType,
  handlerActionDragMimeType,
} from "./eventEditorUtils";

type UseEventDragHandlersParams = {
  conversationItemDropTarget: ConversationItemDropTarget | null;
  draggingConversationItem: DraggingConversationItem | null;
  draggingEventId: string;
  draggingHandlerAction: DraggingHandlerAction | null;
  draggingStepId: string;
  eventStepDropTarget: EventStepDropTarget | null;
  handlerActionDropTarget: HandlerActionDropTarget | null;
  normalizedEventSearch: string;
  reorderEditorEvent: (
    eventId: string,
    targetEventId: string,
  ) => Promise<void>;
  reorderEventChatTool: (
    toolId: string,
    targetToolId: string,
    position?: DropPosition,
  ) => void;
  reorderEventChatToolAction: (
    toolId: string,
    actionId: string,
    targetActionId: string,
    position?: DropPosition,
  ) => void;
  reorderEventClassifierGroup: (
    groupId: string,
    targetGroupId: string,
    position?: DropPosition,
  ) => void;
  reorderEventClassifierGroupAction: (
    groupId: string,
    actionId: string,
    targetActionId: string,
    position?: DropPosition,
  ) => void;
  reorderEventConversationCheck: (
    checkId: string,
    targetCheckId: string,
    position?: DropPosition,
  ) => void;
  reorderEventConversationCheckAction: (
    checkId: string,
    actionId: string,
    targetActionId: string,
    position?: DropPosition,
  ) => void;
  reorderEventConversationChoice: (
    choiceId: string,
    targetChoiceId: string,
    position?: DropPosition,
  ) => void;
  reorderEventStep: (
    stepId: string,
    targetStepId: string,
    position?: DropPosition,
  ) => Promise<void>;
  setConversationItemDropTarget: Dispatch<
    SetStateAction<ConversationItemDropTarget | null>
  >;
  setDraggingConversationItem: Dispatch<
    SetStateAction<DraggingConversationItem | null>
  >;
  setDraggingHandlerAction: Dispatch<
    SetStateAction<DraggingHandlerAction | null>
  >;
  setDraggingEventId: Dispatch<SetStateAction<string>>;
  setDraggingStepId: Dispatch<SetStateAction<string>>;
  setEventStepDropTarget: Dispatch<SetStateAction<EventStepDropTarget | null>>;
  setHandlerActionDropTarget: Dispatch<
    SetStateAction<HandlerActionDropTarget | null>
  >;
};

export function useEventDragHandlers({
  conversationItemDropTarget,
  draggingConversationItem,
  draggingEventId,
  draggingHandlerAction,
  draggingStepId,
  eventStepDropTarget,
  handlerActionDropTarget,
  normalizedEventSearch,
  reorderEditorEvent,
  reorderEventChatTool,
  reorderEventChatToolAction,
  reorderEventClassifierGroup,
  reorderEventClassifierGroupAction,
  reorderEventConversationCheck,
  reorderEventConversationCheckAction,
  reorderEventConversationChoice,
  reorderEventStep,
  setConversationItemDropTarget,
  setDraggingConversationItem,
  setDraggingHandlerAction,
  setDraggingEventId,
  setDraggingStepId,
  setEventStepDropTarget,
  setHandlerActionDropTarget,
}: UseEventDragHandlersParams) {
  function dragEditorEvent(event: DragEvent<HTMLElement>, eventId: string) {
    if (normalizedEventSearch) return;
    setDraggingEventId(eventId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", eventId);
  }

  function dragOverEditorEvent(event: DragEvent<HTMLElement>) {
    if (normalizedEventSearch) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  async function dropEditorEvent(
    event: DragEvent<HTMLElement>,
    targetEventId: string,
  ) {
    if (normalizedEventSearch) return;
    event.preventDefault();
    const sourceEventId =
      event.dataTransfer.getData("text/plain") || draggingEventId;
    setDraggingEventId("");
    if (!sourceEventId || sourceEventId === targetEventId) return;
    await reorderEditorEvent(sourceEventId, targetEventId);
  }

  function shouldIgnoreActionDragStart(event: DragEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest(".event-drag-handle")) return false;
    if (target.closest(".event-step-summary")) return false;
    if (target.closest(".event-step-detail")) return true;
    const isEditableControl = Boolean(
      target.closest(
        [
          "input",
          "textarea",
          "select",
          "a",
          "[contenteditable='true']",
          "[role='tab']",
        ].join(","),
      ),
    );
    if (isEditableControl) return true;
    if (target.closest(".chat-exit-summary")) return false;
    return Boolean(target.closest("button,[role='button']"));
  }

  function dragPositionFromEvent(event: DragEvent<HTMLElement>): DropPosition {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function dragEventStep(
    event: DragEvent<HTMLElement>,
    stepId: string,
  ) {
    if (shouldIgnoreActionDragStart(event)) {
      event.preventDefault();
      return;
    }
    setDraggingStepId(stepId);
    setEventStepDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", stepId);
  }

  function dragOverEventStep(
    event: DragEvent<HTMLElement>,
    targetStepId: string,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!draggingStepId || draggingStepId === targetStepId) {
      setEventStepDropTarget(null);
      return;
    }
    setEventStepDropTarget({
      position: dragPositionFromEvent(event),
      stepId: targetStepId,
    });
  }

  function dragLeaveEventStep(
    event: DragEvent<HTMLElement>,
    targetStepId: string,
  ) {
    if (
      event.currentTarget.contains(event.relatedTarget as Node | null)
    ) {
      return;
    }
    setEventStepDropTarget((current) =>
      current?.stepId === targetStepId ? null : current,
    );
  }

  async function dropEventStep(
    event: DragEvent<HTMLElement>,
    targetStepId: string,
  ) {
    event.preventDefault();
    const sourceStepId =
      event.dataTransfer.getData("text/plain") || draggingStepId;
    const position =
      eventStepDropTarget?.stepId === targetStepId
        ? eventStepDropTarget.position
        : dragPositionFromEvent(event);
    setDraggingStepId("");
    setEventStepDropTarget(null);
    if (!sourceStepId || sourceStepId === targetStepId) return;
    await reorderEventStep(sourceStepId, targetStepId, position);
  }

  function serializeConversationItemDrag(payload: DraggingConversationItem) {
    return JSON.stringify(payload);
  }

  function parseConversationItemDrag(value: string) {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value) as Partial<DraggingConversationItem>;
      if (
        (parsed.itemKind === "chatTool" ||
          parsed.itemKind === "conversationCheck" ||
          parsed.itemKind === "classifierGroup" ||
          parsed.itemKind === "conversationChoice") &&
        typeof parsed.itemId === "string"
      ) {
        return parsed as DraggingConversationItem;
      }
    } catch {
      return null;
    }

    return null;
  }

  function dragConversationItem(
    event: DragEvent<HTMLElement>,
    payload: DraggingConversationItem,
  ) {
    if (shouldIgnoreActionDragStart(event)) {
      event.preventDefault();
      return;
    }
    const serializedPayload = serializeConversationItemDrag(payload);
    setDraggingConversationItem(payload);
    setConversationItemDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(conversationItemDragMimeType, serializedPayload);
    event.dataTransfer.setData("text/plain", serializedPayload);
  }

  function dragOverConversationItem(
    event: DragEvent<HTMLElement>,
    target: DraggingConversationItem,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (
      !draggingConversationItem ||
      draggingConversationItem.itemId === target.itemId ||
      draggingConversationItem.itemKind !== target.itemKind
    ) {
      setConversationItemDropTarget(null);
      return;
    }
    setConversationItemDropTarget({
      ...target,
      position: dragPositionFromEvent(event),
    });
  }

  function dragLeaveConversationItem(
    event: DragEvent<HTMLElement>,
    target: DraggingConversationItem,
  ) {
    if (
      event.currentTarget.contains(event.relatedTarget as Node | null)
    ) {
      return;
    }
    setConversationItemDropTarget((current) =>
      current?.itemId === target.itemId && current.itemKind === target.itemKind
        ? null
        : current,
    );
  }

  function dropConversationItem(
    event: DragEvent<HTMLElement>,
    target: DraggingConversationItem,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const source =
      parseConversationItemDrag(
        event.dataTransfer.getData(conversationItemDragMimeType),
      ) ??
      parseConversationItemDrag(event.dataTransfer.getData("text/plain")) ??
      draggingConversationItem;
    const position =
      conversationItemDropTarget?.itemId === target.itemId &&
      conversationItemDropTarget.itemKind === target.itemKind
        ? conversationItemDropTarget.position
        : dragPositionFromEvent(event);
    setDraggingConversationItem(null);
    setConversationItemDropTarget(null);
    if (
      !source ||
      source.itemId === target.itemId ||
      source.itemKind !== target.itemKind
    ) {
      return;
    }

    if (source.itemKind === "chatTool") {
      reorderEventChatTool(source.itemId, target.itemId, position);
      return;
    }

    if (source.itemKind === "conversationCheck") {
      reorderEventConversationCheck(source.itemId, target.itemId, position);
      return;
    }

    if (source.itemKind === "conversationChoice") {
      reorderEventConversationChoice(source.itemId, target.itemId, position);
      return;
    }

    reorderEventClassifierGroup(source.itemId, target.itemId, position);
  }

  function isDraggingConversationItem(payload: DraggingConversationItem) {
    return (
      draggingConversationItem?.itemKind === payload.itemKind &&
      draggingConversationItem.itemId === payload.itemId
    );
  }

  function serializeHandlerActionDrag(payload: DraggingHandlerAction) {
    return JSON.stringify(payload);
  }

  function parseHandlerActionDrag(value: string) {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value) as Partial<DraggingHandlerAction>;
      if (
        (parsed.ownerKind === "chatTool" ||
          parsed.ownerKind === "conversationCheck" ||
          parsed.ownerKind === "classifierGroup") &&
        typeof parsed.ownerId === "string" &&
        typeof parsed.actionId === "string"
      ) {
        return parsed as DraggingHandlerAction;
      }
    } catch {
      return null;
    }

    return null;
  }

  function dragHandlerAction(
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) {
    event.stopPropagation();
    if (shouldIgnoreActionDragStart(event)) {
      event.preventDefault();
      return;
    }
    const serializedPayload = serializeHandlerActionDrag(payload);
    setDraggingHandlerAction(payload);
    setHandlerActionDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(handlerActionDragMimeType, serializedPayload);
    event.dataTransfer.setData("text/plain", serializedPayload);
  }

  function dragOverHandlerAction(
    event: DragEvent<HTMLElement>,
    target: DraggingHandlerAction,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (
      !draggingHandlerAction ||
      draggingHandlerAction.actionId === target.actionId ||
      draggingHandlerAction.ownerId !== target.ownerId ||
      draggingHandlerAction.ownerKind !== target.ownerKind
    ) {
      setHandlerActionDropTarget(null);
      return;
    }
    setHandlerActionDropTarget({
      ...target,
      position: dragPositionFromEvent(event),
    });
  }

  function dragLeaveHandlerAction(
    event: DragEvent<HTMLElement>,
    target: DraggingHandlerAction,
  ) {
    event.stopPropagation();
    if (
      event.currentTarget.contains(event.relatedTarget as Node | null)
    ) {
      return;
    }
    setHandlerActionDropTarget((current) =>
      current?.actionId === target.actionId &&
      current.ownerId === target.ownerId &&
      current.ownerKind === target.ownerKind
        ? null
        : current,
    );
  }

  function dropHandlerAction(
    event: DragEvent<HTMLElement>,
    target: DraggingHandlerAction,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const source =
      parseHandlerActionDrag(
        event.dataTransfer.getData(handlerActionDragMimeType),
      ) ??
      parseHandlerActionDrag(event.dataTransfer.getData("text/plain")) ??
      draggingHandlerAction;
    const position =
      handlerActionDropTarget?.actionId === target.actionId &&
      handlerActionDropTarget.ownerId === target.ownerId &&
      handlerActionDropTarget.ownerKind === target.ownerKind
        ? handlerActionDropTarget.position
        : dragPositionFromEvent(event);
    setDraggingHandlerAction(null);
    setHandlerActionDropTarget(null);
    if (
      !source ||
      source.actionId === target.actionId ||
      source.ownerId !== target.ownerId ||
      source.ownerKind !== target.ownerKind
    ) {
      return;
    }

    if (source.ownerKind === "chatTool") {
      reorderEventChatToolAction(
        source.ownerId,
        source.actionId,
        target.actionId,
        position,
      );
      return;
    }

    if (source.ownerKind === "conversationCheck") {
      reorderEventConversationCheckAction(
        source.ownerId,
        source.actionId,
        target.actionId,
        position,
      );
      return;
    }

    reorderEventClassifierGroupAction(
      source.ownerId,
      source.actionId,
      target.actionId,
      position,
    );
  }

  function isDraggingHandlerAction(payload: DraggingHandlerAction) {
    return (
      draggingHandlerAction?.ownerKind === payload.ownerKind &&
      draggingHandlerAction.ownerId === payload.ownerId &&
      draggingHandlerAction.actionId === payload.actionId
    );
  }

  return {
    dragConversationItem,
    dragEditorEvent,
    dragEventStep,
    dragHandlerAction,
    dragLeaveConversationItem,
    dragLeaveEventStep,
    dragLeaveHandlerAction,
    dragOverConversationItem,
    dragOverEditorEvent,
    dragOverEventStep,
    dragOverHandlerAction,
    dropConversationItem,
    dropEditorEvent,
    dropEventStep,
    dropHandlerAction,
    isDraggingConversationItem,
    isDraggingHandlerAction,
  };
}
