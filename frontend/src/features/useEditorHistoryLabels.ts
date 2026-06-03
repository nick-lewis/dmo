import { useMemo } from "react";

import type {
  EventDraft,
  EventStructuralHistoryItem,
} from "../types";

function structuralHistoryEventLabel(item: EventStructuralHistoryItem) {
  if (item.type === "reorder_events") return "events";
  return item.event.title || item.event.slug || "event";
}

export function useEditorHistoryLabels({
  eventRedoStack,
  eventStructuralRedoStack,
  eventStructuralUndoStack,
  eventUndoStack,
}: {
  eventRedoStack: EventDraft[];
  eventStructuralRedoStack: EventStructuralHistoryItem[];
  eventStructuralUndoStack: EventStructuralHistoryItem[];
  eventUndoStack: EventDraft[];
}) {
  return useMemo(() => {
    const nextStructuralUndo = eventStructuralUndoStack[0];
    const nextStructuralRedo = eventStructuralRedoStack[0];
    const canUndoEditorHistory =
      eventUndoStack.length > 0 || Boolean(nextStructuralUndo);
    const undoEditorTitle = eventUndoStack.length
      ? `Undo event edit (${eventUndoStack.length} available)`
      : nextStructuralUndo?.type === "reorder_events"
        ? `Restore previous event order (${eventStructuralUndoStack.length} structural available)`
        : nextStructuralUndo?.type === "restore"
          ? `Restore deleted event: ${structuralHistoryEventLabel(nextStructuralUndo)} (${eventStructuralUndoStack.length} structural available)`
          : nextStructuralUndo?.type === "delete"
            ? `Remove new event: ${structuralHistoryEventLabel(nextStructuralUndo)} (${eventStructuralUndoStack.length} structural available)`
            : "Nothing to undo";
    const canRedoEditorHistory =
      eventRedoStack.length > 0 || Boolean(nextStructuralRedo);
    const redoEditorTitle = eventRedoStack.length
      ? `Redo event edit (${eventRedoStack.length} available)`
      : nextStructuralRedo?.type === "reorder_events"
        ? `Reapply event order (${eventStructuralRedoStack.length} structural available)`
        : nextStructuralRedo?.type === "restore"
          ? `Restore event: ${structuralHistoryEventLabel(nextStructuralRedo)} (${eventStructuralRedoStack.length} structural available)`
          : nextStructuralRedo?.type === "delete"
            ? `Delete event again: ${structuralHistoryEventLabel(nextStructuralRedo)} (${eventStructuralRedoStack.length} structural available)`
            : "Nothing to redo";

    return {
      canRedoEditorHistory,
      canUndoEditorHistory,
      redoEditorTitle,
      undoEditorTitle,
    };
  }, [
    eventRedoStack,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    eventUndoStack,
  ]);
}
