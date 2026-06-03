import { useState } from "react";

import type {
  ConversationItemDropTarget,
  DraggingConversationItem,
  DraggingHandlerAction,
  EventStepDropTarget,
  HandlerActionDropTarget,
} from "../types";

export function useEditorDragState() {
  const [draggingEventId, setDraggingEventId] = useState("");
  const [draggingStepId, setDraggingStepId] = useState("");
  const [eventStepDropTarget, setEventStepDropTarget] =
    useState<EventStepDropTarget | null>(null);
  const [draggingConversationItem, setDraggingConversationItem] =
    useState<DraggingConversationItem | null>(null);
  const [conversationItemDropTarget, setConversationItemDropTarget] =
    useState<ConversationItemDropTarget | null>(null);
  const [draggingHandlerAction, setDraggingHandlerAction] =
    useState<DraggingHandlerAction | null>(null);
  const [handlerActionDropTarget, setHandlerActionDropTarget] =
    useState<HandlerActionDropTarget | null>(null);

  function clearActionDragState() {
    setDraggingStepId("");
    setEventStepDropTarget(null);
    setDraggingConversationItem(null);
    setConversationItemDropTarget(null);
    setDraggingHandlerAction(null);
    setHandlerActionDropTarget(null);
  }

  return {
    clearActionDragState,
    conversationItemDropTarget,
    draggingConversationItem,
    draggingEventId,
    draggingHandlerAction,
    draggingStepId,
    eventStepDropTarget,
    handlerActionDropTarget,
    setConversationItemDropTarget,
    setDraggingConversationItem,
    setDraggingEventId,
    setDraggingHandlerAction,
    setDraggingStepId,
    setEventStepDropTarget,
    setHandlerActionDropTarget,
  };
}
