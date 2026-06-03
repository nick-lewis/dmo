import type { DragEvent } from "react";

import type {
  ConversationItemDropTarget,
  DraggingConversationItem,
  DraggingHandlerAction,
  ExperienceEvent,
  HandlerActionDropTarget,
  ScriptAudioItem,
} from "../types";

export type ConversationItemInteractionProps = {
  clearActionDragState: () => void;
  conversationItemDropTarget: ConversationItemDropTarget | null;
  dragConversationItem: (
    event: DragEvent<HTMLElement>,
    payload: DraggingConversationItem,
  ) => void;
  dragLeaveConversationItem: (
    event: DragEvent<HTMLElement>,
    payload: DraggingConversationItem,
  ) => void;
  dragOverConversationItem: (
    event: DragEvent<HTMLElement>,
    payload: DraggingConversationItem,
  ) => void;
  dropConversationItem: (
    event: DragEvent<HTMLElement>,
    payload: DraggingConversationItem,
  ) => void;
  editorEvents: ExperienceEvent[];
  isDraggingConversationItem: (payload: DraggingConversationItem) => boolean;
  isExpandedItem: (itemId: string) => boolean;
  toggleExpandedItem: (itemId: string) => void;
};

export type HandlerActionInteractionProps = {
  closeExpandedItem: (itemId: string) => void;
  dragHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  dragLeaveHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  dragOverHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  dropHandlerAction: (
    event: DragEvent<HTMLElement>,
    payload: DraggingHandlerAction,
  ) => void;
  handlerActionDropTarget: HandlerActionDropTarget | null;
  isDraggingHandlerAction: (payload: DraggingHandlerAction) => boolean;
  openExpandedItem: (itemId: string) => void;
  scriptAudioItems: ScriptAudioItem[];
};
