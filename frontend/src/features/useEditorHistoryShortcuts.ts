import { useEffect } from "react";

import type {
  EventDraft,
  EventStructuralHistoryItem,
} from "../types";

export function useEditorHistoryShortcuts({
  eventDraft,
  eventRedoStack,
  eventStructuralRedoStack,
  eventStructuralUndoStack,
  eventUndoStack,
  redoEditorHistory,
  undoEditorHistory,
}: {
  eventDraft: EventDraft;
  eventRedoStack: EventDraft[];
  eventStructuralRedoStack: EventStructuralHistoryItem[];
  eventStructuralUndoStack: EventStructuralHistoryItem[];
  eventUndoStack: EventDraft[];
  redoEditorHistory: () => void;
  undoEditorHistory: () => void;
}) {
  useEffect(() => {
    function handleEditorHistoryShortcut(event: KeyboardEvent) {
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const isScriptEditorTarget =
        target instanceof HTMLElement &&
        Boolean(target.closest(".script-action-editor"));
      if ((!event.ctrlKey && !event.metaKey) || (isTypingTarget && !isScriptEditorTarget)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoEditorHistory();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        undoEditorHistory();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        redoEditorHistory();
      }
    }

    document.addEventListener("keydown", handleEditorHistoryShortcut);
    return () =>
      document.removeEventListener("keydown", handleEditorHistoryShortcut);
  }, [
    eventDraft,
    eventRedoStack,
    eventStructuralRedoStack,
    eventStructuralUndoStack,
    eventUndoStack,
  ]);
}
